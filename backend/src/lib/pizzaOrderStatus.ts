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

/** Nothing live and nothing confirmed: a new order for the party needs no extra confirmation. */
export const FREE_STATUSES: ReadonlySet<string> = new Set(['refused', 'unreachable', 'canceled', 'shop_requires_prepay']);

/**
 * Statuses pizza-mcp lets a host cancel. `calling` and `awaiting_price_approval` are NOT here: it
 * answers 409 there (a call is live), so offering a button only produced an error.
 */
export const CANCELABLE_STATUSES: ReadonlySet<string> = new Set(['awaiting_approval', 'approval_timeout', 'held']);

/** How long after `confirmed_by_shop` we keep polling: pizza-mcp can still downgrade it to `needs_review`. */
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

interface OrderRowLike {
  status: string;
  nextAction?: unknown;
  ceilingCents?: number | null;
  confirmedTotalCents?: number | null;
  releasedAt?: Date | string | null;
}

/**
 * A `needs_review` order only holds the party's budget (and blocks a new order) when the shop
 * actually reached a confirmation or quoted a total inside what the host approved. IVR, voicemail
 * and "the shop quoted more than the limit" mean nothing was ordered, so they hold nothing.
 */
export function needsReviewHolds(row: OrderRowLike): boolean {
  if (row.status !== 'needs_review') return false;
  if (row.confirmedTotalCents == null) return false;
  return row.ceilingCents == null || row.confirmedTotalCents <= row.ceilingCents;
}

/**
 * Does this row stop the party from placing another order, and hold budget? A host who said
 * "nothing was ordered" (`releasedAt`) releases it.
 */
export function isBlocking(row: OrderRowLike): boolean {
  if (row.releasedAt) return false;
  if (row.status === 'needs_review') return needsReviewHolds(row);
  return !FREE_STATUSES.has(row.status) && !isRestartable(row);
}

/** Keep polling a freshly confirmed order for a while: the post-call check can still downgrade it. */
export function isSettling(row: { status: string; lastEventAt?: Date | string | null }, now = Date.now()): boolean {
  if (row.status !== 'confirmed_by_shop') return false;
  const t = row.lastEventAt ? new Date(row.lastEventAt).getTime() : NaN;
  return Number.isFinite(t) && now - t < SETTLE_WINDOW_MS;
}
