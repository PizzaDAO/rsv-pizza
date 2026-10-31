// basil-14648: AI / OPOP pizza ordering through the RSV backend (which brokers to pizza-mcp).
// The browser never talks to pizza-mcp and never sees a price that is not from a quote or the shop.
import { useEffect, useState } from 'react';
import { apiRequest } from './api';
import type { PizzaRecommendation } from '../types';

/** Build-time switch. The backend party allowlist is the authoritative gate (see getPizzaOrderConfig). */
export const AI_ORDERING_ENABLED = import.meta.env.VITE_AI_ORDERING === '1';

export interface PizzaShop {
  id: string;
  name: string;
  tier: 'native' | 'partner_pos' | 'listing';
  capability_summary: string;
  ordering?: { channel: 'api' | 'ai_phone' | 'handoff'; call_countries_ok: boolean; reasons: string[] };
  address: Record<string, unknown>;
  phone: string | null;
  website?: string | null;
  attribution?: string | null;
  distance_km: number | null;
  open_now: boolean;
}

export interface CartLine {
  id: string;
  item_name: string;
  size_name: string | null;
  quantity: number;
  summary: string;
  dietary_firm?: string[];
}
export interface PizzaCart {
  id: string;
  pizzeria_id: string;
  version: number;
  lines: CartLine[];
  ready_for_quote: boolean;
}
export interface PizzaQuote {
  quote_id: string;
  read_back: string;
  binding?: boolean;
  estimate?: { low_cents: number; expected_cents: number; high_cents: number; confidence: 'high' | 'medium' | 'low' };
  price_ceiling_cents?: number;
  total_display: string;
  totals: { total_cents: number };
}
export type CartDecision = 'omit_toppings' | 'drop_line';
/** A pizza we could not fit to this shop's menu: the host answers, the rest of the order is kept. */
export interface CartIssue {
  ref: string;
  /** Human label for the pizza (never an id). */
  label: string;
  kind: 'topping_unavailable' | 'unresolved';
  ask_user: string;
  unmatched: string[];
  choices: Array<{ id: CartDecision; label: string }>;
}
export interface CartResponse {
  cart: PizzaCart | null;
  quote: PizzaQuote | null;
  issues: CartIssue[];
  /** Size changes, left-off toppings: shown before the host approves. */
  notices: string[];
  dropped: Array<{ ref: string; label: string }>;
  recommendationVersion: string;
  capCents: number | null;
  /** What the host may still spend: cap minus receipts minus open orders. */
  remainingCapCents: number | null;
}

export interface NextAction {
  type: 'open_url' | 'none';
  url?: string | null;
  message?: string;
  expires_at?: string | null;
}
export interface PizzaOrderView {
  id: string;
  opopOrderId: string;
  tier: 'native' | 'listing';
  shopId: string;
  shopName: string;
  status: string;
  paymentStatus: string | null;
  ceilingCents: number | null;
  confirmedTotalCents: number | null;
  readyAtText: string | null;
  summary: string | null;
  payoutDocumentId: string | null;
  // `deferred_calls` is optional: pizza-mcp may or may not expose it yet.
  call: {
    attempts?: number;
    last_outcome?: string | null;
    shop_total_cents?: number | null;
    ready_at_text?: string | null;
    changes?: string[];
    // Optional: set by pizza-mcp while the order is `calling` but the shop has not been dialed yet.
    deferred?: { until?: string | null; reason?: string | null; message?: string | null } | null;
  } | null;
  nextAction: NextAction | null;
  /**
   * What pizza-mcp says happened when the order ended without a confirmation. null/absent while in flight,
   * confirmed, or when pizza-mcp does not send it (older versions): the copy must then stay cautious.
   * nothing_ordered true = sure nothing was placed; false = an order MAY exist, check with the shop.
   */
  outcome?: { nothing_ordered: boolean; reason: string; message: string } | null;
  isMine: boolean;
  /** Approval expired with nothing to open: the host can simply start over. */
  restartable?: boolean;
  cancelable?: boolean;
  /** A fresh confirmation is still polled: the post-call check can downgrade it. */
  settling?: boolean;
  /** needs_review that holds budget: the host can say nothing was ordered. */
  releasable?: boolean;
  released?: boolean;
  receiptCovered?: boolean;
}

