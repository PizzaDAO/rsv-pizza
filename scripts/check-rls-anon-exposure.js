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
  const { Client } = require('pg');
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
  const problems = await guestsClassChecks(pgQuery(client));
  for (const line of problems.info) console.log(line);
  if (problems.fail.length) {
    failed = true;
    for (const line of problems.fail) console.error(line);
  }
  await client.end();
  if (failed) process.exit(1);
}

const pgQuery = (client) => async (sql, params = []) => (await client.query(sql, params)).rows;

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

// ---------------------------------------------------------------------------------------------
// guests-anon-exposure guards C1, C3, C4 (plans/guests-anon-exposure.md section 6, PR2).
// C2 (parties exact column check) is checkColumns() above.
// `query(sql, params) -> rows[]` so backend/scripts/apply-lockdown-guests.cjs can run the same
// checks inside its --simulate transaction (post-lockdown state, then rolled back).
// Catalog SELECTs only. Prints table/column names, never row values.
// ---------------------------------------------------------------------------------------------
const ROLES = ['anon', 'authenticated'];
// Column names that must never be anon-readable on a table anon can actually read rows from.
const SENSITIVE_NAME_RE = /(email|phone|wallet|ethereum|privy|token|secret|password|passcode|session|resend|ssn|ein|tax_id|iban|routing|bank|telegram|chat_id)/i;

const readJson = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, f), 'utf8'));

/** C1: tables anon/authenticated must have NO privilege on (scripts/anon-no-access-tables.json). */
async function checkNoAccessTables(query, tables = readJson('anon-no-access-tables.json').tables) {
  const fail = [];
  for (const t of tables) {
    const [{ ok }] = await query(`SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS ok`, [t]);
    if (!ok) { fail.push(`C1 ${t}: table does not exist (typo in scripts/anon-no-access-tables.json?)`); continue; }
    for (const role of ROLES) {
      const [p] = await query(
        `WITH r AS (SELECT ('public.' || quote_ident($2))::regclass AS rel)
         SELECT has_any_column_privilege($1, rel, 'SELECT') AS sel,
                has_any_column_privilege($1, rel, 'INSERT') AS ins,
                has_any_column_privilege($1, rel, 'UPDATE') AS upd,
                has_table_privilege($1, rel, 'DELETE') AS del,
                has_table_privilege($1, rel, 'TRUNCATE') AS trunc FROM r`, [role, t]);
      const held = Object.entries({ SELECT: p.sel, INSERT: p.ins, UPDATE: p.upd, DELETE: p.del, TRUNCATE: p.trunc })
        .filter(([, v]) => v).map(([k]) => k);
      if (held.length) fail.push(`C1 ${role} still holds ${held.join('/')} on ${t}`);
    }
  }
  return { fail, checked: tables.length };
}

/** anon-selectable columns of a table whose NAME looks sensitive, minus the allowlist. */
async function sensitiveAnonColumns(query, table, allow) {
  const rows = await query(
    `SELECT a.attname AS col FROM pg_attribute a
      WHERE a.attrelid = ('public.' || quote_ident($1))::regclass AND a.attnum > 0 AND NOT a.attisdropped
        AND has_column_privilege('anon', a.attrelid, a.attnum, 'SELECT')
      ORDER BY a.attnum`, [table]);
  return rows.map((r) => r.col).filter((c) => SENSITIVE_NAME_RE.test(c) && !(`${table}.${c}` in allow));
}

/**
 * C3: permissive-policy sweep. RLS-on public tables with an anon/public SELECT or ALL policy whose
 * qual is not `false` and does not call auth.uid()/auth.jwt()/auth.role(): anon can read rows, so
 * no anon-selectable column may look sensitive unless allowlisted (scripts/anon-column-allowlist.json).
 * Tables in anon-sensitive-columns.json (parties, experiment_flags) are covered exactly by C2.
 */
async function checkPermissivePolicies(query) {
  const allow = readJson('anon-column-allowlist.json').allow || {};
  const exact = new Set(Object.keys(readJson('anon-sensitive-columns.json')));
  const rows = await query(`
    SELECT DISTINCT p.tablename AS t
      FROM pg_policies p
      JOIN pg_class c ON c.relname = p.tablename
      JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = p.schemaname
     WHERE p.schemaname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
       AND p.cmd IN ('SELECT', 'ALL')
       AND p.permissive = 'PERMISSIVE'
       AND (p.roles && ARRAY['anon', 'public']::name[])
       AND coalesce(btrim(p.qual), 'true') NOT IN ('false', '(false)')
       AND coalesce(p.qual, '') !~ 'auth\.(uid|jwt|role)\(\)'
     ORDER BY 1`);
  const tables = rows.map((r) => r.t).filter((t) => !exact.has(t));
  const fail = [];
  for (const t of tables) {
    const bad = await sensitiveAnonColumns(query, t, allow);
    if (bad.length) fail.push(`C3 ${t}: anon-readable rows (permissive policy) AND sensitive-looking columns: ${bad.join(', ')}`);
  }
  return { fail, tables };
}

/** C4: every table in supabase_realtime must be allowlisted; listed ones get C3's column rule. */
async function checkRealtimePublication(query) {
  const allowTables = new Set(readJson('realtime-publication-allowlist.json').tables || []);
  const colAllow = readJson('anon-column-allowlist.json').allow || {};
  const rows = await query(
    `SELECT schemaname || '.' || tablename AS fq, schemaname AS s, tablename AS t
       FROM pg_publication_tables WHERE pubname = 'supabase_realtime' ORDER BY 1`);
  const fail = [];
  for (const r of rows) {
    if (!allowTables.has(r.t) && !allowTables.has(r.fq)) {
      fail.push(`C4 ${r.fq} is in the supabase_realtime publication but not in scripts/realtime-publication-allowlist.json`);
      continue;
    }
    if (r.s !== 'public') continue;
    // Realtime change payloads follow column grants regardless of policies.
    const bad = await sensitiveAnonColumns(query, r.t, colAllow);
    if (bad.length) fail.push(`C4 ${r.fq}: published to realtime with anon-readable sensitive columns: ${bad.join(', ')}`);
  }
  return { fail, published: rows.map((r) => r.fq) };
}

/** Runs C1, C3, C4. Returns { fail: string[], info: string[] }. */
async function guestsClassChecks(query) {
  const c1 = await checkNoAccessTables(query);
  const c3 = await checkPermissivePolicies(query);
  const c4 = await checkRealtimePublication(query);
  const info = [];
  const fail = [...c1.fail, ...c3.fail, ...c4.fail];
  if (!c1.fail.length) info.push(`✓ C1 no-access tables: anon/authenticated hold no privilege on ${c1.checked} table(s).`);
  if (!c3.fail.length) info.push(`✓ C3 permissive-policy sweep: ${c3.tables.length} anon-readable table(s) (${c3.tables.join(', ') || 'none'}), no sensitive-looking columns outside the allowlist.`);
  if (!c4.fail.length) info.push(`✓ C4 realtime publication: ${c4.published.length} table(s) published, all allowlisted.`);
  if (fail.length) {
    fail.unshift('\n✗ guests-anon-exposure guard FAILED (plans/guests-anon-exposure.md):');
    fail.push('Fix: REVOKE the privilege / drop the permissive policy / remove the table from supabase_realtime,');
    fail.push('or (only for genuinely public, non-sensitive data) add an entry with a reason to the allowlist JSON.');
  }
  return { fail, info };
}

module.exports = { guestsClassChecks, checkNoAccessTables, checkPermissivePolicies, checkRealtimePublication, SENSITIVE_NAME_RE };

if (require.main === module) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
}
