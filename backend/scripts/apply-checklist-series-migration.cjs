#!/usr/bin/env node
/**
 * Apply 20260929_checklist_series (white-label Phase 2b): add series_id to
 * checklist_defaults, relax the global name-unique to per-series. Additive +
 * backward compatible (existing rows stay series_id NULL = global template).
 *
 * Must run against PROD before merging the schema.prisma change (backend SELECTs
 * every field). DRY RUN by default; --apply to execute in one transaction.
 *
 *   node backend/scripts/apply-checklist-series-migration.cjs [--apply]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const MIGRATION = path.join(__dirname, '../prisma/migrations/20260929_checklist_series/migration.sql');

function statements() {
  const raw = fs.readFileSync(MIGRATION, 'utf8');
  return raw.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

async function main() {
  console.log(`\n=== checklist_series migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);

  const [{ t: hasCol }] = await prisma.$queryRawUnsafe(
    `SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_defaults' AND column_name='series_id'))::text AS t`,
  );
  const [{ n: total }] = await prisma.$queryRawUnsafe(`SELECT count(*)::int AS n FROM checklist_defaults`);
  console.log(`baseline: checklist_defaults rows = ${total}; series_id column exists = ${hasCol}`);

  if (hasCol === 'true') {
    console.log('series_id already present — migration appears applied; aborting.');
    return;
  }

  const stmts = statements();
  if (!APPLY) {
    console.log(`\nWould run ${stmts.length} statements. Re-run with --apply.`);
    stmts.forEach((s) => console.log('  -', s.slice(0, 72).replace(/\s+/g, ' '), '...'));
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const s of stmts) {
      await tx.$executeRawUnsafe(s);
      console.log('OK  ', s.slice(0, 64).replace(/\s+/g, ' '), '...');
    }
  });

  const [{ t: colNow }] = await prisma.$queryRawUnsafe(
    `SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='checklist_defaults' AND column_name='series_id'))::text AS t`,
  );
  const [{ t: idxNow }] = await prisma.$queryRawUnsafe(
    `SELECT (EXISTS (SELECT 1 FROM pg_indexes WHERE tablename='checklist_defaults' AND indexname='checklist_defaults_series_name_key'))::text AS t`,
  );
  const [{ n: stillGlobal }] = await prisma.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM checklist_defaults WHERE series_id IS NULL`,
  );
  console.log(`\nverify: series_id column = ${colNow}; per-series unique index = ${idxNow}; global rows preserved = ${stillGlobal} (expect ${total})`);
  const ok = colNow === 'true' && idxNow === 'true' && stillGlobal === total;
  console.log(ok ? '\n✓ applied and verified' : '\n✗ verification MISMATCH');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
