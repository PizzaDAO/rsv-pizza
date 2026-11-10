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
  /** When the approval LINK expires. Not the shop's hold: see PizzaOrderView.holdUntil. */
  expires_at?: string | null;
  /** pizza-mcp 64fb2ac, read from the approval page's view by our backend: false once approving can do nothing. */
  live?: boolean;
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
  // `call.attempts` is deliberately not here: it can count a row that was never dialed, so it must not become "we tried N times".
  call: {
    last_outcome?: string | null;
    shop_total_cents?: number | null;
    ready_at_text?: string | null;
    changes?: string[];
    // Optional: set by pizza-mcp while the order is `calling` but the shop has not been dialed yet.
    deferred?: { until?: string | null; reason?: string | null; message?: string | null } | null;
    // pizza-mcp 662d51c: still `calling`, the shop agreed and the finished call is being checked. NOT confirmed.
    checking?: { message: string } | null;
  } | null;
  /** Append-only status history from pizza-mcp. */
  timeline?: Array<{ at: string; status: string }>;
  nextAction: NextAction | null;
  /**
   * pizza-mcp 64fb2ac: while a price approval waits, when the shop stops holding the line (3 minutes after the
   * shop's quote), from the approval page's `hold_until`. null when unknown: then there is no countdown.
   */
  holdUntil?: string | null;
  /** pizza-mcp 64fb2ac OrderView.shop: the name and number the order was placed with (E.164 or null). */
  shop?: { name: string | null; phone: string | null; phoneDisplay: string | null } | null;
  /**
   * What pizza-mcp says happened when the order ended without a confirmation. null/absent while in flight,
   * confirmed, or when pizza-mcp does not send it (older versions): the copy must then stay cautious.
   * nothing_ordered true = sure nothing was placed; false = an order MAY exist, check with the shop.
   * Copy reads only that boolean and `message`, never a list of `reason`s: new reasons must work untouched. The one
   * exception adds words, never safety: `judge_unavailable` also says the call is waiting for a person to read it.
   */
  outcome?: { nothing_ordered: boolean; reason: string; message: string } | null;
  isMine: boolean;
  /** Approval expired with nothing to open: the host can simply start over. */
  restartable?: boolean;
  cancelable?: boolean;
  /** A fresh confirmation is still polled: the post-call check can downgrade it. */
  settling?: boolean;
  /** pizza-mcp 662d51c: `calling`, the call is being checked (same as `call.checking`). Not confirmed. */
  checking?: { message: string } | null;
  /** An ended order that holds budget or may exist: a host can say nothing was ordered. */
  releasable?: boolean;
  /** A host said nothing was ordered: it holds nothing and blocks nothing. */
  released?: boolean;
  /** The backend refuses a new order while this one stands, unless the host confirms a second. */
  blocking?: boolean;
  receiptCovered?: boolean;
}

// Mirrors pizza-mcp's TERMINAL (+ `completed` for native). approval_timeout is NOT terminal there.
export const TERMINAL_STATUSES = [
  'confirmed_by_shop', 'needs_review', 'shop_requires_prepay', 'refused', 'unreachable', 'canceled', 'completed',
];
export const isTerminalStatus = (s: string) => TERMINAL_STATUSES.includes(s);

/**
 * The order to reopen on load: the host's own live order, else one a host still has to settle
 * (release it, or say the receipt is in). Those can wait days, and any host who can edit may settle them.
 */
export function orderToResume(orders: PizzaOrderView[]): PizzaOrderView | undefined {
  return (
    orders.find((o) => o.isMine && !isTerminalStatus(o.status) && !o.restartable) ??
    orders.find((o) => (o.releasable || o.status === 'confirmed_by_shop') && !o.receiptCovered)
  );
}

const base = (partyId: string) => `/api/parties/${partyId}/pizza`;

