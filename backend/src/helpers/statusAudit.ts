import { Prisma } from '@prisma/client';

const STATUS_TO_ACTION: Record<string, string> = {
  approved: 'approve',
  rejected: 'reject',
  listed:   'list',
  hidden:   'hide',
  pending:  'pending',
};

export type ActorKind = 'admin' | 'underboss' | 'owner' | 'system';

/**
 * Writes a single row to party_status_audit. Must be called inside an
 * interactive $transaction with the status update. If this throws, the
 * surrounding transaction aborts and the status change rolls back —
 * fail-closed by design (see pizzaiolo-97053).
 */
export function writeStatusAudit(
  tx: Prisma.TransactionClient,
  partyId: string,
  oldStatus: string | null,
  newStatus: string,
  actorEmail: string,
  actorKind: ActorKind,
  reason?: string,
) {
  return tx.partyStatusAudit.create({
    data: {
      partyId,
      action:     STATUS_TO_ACTION[newStatus] ?? newStatus,
      oldStatus,
      newStatus,
      actorEmail: (actorEmail || 'unknown').toLowerCase(),
      actorKind,
      reason: reason ?? null,
    },
  });
}
