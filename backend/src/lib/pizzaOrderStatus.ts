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

/** Statuses a host can still cancel (nothing confirmed by a shop yet). */
export const CANCELABLE_STATUSES: ReadonlySet<string> = new Set([
  'awaiting_approval',
  'calling',
  'awaiting_price_approval',
  'approval_timeout',
  'held',
]);

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

/** Does this row stop the party from placing another order without an explicit confirmation? */
export function isBlocking(row: { status: string; nextAction?: unknown }): boolean {
  return !FREE_STATUSES.has(row.status) && !isRestartable(row);
}