// Mirrors pizza-mcp's TERMINAL (+ `completed` for native). approval_timeout is NOT terminal there.
export const TERMINAL_STATUSES = [
  'confirmed_by_shop', 'needs_review', 'shop_requires_prepay', 'refused', 'unreachable', 'canceled', 'completed',
];
export const isTerminalStatus = (s: string) => TERMINAL_STATUSES.includes(s);

const base = (partyId: string) => `/api/parties/${partyId}/pizza`;

export interface PizzaOrderConfig {
  enabled: boolean;
  capCents: number | null;
  remainingCapCents: number | null;
  /** e.g. NO_REIMBURSEMENT_CAP / CAP_EXHAUSTED: ordering is on for the party but blocked right now. */
  blockedReason: string | null;
  location: { lat: number | null; lng: number | null; address: string | null } | null;
}
export const getPizzaOrderConfig = (partyId: string) => apiRequest<PizzaOrderConfig>(`${base(partyId)}/config`);

/**
 * True only when the build flag is on AND the backend allowlists this party. Until the answer is in
 * (or if it fails) nothing renders: the flag alone must never show UI to a host who is not in the pilot.
 */
export function usePizzaOrderingEnabled(partyId: string | undefined): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    if (!AI_ORDERING_ENABLED || !partyId) return;
    let cancelled = false;
    getPizzaOrderConfig(partyId)
      .then((c) => !cancelled && setEnabled(c.enabled === true))
      .catch(() => !cancelled && setEnabled(false));
    return () => {
      cancelled = true;
    };
  }, [partyId]);
  return AI_ORDERING_ENABLED && !!partyId && enabled;
}

export const getPizzaShops = (partyId: string) => apiRequest<{ pizzerias: PizzaShop[]; note?: string }>(`${base(partyId)}/shops`);

/** Only the facts the backend turns into order text; nothing else leaves the browser. */
export function toRecommendationPayload(recs: PizzaRecommendation[]) {
  return recs.map((r) => ({
    id: r.id,
    quantity: r.quantity ?? 1,
    size: { diameter: r.size?.diameter, name: r.size?.name },
    style: { name: r.style?.name },
    toppings: (r.toppings ?? []).map((t) => ({ name: t.name })),
    dietaryRestrictions: r.dietaryRestrictions ?? [],
    label: r.label,
    isHalfAndHalf: r.isHalfAndHalf,
    leftHalf: r.leftHalf && { toppings: r.leftHalf.toppings.map((t) => ({ name: t.name })), dietaryRestrictions: r.leftHalf.dietaryRestrictions },
    rightHalf: r.rightHalf && { toppings: r.rightHalf.toppings.map((t) => ({ name: t.name })), dietaryRestrictions: r.rightHalf.dietaryRestrictions },
  }));
}

export const buildPizzaCart = (
  partyId: string,
  shopId: string,
  recs: PizzaRecommendation[],
  pickupAt: string,
  decisions: Record<string, CartDecision> = {}
) =>
  apiRequest<CartResponse>(`${base(partyId)}/cart`, {
    method: 'POST',
    body: { shopId, pickupAt, recommendations: toRecommendationPayload(recs), decisions },
    timeoutMs: 60_000,
  });

export const editPizzaCart = (partyId: string, cartId: string, ops: unknown[], expectedVersion?: number) =>
  apiRequest<{ cart: PizzaCart; quote: PizzaQuote | null }>(`${base(partyId)}/cart/${cartId}`, {
    method: 'PATCH',
    body: { ops, expectedVersion },
  });

