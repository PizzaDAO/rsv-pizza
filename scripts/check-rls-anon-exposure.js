#!/usr/bin/env node
/**
 * scripts/check-rls-anon-exposure.js
 *
 * Live-state regression guard for the tax_forms / #1061 bug class: a public table
 * that is RLS-OFF *and* SELECTable by the `anon` role is readable by anyone with
 * the public anon key. Fails if any such table exists outside the allowlist of
 * intentionally-public tables.
 *
 * ============================================================================
 *                    READ-ONLY. NEVER WRITES TO THE DB.
 * ============================================================================
 * Only reads pg_class / has_table_privilege. Complements the rls-check guard
 * (which only inspects NEW tables in migration SQL) by checking the ACTUAL live
 * schema — catching drift from manual SQL, dashboard changes, or restores.
 *
 * Local:  DATABASE_URL=... node scripts/check-rls-anon-exposure.js
 */
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

function allowlist() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'rls-anon-allowlist.json'), 'utf8');
    return new Set((JSON.parse(raw).allow || []).map((s) => s.toLowerCase()));
  } catch (_) {
    return new Set();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — cannot run RLS anon-exposure check.');
    process.exit(1);
  }
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const { rows } = await client.query(`
    SELECT c.relname AS t
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND NOT c.relrowsecurity
      AND has_table_privilege('anon', c.oid, 'SELECT')
    ORDER BY 1`);
  await client.end();

  const allow = allowlist();
  const offenders = rows.map((r) => r.t).filter((t) => !allow.has(t.toLowerCase()));

  if (offenders.length) {
    console.error('\n✗ RLS anon-exposure FAILED — these public tables are anon-readable (RLS off + anon SELECT):\n');
    offenders.forEach((t) => console.error('   - ' + t));
    console.error('\nThis is the tax_forms/#1061 leak class. Fix each: ENABLE ROW LEVEL SECURITY +');
    console.error('REVOKE anon (serve via the backend service-role instead), or — if the table is');
    console.error('genuinely public, non-sensitive config — add it to scripts/rls-anon-allowlist.json.');
    process.exit(1);
  }
  console.log(`✓ RLS anon-exposure: no unexpected anon-readable public tables (allowlist: ${allow.size}).`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
