#!/usr/bin/env node
/**
 * SECURITY (party-password-anon-exposure, step 3): lock `public.parties` down for anon /
 * authenticated. REVOKE ALL on the table, then GRANT SELECT on an explicit column allowlist
 * (scripts/parties-anon-columns.json, which must equal SAFE_PARTY_COLUMNS in
 * frontend/src/lib/supabase.ts - enforced by frontend/src/__tests__/anon-columns.test.ts).
 *
 * DO NOT RUN --apply until:
 *   1. apply-parties-has-password.cjs --apply has been run (the allowlist includes has_password), and
 *   2. the PR that stops reading host-only columns from anon is live on prod (~24h earlier, so
 *      cached SPA bundles that still select host_telegram_* age out).
 *
 * Modes (exactly one; default is a read-only dry run):
 *   (none)       dry run: counts/names only, never values. Read-only.
 *   --simulate   BEGIN; lock_timeout; REVOKE+GRANT; SET LOCAL ROLE anon; run the real query shapes
 *                inside savepoints; ALWAYS ROLLBACK (a sentinel error forces it). Nothing is
 *                committed. SET LOCAL is transaction-scoped, so nothing leaks onto the 6543
 *                transaction pooler. Takes brief catalog row locks: run off-peak.
 *   --apply      the same statements in ONE transaction, verified INSIDE the transaction
 *                (rolls back if verification fails), then re-verified after commit.
 *   --rollback   GRANT the original table-level privileges back to anon, authenticated.
 *
 *   node backend/scripts/apply-lockdown-parties-columns.cjs [--simulate|--apply|--rollback]
 *
 * No session-level SET / SET ROLE anywhere (only SET LOCAL inside a transaction).
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const MODE = process.argv.includes('--apply') ? 'apply'
  : process.argv.includes('--simulate') ? 'simulate'
  : process.argv.includes('--rollback') ? 'rollback'
  : 'dry';
const prisma = new PrismaClient();

const ROOT = path.join(__dirname, '../..');
const ALLOW_ALL = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/parties-anon-columns.json'), 'utf8'));
const SENSITIVE = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/anon-sensitive-columns.json'), 'utf8')).parties;
const ROLES = ['anon', 'authenticated'];
const TX_OPTS = { timeout: 60000, maxWait: 15000 };
const SENTINEL = 'SIMULATION_ROLLBACK';

const ROLLBACK_SQL = [
  'GRANT SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON public.parties TO anon, authenticated',
  `NOTIFY pgrst, 'reload schema'`,
];

const q = (id) => `"${id}"`;
function lockdownSql(allow) {
  return [
    'REVOKE ALL ON public.parties FROM anon, authenticated',
    `GRANT SELECT (${allow.map(q).join(', ')}) ON public.parties TO anon, authenticated`,
    `NOTIFY pgrst, 'reload schema'`,
  ];
}

async function tableColumns(db) {
  const rows = await db.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='parties' ORDER BY ordinal_position`);
  return rows.map((r) => r.column_name);
}

/** { role: { readable: Set<col>, tableSelect: bool, writePrivs: string[] } } */
async function privileges(db, cols) {
  const out = {};
  for (const role of ROLES) {
    const rows = await db.$queryRawUnsafe(
      `SELECT c AS col, has_column_privilege($1, 'public.parties', c, 'SELECT') AS ok FROM unnest($2::text[]) AS c`, role, cols);
    const t = await db.$queryRawUnsafe(
      `SELECT has_table_privilege($1,'public.parties','SELECT') AS sel,
              has_table_privilege($1,'public.parties','INSERT') AS ins,
              has_table_privilege($1,'public.parties','UPDATE') AS upd,
              has_table_privilege($1,'public.parties','DELETE') AS del,
              has_table_privilege($1,'public.parties','TRUNCATE') AS trunc,
              has_table_privilege($1,'public.parties','REFERENCES') AS refs,
              has_table_privilege($1,'public.parties','TRIGGER') AS trig`, role);
    const x = t[0];
    out[role] = {
      readable: new Set(rows.filter((r) => r.ok).map((r) => r.col)),
      tableSelect: x.sel,
      writePrivs: Object.entries({ INSERT: x.ins, UPDATE: x.upd, DELETE: x.del, TRUNCATE: x.trunc, REFERENCES: x.refs, TRIGGER: x.trig })
        .filter(([, v]) => v).map(([k]) => k),
    };
  }
  return out;
}