export interface PizzaOrderConfig {
  enabled: boolean;
  capCents: number | null;
  remainingCapCents: number | null;
  /** e.g. NO_REIMBURSEMENT_CAP / CAP_EXHAUSTED: ordering is on for the party but blocked right now. */
  blockedReason: string | null;
  /** With CAP_EXHAUSTED: the order holding the budget, when one is. */
  heldOrderId?: string | null;
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

/** Past this, a `calling` order stops reading as "a few minutes". pizza-mcp can hold a stuck one for 60 minutes. */
export const CALL_RUNNING_LONG_MS = 10 * 60_000;

function callingSince(o: Pick<PizzaOrderView, 'timeline'>): number | null {
  const entry = [...(o.timeline ?? [])].reverse().find((t) => t.status === 'calling');
  const t = entry ? new Date(entry.at).getTime() : NaN;
  return Number.isNaN(t) ? null : t;
}

export interface StatusInfo {
  title: string;
  /** One "why" line (pizza-mcp's own words where it sent any). */
  detail: string;
  tone: 'info' | 'action' | 'success' | 'warn' | 'error';
  /** What the host does next, in order (rendered as a numbered list). */
  steps?: string[];
  /** A short "please don't order again" line, shown after the steps. */
  caution?: string;
  /** The copy tells the host to phone the shop: show a Call button when we know the number. */
  callShop?: boolean;
}

type StatusInput = Pick<PizzaOrderView, 'status' | 'shopName' | 'confirmedTotalCents' | 'readyAtText' | 'call' | 'outcome'> &
  Pick<Partial<PizzaOrderView>, 'restartable' | 'releasable' | 'released' | 'timeline' | 'isMine' | 'nextAction' | 'ceilingCents' | 'holdUntil'>;

/**
 * The price approval's deadline: when the shop stops holding the line (pizza-mcp's `hold_until`, 3 minutes). Never
 * `next_action.expires_at`: that is when the link expires, long after the shop has hung up. null when unknown.
 */
export function approvalDeadline(o: Pick<Partial<PizzaOrderView>, 'status' | 'holdUntil'>): string | null {
  if (o.status !== 'awaiting_price_approval') return null;
  const iso = o.holdUntil ?? null;
  return iso && !Number.isNaN(Date.parse(iso)) ? iso : null;
}

/** The number for a Call button: the one pizza-mcp placed the order with, else the listing's. */
export function callNumber(o: Pick<Partial<PizzaOrderView>, 'shop'>, listingPhone?: string | null): { tel: string; display: string } | null {
  const tel = o.shop?.phone || listingPhone || null;
  if (!tel) return null;
  return { tel, display: (o.shop?.phone && o.shop.phoneDisplay) || formatPhone(tel) };
}

const CHECK_CAUTION = "Please don't order again until you've checked with them.";

/** The "check with the shop" steps: call, what to do either way. */
function checkSteps(shop: string, releasable: boolean | undefined): string[] {
  return [
    `Call ${shop} and ask whether they have your pickup order.`,
    'If they do: pick it up and pay as usual, then upload the receipt.',
    releasable ? "If they don't: release it below so it stops counting against your budget." : "If they don't: you can order again.",
  ];
}

export function statusInfo(o: StatusInput, now = Date.now(), opts: { timeZone?: string | null } = {}): StatusInfo {
  if (o.released) {
    // the host's word, not ours: pizza-mcp may still say an order could exist
    return {
      title: `A host released the order at ${o.shopName}`,
      detail: 'A host said nothing was ordered, so this no longer counts against your budget or blocks a new order.',
      tone: 'info',
    };
  }
  const mine = o.isMine !== false;
  const hasLink = o.nextAction?.type === 'open_url' && !!o.nextAction.url;
  const total = formatCents(o.confirmedTotalCents ?? o.call?.shop_total_cents ?? null);
  // pizza-mcp's own words win once it has said what happened (never inferred from totals or transcripts).
  // Not for "nothing yet" on an approval_timeout: it is still open, and approving sends the call back.
  const oc = o.status === 'approval_timeout' && o.outcome?.nothing_ordered ? null : o.outcome;
  if (oc && ['needs_review', 'refused', 'unreachable', 'canceled', 'shop_requires_prepay', 'approval_timeout'].includes(o.status)) {
    if (oc.nothing_ordered) {
      return { title: `Nothing was ordered at ${o.shopName}`, detail: oc.message, tone: o.status === 'canceled' ? 'info' : 'warn' };
    }
    // pizza-mcp faf6855: its call judge could not read this call. Not a fault at the shop: the call is waiting for a
    // person at pizza-mcp to read it (its operator is emailed every time). That check does not report back here, so the
    // host is told not to wait for it. Still nothing_ordered false, so it blocks and holds like any other.
    if (oc.reason === 'judge_unavailable') {
      return {
        title: `Check with ${o.shopName} before ordering again`,
        detail: `${oc.message} The call is waiting for a person on our team to read it, but you don't need to wait for that.`,
        steps: checkSteps(o.shopName, o.releasable),
        caution: CHECK_CAUTION,
        callShop: true,
        tone: 'warn',
      };
    }
    // pizza-mcp e62620e: an approval timeout is NOT evidence that nothing was ordered (the shop heard the order and the AI
    // said it would call back), so its outcome is `nothing_ordered: false` unless a verdict shows no order. The order is
    // still open: approving sends the call back, canceling only stops the callback. Never says nothing was ordered.
    if (o.status === 'approval_timeout') {
      return {
        title: 'Approval timed out',
        detail: oc.message,
        steps: [
          hasLink
            ? `Open the approval page to have us call ${o.shopName} back.`
            : mine
              ? `Approve from the email we sent you to have us call ${o.shopName} back.`
              : `The host who placed it can approve from their email to have us call ${o.shopName} back.`,
          `Or cancel to stop the callback. Canceling doesn't undo anything ${o.shopName} may already have, so check with them.`,
        ],
        caution: "Please don't order again in the meantime.",
        callShop: true,
        tone: 'warn',
      };
    }
    return {
      title: `Check with ${o.shopName} before ordering again`,
      detail: oc.message,
      steps: checkSteps(o.shopName, o.releasable),
      caution: CHECK_CAUTION,
      callShop: true,
      tone: 'warn',
    };
  }
  switch (o.status) {
    case 'awaiting_approval':
      if (o.restartable) return { title: 'The approval link expired', detail: 'Nothing was ordered. Start over to place it again.', tone: 'warn' };
      if (!mine) {
        return {
          title: `Waiting for approval of the call to ${o.shopName}`,
          detail: `The host who placed this order gets a 6-digit code by email and approves the call. We don't call ${o.shopName} until they do.`,
          tone: 'info',
        };
      }
      return {
        title: `Approve the call to ${o.shopName}`,
        detail: `When the approval page opens we email you a 6-digit code from Open Pizza; enter it there within 10 minutes. We don't call ${o.shopName} until you do. If that page says the shop can't be called right now, cancel this order and pick another pizzeria.`,
        tone: 'action',
      };
    case 'calling': {
      // pizza-mcp 662d51c: the shop agreed on the call, and the call is being checked before the order can be
      // confirmed. Not a confirmation: it becomes confirmed or "could not confirm", and nothing is redialed meanwhile.
      // pizza-mcp 41b81d7: a deferral beats a check. After a price approval the order can carry both `call.checking`
      // and `call.deferred` (`call_check_pending`); it is waiting to be called, which is what the host needs to know.
      const checking = o.call?.deferred ? null : o.call?.checking;
      if (checking) {
        return {
          title: `Checking the call with ${o.shopName}`,
          detail: `${checking.message || 'The call ended and the result is being checked.'} The order is not confirmed until this check is done. It usually takes a few seconds, and at most about an hour. Please do not order again in the meantime.`,
          tone: 'info',
        };
      }
      // Not dialed yet, so not "calling": no call is on the line, and that says nothing about earlier calls.
      const deferred = o.call?.deferred;
      if (deferred && deferred.reason === 'call_check_pending') {
        return {
          title: `Waiting to call ${o.shopName} back`,
          detail: `${deferred.message || 'An earlier call to the shop is still being checked; we will call as soon as that check is done.'} Nothing is on the line right now. If the check takes longer than about 30 minutes we stop and tell you. You can cancel this order meanwhile; that does not undo anything ${o.shopName} may already have, so check with them. Please do not order again in the meantime.`,
          tone: 'info',
        };
      }
      if (deferred) {
        const transient = deferred.reason === 'transient';
        return {
          title: transient ? `Our call to ${o.shopName} is delayed` : `Our call to ${o.shopName} is scheduled`,
          detail: deferred.message || (transient ? 'A temporary problem on our side stopped the call before it was dialed. We will try again shortly.' : `We will call ${o.shopName} later.`),
          tone: 'info',
        };
      }
      const since = callingSince(o);
      if (since !== null && now - since > CALL_RUNNING_LONG_MS) {
        return {
          title: `Still waiting on our call to ${o.shopName}`,
          detail: 'We are waiting to hear how the call went. This can take up to an hour. Please do not order again in the meantime: the host who placed it gets an email when it ends.',
          tone: 'info',
        };
      }
      return { title: `Calling ${o.shopName}`, detail: 'Our AI is placing your order by phone. This usually takes a few minutes, and can take up to an hour.', tone: 'info' };
    }
    case 'awaiting_price_approval': {
      // pizza-mcp sends one email with the price, the deadline and a one-tap approve link.
      const limit = formatCents(o.ceilingCents ?? null);
      const quoted = `${o.shopName} quoted ${total || 'more than your limit'}${limit && total ? ` (over your ${limit})` : ''}.`;
      // pizza-mcp 64fb2ac: the deadline is the shop's real hold (hold_until). After it, approving still works: we
      // call the shop back at that price. So the hold is "answer before then", never "the offer is gone".
      const deadline = approvalDeadline(o);
      const hold = deadline
        ? `${o.shopName} is holding the line until ${formatWhen(deadline, opts.timeZone)}.`
        : `${o.shopName} is holding the line, so please answer quickly.`;
      return {
        title: `${o.shopName} quoted a higher price`,
        detail: mine
          ? `${quoted} Approve or decline from the email we sent you. ${hold}`
          : `${quoted} The host who placed it can approve or decline from their email. ${hold}`,
        tone: 'action',
      };
    }
    case 'confirmed_by_shop':
      // pizza-mcp 662d51c confirms only a recorded total that includes tax
      return { title: `${o.shopName} confirmed`, detail: `${total ? `Total ${total} with tax. ` : ''}${o.readyAtText ? `Ready ${o.readyAtText}. ` : ''}Pay at pickup, then upload the real receipt as usual (the reminder line in your Receipts list is not a receipt).`, tone: 'success' };
    case 'needs_review':
      // Honest for both cases: the shop may have taken the order, or nothing may have been ordered at all
      // (a phone menu, voicemail, or a price over your limit). Optional `reason` comes from pizza-mcp when it sends one.
      return {
        title: `We could not confirm the order at ${o.shopName}`,
        detail: 'It may be that nothing was ordered, or that the shop did take it.',
        steps: checkSteps(o.shopName, o.releasable),
        caution: CHECK_CAUTION,
        callShop: true,
        tone: 'warn',
      };
    case 'shop_requires_prepay':
      return { title: 'The shop wants payment up front', detail: 'We never pay by phone. Call the shop to check where the order stands. The order is below.', callShop: true, tone: 'warn' };
    case 'refused':
      return { title: 'The shop declined the call', detail: 'They do not take orders from our assistant. Call them to check where the order stands. The order is below.', callShop: true, tone: 'warn' };
    case 'unreachable':
      return { title: 'We could not complete the call', detail: `We did not get a person at ${o.shopName} to take the order (no answer, voicemail or a phone menu). Call them to check before you order again. The order is below.`, callShop: true, tone: 'warn' };
    case 'approval_timeout':
      // `nothing_ordered: true` here is true only for now: the order stays open until it is approved or canceled
      return {
        title: 'Approval timed out',
        detail: `${o.outcome?.message || 'We could not reach you in time.'} ${
          hasLink ? 'Open the approval page to retry, or cancel the order.' : mine ? 'Approve from the email we sent you to retry, or cancel the order.' : 'The host who placed it can approve from their email, or cancel the order.'
        }`,
        tone: 'warn',
      };
    case 'canceled':
      return { title: 'Order canceled', detail: `This order is canceled. If we had already called ${o.shopName}, check with them before ordering again.`, callShop: true, tone: 'info' };
    case 'held':
      return { title: 'Pay to place the order', detail: 'Open the payment page. The kitchen only gets it after you pay.', tone: 'action' };
    default:
      return { title: `Update on your order at ${o.shopName}`, detail: o.readyAtText ? `Ready ${o.readyAtText}.` : "We'll show more here as soon as we hear from the shop.", tone: 'info' };
  }
}

// ---- time zones: pickup and every time shown use the PARTY's zone, not the browser's --------------------

/** A usable IANA zone, or undefined (= the browser's) when missing or unknown to this browser. */
export function safeTimeZone(tz: string | null | undefined): string | undefined {
  if (!tz) return undefined;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

function zonedParts(ms: number, tz: string | undefined) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour') % 24, mi: get('minute'), s: get('second') };
}

/** "YYYY-MM-DDTHH:MM" for an instant, as the wall clock reads in `tz`. */
export function toZonedLocal(ms: number, timeZone?: string | null): string {
  const p = zonedParts(ms, safeTimeZone(timeZone));
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`;
}

/** A `datetime-local` value read as wall-clock time in `tz` -> ISO instant (DST-safe). null if unparsable. */
export function zonedLocalToIso(local: string, timeZone?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(local);
  if (!m) return null;
  const tz = safeTimeZone(timeZone);
  const wall = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(wall)) return null;
  const offset = (ms: number) => {
    const p = zonedParts(ms, tz);
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi, p.s) - Math.floor(ms / 1000) * 1000;
  };
  let t = wall - offset(wall);
  t = wall - offset(t);
  return new Date(t).toISOString();
}

/** "Sat 5:15 PM EST" in the party's zone. No seconds. */
export function formatWhen(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone(timeZone), weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
}

/** "+16175550101" -> "(617) 555-0101"; other numbers are shown as given. */
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return '';
  const m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(raw.replace(/[^\d+]/g, ''));
  return m ? `(${m[1]}) ${m[2]}-${m[3]}` : raw;
}

/**
 * Default pickup: 45 minutes before the party if that is at least 2 hours away, else in 2 hours, rounded up to 5
 * minutes. A `datetime-local` string on the wall clock of `timeZone` (the party's; the browser's when absent).
 */
export function defaultPickupLocal(partyDateIso: string | null, now = new Date(), timeZone?: string | null): string {
  const twoHours = now.getTime() + 2 * 3600_000;
  let t = twoHours;
  if (partyDateIso) {
    const p = new Date(partyDateIso).getTime() - 45 * 60_000;
    if (!Number.isNaN(p) && p >= twoHours) t = p;
  }
  const step = 5 * 60_000;
  t = Math.ceil(t / step) * step;
  return toZonedLocal(t, timeZone);
}
