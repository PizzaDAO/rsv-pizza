#!/usr/bin/env node
/**
 * SECURITY (guests-anon-exposure, step S4): apply Migration B
 * (backend/prisma/migrations/20261113_guests_anon_lockdown/migration.sql). Takes `public.guests`
 * and `public.user_preferences` away from the public key: REVOKE ALL from anon/authenticated,
 * drop the permissive anon policies (and the 3 dead superlative_submissions policies whose
 * subquery on guests would start raising 42501), and drop guests from supabase_realtime.
 * This runner executes the migration FILE (single source of truth), statement by statement.
 *
 * DO NOT RUN --apply until (plan section 7):
 *   - PR1b (#1218, frontend reads guests via the backend + broadcast realtime) has been live on
 *     prod for ~24h (old host tabs on anon select('*') + postgres_changes age out),
 *   - Migration A (apply-guests-broadcast-trigger.cjs) is applied (checked below), and
 *   - D8: the parties lockdown (apply-lockdown-parties-columns.cjs --apply) went first, on a
 *     different day (checked below; override with --allow-before-parties).
 *
 * experiment_flags (D9) is NOT handled here: apply-lockdown-parties-columns.cjs already locks it.
 *
 * Modes (exactly one; default is a read-only dry run):
 *   (none)       dry run, read-only: per-role privileges on guests/user_preferences, the current
 *                anon/public policies on guests/user_preferences/superlative_submissions diffed
 *                against the hardcoded rollback DDL, publication membership, realtime.subscription
 *                count, the preconditions and the statements it would run.
 *   --simulate   BEGIN; SET LOCAL lock_timeout/statement_timeout; run the migration; verify();
 *                SET LOCAL ROLE anon (then authenticated) and run the expected-denied / expected-ok
 *                query shapes in savepoints; run the CI guards C1/C3/C4 against the post-lockdown
 *                state; run the rollback DDL and re-diff the policies (proves --rollback is exact);
 *                then a sentinel error forces ROLLBACK. Nothing is committed. Takes brief
 *                AccessExclusive locks on guests and superlative_submissions: run off-peak.
 *   --apply      the migration in ONE transaction (SET LOCAL lock_timeout '5s'), verify() inside
 *                the transaction (throws -> rollback on any problem), re-verify after commit.
 *   --rollback   the exact inverse (section 5 "Rollback B") in one transaction: GRANT back,
 *                CREATE POLICY only where missing, ADD TABLE only if guests is not a member.
 *
 * Flags: --skip-bundle-check (skip the live-bundle precondition), --allow-before-parties (D8 override).
 *
 *   node backend/scripts/apply-lockdown-guests.cjs [--simulate|--apply|--rollback]
 *
 * No session-level SET / SET ROLE anywhere (DATABASE_URL is the 6543 transaction pooler); only
 * SET LOCAL inside a transaction. Prints names/counts, never row values.
 */
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--apply') ? 'apply'
  : ARGS.includes('--simulate') ? 'simulate'
  : ARGS.includes('--rollback') ? 'rollback'
  : 'dry';
const SKIP_BUNDLE = ARGS.includes('--skip-bundle-check');
const ALLOW_BEFORE_PARTIES = ARGS.includes('--allow-before-parties');

const ROOT = path.join(__dirname, '../..');
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261113_guests_anon_lockdown/migration.sql');
const SAFE_PARTY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/parties-anon-columns.json'), 'utf8'));
const BUNDLE_URL = 'https://www.rsv.pizza/';
const TABLES = ['guests', 'user_preferences'];
const ROLES = ['anon', 'authenticated'];
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'];
const TX_OPTS = { timeout: 60000, maxWait: 15000 };
const SENTINEL = 'SIMULATION_ROLLBACK';
const BROADCAST_TRIGGERS = ['trg_guests_broadcast_ins', 'trg_guests_broadcast_upd', 'trg_guests_broadcast_del'];