/** Returns a list of problems (empty = locked down exactly to the allowlist). */
async function verify(db, allow) {
  const cols = await tableColumns(db);
  const priv = await privileges(db, cols);
  const problems = [];
  for (const role of ROLES) {
    const p = priv[role];
    if (p.tableSelect) problems.push(`${role}: still has table-level SELECT`);
    if (p.writePrivs.length) problems.push(`${role}: still has ${p.writePrivs.join('/')}`);
    for (const c of cols) {
      const want = allow.includes(c);
      const have = p.readable.has(c);
      if (want && !have) problems.push(`${role}: allowlisted column NOT readable: ${c}`);
      if (!want && have) problems.push(`${role}: non-allowlisted column STILL readable: ${c}`);
    }
  }
  for (const c of SENSITIVE) {
    if (!cols.includes(c)) continue;
    for (const role of ROLES) if (priv[role].readable.has(c)) problems.push(`${role}: SENSITIVE column readable: ${c}`);
  }
  return problems;
}

async function dryRun(allow, cols) {
  const priv = await privileges(prisma, cols);
  const missing = ALLOW_ALL.filter((c) => !cols.includes(c));
  console.log(`table columns: ${cols.length}; allowlist: ${ALLOW_ALL.length}; sensitive list: ${SENSITIVE.length}`);
  for (const role of ROLES) {
    const p = priv[role];
    const sens = SENSITIVE.filter((c) => p.readable.has(c));
    const exposedNonAllow = cols.filter((c) => p.readable.has(c) && !ALLOW_ALL.includes(c));
    console.log(`\n[${role}] table-level SELECT: ${p.tableSelect}; other privileges: ${p.writePrivs.join(', ') || 'none'}`);
    console.log(`[${role}] readable columns now: ${p.readable.size}/${cols.length}`);
    console.log(`[${role}] SENSITIVE columns readable now (${sens.length}): ${sens.join(', ') || 'none'}`);
    console.log(`[${role}] readable-but-not-allowlisted that the lockdown would hide: ${exposedNonAllow.length}`);
    console.log(`[${role}] allowlisted columns readable after lockdown: ${allow.length}`);
  }
  if (missing.length) {
    console.log(`\n!! allowlisted columns missing from the table (the GRANT would fail): ${missing.join(', ')}`);
    if (missing.includes('has_password')) console.log('   -> run backend/scripts/apply-parties-has-password.cjs --apply first.');
  }
  const stmts = lockdownSql(allow);
  console.log(`\nWould run ${stmts.length} statements (REVOKE ALL; GRANT SELECT on ${allow.length} columns; NOTIFY).`);
  console.log('Dry run only. Use --simulate (rolled back) to test, --apply to execute, --rollback to undo.');
}

// Query shapes anon issues today (plan section 3). Values are never printed.
function simulationChecks(allow) {
  const list = allow.map(q).join(', ');
  const OG = 'name, date, duration, description, address, event_image_url, custom_url, invite_code';
  const ok = [
    ['SAFE select by custom_url', `SELECT ${list} FROM public.parties WHERE custom_url = 'zz-sim' LIMIT 1`],
    ['SAFE select by invite_code', `SELECT ${list} FROM public.parties WHERE invite_code = 'zz-sim' LIMIT 1`],
    ['SAFE select .or(custom_url, invite_code)', `SELECT ${list} FROM public.parties WHERE custom_url = 'zz-sim' OR invite_code = 'zz-sim' LIMIT 1`],
    ['SAFE select in(id)', `SELECT ${list} FROM public.parties WHERE id = ANY(ARRAY[]::uuid[])`],
    ['has_password filter + count', `SELECT count(id) FROM public.parties WHERE has_password IS TRUE`],
    ['OG column list (api/event + build script)', `SELECT ${OG} FROM public.parties WHERE custom_url IS NOT NULL ORDER BY custom_url LIMIT 1`],
    ['validateCustomSlug', `SELECT id FROM public.parties WHERE custom_url = 'zz-sim' LIMIT 1`],
    ['ArtDisplayPage underboss_status', `SELECT underboss_status FROM public.parties WHERE id = '00000000-0000-0000-0000-000000000000' LIMIT 1`],
    ['findApprovedGppPartyInCity filters', `SELECT ${list} FROM public.parties WHERE event_type = 'gpp' AND city = 'zz' AND underboss_status = 'approved' LIMIT 1`],
    ['count head (createParty fallback)', `SELECT count(id) FROM public.parties`],
  ];
  const denied = [
    ['select *', `SELECT * FROM public.parties LIMIT 1`],
    ...SENSITIVE.map((c) => [`select ${c}`, `SELECT ${q(c)} FROM public.parties LIMIT 1`]),
    ['filter on password', `SELECT id FROM public.parties WHERE password IS NOT NULL LIMIT 1`],
    ['filter on report_password', `SELECT id FROM public.parties WHERE report_password IS NOT NULL LIMIT 1`],
    ['filter on co_hosts', `SELECT id FROM public.parties WHERE co_hosts IS NOT NULL LIMIT 1`],
    ['update', `UPDATE public.parties SET name = name WHERE false`],
    ['delete', `DELETE FROM public.parties WHERE false`],
  ];
  return { ok, denied };
}

