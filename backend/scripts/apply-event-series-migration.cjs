#!/usr/bin/env node
/**
 * Apply the 20260928_event_series migration (Phase 1 of the white-label event
 * series work) to the database in DATABASE_URL, with baseline + verification.
 *
 * Per repo convention this must run against PROD *before* the schema.prisma
 * change (PR) is merged — the backend SELECTs every Prisma field, so merging the
 * EventSeries model / Party.eventSeriesId ahead of the columns would 500 prod.
 *
 * Additive + reversible: new table, new nullable FK column, seed of 2 GPP series
 * rows, backfill of existing gpp parties. No destructive statements.
 *
 * DRY RUN by default (prints baseline + planned statements, changes nothing).
 * Pass --apply to execute inside a single transaction.
 *
 *   node backend/scripts/apply-event-series-migration.cjs           # dry run
 *   node backend/scripts/apply-event-series-migration.cjs --apply   # execute
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();

const MIGRATION = path.join(__dirname, '../prisma/migrations/20260928_event_series/migration.sql');

function statements() {
  const raw = fs.readFileSync(MIGRATION, 'utf8');
  const noComments = raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n');
  return noComments.split(';').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  console.log(`\n=== event_series migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const [{ n: gpp }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM parties WHERE event_type = 'gpp'`,
  );
  const [{ n: gpp27 }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM parties WHERE event_type = 'gpp' AND 'gpp2027' = ANY(event_tags)`,
  );
  const [{ t: exists }] = await prisma.$queryRawUnsafe(
    `SELECT to_regclass('public.event_series')::text AS t`,
  );
  console.log(`baseline: ${gpp} gpp parties (${gpp27} tagged gpp2027); event_series table = ${exists}`);
  console.log(`expected backfill: ${gpp27} -> gpp2027, ${gpp - gpp27} -> gpp2026\n`);

  if (exists) {
    console.log('event_series already exists — migration appears applied; aborting to avoid duplicate seed.');
    return;
  }

  const stmts = statements();
  if (!APPLY) {
    console.log(`Would run ${stmts.length} statements. Re-run with --apply to execute.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const s of stmts) {
      await tx.$executeRawUnsafe(s);
      console.log('OK  ', s.slice(0, 64).replace(/\s+/g, ' '), '...');
    }
  });

  // Verify.
  const [{ n: seriesCount }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM event_series`,
  );
  const [{ n: linked }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM parties WHERE event_series_id IS NOT NULL`,
  );
  const [{ n: linked27 }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM parties p JOIN event_series s ON p.event_series_id = s.id WHERE s.slug = 'gpp2027'`,
  );
  const [{ t: rls }] = await prisma.$queryRawUnsafe(
    `SELECT relrowsecurity::text AS t FROM pg_class WHERE relname = 'event_series'`,
  );
  console.log(`\nverify: event_series rows = ${seriesCount} (expect 2); parties linked = ${linked} (expect ${gpp}); linked to gpp2027 = ${linked27} (expect ${gpp27}); RLS = ${rls}`);
  const ok = seriesCount === 2 && linked === gpp && linked27 === gpp27 && rls === 'true';
  console.log(ok ? '\n✓ migration applied and verified' : '\n✗ verification MISMATCH — investigate');
  if (!ok) process.exit(1);
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
