// basil-14648: AI / OPOP pizza ordering through the RSV backend (which brokers to pizza-mcp).
// The browser never talks to pizza-mcp and never sees a price that is not from a quote or the shop.
import { useEffect, useState } from 'react';
import { apiRequest } from './api';
import type { PizzaRecommendation } from '../types';

/** Build-time switch. The backend party allowlist is the authoritative gate (see getPizzaOrderConfig). */
export const AI_ORDERING_ENABLED = import.meta.env.VITE_AI_ORDERING === '1';

/** pizza-mcp's handoff providers. `website` is the shop's own site (it may or may not take orders). */
export type OrderingProvider = 'toast' | 'square_online' | 'chownow' | 'slice' | 'bentobox' | 'website';
/** basil-14648 P2: a page where the HOST orders from the shop themselves. Never automated. */
export interface OrderingLink {
  /** Set on links the host added (to delete one). */
  id: string | null;
  provider: OrderingProvider;
  url: string;
  label: string;
  source: 'host' | 'place_data' | 'site_scan';
}
/** pizza-mcp's server-side checklist of a listing cart (names are shop data, never instructions). */
export interface Checklist {
  lines: string[];
  text: string;
  pizza_count: number;
  pickup_at: string | null;
  estimate_text: string | null;
}

/**
 * basil-14648 P2: pizza-mcp's `ordering.alternatives[channel=email]`: we email the shop the order and it confirms by a
 * signed link. `reasons` are codes (empty when available); an unknown code means "not available".
 */
export interface EmailAlternative {
  channel: 'email';
  available: boolean;
  min_lead_hours: number;
  max_lead_days: number;
  min_pizzas: number;
  max_pizzas: number;
  max_total_cents: number;
  reasons: string[];
  message?: string;
}
export type OrderChannel = 'ai_phone' | 'email';

