/**
 * basil-14648: keep PizzaOrder in step with pizza-mcp. One function serves both the signed
 * `order.updated` webhook and the poll on page view, so they cannot disagree.
 *
 * - Out of order: pizza-mcp's order.timeline is append-only, so a view with a SHORTER timeline
 *   than the stored one is older and is ignored; on equal length the later event time wins.
 * - Draft receipt: on `confirmed_by_shop` (phone tier) or `payment_status = paid` (native) a
 *   draft PayoutDocument is created, once (unique pizza_order_id), carrying NO file and NO
 *   ocrAmount. The shop's total lives in ocrRaw so the reimbursement flow can show and cross-check
 *   it without ever adding it to a payout sum next to the host's real receipt.
 */
import type { Prisma, PizzaOrder } from '@prisma/client';
import type { OpopOrder } from './pizzaMcp.client.js';

export type Db = Prisma.TransactionClient;

export interface ClientRef {
  party_id?: unknown;
  rsvp_user_id?: unknown;
}

export interface ApplyResult {
  row: PizzaOrder | null;
  applied: boolean;
  draftCreated: boolean;
}

/**
 * `tier` is OUR stored value (the row), not the view's: pizza-mcp's order view carries no `tier`
 * on every path, which made native orders look like phone orders.
 */
export function isDraftReceiptTrigger(
  o: Pick<OpopOrder, 'status' | 'payment_status'>,
  tier: string
): 'ai_call' | 'opop_native' | null {
  if (tier !== 'native' && o.status === 'confirmed_by_shop') return 'ai_call';
  if (tier === 'native' && o.payment_status === 'paid') return 'opop_native';
  return null;
}

function confirmedTotalCents(o: OpopOrder, tier: string): number | null {
  if (tier === 'native') return o.totals?.total_cents ?? null;
  const shop = o.call?.shop_total_cents;
  return typeof shop === 'number' ? shop : null;
}

