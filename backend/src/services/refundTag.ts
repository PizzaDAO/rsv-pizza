/**
 * paccheri-58541: single source of truth for the 'refund' event_tag.
 *
 * A city is "refund due" when it is OPEN (paymentsClosedAt IS NULL), has at
 * least one submitted (non-duplicate, non-ineligible) receipt, AND the
 * proof-backed PAID total exceeds the capped receipt total — i.e. PizzaDAO
 * over-reimbursed and is owed money back.
 *
 * The 'refund' tag is INTERNAL (see backend/src/lib/eventTags.ts +
 * frontend/src/lib/eventTags.ts): it is stripped from every public payload and
 * suppressed on guest-facing surfaces. It stays visible on /payments and
 * /underboss admin surfaces.
 *
 * `recomputeRefundTags` is batched + idempotent: it only writes rows whose tag
 * membership actually changes. Wire it AFTER any mutation that changes a
 * party's paid total or receipt total (payment-record + receipt-change paths),
 * outside the surrounding $transaction, wrapped in try/catch so a tag-recompute
 * failure never 500s the underlying action.
 */
import { PrismaClient } from '@prisma/client';
import { fetchPaidTotalsByParty } from '../routes/admin-payout.routes.js';

export const REFUND_TAG = 'refund';

// paccheri-58541: literal cap. Matches the /payments Pending tile formula —
// deliberately NOT computeEffectiveCapUsd (per-event numeric-tag caps do not
// raise the refund ceiling).
export const REFUND_CAP_USD = 625;

export interface PartyReimbursementState {
  receiptTotalUsd: number;
  capUsd: number;
  paidUsd: number;
  owedUsd: number;
  isRefund: boolean;
}

/**
 * Per-party reimbursement state for the given partyIds. Parties with no
 * receipts still appear in the map (receiptTotalUsd 0, isRefund false) when
 * loaded, but callers typically pass an id set already known to have receipts.
 */
export async function computePartyReimbursementState(
  db: PrismaClient,
  partyIds: string[],
): Promise<Map<string, PartyReimbursementState>> {
  const result = new Map<string, PartyReimbursementState>();
  if (partyIds.length === 0) return result;

  // receiptTotal: Σ ocr_amount over non-excluded receipt docs (NULL → 0).
  const receiptRows = await db.payoutDocument.groupBy({
    by: ['partyId'],
    where: {
      partyId: { in: partyIds },
      kind: 'receipt',
      isDuplicate: false,
      ineligible: false,
    },
    _sum: { ocrAmount: true },
  });
  const receiptTotals = new Map<string, number>();
  for (const r of receiptRows) {
    receiptTotals.set(
      r.partyId,
      r._sum.ocrAmount ? Number(r._sum.ocrAmount.toString()) : 0,
    );
  }

  // paid: proof-backed status='paid' only (reuse the shared helper — do NOT
  // duplicate the proof logic; 'completed' rows are intentionally excluded so
  // mark_pending_complete close-outs don't double-count).
  const paidTotals = await fetchPaidTotalsByParty(partyIds);

  // closed-state: a closed city is never a refund (the tag is cleared on
  // close), regardless of the math.
  const parties = await db.party.findMany({
    where: { id: { in: partyIds } },
    select: { id: true, paymentsClosedAt: true },
  });
  const closedById = new Map<string, boolean>();
  for (const p of parties) closedById.set(p.id, p.paymentsClosedAt != null);

  for (const partyId of partyIds) {
    const receiptTotalUsd = receiptTotals.get(partyId) ?? 0;
    const paidUsd = paidTotals.get(partyId)?.paidUsd ?? 0;
    const cappedReceipts = Math.min(REFUND_CAP_USD, receiptTotalUsd);
    const owedUsd = Math.max(0, cappedReceipts - paidUsd);
    const isClosed = closedById.get(partyId) === true;
    const hasReceipts = receiptTotals.has(partyId);
    const isRefund = !isClosed && hasReceipts && paidUsd > cappedReceipts;
    result.set(partyId, {
      receiptTotalUsd,
      capUsd: REFUND_CAP_USD,
      paidUsd,
      owedUsd,
      isRefund,
    });
  }
  return result;
}

/**
 * Add / remove REFUND_TAG in party.event_tags to match `isRefund`. Only writes
 * rows whose membership actually changes (no-op when already correct). Closed
 * parties always have the tag REMOVED (computePartyReimbursementState forces
 * isRefund=false for closed cities).
 */
export async function recomputeRefundTags(
  db: PrismaClient,
  partyIds: string[],
): Promise<void> {
  const ids = Array.from(new Set(partyIds.filter((id) => typeof id === 'string' && id.length > 0)));
  if (ids.length === 0) return;

  const states = await computePartyReimbursementState(db, ids);

  const parties = await db.party.findMany({
    where: { id: { in: ids } },
    select: { id: true, eventTags: true },
  });

  for (const party of parties) {
    const desired = states.get(party.id)?.isRefund === true;
    const current = Array.isArray(party.eventTags) ? party.eventTags : [];
    const has = current.includes(REFUND_TAG);
    if (desired === has) continue; // already correct — no-op

    const next = desired
      ? Array.from(new Set([...current, REFUND_TAG])) // add + dedupe
      : current.filter((t) => t !== REFUND_TAG);       // remove

    await db.party.update({
      where: { id: party.id },
      data: { eventTags: next },
    });
  }
}
