#!/usr/bin/env node
/**
 * scam-flag-private: stop anon reading admin-only parties.event_tags ('possible-scam', payout
 * state, numeric/k caps, launch gates) while keeping the public taxonomy tags readable.
 *
 * Step 1 (additive, apply BEFORE merging the frontend PR):
 *   20261118_parties_public_event_tags - strip_internal_event_tags(text[]) + generated column
 *   parties.public_event_tags + GRANT SELECT (public_event_tags) TO anon, authenticated.
 *     node backend/scripts/apply-public-event-tags.cjs              # dry run (read-only)
 *     node backend/scripts/apply-public-event-tags.cjs --apply      # apply + verify in-txn
 *   Verification (inside the transaction; rolls back on failure): the column exists and is
 *   generated, anon + authenticated can read it, the SQL function agrees with
 *   scripts/internal-event-tags.json on a fixed edge-case list, and EVERY row's
 *   public_event_tags equals the JSON-fixture strip of its event_tags.
 *
 * Step 2: merge the frontend PR (SAFE_PARTY_COLUMNS selects `event_tags:public_event_tags`) and
 *   wait ~24h so cached SPA bundles that still select event_tags age out.
 *
 * Step 3 (revokes; only after step 2 has been live ~24h):
 *   20261119_revoke_anon_event_tags - REVOKE SELECT (event_tags) ON parties FROM anon, authenticated.
 *     node backend/scripts/apply-public-event-tags.cjs --revoke              # dry run (read-only)
 *     node backend/scripts/apply-public-event-tags.cjs --revoke --simulate   # always rolled back
 *     node backend/scripts/apply-public-event-tags.cjs --revoke --apply
 *     node backend/scripts/apply-public-event-tags.cjs --rollback-revoke     # re-GRANT event_tags
 *
 * Prints counts and party ids only, never tag values. No session-level SET / SET ROLE (the
 * DATABASE_URL is the 6543 transaction pooler): only SET LOCAL inside a transaction.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const argv = process.argv.slice(2);
const APPLY = argv.includes('--apply');
const SIMULATE = argv.includes('--simulate');
const REVOKE = argv.includes('--revoke');
const ROLLBACK_REVOKE = argv.includes('--rollback-revoke');
const prisma = new PrismaClient();

const ROOT = path.join(__dirname, '../..');
const STEP1 = path.join(__dirname, '../prisma/migrations/20261118_parties_public_event_tags/migration.sql');
const STEP3 = path.join(__dirname, '../prisma/migrations/20261119_revoke_anon_event_tags/migration.sql');
const FIXTURE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/internal-event-tags.json'), 'utf8'));
const ALLOW = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/parties-anon-columns.json'), 'utf8'));
const ROLES = ['anon', 'authenticated'];
const TX_OPTS = { timeout: 60000, maxWait: 15000 };
const SENTINEL = 'SIMULATION_ROLLBACK';

// JS reference implementation, built ONLY from the shared fixture (same source as the
// backend/frontend parity tests), so a prod-side mismatch means the SQL list drifted.
const TAGS = new Set(FIXTURE.tags);
const PATTERNS = FIXTURE.patterns.map((p) => new RegExp(p.source, p.flags));
function isInternal(t) {
  const s = t.trim();
  return TAGS.has(s) || TAGS.has(s.toLowerCase()) || PATTERNS.some((re) => re.test(s));
}
function expectedPublic(tags) {
  return (Array.isArray(tags) ? tags : []).filter((t) => typeof t === 'string' && !isInternal(t));
}
const EDGE_CASES = [
  'swc', 'SWC Hub', 'side', 'gpp2026', 'Global Pizza Party', 'wpc', 'ens', 'avax', 'swcbr',
  'possible-scam', 'POSSIBLE-SCAM', '  paid  ', 'prepay', 'go', 'Go', 'missed', 'refund', 'nonhub',
  'NonHub', 'nonpres', 'side-prelaunch', '200', '350.50', '350.5', '1.234', 'k40', 'K200.50', 'k',
  'gpp2027', 'GPP2027', 'gpp20270', '12a', 'going', 'paid-ish',
];

function statements(file) {
  const src = fs.readFileSync(file, 'utf8');
  // Split on top-level ';' only (the function body is $fn$-quoted and contains none, but be safe).
  const out = [];
  let buf = '';
  let inDollar = false;
  for (const line of src.split('\n')) {
    if (!inDollar && line.trim().startsWith('--')) continue;
    buf += line + '\n';
    const dollars = (line.match(/\$fn\$/g) || []).length;
    if (dollars % 2 === 1) inDollar = !inDollar;
    if (!inDollar && line.trim().endsWith(';')) {
      out.push(buf.trim().replace(/;$/, ''));
      buf = '';
    }
  }
  if (buf.trim()) out.push(buf.trim().replace(/;$/, ''));
  return out.filter(Boolean);
}

async function columnInfo(db) {
  const rows = await db.$queryRawUnsafe(`
    SELECT column_name, data_type, is_generated, generation_expression
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='parties' AND column_name='public_event_tags'`);
  return rows[0] || null;
}

async function canSelect(db, role, col) {
  const [{ ok }] = await db.$queryRawUnsafe(
    `SELECT has_column_privilege($1::name, 'public.parties'::text, $2::text, 'SELECT'::text) AS ok`, role, col);
  return ok;
}

async function privSummary(db) {
  const out = {};
  for (const r of ROLES) {
    out[r] = {
      event_tags: await canSelect(db, r, 'event_tags'),
      public_event_tags: (await columnInfo(db)) ? await canSelect(db, r, 'public_event_tags') : '(no column)',
    };
  }
  return out;
}

/** Step-1 verification. Returns a list of problems (empty = OK). */
async function verifyStep1(db) {
  const problems = [];
  const info = await columnInfo(db);
  if (!info) return ['public_event_tags column missing'];
  if (info.is_generated !== 'ALWAYS') problems.push(`public_event_tags is_generated=${info.is_generated}`);
  if (info.data_type !== 'ARRAY') problems.push(`public_event_tags data_type=${info.data_type}`);
  for (const r of ROLES) if (!(await canSelect(db, r, 'public_event_tags'))) problems.push(`${r} cannot SELECT public_event_tags`);

  // Fixed edge cases: SQL function vs JSON fixture.
  const [{ got }] = await db.$queryRawUnsafe(
    `SELECT public.strip_internal_event_tags($1::text[]) AS got`, EDGE_CASES);
  const want = expectedPublic(EDGE_CASES);
  if (JSON.stringify(got) !== JSON.stringify(want)) {
    problems.push(`edge-case parity: SQL kept ${got.length}, fixture keeps ${want.length}`);
  }
  const [{ nul }] = await db.$queryRawUnsafe(`SELECT public.strip_internal_event_tags(NULL::text[]) AS nul`);
  if (!Array.isArray(nul) || nul.length !== 0) problems.push('strip_internal_event_tags(NULL) is not {}');

  // Every prod row.
  const rows = await db.$queryRawUnsafe(`SELECT id, event_tags, public_event_tags FROM public.parties`);
  const bad = rows.filter((r) => JSON.stringify(r.public_event_tags) !== JSON.stringify(expectedPublic(r.event_tags)));
  if (bad.length) problems.push(`${bad.length}/${rows.length} rows differ from the fixture strip (ids: ${bad.slice(0, 10).map((r) => r.id).join(', ')})`);
  const leaked = rows.filter((r) => (r.public_event_tags || []).some((t) => isInternal(t)));
  if (leaked.length) problems.push(`${leaked.length} rows still expose an internal tag in public_event_tags`);
  console.log(`  checked ${rows.length} rows; ${rows.filter((r) => (r.event_tags || []).some((t) => isInternal(t))).length} carry >=1 internal tag`);
  return problems;
}