// The policies Migration B drops, exactly as pg_policies shows them on prod (read 2026-11-13).
// The dry run diffs the live catalog against these; --simulate/--apply refuse on any diff, so
// --rollback (built from the same objects) is provably the exact inverse.
const SUPERLATIVE_QUAL = `((auth.uid())::text IN ( SELECT (g.id)::text AS id FROM guests g WHERE (g.id = superlative_submissions.guest_id)))`;
const DROPPED_POLICIES = [
  { table: 'guests', name: 'Public can read guests', cmd: 'SELECT', roles: ['public'], qual: 'true', check: null },
  { table: 'user_preferences', name: 'Allow public read', cmd: 'SELECT', roles: ['public'], qual: 'true', check: null },
  { table: 'user_preferences', name: 'Allow public insert', cmd: 'INSERT', roles: ['public'], qual: null, check: 'true' },
  { table: 'user_preferences', name: 'Allow public update', cmd: 'UPDATE', roles: ['public'], qual: 'true', check: null },
  { table: 'superlative_submissions', name: 'Guests can read own superlative submissions', cmd: 'SELECT', roles: ['public'], qual: SUPERLATIVE_QUAL, check: null },
  { table: 'superlative_submissions', name: 'Guests can insert own superlative submissions', cmd: 'INSERT', roles: ['public'], qual: null, check: SUPERLATIVE_QUAL },
  { table: 'superlative_submissions', name: 'Guests can update own superlative submissions', cmd: 'UPDATE', roles: ['public'], qual: SUPERLATIVE_QUAL, check: null },
];
// Policies that STAY (RLS stays on; these deny every anon write).
const KEPT_GUESTS_POLICIES = ['No public delete on guests', 'No public insert on guests', 'No public update on guests'];

const createPolicySql = (p) =>
  `CREATE POLICY "${p.name}" ON public.${p.table} FOR ${p.cmd} TO ${p.roles.join(', ')}` +
  (p.qual !== null ? ` USING (${p.qual})` : '') + (p.check !== null ? ` WITH CHECK (${p.check})` : '');
const GRANT_BACK = `GRANT ${PRIVS.join(', ')} ON public.guests, public.user_preferences TO anon, authenticated`;

/** Normalize deparsed SQL so whitespace/line-break differences don't count as a diff. */
const norm = (s) => (s === null || s === undefined ? null
  : String(s).replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim());

