#!/usr/bin/env node
/**
 * SECURITY: apply 20261002_lockdown_anon_exposed_tables — ENABLE RLS + REVOKE
 * anon/authenticated on 34 public tables that were anon-SELECTable (tax_forms bug
 * class). Reversible, non-destructive (does NOT drop the dead backup tables).
 * DRY RUN by default; --apply to execute in one transaction. Verifies afterward
 * that no target table remains anon-SELECTable.
 *
 *   node backend/scripts/apply-lockdown-anon-tables.cjs [--apply]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261002_lockdown_anon_exposed_tables/migration.sql');

function statements() {
  return fs.readFileSync(MIGRATION, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

// Target table names, parsed from the ALTER statements.
function targets() {
  return [...new Set(statements()
    .map((s) => /ALTER TABLE "([^"]+)" ENABLE/.exec(s)?.[1])
    .filter(Boolean))];
}

async function stillOpen() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity
      AND has_table_privilege('anon', c.oid, 'SELECT')
    ORDER BY 1`);
  return rows.map((r) => r.relname);
}

async function main() {
  console.log(`\n=== lockdown anon-exposed tables (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const tgt = targets();
  const before = await stillOpen();
  console.log(`targets: ${tgt.length}; currently anon-readable+RLS-off in public: ${before.length}`);

  const stmts = statements();
  if (!APPLY) {
    console.log(`Would run ${stmts.length} statements (ENABLE RLS + REVOKE anon/authenticated x${tgt.length}). Re-run with --apply.`);
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const s of stmts) await tx.$executeRawUnsafe(s);
  });

  const after = await stillOpen();
  const remaining = after.filter((t) => tgt.includes(t));
  console.log(`applied ${stmts.length} statements.`);
  console.log(`of the ${tgt.length} targets, still anon-readable+RLS-off: ${remaining.length}`);
  if (after.length) console.log(`(any other RLS-off+anon public tables remaining: ${after.join(', ') || 'none'})`);
  const ok = remaining.length === 0;
  console.log(ok ? '\n✓ all targets locked down and verified' : '\n✗ some targets NOT locked — investigate');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
