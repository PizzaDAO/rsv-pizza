/**
 * basil-14648: order status sets. TERMINAL mirrors pizza-mcp's `TERMINAL`
 * (src/voice/outbound/state.ts) exactly, plus `completed` for native orders. `approval_timeout`
 * is NOT terminal there (a callback can still follow), and `needs_review` IS.
 */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'confirmed_by_shop',
  'needs_review',
  'shop_requires_prepay',
  'refused',
  'unreachable',
  'canceled',
  'completed',
]);

/**
 * Ended without a confirmation. With no `outcome` a new order needs no extra confirmation; with one, `nothing_ordered`
 * decides (see isBlocking). pizza-mcp's reason codes are never read here: unknown reasons must work, so only the
 * boolean counts.
 */
export const FREE_STATUSES: ReadonlySet<string> = new Set(['refused', 'unreachable', 'canceled', 'shop_requires_prepay']);

/**
 * Statuses pizza-mcp always lets a host cancel. `awaiting_price_approval` is NOT here: it answers 409
 * there (the shop is on the line). `calling` depends on the dial, see isCancelable.
 */
export const CANCELABLE_STATUSES: ReadonlySet<string> = new Set(['awaiting_approval', 'approval_timeout', 'held']);

/**
 * How long after entering `confirmed_by_shop` we keep polling. Since pizza-mcp 662d51c the judge rules BEFORE
 * `confirmed_by_shop` (the order waits in `calling` + `call.checking`), so a downgrade is no longer expected; the
 * window is kept as a cheap safety net.
 */
export const SETTLE_WINDOW_MS = 20 * 60_000;

export const isTerminal = (status: string) => TERMINAL_STATUSES.has(status);

/**
 * An approval that expired: pizza-mcp left the order in `awaiting_approval` with no link to open.
 * Nothing is happening to it, so the host may simply start over.
 */
export function isRestartable(row: { status: string; nextAction?: unknown }): boolean {
  if (row.status !== 'awaiting_approval') return false;
  const na = row.nextAction as { type?: string } | null | undefined;
  return !na || na.type === 'none';
}

/**
 * pizza-mcp 662d51c: the shop agreed on the call and the call is being checked (its post-call judge) before the order
 * can be `confirmed_by_shop`. The order stays `calling` with `call.checking = { message }` until it becomes
 * `confirmed_by_shop` or `needs_review` (`no_call_record` within about an hour if the call record never arrives).
 * `calling` is never "confirmed": nothing that says so (draft receipt, host notice) happens before `confirmed_by_shop`.
 * No webhook is sent when `checking` first appears: polling picks it up. Returns pizza-mcp's message, or null.
 */
export function checkingOf(row: { status: string; lastView?: unknown }): { message: string } | null {
  if (row.status !== 'calling') return null;
  const c = (row.lastView as { call?: { checking?: { message?: unknown } | null } | null } | null | undefined)?.call?.checking;
  if (!c || typeof c !== 'object') return null;
  return { message: typeof c.message === 'string' && c.message.trim() ? c.message : 'The call ended and the result is being checked.' };
}

/**
 * Can the host call this order off? `calling` counts only while the dial is deferred (`call.deferred`):
 * no call is on the line yet. If the dial starts first, pizza-mcp's 409 reaches the host as an error.
 * Never while the finished call is being checked (`call.checking`): pizza-mcp refuses that cancel.
 */
export function isCancelable(row: { status: string; lastView?: unknown }): boolean {
  if (CANCELABLE_STATUSES.has(row.status)) return true;
  if (checkingOf(row)) return false;
  const deferred = (row.lastView as { call?: { deferred?: unknown } | null } | null | undefined)?.call?.deferred;
  return row.status === 'calling' && !!deferred;
}

export interface OrderOutcome {
  nothing_ordered: boolean;
  reason: string;
  message: string;
}

/** pizza-mcp's OrderView.outcome, as last stored in lastView. Missing / malformed = unknown (null). */
export function outcomeOf(row: { lastView?: unknown }): OrderOutcome | null {
  const o = (row.lastView as { outcome?: Partial<OrderOutcome> | null } | null | undefined)?.outcome;
  if (!o || typeof o !== 'object' || typeof o.nothing_ordered !== 'boolean') return null;
  return { nothing_ordered: o.nothing_ordered, reason: String(o.reason ?? ''), message: String(o.message ?? '') };
}

interface OrderRowLike {
  lastView?: unknown;
  status: string;
  nextAction?: unknown;
  ceilingCents?: number | null;
  confirmedTotalCents?: number | null;
  releasedAt?: Date | string | null;
}

/**
 * Fallback when pizza-mcp sends no `outcome`: a `needs_review` order only holds the party's budget when the shop
 * reached a confirmation or quoted a total inside what the host approved.
 */
export function needsReviewHolds(row: OrderRowLike): boolean {
  if (row.status !== 'needs_review') return false;
  if (row.confirmedTotalCents == null) return false;
  return row.ceilingCents == null || row.confirmedTotalCents <= row.ceilingCents;
}

/** Ended, and pizza-mcp says an order may exist at the shop. `needs_review` is not here: it always takes a receipt. */
export function mayExistAtShop(row: OrderRowLike): boolean {
  return FREE_STATUSES.has(row.status) && outcomeOf(row)?.nothing_ordered === false;
}

/**
 * Does this row stop the party from placing another order, and hold budget? A host who said
 * "nothing was ordered" (`releasedAt`) releases it.
 */
export function isBlocking(row: OrderRowLike): boolean {
  if (row.releasedAt) return false;
  const ended = row.status === 'needs_review' || FREE_STATUSES.has(row.status);
  // Only a final status can free anything. A live order still counts whatever its outcome says: on approval_timeout
  // `nothing_ordered` may be either value, and approving sends the call back to the shop.
  if (!ended) return !isRestartable(row);
  const outcome = outcomeOf(row);
  // An order may exist (ambiguous_dial, outcome_unclear, a reason added later...): hold the budget and block a second
  // order until a host has checked with the shop, whatever the status.
  if (outcome) return !outcome.nothing_ordered;
  // No outcome (older pizza-mcp, or malformed): fall back to what we can see.
  return row.status === 'needs_review' && needsReviewHolds(row);
}

/**
 * Keep polling a freshly confirmed order for a while: the post-call check can still downgrade it.
 * Counted from `confirmedAt`, not `lastEventAt`: every poll moves `lastEventAt`, so it would never end.
 */
export function isSettling(row: { status: string; confirmedAt?: Date | string | null }, now = Date.now()): boolean {
  if (row.status !== 'confirmed_by_shop') return false;
  const t = row.confirmedAt ? new Date(row.confirmedAt).getTime() : NaN;
  return Number.isFinite(t) && now - t < SETTLE_WINDOW_MS;
}
