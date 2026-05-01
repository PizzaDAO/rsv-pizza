import { PrismaClient, Prisma } from '@prisma/client';

/**
 * Sets Postgres session variables so the deletion trigger can record
 * who performed the delete and from what context.
 *
 * Must be called inside an interactive $transaction with the delete.
 * Uses SET LOCAL so the variables are scoped to the current transaction.
 */
export async function setDeleteContext(
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>,
  userEmail: string | undefined,
  context: string
): Promise<void> {
  const safeEmail = userEmail || 'unknown';
  const safeContext = context;
  await tx.$executeRaw(Prisma.sql`SELECT set_config('app.current_user', ${safeEmail}, true)`);
  await tx.$executeRaw(Prisma.sql`SELECT set_config('app.delete_context', ${safeContext}, true)`);
}