/** Step-3 verification. */
async function verifyStep3(db) {
  const problems = [];
  for (const r of ROLES) {
    if (await canSelect(db, r, 'event_tags')) problems.push(`${r} can still SELECT event_tags`);
    for (const c of ALLOW) if (!(await canSelect(db, r, c))) problems.push(`${r} cannot SELECT allowlisted ${c}`);
  }
  return problems;
}

async function simulateAnon(tx) {
  const list = ALLOW.map((c) => `"${c}"`).join(', ');
  const ok = [
    ['SAFE select (new allowlist) by custom_url', `SELECT ${list} FROM public.parties WHERE custom_url = 'zz-sim' LIMIT 1`],
    ['SAFE select .or(custom_url, invite_code)', `SELECT ${list} FROM public.parties WHERE custom_url = 'zz-sim' OR invite_code = 'zz-sim' LIMIT 1`],
    ['public_event_tags read', `SELECT public_event_tags FROM public.parties LIMIT 1`],
  ];
  const denied = [
    ['select event_tags', `SELECT event_tags FROM public.parties LIMIT 1`],
    ['filter on event_tags', `SELECT id FROM public.parties WHERE 'possible-scam' = ANY(event_tags) LIMIT 1`],
    ['select *', `SELECT * FROM public.parties LIMIT 1`],
  ];
  const results = [];
  let n = 0;
  for (const role of ROLES) {
    await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
    for (const [label, sql, expectDenied] of [...ok.map((x) => [...x, false]), ...denied.map((x) => [...x, true])]) {
      const sp = `sim_${n++}`;
      await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
      let outcome = 'ok';
      try { await tx.$queryRawUnsafe(sql); }
      catch (e) { outcome = /42501|permission denied/i.test(String(e.message) + JSON.stringify(e.meta || {})) ? 'denied' : `error: ${String(e.message).split('\n').pop().slice(0, 120)}`; }
      await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
      await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
      const pass = expectDenied ? outcome === 'denied' : outcome === 'ok';
      results.push({ label: `${role}: ${label}`, expect: expectDenied ? 'denied(42501)' : 'ok', outcome, pass });
    }
    await tx.$executeRawUnsafe(`RESET ROLE`);
  }
  return results;
}