export interface PlaceOrderInput {
  quoteId: string;
  cartId: string;
  shopId: string;
  recommendationVersion: string;
  contact: { name: string; phone: string; email?: string };
  /** Phone orders only; native orders have no ceiling. */
  policy: { ceilingCents?: number; substitution?: 'exact' | 'deals_ok'; minPizzaCount?: number };
  /** The host explicitly confirmed a second order while one is live or confirmed. */
  allowAnother?: boolean;
}
export const placePizzaOrder = (partyId: string, input: PlaceOrderInput) =>
  apiRequest<{ order: PizzaOrderView; next_action: NextAction | null }>(`${base(partyId)}/orders`, { method: 'POST', body: input });

export const cancelPizzaOrder = (partyId: string, orderId: string) =>
  apiRequest<{ order: PizzaOrderView }>(`${base(partyId)}/orders/${orderId}/cancel`, { method: 'POST', body: {} });

/** Remove the reminder line a pizza order leaves in the receipts list (never a real receipt). */
export const removeOrderDraft = (partyId: string, docId: string) =>
  apiRequest<{ removedDraft: boolean }>(`/api/parties/${partyId}/reimbursement/receipts/${docId}`, { method: 'DELETE' });

export const settlePizzaOrder = (partyId: string, orderId: string, action: 'nothing_ordered' | 'receipt_uploaded') =>
  apiRequest<{ order: PizzaOrderView }>(`${base(partyId)}/orders/${orderId}/settle`, { method: 'POST', body: { action } });

export const getPizzaOrders = (partyId: string) => apiRequest<{ orders: PizzaOrderView[] }>(`${base(partyId)}/orders`);
export const getPizzaOrder = (partyId: string, orderId: string) =>
  apiRequest<{ order: PizzaOrderView; stale: boolean }>(`${base(partyId)}/orders/${orderId}`);

// ---- display helpers -------------------------------------------------------

export function shopBadge(shop: Pick<PizzaShop, 'tier' | 'ordering'>): { label: string; tone: 'green' | 'purple' | 'gray'; orderable: boolean } {
  const channel = shop.ordering?.channel ?? (shop.tier === 'native' ? 'api' : 'handoff');
  if (channel === 'api') return { label: 'Orders instantly', tone: 'green', orderable: true };
  if (channel === 'ai_phone') return { label: 'AI calls for you, pay at pickup', tone: 'purple', orderable: true };
  return { label: 'Call it yourself', tone: 'gray', orderable: false };
}

export const formatCents = (c: number | null | undefined) => (c == null ? '' : `$${(c / 100).toFixed(2)}`);

