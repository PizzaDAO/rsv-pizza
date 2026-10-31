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

export function isDraftReceiptTrigger(o: Pick<OpopOrder, 'status' | 'payment_status' | 'tier'>): 'ai_call' | 'opop_native' | null {
  if (o.tier !== 'native' && o.status === 'confirmed_by_shop') return 'ai_call';
  if (o.tier === 'native' && o.payment_status === 'paid') return 'opop_native';
  return null;
}

function confirmedTotalCents(o: OpopOrder): number | null {
  if (o.tier === 'native') return o.totals?.total_cents ?? null;
  const shop = o.call?.shop_total_cents;
  return typeof shop === 'number' ? shop : null;
}

function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string') return null;
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
    row = await db.pizzaOrder.create({
      data: {
        partyId,
        userId,
        opopOrderId: order.id,
        tier: order.tier ?? 'listing',
        shopId: order.pizzeria_id,
        shopName: 'Pizzeria',
        status: 'awaiting_approval',
        timelineLen: 0,
      },
    });
  }

  const stale =
    timelineLen < row.timelineLen ||
    (timelineLen === row.timelineLen && eventAt !== null && row.lastEventAt !== null && eventAt < row.lastEventAt);
  if (stale) return { row, applied: false, draftCreated: false };

  const total = confirmedTotalCents(order);
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
  const source = isDraftReceiptTrigger(order);
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
          ocrSummary: `${source === 'ai_call' ? 'AI phone order' : 'Online order'} at ${row.shopName}: ${
            total != null ? `$${(total / 100).toFixed(2)}` : 'total pending'
          }. Attach the real receipt to be reimbursed.`.slice(0, 300),
          ocrRaw: {
            source,
            opop_order_id: row.opopOrderId,
            shop_id: row.shopId,
            shop_name: row.shopName,
            confirmed_total_cents: total,
            ready_at_text: order.call?.ready_at_text ?? null,
            changes: order.call?.changes ?? [],
            summary: order.summary ?? null,
          } as Prisma.InputJsonValue,
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
