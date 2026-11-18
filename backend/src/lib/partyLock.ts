import type { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

/**
 * Serialise capacity-sensitive writes for ONE party. Runs `fn` inside an interactive transaction
 * that first takes `pg_advisory_xact_lock(hashtext(partyId))` (transaction-scoped: released at
 * commit/rollback). `SET LOCAL lock_timeout` is also transaction-scoped (reverts at the end of the
 * transaction), so nothing session-level leaks onto the 6543 transaction pooler.
 * Concurrent RSVPs for the same party queue behind each other, so "count -> create -> waitlist
 * position" is atomic per party; other parties are unaffected. If the lock can't be had within
 * 5s (or a transaction slot can't be had in the default maxWait), the caller gets a 503.
 */
function isLockBusy(err: unknown): boolean {
  const e = err as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null;
  const msg = `${e?.message ?? ''} ${e?.meta?.message ?? ''}`;
  return (
    e?.code === 'P2028' || // interactive transaction could not start / timed out
    e?.code === '55P03' ||
    e?.meta?.code === '55P03' ||
    /lock timeout|55P03/i.test(msg)
  );
}

export async function withPartyLock<T>(
  partyId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${partyId}))`;
        return fn(tx);
      },
      { timeout: 20_000 }, // maxWait stays at the client default (5s, config/database.ts)
    );
  } catch (err) {
    if (isLockBusy(err)) {
      throw new AppError('The event is busy right now. Please try again in a moment.', 503, 'BUSY_TRY_AGAIN');
    }
    throw err;
  }
}