// Only real ISO-8601 timestamps. `new Date("around 6")` happily returns June 2001.
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;
function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !ISO_RE.test(s)) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function applyOrderUpdate(
  db: Db,
  order: OpopOrder,
  opts: { eventAt?: Date | null; clientRef?: ClientRef | null } = {}
): Promise<ApplyResult> {
  const timelineLen = Array.isArray(order.timeline) ? order.timeline.length : 0;
  const eventAt = opts.eventAt ?? null;

  let row = await db.pizzaOrder.findUnique({ where: { opopOrderId: order.id } });

  if (!row) {
    // The webhook can beat the placing request's own insert. Create from the echoed client_ref
    // (signed, so trusted); the placing request fills in shop name / ceiling afterwards.
    const partyId = typeof opts.clientRef?.party_id === 'string' ? opts.clientRef.party_id : null;
    const userId = typeof opts.clientRef?.rsvp_user_id === 'string' ? opts.clientRef.rsvp_user_id : null;
    if (!partyId || !userId || !UUID_RE.test(partyId)) return { row: null, applied: false, draftCreated: false };
    const party = await db.party.findUnique({ where: { id: partyId }, select: { id: true } });
    if (!party) return { row: null, applied: false, draftCreated: false };
    // createMany + skipDuplicates (ON CONFLICT DO NOTHING): losing the race to the placing request
    // must not abort this transaction the way a unique violation would.
    await db.pizzaOrder.createMany({
      data: [
        {
          partyId,
          userId,
          opopOrderId: order.id,
          tier: order.pizzeria_id?.startsWith('pzl_') ? 'listing' : 'native', // listing ids are pzl_*; pizza-mcp's view carries no reliable tier
          shopId: order.pizzeria_id,
          shopName: 'Pizzeria',
          status: 'awaiting_approval',
          timelineLen: 0,
        },
      ],
      skipDuplicates: true,
    });
    row = await db.pizzaOrder.findUnique({ where: { opopOrderId: order.id } });
    if (!row) return { row: null, applied: false, draftCreated: false };
  }

  const stale =
    timelineLen < row.timelineLen ||
    (timelineLen === row.timelineLen && eventAt !== null && row.lastEventAt !== null && eventAt < row.lastEventAt);
  if (stale) return { row, applied: false, draftCreated: false };

  const total = confirmedTotalCents(order, row.tier);
  row = await db.pizzaOrder.update({
    where: { id: row.id },
    data: {
      status: order.status,
      paymentStatus: order.payment_status ?? null,
      summary: order.summary ?? row.summary,
      confirmedTotalCents: total ?? row.confirmedTotalCents,
      readyAt: parseDate(order.promised_at) ?? row.readyAt,
      readyAtText: order.call?.ready_at_text ?? row.readyAtText,
      lastView: order as unknown as Prisma.InputJsonValue,
      nextAction: (order.next_action ?? null) as unknown as Prisma.InputJsonValue,
      timelineLen,
      lastEventAt: eventAt ?? new Date(),
    },
  });

  let draftCreated = false;
  const source = isDraftReceiptTrigger(order, row.tier);
  if (!source && row.payoutDocumentId) {
    // Downgraded (needs_review) or canceled after the shop confirmed: the "confirmed" draft is no
    // longer true. Remove it unless the host already attached it to a request.
    await db.payoutDocument.deleteMany({ where: { pizzaOrderId: row.id, source: { not: 'upload' }, payoutId: null } });
    row = await db.pizzaOrder.update({ where: { id: row.id }, data: { payoutDocumentId: null } });
  } else if (source && row.payoutDocumentId) {
    // Still confirmed: keep the draft's total and notes current (a re-quoted price, new substitutions).
    await db.payoutDocument.updateMany({
      where: { pizzaOrderId: row.id, source: { not: 'upload' } },
      data: { ocrSummary: draftSummary(source, row.shopName, total), ocrRaw: draftRaw(source, row, order, total) as Prisma.InputJsonValue },
    });
  }
  if (source && !row.payoutDocumentId) {
    const hostUser = await db.user.findUnique({ where: { id: row.userId }, select: { email: true } });
    const made = await db.payoutDocument.createMany({
      data: [
        {
          partyId: row.partyId,
          kind: 'receipt',
          source,
          pizzaOrderId: row.id,
          // No file exists. The marker keeps the NOT NULL columns honest and unique per order.
          url: `pizza-order://${row.opopOrderId}`,
          fileName: `${row.shopName} order ${order.order_number ?? row.opopOrderId}`.slice(0, 200),
          fileSize: 0,
          mimeType: 'application/x-pizza-order',
          ocrAmount: null,
          // Stop the OCR backfill loop from fetching a URL that is not a file.
          ocrAttemptCount: 3,
          ocrAttemptedAt: new Date(),
          ocrSummary: draftSummary(source, row.shopName, total),
          ocrRaw: draftRaw(source, row, order, total) as Prisma.InputJsonValue,
          uploadedByUserId: hostUser ? row.userId : null,
          uploadedByEmail: hostUser?.email ?? null,
        },
      ],
      skipDuplicates: true,
    });
    if (made.count === 1) {
      const doc = await db.payoutDocument.findUnique({ where: { pizzaOrderId: row.id }, select: { id: true } });
      row = await db.pizzaOrder.update({ where: { id: row.id }, data: { payoutDocumentId: doc?.id ?? null } });
      draftCreated = true;
    }
  }
  return { row, applied: true, draftCreated };
}

function draftSummary(source: 'ai_call' | 'opop_native', shopName: string, total: number | null): string {
  return `${source === 'ai_call' ? 'AI phone order' : 'Online order'} at ${shopName}: ${
    total != null ? `$${(total / 100).toFixed(2)}` : 'total pending'
  }. Reminder only: upload your real receipt to be reimbursed.`.slice(0, 300);
}

function draftRaw(source: string, row: PizzaOrder, order: OpopOrder, total: number | null) {
  return {
    source,
    opop_order_id: row.opopOrderId,
    shop_id: row.shopId,
    shop_name: row.shopName,
    confirmed_total_cents: total,
    ready_at_text: order.call?.ready_at_text ?? null,
    changes: order.call?.changes ?? [],
    summary: order.summary ?? null,
  };
}
