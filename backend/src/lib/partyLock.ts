import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

/**
 * Serialise capacity-sensitive writes for ONE party. Runs `fn` inside an interactive transaction
 * that first takes `pg_advisory_xact_lock(hashtext(partyId))` (transaction-scoped: released at
 * commit/rollback, nothing session-level, so it is safe on the 6543 transaction pooler).
 * Concurrent RSVPs for the same party queue behind each other, so "count -> create -> waitlist
 * position" is atomic per party; other parties are unaffected.
 */
export async function withPartyLock<T>(
  partyId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${partyId}))`;
      return fn(tx);
    },
    { maxWait: 10_000, timeout: 20_000 },
  );
}