async function runSimulation(tx, allow) {
  const results = [];
  const { ok, denied } = simulationChecks(allow);
  await tx.$executeRawUnsafe(`SET LOCAL ROLE anon`);
  let n = 0;
  const attempt = async (label, sql, expectDenied) => {
    const sp = `sim_${n++}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
    let outcome = 'ok';
    try { await tx.$queryRawUnsafe(sql); }
    catch (e) { outcome = /42501|permission denied/i.test(String(e.message) + JSON.stringify(e.meta || {})) ? 'denied' : `error: ${String(e.message).split('\n').pop().slice(0, 120)}`; }
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
    const pass = expectDenied ? outcome === 'denied' : outcome === 'ok';
    results.push({ label, expect: expectDenied ? 'denied(42501)' : 'ok', outcome, pass });
  };
  for (const [l, s] of ok) await attempt(l, s, false);
  for (const [l, s] of denied) await attempt(l, s, true);
  await tx.$executeRawUnsafe(`RESET ROLE`);
  return results;
}

async function main() {
  console.log(`\n=== lockdown parties columns (${MODE.toUpperCase()}) ===\n`);
  const cols = await tableColumns(prisma);
  const hasPwCol = cols.includes('has_password');
  const allow = ALLOW_ALL.filter((c) => cols.includes(c));

  if (MODE === 'rollback') {
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      for (const s of ROLLBACK_SQL) await tx.$executeRawUnsafe(s);
    }, TX_OPTS);
    const priv = await privileges(prisma, cols);
    const ok = ROLES.every((r) => priv[r].tableSelect);
    console.log(ok ? 'OK   table-level privileges restored for anon, authenticated' : 'FAIL privileges not restored - investigate');
    if (!ok) process.exit(1);
    return;
  }

  if (MODE === 'dry') return dryRun(allow, cols);

  if (!hasPwCol) {
    if (MODE === 'apply') {
      console.error('REFUSING: parties.has_password does not exist. Run apply-parties-has-password.cjs --apply first.');
      process.exit(1);
    }
    console.log('NOTE: has_password column is not applied yet; simulating WITHOUT it (the has_password check will fail).\n');
  }
  const stmts = lockdownSql(allow);

  if (MODE === 'simulate') {
    let results = null;
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
        for (const s of stmts) await tx.$executeRawUnsafe(s);
        const problems = await verify(tx, allow);
        results = await runSimulation(tx, allow);
        results.push({ label: 'privilege verification inside txn', expect: '0 problems', outcome: `${problems.length} problems${problems.length ? ': ' + problems.slice(0, 5).join('; ') : ''}`, pass: problems.length === 0 });
        throw new Error(SENTINEL); // force ROLLBACK: nothing is ever committed in --simulate
      }, TX_OPTS);
    } catch (e) {
      if (!String(e.message).includes(SENTINEL)) throw e;
    }
    for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}  (expected ${r.expect}, got ${r.outcome})`);
    // Prove nothing leaked: privileges are unchanged and we are still the original role.
    const priv = await privileges(prisma, cols);
    const [{ u }] = await prisma.$queryRawUnsafe(`SELECT current_user AS u`);
    console.log(`\nafter rollback: current_user=${u}; anon table-level SELECT=${priv.anon.tableSelect} (unchanged from before the run)`);
    const bad = results.filter((r) => !r.pass);
    console.log(bad.length ? `\n${bad.length} check(s) FAILED (transaction was rolled back regardless)` : '\nAll simulation checks passed. Transaction rolled back; nothing changed.');
    if (bad.length) process.exit(1);
    return;
  }

  // --apply
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
    for (const s of stmts) await tx.$executeRawUnsafe(s);
    const problems = await verify(tx, allow);
    if (problems.length) throw new Error(`verification failed inside txn (rolled back): ${problems.join('; ')}`);
  }, TX_OPTS);
  const problems = await verify(prisma, allow);
  console.log(`applied ${stmts.length} statements; post-commit problems: ${problems.length}`);
  for (const p of problems) console.log('  - ' + p);
  console.log(problems.length ? '\nFAIL not locked down as expected - consider --rollback' : '\nOK   anon/authenticated can read exactly the allowlist; 0 sensitive columns readable');
  if (problems.length) process.exit(1);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); }).finally(() => prisma.$disconnect());