async function step1() {
  console.log(`\n=== parties.public_event_tags step 1 (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  const before = await columnInfo(prisma);
  console.log('column now:', before ? `${before.data_type}, generated=${before.is_generated}` : '(missing)');
  console.log('privileges now:', JSON.stringify(await privSummary(prisma)));
  const stmts = statements(STEP1);
  console.log(`\n${APPLY ? 'Running' : 'Would run'} ${stmts.length} statements:`);
  for (const s of stmts) console.log('  ' + s.replace(/\s+/g, ' ').slice(0, 160));
  if (!APPLY) { console.log('\nDry run only. Re-run with --apply.'); return; }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '30s'`);
    for (const s of stmts) await tx.$executeRawUnsafe(s);
    const problems = await verifyStep1(tx);
    if (problems.length) throw new Error(`verification failed inside txn (rolled back): ${problems.join('; ')}`);
  }, TX_OPTS);
  const problems = await verifyStep1(prisma);
  console.log('\nafter:', JSON.stringify(await privSummary(prisma)));
  console.log(problems.length ? `\nFAIL ${problems.join('; ')}` : '\nOK   public_event_tags exists, is generated, anon-readable, and matches the fixture strip on every row');
  if (problems.length) process.exit(1);
}

async function step3() {
  const mode = APPLY ? 'APPLY' : SIMULATE ? 'SIMULATE (rolled back)' : 'DRY RUN';
  console.log(`\n=== revoke anon event_tags step 3 (${mode}) ===\n`);
  console.log('privileges now:', JSON.stringify(await privSummary(prisma)));
  const pre = await verifyStep1(prisma);
  if (pre.length) {
    console.error(`REFUSING: step 1 is not healthy (${pre.join('; ')}). Run --apply (step 1) first.`);
    process.exit(1);
  }
  if (ALLOW.includes('event_tags') || !ALLOW.includes('public_event_tags')) {
    console.error('REFUSING: scripts/parties-anon-columns.json still lists event_tags / lacks public_event_tags. Merge the frontend PR first.');
    process.exit(1);
  }
  const stmts = statements(STEP3);
  console.log(`\n${APPLY || SIMULATE ? 'Running' : 'Would run'} ${stmts.length} statements:`);
  for (const s of stmts) console.log('  ' + s.replace(/\s+/g, ' '));
  if (!APPLY && !SIMULATE) {
    console.log('\nDry run only. Use --revoke --simulate (rolled back) to test, --revoke --apply to execute.');
    console.log('Only apply once the frontend selecting event_tags:public_event_tags has been live ~24h.');
    return;
  }

  if (SIMULATE) {
    let results = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
        for (const s of stmts) await tx.$executeRawUnsafe(s);
        const problems = await verifyStep3(tx);
        results = await simulateAnon(tx);
        results.push({ label: 'privilege verification inside txn', expect: '0 problems', outcome: `${problems.length} problems${problems.length ? ': ' + problems.slice(0, 5).join('; ') : ''}`, pass: problems.length === 0 });
        throw new Error(SENTINEL);
      }, TX_OPTS);
    } catch (e) {
      if (!String(e.message).includes(SENTINEL)) throw e;
    }
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}  (expected ${r.expect}, got ${r.outcome})`);
    const [{ u }] = await prisma.$queryRawUnsafe(`SELECT current_user AS u`);
    console.log(`\nafter rollback: current_user=${u}; privileges=${JSON.stringify(await privSummary(prisma))} (unchanged)`);
    const bad = results.filter((r) => !r.pass);
    console.log(bad.length ? `\n${bad.length} check(s) FAILED (transaction was rolled back regardless)` : '\nAll simulation checks passed. Transaction rolled back; nothing changed.');
    if (bad.length) process.exit(1);
    return;
  }

  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    for (const s of stmts) await tx.$executeRawUnsafe(s);
    const problems = await verifyStep3(tx);
    if (problems.length) throw new Error(`verification failed inside txn (rolled back): ${problems.join('; ')}`);
  }, TX_OPTS);
  const problems = await verifyStep3(prisma);
  console.log('\nafter:', JSON.stringify(await privSummary(prisma)));
  console.log(problems.length ? `\nFAIL ${problems.join('; ')} - consider --rollback-revoke` : '\nOK   anon/authenticated can no longer read event_tags; public_event_tags + allowlist readable');
  if (problems.length) process.exit(1);
}

async function rollbackRevoke() {
  console.log('\n=== rollback: re-GRANT SELECT (event_tags) to anon, authenticated ===\n');
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    await tx.$executeRawUnsafe(`GRANT SELECT (event_tags) ON public.parties TO anon, authenticated`);
    await tx.$executeRawUnsafe(`NOTIFY pgrst, 'reload schema'`);
  }, TX_OPTS);
  const p = await privSummary(prisma);
  console.log('after:', JSON.stringify(p));
  const ok = ROLES.every((r) => p[r].event_tags === true);
  console.log(ok ? 'OK   event_tags readable again' : 'FAIL event_tags still not readable - investigate');
  if (!ok) process.exit(1);
}

async function main() {
  if (ROLLBACK_REVOKE) return rollbackRevoke();
  if (REVOKE) return step3();
  if (SIMULATE) { console.error('--simulate is only supported with --revoke'); process.exit(1); }
  return step1();
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
