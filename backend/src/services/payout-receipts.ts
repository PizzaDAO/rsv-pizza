import { Prisma, PrismaClient } from '@prisma/client';
// bottarga-58513: a payout is documented if a receipt payout_document is linked directly (payout_id)
// or to the same party by the same host (legacy/admin-added receipts stamp party_id, not payout_id).
export async function payoutHasReceipt(
  db: PrismaClient | Prisma.TransactionClient,
  p: { id: string; partyId: string | null; hostUserId: string | null },
): Promise<boolean> {
  const hit = await db.payoutDocument.findFirst({
    where: {
      kind: 'receipt',
      OR: [
        { payoutId: p.id },
        ...(p.partyId && p.hostUserId ? [{ partyId: p.partyId, uploadedByUserId: p.hostUserId }] : []),
      ],
    },
    select: { id: true },
  });
  return !!hit;
}