export interface PizzaShop {
  id: string;
  name: string;
  tier: 'native' | 'partner_pos' | 'listing';
  capability_summary: string;
  ordering?: { channel: 'api' | 'ai_phone' | 'handoff'; call_countries_ok: boolean; reasons: string[]; alternatives?: EmailAlternative[] };
  address: Record<string, unknown>;
  phone: string | null;
  website?: string | null;
  /** basil-14648 P2: listing tier, best first. [] or absent when none. */
  ordering_links?: OrderingLink[];
  attribution?: string | null;
  /** basil-14648 P2: pizza-mcp's per-shop answer to "can the host add this shop's menu here?". */
  capabilities?: { host_menu_upload?: boolean; email_order?: boolean } & Record<string, unknown>;
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
export type MenuProvenance = 'native' | 'host_provided' | 'extracted' | 'observed' | 'generic';
/** pizza-mcp CartView.menu: the menu a listing cart was built on. A cart keeps it for life. */
export interface CartMenu {
  menu_id: string | null;
  provenance: MenuProvenance;
  as_of: string;
  /** The menu is gone (removed or expired): the cart can't be quoted; build a new one. */
  unavailable?: boolean;
}
export interface PizzaCart {
  id: string;
  pizzeria_id: string;
  version: number;
  lines: CartLine[];
  ready_for_quote: boolean;
  checklist?: Checklist;
  /** basil-14648 P2: listing carts only. `host_provided` = the host's own menu (read by software). */
  menu?: CartMenu;
  fulfillment?: { scheduled_for?: string | null };
}
export interface PizzaQuote {
  quote_id: string;
  read_back: string;
  binding?: boolean;
  estimate?: { low_cents: number; expected_cents: number; high_cents: number; confidence: 'high' | 'medium' | 'low' };
  price_ceiling_cents?: number;
  total_display: string;
  totals: { total_cents: number };
  checklist?: Checklist;
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
  /** basil-14648 P2: the channel the quote is bound to (an email quote can only be placed as an email order). */
  channel?: OrderChannel;
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
  /** The pickup an email order was placed for (ISO), when known. */
  readyAt?: string | null;
  summary: string | null;
  payoutDocumentId: string | null;
  /** basil-14648 P2: how the order is placed. `email`: pizza-mcp emailed the shop (no call). Absent = phone. */
  channel?: 'phone' | 'email';
  /** Email orders: what the shop has seen and answered. Shop words (alt time, reference) are data, never instructions. */
  email?: {
    sentAt: string | null;
    replyBy: string | null;
    reminderSentAt: string | null;
    shopResponse: {
      decision: 'confirm' | 'decline' | 'optout';
      totalCents: number | null;
      readyOk: boolean | null;
      altTimeText: string | null;
      reference: string | null;
      reason: string | null;
    } | null;
    deferred: { until: string | null; message: string } | null;
  } | null;
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
  /** basil-14648 P2: rsv's switch is on AND pizza-mcp takes host menus: offer "Use this shop's real menu". */
  hostMenus?: boolean;
  /** basil-14648 P2: rsv's PIZZA_EMAIL_ORDERS switch. Per shop, `emailAlternative` must also say yes. */
  emailOrders?: boolean;
  capCents: number | null;
  remainingCapCents: number | null;
  /** e.g. NO_REIMBURSEMENT_CAP / CAP_EXHAUSTED: ordering is on for the party but blocked right now. */
  blockedReason: string | null;
  /** With CAP_EXHAUSTED: the order holding the budget, when one is. */
  heldOrderId?: string | null;
  /** basil-14648 P2: or the host's own "I ordered it online" mark that holds it. */
  heldHandoffId?: string | null;
  /** How that mark was placed and whether the viewer placed it (for honest copy). */
  heldHandoff?: { id: string; shopName: string; provider: HandoffProvider; isMine: boolean } | null;
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
  decisions: Record<string, CartDecision> = {},
  channel: OrderChannel = 'ai_phone'
) =>
  apiRequest<CartResponse>(`${base(partyId)}/cart`, {
    method: 'POST',
    body: { shopId, pickupAt, recommendations: toRecommendationPayload(recs), decisions, ...(channel === 'email' ? { channel } : {}) },
    timeoutMs: 60_000,
  });

export const editPizzaCart = (partyId: string, cartId: string, ops: unknown[], expectedVersion?: number, channel: OrderChannel = 'ai_phone') =>
  apiRequest<{ cart: PizzaCart; quote: PizzaQuote | null }>(`${base(partyId)}/cart/${cartId}`, {
    method: 'PATCH',
    body: { ops, expectedVersion, ...(channel === 'email' ? { channel } : {}) },
  });

export interface PlaceOrderInput {
  quoteId: string;
  cartId: string;
  shopId: string;
  recommendationVersion: string;
  contact: { name: string; phone: string; email?: string };
  /** Phone orders only; native orders have no ceiling. */
  policy: { ceilingCents?: number; substitution?: 'exact' | 'deals_ok'; minPizzaCount?: number; channel?: OrderChannel };
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

// ---- basil-14648 P2: "Order online" handoff --------------------------------

/** How the host says they ordered: on one of the shop's pages, by phone, or in person. */
export type HandoffProvider = OrderingProvider | 'phone' | 'in_person';
export interface PizzaHandoffView {
  id: string;
  shopId: string;
  shopName: string;
  provider: HandoffProvider;
  /** The host's own checklist cart (null for a co-host). */
  cartId: string | null;
  /** What the mark holds of the budget (the quote's price ceiling); 0 when not marked. */
  holdCents: number;
  /** pizza-mcp's estimate for the checklist's cart, when there was one. */
  estimateCents?: number | null;
  /** Marked, but holding less than the estimate: what was left of the budget did not cover it. */
  overBudget?: boolean;
  /** Marked with no cart or no quote: the amount is unknown, so it holds the rest of the budget until a receipt. */
  holdsRest?: boolean;
  /** Taken back by the host who marked it ("I didn't order after all"). */
  releasedByOwner?: boolean;
  /** Taken back (or released) by the viewer. */
  releasedByMe?: boolean;
  clickedAt: string | null;
  orderedAt: string | null;
  releasedAt: string | null;
  /** "I placed this order" and not taken back: holds holdCents and blocks a second order. */
  marked: boolean;
  blocking: boolean;
  receiptCovered: boolean;
  isMine: boolean;
}

/** The party's budget as the backend sees it (USD cents). `noCap`: no reimbursement cap is set. */
export interface HandoffBudget {
  capCents: number | null;
  leftCents: number;
  noCap: boolean;
}
export const getPizzaHandoffs = (partyId: string) =>
  apiRequest<{ handoffs: PizzaHandoffView[]; budget?: HandoffBudget }>(`${base(partyId)}/handoffs`);

/** A mark of mine that another host released: tell me once (I may have ordered after all). */
export const releasedByOtherHost = (h: PizzaHandoffView) => h.isMine && !!h.releasedAt && !h.releasedByOwner && !h.releasedByMe;

/** The host opened the shop's ordering page (`opened`), or is about to mark a phone order (`opened: false`). */
export const recordPizzaHandoff = (
  partyId: string,
  input: { shopId: string; shopName: string; provider: HandoffProvider; cartId?: string | null; opened?: boolean }
) => apiRequest<{ handoff: PizzaHandoffView }>(`${base(partyId)}/handoffs`, { method: 'POST', body: input });

/** `unmark`: the host who marked it. `release`: a co-host who checked that nothing was ordered. */
export const markPizzaHandoff = (
  partyId: string,
  handoffId: string,
  action: 'ordered' | 'unmark' | 'release' | 'receipt_uploaded',
  allowAnother = false
) =>
  apiRequest<{ handoff: PizzaHandoffView; budget?: HandoffBudget }>(`${base(partyId)}/handoffs/${handoffId}/mark`, {
    method: 'POST',
    body: { action, ...(allowAnother ? { allowAnother: true } : {}) },
  });

// ---------------------------------------------------------------------------
// basil-14648 P2: the host's own menu for a listing shop (plans/rsv-p2-host-menus.md). Private to the host on
// pizza-mcp; it only changes their NEW carts, so the flow rebuilds the cart after an upload or a removal.
// ---------------------------------------------------------------------------
export interface HostMenuResult {
  menuId: string;
  provenance: MenuProvenance;
  asOf: string;
  summary: { pizzaItems: number; pricedItems: number; priceRangeCents: [number, number] | null };
}

/** The limits rsv and pizza-mcp enforce; checked here first so the host hears it before a long upload. */
export const MENU_LIMITS = { maxImages: 3, maxTotalBytes: 4 * 1024 * 1024, longestSidePx: 2000, jpegQuality: 0.8, maxUrlChars: 500 } as const;

/** Up to 75 s: a vision read takes 15-40 s on pizza-mcp, plus two hops. */
const MENU_TIMEOUT_MS = 75_000;

export const submitHostMenuFiles = (partyId: string, shopId: string, files: Blob[]) => {
  const form = new FormData();
  files.forEach((f, i) => form.append('files[]', f, f instanceof File ? f.name : `menu-${i + 1}`));
  return apiRequest<HostMenuResult>(`${base(partyId)}/shops/${encodeURIComponent(shopId)}/menu/host`, { method: 'POST', body: form, timeoutMs: MENU_TIMEOUT_MS });
};
export const submitHostMenuUrl = (partyId: string, shopId: string, url: string) =>
  apiRequest<HostMenuResult>(`${base(partyId)}/shops/${encodeURIComponent(shopId)}/menu/host`, { method: 'POST', body: { url }, timeoutMs: MENU_TIMEOUT_MS });
export const deleteHostMenu = (partyId: string, shopId: string) =>
  apiRequest<{ expired: number }>(`${base(partyId)}/shops/${encodeURIComponent(shopId)}/menu/host`, { method: 'DELETE' });

export class MenuFileError extends Error {
  constructor(public code: 'MENU_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'NO_FILES' | 'CANT_PREPARE') {
    super(code);
  }
}

/**
 * Get the host's chosen files ready to send: every photo is redrawn at most 2000 px on the longest side, on white
 * (a transparent PNG stays readable), as JPEG q0.8. A phone photo becomes about 0.5-1 MB, and because the photo is
 * re-encoded its EXIF data (location included) is not sent. A photo this browser can't redraw is refused
 * (`CANT_PREPARE`), never sent as it is. A PDF goes as it is (its own metadata is not stripped). Up to 3 photos or one
 * PDF alone, 4 MB in total, else a MenuFileError.
 */
export async function prepareMenuFiles(files: File[]): Promise<Blob[]> {
  if (files.length === 0) throw new MenuFileError('NO_FILES');
  const pdfs = files.filter((f) => f.type === 'application/pdf');
  if (pdfs.length > 0 && files.length > 1) throw new MenuFileError('UNSUPPORTED_MEDIA_TYPE');
  if (pdfs.length === 0 && files.length > MENU_LIMITS.maxImages) throw new MenuFileError('MENU_TOO_LARGE');
  const out: Blob[] = [];
  for (const f of files) {
    if (f.type === 'application/pdf') out.push(f);
    else if (f.type.startsWith('image/') || f.type === '') out.push(await reencode(f));
    else throw new MenuFileError('UNSUPPORTED_MEDIA_TYPE');
  }
  if (out.reduce((n, b) => n + b.size, 0) > MENU_LIMITS.maxTotalBytes) throw new MenuFileError('MENU_TOO_LARGE');
  return out;
}

async function reencode(f: File): Promise<Blob> {
  if (typeof createImageBitmap !== 'function') throw new MenuFileError('CANT_PREPARE');
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(f, { imageOrientation: 'from-image' });
  } catch {
    throw new MenuFileError('CANT_PREPARE');
  }
  const scale = Math.min(1, MENU_LIMITS.longestSidePx / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new MenuFileError('CANT_PREPARE');
  // JPEG has no transparency: paint white first, so a transparent menu PNG doesn't turn black
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', MENU_LIMITS.jpegQuality));
  if (!blob || blob.type !== 'image/jpeg') throw new MenuFileError('CANT_PREPARE');
  const name = (f.name || 'menu').replace(/\.[^.]+$/, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg' });
}

/** Where the menu panel is offered: a cart on a generic or extracted menu, the host's own (to replace or remove it), or no cart yet. */
export function menuPanelFits(menu: CartMenu | null | undefined): boolean {
  return !menu || menu.provenance === 'generic' || menu.provenance === 'extracted' || menu.provenance === 'host_provided';
}

/** A menu's date for "estimate from your menu (Nov 9)", on the party's clock. */
export function formatMenuDate(iso: string | null | undefined, lang: string, timeZone?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  try {
    return new Intl.DateTimeFormat(lang || 'en', { month: 'short', day: 'numeric', timeZone: safeTimeZone(timeZone) }).format(d);
  } catch {
    return d.toISOString().slice(0, 10);
  }
}

/** Every problem a menu upload can end in, as the i18n key of plain copy with a next step. */
export function hostMenuErrorKey(code: string | undefined): string {
  switch (code) {
    case 'MENU_UNREADABLE':
    case 'MENU_TOO_LARGE':
    case 'UNSUPPORTED_MEDIA_TYPE':
    case 'URL_NOT_ALLOWED':
    case 'MENU_CURRENCY_MISMATCH':
    case 'RATE_LIMITED':
    case 'EXTRACTION_BUDGET_EXHAUSTED':
    case 'FEATURE_DISABLED':
    case 'NOT_A_LISTING':
    case 'NO_FILES':
    case 'CANT_PREPARE':
      return `aiOrder.menu.errors.${code}`;
    case 'EXTRACTION_UNAVAILABLE':
    case 'PIZZA_MCP_UNAVAILABLE':
    case 'TIMEOUT':
      return 'aiOrder.menu.errors.EXTRACTION_UNAVAILABLE';
    default:
      return 'aiOrder.menu.errors.default';
  }
}

export const addShopOrderingLink = (partyId: string, shopId: string, url: string) =>
  apiRequest<{ link: OrderingLink }>(`${base(partyId)}/shops/${encodeURIComponent(shopId)}/links`, { method: 'POST', body: { url } });

export const deleteShopOrderingLink = (partyId: string, shopId: string, linkId: string) =>
  apiRequest<{ deleted: boolean }>(`${base(partyId)}/shops/${encodeURIComponent(shopId)}/links/${encodeURIComponent(linkId)}`, { method: 'DELETE' });

/** Only http(s) links are ever rendered as an href (defence in depth: pizza-mcp already checks them). */
export function safeHref(url: unknown): string | null {
  if (typeof url !== 'string' || url.length > 600) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** The shop's ordering links we can render, best first, with the bare website last. */
export function orderingLinks(shop: Pick<PizzaShop, 'ordering_links'>): OrderingLink[] {
  const links = Array.isArray(shop.ordering_links) ? shop.ordering_links : [];
  const ok = links.filter((l) => l && typeof l.provider === 'string' && safeHref(l.url));
  return [...ok.filter((l) => l.provider !== 'website'), ...ok.filter((l) => l.provider === 'website')];
}

/** True when the shop has a real online-ordering page (not just its website). */
export const hasProviderLink = (shop: Pick<PizzaShop, 'ordering_links'>) => orderingLinks(shop).some((l) => l.provider !== 'website');

/** "Sam W." from the host's name: first name and last initial, for the order. */
export function orderName(full: string | null | undefined): string {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

/** The marked handoff to reopen on load: one a host still has to settle (receipt or "didn't order"). */
export function handoffToResume(handoffs: PizzaHandoffView[]): PizzaHandoffView | undefined {
  // receiptCovered is set only when a receipt was really matched: a mark that holds 0 (no budget left) still waits
  // for its receipt, so it is resumed too
  return handoffs.find((h) => h.marked && !h.receiptCovered);
}

// ---- display helpers -------------------------------------------------------

export function shopBadge(shop: Pick<PizzaShop, 'tier' | 'ordering'> & Partial<Pick<PizzaShop, 'ordering_links'>>): {
  label: string; tone: 'green' | 'purple' | 'gray'; orderable: boolean; handoff?: boolean;
} {
  const channel = shop.ordering?.channel ?? (shop.tier === 'native' ? 'api' : 'handoff');
  if (channel === 'api') return { label: 'Orders instantly', tone: 'green', orderable: true };
  if (channel === 'ai_phone') return { label: 'AI calls for you, pay at pickup', tone: 'purple', orderable: true };
  // basil-14648 P2: the shop takes orders online itself (Toast, Square Online, ...): the host orders there
  if (hasProviderLink(shop)) return { label: 'Order online yourself', tone: 'gray', orderable: false, handoff: true };
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

/** "Sun, Nov 22, 6:30 PM EST" in the party's zone: with the date, for email orders placed days ahead. */
export function formatWhenDate(iso: string | null | undefined, timeZone?: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: safeTimeZone(timeZone), weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d);
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

// ---- basil-14648 P2: email orders (plans/rsv-p2-email-orders.md §7) ------------------------------------------------

/** The shop's email alternative as pizza-mcp published it, or null. */
export function emailAlternative(shop: Pick<PizzaShop, 'ordering'> | null | undefined): EmailAlternative | null {
  const alts = shop?.ordering?.alternatives;
  if (!Array.isArray(alts)) return null;
  return alts.find((a) => a && a.channel === 'email') ?? null;
}

/**
 * "Email the order" is offered only when rsv's switch is on AND pizza-mcp says yes for this shop twice: the
 * capability and an available alternative with no reason against it (an unknown reason code means no).
 */
export function emailOrderable(shop: Pick<PizzaShop, 'ordering' | 'capabilities'> | null | undefined, flagOn: boolean | undefined): EmailAlternative | null {
  if (!flagOn) return null;
  const alt = emailAlternative(shop);
  if (!alt || alt.available !== true || (alt.reasons ?? []).length > 0 || shop?.capabilities?.email_order !== true) return null;
  return alt;
}

/**
 * Reasons that mean "this shop doesn't take email orders (from us, yet)": true of almost every shop during the pilot,
 * so the shop list stays quiet about them. Any other reason (an opt-out, an unverified account, a cap, a code added
 * later) is shown on the shop, in pizza-mcp's words.
 */
const QUIET_EMAIL_REASONS = new Set(['disabled', 'not_in_pilot', 'no_shop_email']);

/** Why "Email the order" is not offered for this shop, when that is worth saying; else null. */
export function emailUnavailableNote(shop: Pick<PizzaShop, 'ordering' | 'capabilities'>, flagOn: boolean | undefined): string | null {
  if (!flagOn || emailOrderable(shop, flagOn)) return null;
  const alt = emailAlternative(shop);
  if (!alt) return null;
  const reasons = alt.reasons ?? [];
  if (reasons.length === 0 || reasons.every((r) => QUIET_EMAIL_REASONS.has(r))) return null;
  const msg = (alt.message ?? '').trim().replace(/[.!?]+$/, '');
  return msg ? msg[0].toLowerCase() + msg.slice(1) : 'we can\'t email this shop right now';
}

const HOUR = 3600_000;

/** Is this pickup inside the email lead time? 'too_soon' / 'too_late' / null (fine or unknown). */
export function emailPickupProblem(iso: string | null, alt: Pick<EmailAlternative, 'min_lead_hours' | 'max_lead_days'>, now = Date.now()): 'too_soon' | 'too_late' | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  if (t - now < alt.min_lead_hours * HOUR) return 'too_soon';
  if (t - now > alt.max_lead_days * 24 * HOUR) return 'too_late';
  return null;
}

/**
 * Default pickup for an email order: 45 minutes before the party when that is far enough ahead, else the earliest
 * allowed time plus an hour, rounded up to 5 minutes. On the party's wall clock.
 */
export function defaultEmailPickupLocal(partyDateIso: string | null, alt: Pick<EmailAlternative, 'min_lead_hours' | 'max_lead_days'>, now = new Date(), timeZone?: string | null): string {
  const earliest = now.getTime() + (alt.min_lead_hours + 1) * HOUR;
  const latest = now.getTime() + alt.max_lead_days * 24 * HOUR;
  let t = earliest;
  if (partyDateIso) {
    const p = new Date(partyDateIso).getTime() - 45 * 60_000;
    if (!Number.isNaN(p) && p >= earliest && p <= latest) t = p;
  }
  const step = 5 * 60_000;
  return toZonedLocal(Math.ceil(t / step) * step, timeZone);
}

/** How many pizzas the cart (or, before one exists, the recommendations) holds. */
export const pizzaCount = (lines: Array<{ quantity?: number | null }>) => lines.reduce((n, l) => n + (Number(l.quantity) || 0), 0);

type Translate = (key: string, opts?: Record<string, unknown>) => string;
type EmailStatusInput = StatusInput & Pick<Partial<PizzaOrderView>, 'channel' | 'email' | 'readyAt'>;

/**
 * The status card of an email order (null: not an email order). Truthful in every state: nothing reads as ordered
 * before `confirmed_by_shop`, and an ended order is decided by `outcome.nothing_ordered` alone (pizza-mcp's
 * `message` says why; its reason codes are never switched on, so a new reason works untouched).
 */
export function emailStatusInfo(o: EmailStatusInput, t: Translate, now = Date.now(), opts: { timeZone?: string | null } = {}): StatusInfo | null {
  if (o.channel !== 'email') return null;
  if (o.released) return statusInfo(o, now, opts);
  const shop = o.shopName;
  const tz = opts.timeZone;
  const mine = o.isMine !== false;
  const e = o.email ?? null;
  // an email order runs over days: every time it shows carries its date
  const when = (iso: string | null | undefined) => formatWhenDate(iso, tz);
  const pickup = o.readyAt ? when(o.readyAt) : o.readyAtText || '';
  const total = formatCents(o.confirmedTotalCents ?? e?.shopResponse?.totalCents ?? null);

  // Ended: only `nothing_ordered` decides what the host is told to do.
  // No outcome on an ended order (an older pizza-mcp, a malformed view): assume the shop may have it.
  const oc = o.outcome;
  if (['refused', 'unreachable', 'canceled', 'needs_review', 'shop_requires_prepay'].includes(o.status)) {
    if (oc?.nothing_ordered) {
      if (o.status === 'refused' && e?.shopResponse?.decision === 'decline') {
        const alt = e.shopResponse.altTimeText;
        return {
          title: t('host:aiOrder.email.status.declinedTitle', { shop }),
          detail: [oc.message, alt ? t('host:aiOrder.email.status.altTime', { alt }) : '', t('host:aiOrder.email.status.declinedDetail', { shop })].filter(Boolean).join(' '),
          tone: 'warn',
        };
      }
      return {
        title: o.status === 'canceled' ? t('host:aiOrder.email.status.canceledTitle') : t('host:aiOrder.email.status.nothingTitle', { shop }),
        detail: oc.message,
        tone: o.status === 'canceled' ? 'info' : 'warn',
      };
    }
    return {
      title:
        o.status === 'unreachable'
          ? t('host:aiOrder.email.status.noReplyTitle', { shop })
          : o.status === 'canceled'
            ? t('host:aiOrder.email.status.withdrawnTitle', { shop })
            : t('host:aiOrder.email.status.mayExistTitle', { shop }),
      // pizza-mcp's message says what it told the shop and why an order may exist; with none, say we can't tell
      detail: oc?.message || t('host:aiOrder.email.status.mayExistUnknown', { shop }),
      steps: [
        pickup ? t('host:aiOrder.email.status.stepCall', { shop, time: pickup }) : t('host:aiOrder.email.status.stepCallNoTime', { shop }),
        t('host:aiOrder.email.status.stepIfYes'),
        o.releasable ? t('host:aiOrder.email.status.stepIfNo') : t('host:aiOrder.email.status.stepIfNoNoRelease'),
      ],
      caution: t('host:aiOrder.email.status.caution'),
      callShop: true,
      tone: 'warn',
    };
  }

  switch (o.status) {
    case 'awaiting_approval':
      if (o.restartable) return statusInfo(o, now, opts);
      return mine
        ? { title: t('host:aiOrder.email.status.approveTitle', { shop }), detail: t('host:aiOrder.email.status.approveDetail', { shop }), tone: 'action' }
        : { title: t('host:aiOrder.email.status.approveOtherTitle', { shop }), detail: t('host:aiOrder.email.status.approveOtherDetail', { shop }), tone: 'info' };
    case 'sending': {
      const until = e?.deferred?.until ? when(e.deferred.until) : '';
      if (e?.deferred) {
        return {
          title: t('host:aiOrder.email.status.scheduledTitle', { shop }),
          detail: until ? t('host:aiOrder.email.status.scheduledDetail', { time: until }) : e.deferred.message || t('host:aiOrder.email.status.sendingDetail', { shop }),
          tone: 'info',
        };
      }
      return { title: t('host:aiOrder.email.status.sendingTitle', { shop }), detail: t('host:aiOrder.email.status.sendingDetail', { shop }), tone: 'info' };
    }
    case 'awaiting_shop_reply': {
      const sent = when(e?.sentAt);
      const replyBy = when(e?.replyBy);
      const base = sent && replyBy ? t('host:aiOrder.email.status.waitingDetail', { shop, sent, replyBy }) : t('host:aiOrder.email.status.waitingDetailNoTimes', { shop });
      const reminded = e?.reminderSentAt ? t('host:aiOrder.email.status.reminded', { time: when(e.reminderSentAt) }) : '';
      return {
        title: t('host:aiOrder.email.status.waitingTitle', { shop }),
        detail: [base, reminded].filter(Boolean).join(' '),
        caution: t('host:aiOrder.email.status.waitingCaution'),
        tone: 'info',
      };
    }
    case 'awaiting_price_approval': {
      const limit = formatCents(o.ceilingCents ?? null);
      const by = o.nextAction?.expires_at ? when(o.nextAction.expires_at) : '';
      return {
        title: total ? t('host:aiOrder.email.status.priceTitle', { shop, total }) : t('host:aiOrder.email.status.priceTitleNoTotal', { shop }),
        detail: [
          mine ? t('host:aiOrder.email.status.priceDetail', { shop, limit: limit || '—' }) : t('host:aiOrder.email.status.priceDetailOther', { shop, limit: limit || '—' }),
          by ? t('host:aiOrder.email.status.priceBy', { time: by, shop }) : '',
        ].filter(Boolean).join(' '),
        tone: 'action',
      };
    }
    case 'confirmed_by_shop': {
      const ref = e?.shopResponse?.reference;
      return {
        title: t('host:aiOrder.email.status.confirmedTitle', { shop }),
        detail: [
          total ? t('host:aiOrder.email.status.confirmedTotal', { total }) : '',
          pickup ? t('host:aiOrder.email.status.confirmedReady', { time: pickup }) : '',
          ref ? t('host:aiOrder.email.status.confirmedRef', { ref }) : '',
          t('host:aiOrder.email.status.confirmedPay'),
        ].filter(Boolean).join(' '),
        tone: 'success',
      };
    }
    default:
      // anything else (an unknown live status, or an ended one with no outcome): the cautious phone copy
      return statusInfo(o, now, opts);
  }
}
