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

  const allow = allowlist();
  const offenders = rows.map((r) => r.t).filter((t) => !allow.has(t.toLowerCase()));
  let failed = false;

  if (offenders.length) {
    console.error('\n✗ RLS anon-exposure FAILED — these public tables are anon-readable (RLS off + anon SELECT):\n');
    offenders.forEach((t) => console.error('   - ' + t));
    console.error('\nThis is the tax_forms/#1061 leak class. Fix each: ENABLE ROW LEVEL SECURITY +');
    console.error('REVOKE anon (serve via the backend service-role instead), or — if the table is');
    console.error('genuinely public, non-sensitive config — add it to scripts/rls-anon-allowlist.json.');
    failed = true;
  } else {
    console.log(`✓ RLS anon-exposure: no unexpected anon-readable public tables (allowlist: ${allow.size}).`);
  }

  if (await checkColumns(client)) failed = true;
  await client.end();
  if (failed) process.exit(1);
}

// Column-level checks (party-password-anon-exposure). Catalog SELECTs only.
function safePartyColumns() {
  const src = fs.readFileSync(path.join(__dirname, '../frontend/src/lib/supabase.ts'), 'utf8');
  const m = /export const SAFE_PARTY_COLUMNS\s*=\s*`([^`]*)`/.exec(src);
  if (!m) throw new Error('could not parse SAFE_PARTY_COLUMNS from frontend/src/lib/supabase.ts');
  return m[1].split(',').map((c) => c.trim()).filter(Boolean);
}

async function checkColumns(client) {
  const sensitive = JSON.parse(fs.readFileSync(path.join(__dirname, 'anon-sensitive-columns.json'), 'utf8'));
  const safe = safePartyColumns();
  const canSelect = async (table, col) =>
    (await client.query(`SELECT has_column_privilege('anon', ('public.' || quote_ident($1))::regclass, $2, 'SELECT') AS ok`, [table, col])).rows[0].ok;
  let failed = false;

  // (b) every column the client selects must be anon-readable, else every party read 42501s.
  const unreadable = [];
  for (const c of safe) if (!(await canSelect('parties', c))) unreadable.push(c);
  if (unreadable.length) {
    failed = true;
    console.error('\n✗ SAFE_PARTY_COLUMNS not anon-readable (every party read would fail 42501): ' + unreadable.join(', '));
    console.error('  Apply GRANT SELECT (col) ON parties TO anon, authenticated; BEFORE adding it to SAFE_PARTY_COLUMNS.');
  } else {
    console.log(`✓ SAFE_PARTY_COLUMNS: all ${safe.length} columns are anon-readable.`);
  }

  // (a) sensitive columns must not be anon-readable - enforced only once the lockdown is live.
  const tableLevel = (await client.query(`SELECT has_table_privilege('anon', 'public.parties', 'SELECT') AS ok`)).rows[0].ok;
  if (tableLevel) {
    console.warn('\n⚠ WARNING: lockdown not applied yet - anon still has TABLE-level SELECT on public.parties.');
    console.warn('  Sensitive-column check (scripts/anon-sensitive-columns.json) is SKIPPED, not enforced.');
    return failed;
  }
  const leaks = [];
  for (const [table, cols] of Object.entries(sensitive)) {
    for (const c of cols) if (await canSelect(table, c)) leaks.push(`${table}.${c}`);
  }
  if (leaks.length) {
    failed = true;
    console.error('\n✗ anon can SELECT sensitive columns: ' + leaks.join(', '));
  } else {
    console.log('✓ anon-sensitive-columns: none readable by anon.');
  }
  return failed;
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
