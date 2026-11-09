/**
 * basil-14648: the real price-approval hold (pizza-mcp 64fb2ac).
 *
 * While an order is `awaiting_price_approval` the shop is on hold for a fixed 3 minutes. pizza-mcp's order view
 * does not carry that deadline: its `next_action.expires_at` is when the approval LINK expires (much later, the
 * host can still approve after the hold and we call the shop back). The deadline is on the approval page's view,
 * `GET /confirmations/{id}` -> `hold_until`. This reads it for the confirmation the order's `next_action` points at
 * and stores it on the stored next action as `hold_until` (plus `live`), so the status card can count down to the
 * real deadline.
 *
 * Never inside a DB transaction (it is a network call), never fatal: on any failure the view is returned unchanged
 * and the card falls back to "the shop is holding the line, please answer quickly".
 */
import type { OpopOrder, PizzaMcpClient } from './pizzaMcp.client.js';

/** pizza-mcp's listing confirmation ids, as its `next_action.url` ends: `/confirm/lconf_<id>`. */
const CONFIRM_URL_RE = /\/confirm\/(lconf_[A-Za-z0-9_-]{1,100})\/?(?:[?#].*)?$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

export function confirmationIdOf(nextAction: unknown): string | null {
  const na = nextAction as { type?: unknown; url?: unknown } | null | undefined;
  if (!na || na.type !== 'open_url' || typeof na.url !== 'string') return null;
  const m = CONFIRM_URL_RE.exec(na.url);
  return m ? m[1] : null;
}

/** Only a price approval waits on a hold; a first approval has no shop on the line. */
const needsHold = (o: Pick<OpopOrder, 'status'>) => o.status === 'awaiting_price_approval';

export async function withApprovalHold<T extends Pick<OpopOrder, 'status' | 'next_action'>>(
  client: Pick<PizzaMcpClient, 'getConfirmation'>,
  order: T
): Promise<T> {
  if (!needsHold(order)) return order;
  const id = confirmationIdOf(order.next_action);
  if (!id) return order;
  try {
    const c = await client.getConfirmation(id);
    if (!c || c.id !== id || c.kind !== 'price_increase') return order;
    const hold = typeof c.hold_until === 'string' && ISO_RE.test(c.hold_until) && !Number.isNaN(Date.parse(c.hold_until)) ? c.hold_until : null;
    return {
      ...order,
      next_action: {
        ...order.next_action!,
        hold_until: hold,
        ...(typeof c.live === 'boolean' ? { live: c.live } : {}),
      },
    };
  } catch {
    return order;
  }
}

/** The hold deadline stored on a row's next action (see withApprovalHold), or null. */
export function holdUntilOf(row: { status: string; nextAction?: unknown }): string | null {
  if (row.status !== 'awaiting_price_approval') return null;
  const h = (row.nextAction as { hold_until?: unknown } | null | undefined)?.hold_until;
  return typeof h === 'string' && ISO_RE.test(h) ? h : null;
}
