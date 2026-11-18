#!/usr/bin/env node
/**
 * blackolive-70521: apply 20261118_party_labels (parties.labels text[] + GIN index + column GRANT
 * to anon/authenticated). Host-chosen public event tags, distinct from event_tags.
 * Additive + idempotent. DRY RUN by default (read-only); --apply to execute.
 * Apply to prod BEFORE merging the PR (Prisma selects every declared field).
 * Self-verifies column, index and anon/authenticated SELECT privilege. Prints counts only.
 *
 * No session SET / SET ROLE: DATABASE_URL is the 6543 transaction pooler.
 * Run from backend/ with `env -u DATABASE_URL` (dotenv never overrides an already-set variable):
 *   cd backend && env -u DATABASE_URL node scripts/apply-party-labels.cjs [--apply]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261118_party_labels/migration.sql');

function statements() {
  return fs.readFileSync(MIGRATION, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

async function state() {
  const col = await prisma.$queryRawUnsafe(`
    SELECT data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='parties' AND column_name='labels'`);
  const idx = await prisma.$queryRawUnsafe(`
    SELECT indexname FROM pg_indexes
    WHERE schemaname='public' AND tablename='parties' AND indexname='idx_parties_labels_gin'`);
  const grants = await prisma.$queryRawUnsafe(`
    SELECT grantee FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='parties' AND column_name='labels'
      AND privilege_type='SELECT' AND grantee IN ('anon','authenticated')`);
  return {
    column: col[0] || null,
    index: idx.length === 1,
    grants: grants.map((g) => g.grantee).sort(),
  };
}

async function main() {
  console.log(`\n=== parties.labels (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const before = await state();
  console.log('now:', JSON.stringify(before));
  const stmts = statements();
  console.log(`\n${APPLY ? 'Running' : 'Would run'} ${stmts.length} statements:`);
  for (const s of stmts) console.log('  ' + s.replace(/\s+/g, ' '));
  if (!APPLY) { console.log('\nDry run only. Re-run with --apply.'); return; }

  for (const s of stmts) await prisma.$executeRawUnsafe(s);

  const after = await state();
  console.log('\nafter:', JSON.stringify(after));
  const ok = after.column && after.column.udt_name === '_text' && after.column.is_nullable === 'NO'
    && after.index && after.grants.join(',') === 'anon,authenticated';
  console.log(ok ? '\nOK   labels column, GIN index and anon/authenticated SELECT grant exist'
                 : '\nFAIL labels column/index/grant missing - investigate');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
