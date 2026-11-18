import { Prisma } from '@prisma/client';
import { prisma } from '../config/database.js';

/**
 * Serialize find-then-create for one Stripe PaymentIntent (webhook and client POST race) without a
 * unique index. Transaction-scoped only (SET LOCAL + advisory xact lock), so nothing leaks onto
 * the 6543 transaction pooler's session.
 */
export async function withDonationLock<T>(
  paymentIntentId: string,
  fn: (tx: Prisma.TransactionClient) => Promise<T>
): Promise<T> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'donation:' + paymentIntentId}))`;
    return fn(tx);
  });
}