/** US/CA-friendly: "(617) 555-0123", "617-555-0123" or "+1 617 555 0123" -> "+16175550123"; else null. */
export function toE164(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, '');
  if (/^\+[1-9]\d{6,14}$/.test(digits)) return digits;
  const d = digits.replace(/\D/g, '');
  if (d.length === 10) return `+1${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return null;
}

export interface StatusInfo {
  title: string;
  detail: string;
  tone: 'info' | 'action' | 'success' | 'warn' | 'error';
}
export function statusInfo(o: Pick<PizzaOrderView, 'status' | 'shopName' | 'confirmedTotalCents' | 'readyAtText' | 'call' | 'outcome'> & { restartable?: boolean }): StatusInfo {
  const total = formatCents(o.confirmedTotalCents ?? o.call?.shop_total_cents ?? null);
  // pizza-mcp's own words win once it has said what happened (never inferred from totals or transcripts).
  const oc = o.outcome;
  if (oc && ['needs_review', 'refused', 'unreachable', 'canceled', 'shop_requires_prepay', 'approval_timeout'].includes(o.status)) {
    const check = `An order may exist at ${o.shopName}. Check with them before ordering again.`;
    const ambiguous = oc.reason === 'ambiguous_dial';
    return {
      title: oc.nothing_ordered ? `Nothing was ordered at ${o.shopName}` : `Check with ${o.shopName} before ordering again`,
      detail: [oc.message, ambiguous ? `Do NOT order again until you have called ${o.shopName} to find out whether they took it.` : oc.nothing_ordered ? '' : check]
        .filter(Boolean)
        .join(' '),
      tone: oc.nothing_ordered ? (o.status === 'canceled' ? 'error' : 'warn') : 'warn',
    };
  }
  switch (o.status) {
    case 'awaiting_approval':
      if (o.restartable) return { title: 'The approval link expired', detail: 'Nothing was ordered. Start over to place it again.', tone: 'warn' };
      return { title: 'Approve the order', detail: 'Enter the code we emailed you on the approval page. Nothing is ordered until you do.', tone: 'action' };
    case 'calling':
      return { title: `Calling ${o.shopName}`, detail: 'Our AI is placing your order by phone. This usually takes a few minutes.', tone: 'info' };
    case 'awaiting_price_approval':
      return { title: 'Shop quoted a higher price', detail: `${o.shopName} said ${total || 'more than your ceiling'}. They are holding the line while you approve.`, tone: 'action' };
    case 'confirmed_by_shop':
      return { title: `${o.shopName} confirmed`, detail: `${total ? `Total ${total}. ` : ''}${o.readyAtText ? `Ready ${o.readyAtText}. ` : ''}Pay at pickup, then upload the real receipt as usual (the reminder line in your Receipts list is not a receipt).`, tone: 'success' };
    case 'needs_review':
      // Honest for both cases: the shop may have taken the order, or nothing may have been ordered at all
      // (a phone menu, voicemail, or a price over your limit). Optional `reason` comes from pizza-mcp when it sends one.
      return {
        title: `We could not confirm the order at ${o.shopName}`,
        detail: `It may be that nothing was ordered, or that the shop did take it. Call ${o.shopName} to check before you rely on it. If nothing was ordered, release it below so it stops counting against your budget.`,
        tone: 'warn',
      };
    case 'shop_requires_prepay':
      return { title: 'The shop wants payment up front', detail: 'We never pay by phone. Call the shop yourself using the order below.', tone: 'warn' };
    case 'refused':
      return { title: 'The shop declined the call', detail: 'They do not take orders from our assistant. Call them yourself using the order below.', tone: 'warn' };
    case 'unreachable':
      return { title: 'We could not complete the call', detail: `We did not get a person at ${o.shopName} to take the order (no answer, voicemail or a phone menu). Nothing was ordered. Call them yourself using the order below.`, tone: 'warn' };
    case 'approval_timeout':
      return { title: 'Approval timed out', detail: 'The shop was told we would call back. Open the approval page to retry, or cancel the order.', tone: 'warn' };
    case 'canceled':
      return { title: 'Order canceled', detail: '', tone: 'error' };
    case 'held':
      return { title: 'Pay to place the order', detail: 'Open the payment page. The kitchen only gets it after you pay.', tone: 'action' };
    default:
      return { title: o.status.replace(/_/g, ' '), detail: o.readyAtText ? `Ready ${o.readyAtText}` : '', tone: 'info' };
  }
}

/** Default pickup: 45 minutes before the party if that is at least 2 hours away, else in 2 hours. Local `datetime-local` string. */
export function defaultPickupLocal(partyDateIso: string | null, now = new Date()): string {
  const twoHours = new Date(now.getTime() + 2 * 3600_000);
  let t = twoHours;
  if (partyDateIso) {
    const p = new Date(new Date(partyDateIso).getTime() - 45 * 60_000);
    if (!Number.isNaN(p.getTime()) && p.getTime() >= twoHours.getTime()) t = p;
  }
  t.setMinutes(Math.ceil(t.getMinutes() / 5) * 5, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}T${pad(t.getHours())}:${pad(t.getMinutes())}`;
}
