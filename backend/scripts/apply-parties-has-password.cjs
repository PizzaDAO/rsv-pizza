#!/usr/bin/env node
/**
 * party-password-anon-exposure step 1: apply 20261112_parties_has_password
 * (parties.has_password generated boolean = password IS NOT NULL).
 * Additive + idempotent. DRY RUN by default (read-only); --apply to execute.
 * Self-verifies: the column exists, is generated, and its true count equals the number of
 * parties with a password. Prints counts only, never password values.
 *
 * No session SET / SET ROLE: DATABASE_URL is the 6543 transaction pooler.
 *
 *   node backend/scripts/apply-parties-has-password.cjs [--apply]
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const APPLY = process.argv.includes('--apply');
const prisma = new PrismaClient();
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261112_parties_has_password/migration.sql');

function statements() {
  return fs.readFileSync(MIGRATION, 'utf8')
    .split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(';').map((s) => s.trim()).filter(Boolean);
}

async function columnInfo() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT column_name, data_type, is_generated, generation_expression
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='parties' AND column_name='has_password'`);
  return rows[0] || null;
}

async function counts(withColumn) {
  const extra = withColumn
    ? `, count(*) FILTER (WHERE has_password IS TRUE)::int AS flag_true,
         count(*) FILTER (WHERE has_password IS NULL)::int AS flag_null`
    : '';
  const r = await prisma.$queryRawUnsafe(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE password IS NOT NULL)::int AS with_password
           ${extra}
    FROM parties`);
  return r[0];
}

async function main() {
  console.log(`\n=== parties.has_password (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const before = await columnInfo();
  console.log('column now:', before ? `${before.data_type}, generated=${before.is_generated}` : '(missing)');
  console.log('counts now:', JSON.stringify(await counts(!!before)));
  const stmts = statements();
  console.log(`\n${APPLY ? 'Running' : 'Would run'} ${stmts.length} statements:`);
  for (const s of stmts) console.log('  ' + s.replace(/\s+/g, ' '));
  if (!APPLY) { console.log('\nDry run only. Re-run with --apply.'); return; }

  for (const s of stmts) await prisma.$executeRawUnsafe(s);

  const info = await columnInfo();
  const c = await counts(true);
  console.log('\nafter:', JSON.stringify(info), JSON.stringify(c));
  const ok = info && info.data_type === 'boolean' && info.is_generated === 'ALWAYS'
    && c.flag_true === c.with_password && c.flag_null === 0;
  console.log(ok ? '\nOK   has_password exists, is generated, and matches password IS NOT NULL'
                 : '\nFAIL has_password missing or inconsistent - investigate');
  if (!ok) process.exit(1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
