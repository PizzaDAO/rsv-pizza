/**
 * sfincione-40417 (pizza count): hash-stability check. READ-ONLY (one SELECT).
 *
 * Run BEFORE and AFTER applying sfincione-40417-7-pizza-count.sql (the "before" run needs a
 * DB where the migration is not applied yet, so only HASH_SQL is checked then), and again after
 * deploying the code. Both counts must be 0:
 *   - hashDrift:  docs whose stored items_hash <> HASH_SQL (HASH_SQL must be unchanged, or every doc
 *                 would resync and re-spend LLM/vision quota)
 *   - countDrift: docs whose stored count_hash IS DISTINCT FROM COUNT_HASH_SQL (nonzero only once
 *                 something sets a pizza count, e.g. the backfill; expected 0 right after migration)
 *
 * Usage (from backend/, needs DATABASE_URL):  npx tsx scripts/check-pizza-count-hash.ts
 * Exit code 1 when either count is nonzero.
 */
process.env.NODE_ENV ??= 'production';

async function main() {
  const { prisma } = await import('../src/config/database.js');
  const { Prisma } = await import('@prisma/client');
  const { HASH_SQL, COUNT_HASH_SQL } = await import('../src/services/pizzaLineSync.service.js');

  const cols = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
    SELECT count(*)::int AS n FROM information_schema.columns
    WHERE table_name = 'pizza_line_sync' AND column_name = 'count_hash'`);
  const migrated = cols[0].n > 0;

  const [{ hash_drift }] = await prisma.$queryRaw<Array<{ hash_drift: number }>>(Prisma.sql`
    SELECT count(*)::int AS hash_drift
    FROM pizza_line_sync s
    JOIN payout_documents d ON d.id = s.document_id
    LEFT JOIN payouts po ON po.id = d.payout_id
    WHERE d.ocr_line_items IS NOT NULL AND s.items_hash <> ${HASH_SQL}`);

  let countDrift: number | string = 'n/a (migration not applied)';
  if (migrated) {
    const [{ n }] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT count(*)::int AS n
      FROM pizza_line_sync s
      JOIN payout_documents d ON d.id = s.document_id
      WHERE s.count_hash IS DISTINCT FROM ${COUNT_HASH_SQL}`);
    countDrift = n;
  }

  console.log(JSON.stringify({ migrated, hashDrift: hash_drift, countDrift }, null, 2));
  await prisma.$disconnect();
  if (hash_drift !== 0 || (typeof countDrift === 'number' && countDrift !== 0)) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