/** Split a SQL file into statements, respecting $$ dollar quoting and -- comments. */
function splitStatements(sql) {
  const out = [];
  let cur = '';
  let inDollar = false;
  for (let i = 0; i < sql.length; i++) {
    if (!inDollar && sql.startsWith('--', i)) { while (i < sql.length && sql[i] !== '\n') i++; continue; }
    if (sql.startsWith('$$', i)) { inDollar = !inDollar; cur += '$$'; i++; continue; }
    if (!inDollar && sql[i] === ';') { if (cur.trim()) out.push(cur.trim()); cur = ''; continue; }
    cur += sql[i];
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
const isPublicationDrop = (s) => /^ALTER PUBLICATION supabase_realtime DROP TABLE/i.test(s);

// ----------------------------------------------------------------------------------- catalog reads
async function privileges(db) {
  const out = {};
  for (const role of ROLES) {
    for (const t of TABLES) {
      const [r] = await db.$queryRawUnsafe(`
        WITH x AS (SELECT ('public.' || $2)::regclass AS rel)
        SELECT ${PRIVS.map((p) => `has_table_privilege($1, rel, '${p}') AS "${p}"`).join(', ')},
               has_any_column_privilege($1, rel, 'SELECT') AS any_sel,
               has_any_column_privilege($1, rel, 'INSERT') AS any_ins,
               has_any_column_privilege($1, rel, 'UPDATE') AS any_upd,
               (SELECT count(*)::int FROM pg_attribute a WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped
                  AND has_column_privilege($1, rel, a.attnum, 'SELECT')) AS readable_cols,
               (SELECT count(*)::int FROM pg_attribute a WHERE a.attrelid = rel AND a.attnum > 0 AND NOT a.attisdropped) AS total_cols
        FROM x`, role, t);
      out[`${role}.${t}`] = r;
    }
  }
  return out;
}
const heldPrivs = (r) => [...PRIVS.filter((p) => r[p]),
  ...(r.any_sel && !r.SELECT ? ['SELECT(cols)'] : []),
  ...(r.any_ins && !r.INSERT ? ['INSERT(cols)'] : []),
  ...(r.any_upd && !r.UPDATE ? ['UPDATE(cols)'] : [])];

async function policies(db) {
  return db.$queryRawUnsafe(`
    SELECT tablename AS table, policyname AS name, cmd, roles::text[] AS roles, permissive, qual, with_check AS check
      FROM pg_policies
     WHERE schemaname = 'public' AND tablename IN ('guests', 'user_preferences', 'superlative_submissions')
     ORDER BY tablename, policyname`);
}

/** Diff live policies against DROPPED_POLICIES. Returns { missing: [], differ: [] }. */
function policyDiff(live) {
  const missing = [];
  const differ = [];
  for (const want of DROPPED_POLICIES) {
    const got = live.find((p) => p.table === want.table && p.name === want.name);
    if (!got) { missing.push(`${want.table}: "${want.name}"`); continue; }
    const d = [];
    if (got.cmd !== want.cmd) d.push(`cmd ${got.cmd} != ${want.cmd}`);
    if ([...got.roles].sort().join(',') !== [...want.roles].sort().join(',')) d.push(`roles {${got.roles}} != {${want.roles}}`);
    if (got.permissive !== 'PERMISSIVE') d.push(`not PERMISSIVE (${got.permissive})`);
    if (norm(got.qual) !== norm(want.qual)) d.push('USING differs');
    if (norm(got.check) !== norm(want.check)) d.push('WITH CHECK differs');
    if (d.length) differ.push(`${want.table}: "${want.name}": ${d.join('; ')}`);
  }
  return { missing, differ };
}

async function inPublication(db) {
  const [r] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'guests'`);
  return r.n === 1;
}

async function broadcastTriggers(db) {
  const rows = await db.$queryRawUnsafe(
    `SELECT tgname AS name, tgenabled AS enabled FROM pg_trigger
      WHERE tgrelid = 'public.guests'::regclass AND NOT tgisinternal AND tgname LIKE 'trg_guests_broadcast_%'`);
  return BROADCAST_TRIGGERS.filter((n) => !rows.find((r) => r.name === n && r.enabled === 'O'));
}

/** D8: the parties lockdown is applied once anon no longer has table-level SELECT on parties. */
async function partiesLockdownApplied(db) {
  const [r] = await db.$queryRawUnsafe(`SELECT has_table_privilege('anon', 'public.parties', 'SELECT') AS t`);
  return !r.t;
}

/** Live main bundle must use the broadcast (PR1b) and contain no app-level guests access. */
async function bundleCheck() {
  if (SKIP_BUNDLE) return { ok: true, note: 'SKIPPED (--skip-bundle-check)' };
  const html = await (await fetch(BUNDLE_URL, { headers: { 'cache-control': 'no-cache' } })).text();
  const m = /<script[^>]+src="(\/assets\/index-[^"]+\.js)"/.exec(html);
  if (!m) return { ok: false, note: 'could not find the main /assets/index-*.js bundle in the page' };
  const js = await (await fetch(new URL(m[1], BUNDLE_URL))).text();
  // supabase-js itself contains the literal "postgres_changes" (enum + channel internals), so the
  // check looks for app-level usage shapes, not the bare word.
  const bad = {
    'on("postgres_changes"': /\.on\(\s*["'`]postgres_changes["'`]/.test(js),
    'table:"guests"': /table:\s*["'`]guests["'`]/.test(js),
    'from("guests")': /\.from\(\s*["'`]guests["'`]\s*\)/.test(js),
    'from("user_preferences")': /\.from\(\s*["'`]user_preferences["'`]\s*\)/.test(js),
  };
  const hasBroadcast = js.includes('guests_changed');
  const hits = Object.entries(bad).filter(([, v]) => v).map(([k]) => k);
  const ok = hasBroadcast && hits.length === 0;
  return { ok, note: `${m[1]}: guests_changed=${hasBroadcast}; forbidden shapes: ${hits.join(', ') || 'none'}` };
}

/** Post-lockdown invariants. Returns a list of problems (empty = locked down). */
async function verify(db) {
  const problems = [];
  const priv = await privileges(db);
  for (const [k, r] of Object.entries(priv)) {
    const held = heldPrivs(r);
    if (held.length) problems.push(`${k}: still holds ${held.join('/')}`);
    if (r.readable_cols) problems.push(`${k}: ${r.readable_cols} columns still readable`);
  }
  const live = await policies(db);
  for (const p of DROPPED_POLICIES) {
    if (live.find((x) => x.table === p.table && x.name === p.name)) problems.push(`policy still present: ${p.table} "${p.name}"`);
  }
  for (const p of live) {
    if (!TABLES.includes(p.table)) continue;
    const anonish = p.roles.some((r) => ['public', 'anon', 'authenticated'].includes(r));
    const allFalse = [p.qual, p.check].filter((x) => x !== null).every((x) => norm(x) === 'false');
    if (anonish && !allFalse) problems.push(`non-false anon/public policy left on ${p.table}: "${p.name}"`);
  }
  if (await inPublication(db)) problems.push('guests is still in the supabase_realtime publication');
  return problems;
}

function migrationStatements(guestsInPub) {
  const all = splitStatements(fs.readFileSync(MIGRATION, 'utf8'));
  return guestsInPub ? all : all.filter((s) => !isPublicationDrop(s));
}

async function rollbackStatements(db) {
  const live = await policies(db);
  const stmts = [GRANT_BACK];
  for (const p of DROPPED_POLICIES) {
    if (!live.find((x) => x.table === p.table && x.name === p.name)) stmts.push(createPolicySql(p));
  }
  if (!(await inPublication(db))) stmts.push('ALTER PUBLICATION supabase_realtime ADD TABLE public.guests');
  stmts.push(`NOTIFY pgrst, 'reload schema'`);
  return stmts;
}

// ------------------------------------------------------------------------------------- simulation
function simulationChecks(partyCols) {
  const Z = `'00000000-0000-0000-0000-000000000000'`;
  const denied = [
    ['guests select id', `SELECT id FROM public.guests LIMIT 1`],
    ['guests count(*)', `SELECT count(*) FROM public.guests`],
    ['guests select email', `SELECT email FROM public.guests LIMIT 1`],
    ['guests filter on email', `SELECT id FROM public.guests WHERE email = 'zz' LIMIT 1`],
    ['guests select *', `SELECT * FROM public.guests LIMIT 1`],
    ['guests insert', `INSERT INTO public.guests (party_id, name) VALUES (${Z}, 'x')`],
    ['guests update', `UPDATE public.guests SET name = name WHERE false`],
    ['guests delete', `DELETE FROM public.guests WHERE false`],
    ['user_preferences select email', `SELECT email FROM public.user_preferences LIMIT 1`],
    ['user_preferences insert', `INSERT INTO public.user_preferences (email) VALUES ('zz')`],
    ['user_preferences update', `UPDATE public.user_preferences SET email = email WHERE false`],
  ];
  const ok = [
    ['superlative_submissions count (0 rows, no error)', `SELECT count(*) FROM public.superlative_submissions`],
    ['slug_aliases', `SELECT old_slug FROM public.slug_aliases LIMIT 1`],
    ['experiment_flags enabled', `SELECT enabled FROM public.experiment_flags LIMIT 1`],
    ['rsvp_checkboxes', `SELECT id FROM public.rsvp_checkboxes LIMIT 1`],
    ['parties SAFE select by custom_url', `SELECT ${partyCols.map((c) => `"${c}"`).join(', ')} FROM public.parties WHERE custom_url = 'zz-sim' LIMIT 1`],
  ];
  return { denied, ok };
}

async function runAs(tx, role, results) {
  const { denied, ok } = simulationChecks(runAs.partyCols);
  await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
  const attempt = async (label, sql, expectDenied) => {
    const sp = `sim_${runAs.n++}`;
    await tx.$executeRawUnsafe(`SAVEPOINT ${sp}`);
    let outcome = 'ok';
    try { await tx.$queryRawUnsafe(sql); }
    catch (e) {
      outcome = /42501|permission denied/i.test(String(e.message) + JSON.stringify(e.meta || {}))
        ? 'denied' : `error: ${String(e.message).split('\n').pop().slice(0, 120)}`;
    }
    await tx.$executeRawUnsafe(`ROLLBACK TO SAVEPOINT ${sp}`);
    await tx.$executeRawUnsafe(`RELEASE SAVEPOINT ${sp}`);
    const pass = expectDenied ? outcome === 'denied' : outcome === 'ok';
    results.push({ label: `[${role}] ${label}`, expect: expectDenied ? 'denied(42501)' : 'ok', outcome, pass });
  };
  for (const [l, s] of denied) await attempt(l, s, true);
  for (const [l, s] of ok) await attempt(l, s, false);
  await tx.$executeRawUnsafe(`RESET ROLE`);
}
runAs.n = 0;

// ------------------------------------------------------------------------------------------- main
async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(`\n=== lockdown guests + user_preferences (${MODE.toUpperCase()}) ===\n`);

    if (MODE === 'rollback') {
      const stmts = await rollbackStatements(prisma);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
        for (const s of stmts) await tx.$executeRawUnsafe(s);
      }, TX_OPTS);
      const priv = await privileges(prisma);
      const d = policyDiff(await policies(prisma));
      const pub = await inPublication(prisma);
      const ok = priv['anon.guests'].SELECT && priv['anon.user_preferences'].SELECT && pub && !d.missing.length && !d.differ.length;
      console.log(`ran ${stmts.length} statements; anon SELECT on guests=${priv['anon.guests'].SELECT}, user_preferences=${priv['anon.user_preferences'].SELECT}; guests in publication=${pub}; policies missing=${d.missing.length}, differing=${d.differ.length}`);
      console.log(ok ? 'OK   pre-lockdown state restored' : 'FAIL not fully restored - investigate');
      if (!ok) process.exitCode = 1;
      return;
    }

    // ---- state + preconditions (all modes but rollback)
    const priv = await privileges(prisma);
    for (const [k, r] of Object.entries(priv)) {
      console.log(`[${k}] privileges: ${heldPrivs(r).join(', ') || 'none'}; readable columns ${r.readable_cols}/${r.total_cols}`);
    }
    const live = await policies(prisma);
    console.log(`\npolicies on guests/user_preferences/superlative_submissions (${live.length}):`);
    for (const p of live) {
      const tag = DROPPED_POLICIES.find((x) => x.table === p.table && x.name === p.name) ? 'DROP'
        : KEPT_GUESTS_POLICIES.includes(p.name) || p.table === 'superlative_submissions' ? 'keep' : 'keep?';
      console.log(`  [${tag}] ${p.table}: "${p.name}" ${p.cmd} TO {${p.roles}}`);
    }
    const diff = policyDiff(live);
    console.log(`policy diff vs hardcoded rollback DDL: missing ${diff.missing.length}, differing ${diff.differ.length}`);
    for (const m of diff.missing) console.log(`  missing (already dropped?): ${m}`);
    for (const m of diff.differ) console.log(`  DIFFERS: ${m}`);
    const pub = await inPublication(prisma);
    const [{ n: subs }] = await prisma.$queryRawUnsafe(
      `SELECT count(*)::int AS n FROM realtime.subscription WHERE entity = 'public.guests'::regclass`);
    console.log(`\nguests in supabase_realtime: ${pub}; realtime.subscription rows on guests: ${subs}`);

    const missingTrg = await broadcastTriggers(prisma);
    const partiesDone = await partiesLockdownApplied(prisma);
    let bundle;
    try { bundle = await bundleCheck(); } catch (e) { bundle = { ok: false, note: `fetch failed: ${e.message}` }; }
    console.log('\npreconditions:');
    console.log(`  ${missingTrg.length ? 'FAIL' : 'ok  '} Migration A broadcast triggers present${missingTrg.length ? ` (missing/disabled: ${missingTrg.join(', ')})` : ''}`);
    console.log(`  ${bundle.ok ? 'ok  ' : 'FAIL'} live bundle ${BUNDLE_URL}: ${bundle.note}`);
    console.log(`  ${diff.differ.length ? 'FAIL' : 'ok  '} live policies match the rollback DDL`);
    console.log(`  ${partiesDone ? 'ok  ' : 'WARN'} D8 parties lockdown applied first${partiesDone ? '' : ' (NOT yet: anon still has table-level SELECT on parties)'}`);

    const stmts = migrationStatements(pub);
    console.log(`\n${MODE === 'apply' ? 'Running' : 'Would run'} ${stmts.length} statements (from ${path.relative(ROOT, MIGRATION)}):`);
    for (const s of stmts) console.log('  ' + s.replace(/\s+/g, ' '));
    console.log(`Rollback would run: ${GRANT_BACK}; CREATE POLICY x${DROPPED_POLICIES.length}; ALTER PUBLICATION supabase_realtime ADD TABLE public.guests; NOTIFY.`);

    if (MODE === 'dry') {
      console.log('\nDry run only (read-only). Use --simulate (rolled back) to test, --apply to execute, --rollback to undo.');
      return;
    }

    const refusals = [];
    if (missingTrg.length) refusals.push('Migration A triggers missing (run apply-guests-broadcast-trigger.cjs --apply first)');
    if (!bundle.ok) refusals.push('live bundle check failed (PR1b not live?) - override with --skip-bundle-check');
    if (diff.differ.length) refusals.push('live policies differ from the rollback DDL (rollback would not be exact)');
    if (MODE === 'apply' && !partiesDone && !ALLOW_BEFORE_PARTIES) refusals.push('D8: parties lockdown not applied yet - override with --allow-before-parties');
    if (refusals.length) {
      console.error('\nREFUSING:\n  - ' + refusals.join('\n  - '));
      process.exitCode = 1;
      return;
    }

    if (MODE === 'simulate') {
      runAs.partyCols = (await prisma.$queryRawUnsafe(
        `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parties'`))
        .map((r) => r.c).filter((c) => SAFE_PARTY.includes(c));
      // eslint-disable-next-line global-require
      const guards = require(path.join(ROOT, 'scripts/check-rls-anon-exposure.js'));
      let results = null;
      let guardOut = null;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
          for (const s of stmts) await tx.$executeRawUnsafe(s);
          const problems = await verify(tx);
          results = [];
          for (const role of ROLES) await runAs(tx, role, results);
          const [{ n }] = await tx.$queryRawUnsafe(
            `SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename = 'guests'`);
          results.push({ label: 'guests not in supabase_realtime (inside txn)', expect: '0 rows', outcome: `${n} rows`, pass: n === 0 });
          results.push({ label: 'verify() inside txn', expect: '0 problems', outcome: `${problems.length} problems${problems.length ? ': ' + problems.slice(0, 5).join('; ') : ''}`, pass: problems.length === 0 });
          // CI guards C1/C3/C4 against the post-lockdown state (the state CI will see after --apply).
          guardOut = await guards.guestsClassChecks((sql, params = []) => tx.$queryRawUnsafe(sql, ...params));
          results.push({ label: 'CI guards C1/C3/C4 (post-lockdown)', expect: '0 failures', outcome: `${guardOut.fail.length} lines`, pass: guardOut.fail.length === 0 });
          // Rollback DDL inside the same txn must restore the exact pre-lockdown state.
          for (const s of await rollbackStatements(tx)) await tx.$executeRawUnsafe(s);
          const d2 = policyDiff(await policies(tx));
          const p2 = await privileges(tx);
          const restored = !d2.missing.length && !d2.differ.length && (await inPublication(tx))
            && Object.keys(p2).every((k) => heldPrivs(p2[k]).join() === heldPrivs(priv[k]).join() && p2[k].readable_cols === priv[k].readable_cols);
          results.push({ label: 'rollback DDL restores the exact pre-lockdown state (inside txn)', expect: 'identical', outcome: restored ? 'identical' : `diff: missing ${d2.missing.length}, differing ${d2.differ.length}`, pass: restored });
          throw new Error(SENTINEL); // force ROLLBACK: nothing is ever committed in --simulate
        }, TX_OPTS);
      } catch (e) {
        if (!String(e.message).includes(SENTINEL)) throw e;
      }
      console.log('');
      for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}  (expected ${r.expect}, got ${r.outcome})`);
      if (guardOut) for (const l of [...guardOut.info, ...guardOut.fail]) console.log('  guard: ' + l.trim());
      const after = await privileges(prisma);
      const [{ u }] = await prisma.$queryRawUnsafe(`SELECT current_user AS u`);
      const unchanged = Object.keys(after).every((k) => heldPrivs(after[k]).join() === heldPrivs(priv[k]).join())
        && (await inPublication(prisma)) === pub && policyDiff(await policies(prisma)).missing.length === diff.missing.length;
      console.log(`\nafter rollback: current_user=${u}; privileges/policies/publication unchanged=${unchanged}`);
      const bad = results.filter((r) => !r.pass);
      console.log(bad.length ? `\n${bad.length} check(s) FAILED (transaction was rolled back regardless)` : '\nAll simulation checks passed. Transaction rolled back; nothing changed.');
      if (bad.length || !unchanged) process.exitCode = 1;
      return;
    }

    // --apply
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      for (const s of stmts) await tx.$executeRawUnsafe(s);
      const problems = await verify(tx);
      if (problems.length) throw new Error(`verification failed inside txn (rolled back): ${problems.join('; ')}`);
    }, TX_OPTS);
    const problems = await verify(prisma);
    console.log(`applied ${stmts.length} statements; post-commit problems: ${problems.length}`);
    for (const p of problems) console.log('  - ' + p);
    console.log(problems.length ? '\nFAIL not locked down as expected - consider --rollback'
      : '\nOK   anon/authenticated hold no privilege on guests/user_preferences; no permissive policy; guests out of supabase_realtime');
    if (problems.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
}

module.exports = { DROPPED_POLICIES, KEPT_GUESTS_POLICIES, GRANT_BACK, MIGRATION, splitStatements, createPolicySql, policyDiff, norm };
