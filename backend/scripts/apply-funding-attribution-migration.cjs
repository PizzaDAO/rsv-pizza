#!/usr/bin/env node
/**
 * Apply 20260929_funding_attribution (white-label Phase 4): additive columns
 * payouts.funding_source_id, payouts.funding_wallet_address,
 * event_series.funding_wallet_address. No behavior change. Must run against PROD
 * before merging the schema.prisma change. DRY RUN by default; --apply to execute.
 *
 *   node backend/scripts/apply-funding-attribution-migration.cjs [--apply]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const MIGRATION = path.join(__dirname, '../prisma/migrations/20260929_funding_attribution/migration.sql');

const hasCol = (table, col) =>
  prisma.$queryRawUnsafe(
    `SELECT (EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='${table}' AND column_name='${col}'))::text AS t`,
  ).then((r) => r[0].t);

async function main() {
  console.log(`\n=== funding_attribution migration (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const before = {
    payoutSrc: await hasCol('payouts', 'funding_source_id'),
    payoutWallet: await hasCol('payouts', 'funding_wallet_address'),
    seriesWallet: await hasCol('event_series', 'funding_wallet_address'),
  };
  console.log('baseline columns exist:', JSON.stringify(before));

  if (before.payoutSrc === 'true' && before.payoutWallet === 'true' && before.seriesWallet === 'true') {
    console.log('all columns already present — appears applied; aborting.');
    return;
  }

  const stmts = fs.readFileSync(MIGRATION, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);

  if (!APPLY) {
    console.log(`\nWould run ${stmts.length} statements. Re-run with --apply.`);
    stmts.forEach((s) => console.log('  -', s.replace(/\s+/g, ' ')));
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const s of stmts) {
      await tx.$executeRawUnsafe(s);
      console.log('OK  ', s.replace(/\s+/g, ' '));
    }
  });

  const after = {
    payoutSrc: await hasCol('payouts', 'funding_source_id'),
    payoutWallet: await hasCol('payouts', 'funding_wallet_address'),
    seriesWallet: await hasCol('event_series', 'funding_wallet_address'),
  };
  const ok = after.payoutSrc === 'true' && after.payoutWallet === 'true' && after.seriesWallet === 'true';
  console.log('\nverify columns exist:', JSON.stringify(after));
  console.log(ok ? '\n✓ applied and verified' : '\n✗ verification MISMATCH');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
