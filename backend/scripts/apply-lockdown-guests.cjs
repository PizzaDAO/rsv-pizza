#!/usr/bin/env node
/**
 * SECURITY (guests-anon-exposure, step S4): apply Migration B
 * (backend/prisma/migrations/20261113_guests_anon_lockdown/migration.sql). Takes `public.guests`
 * and `public.user_preferences` away from the public key: REVOKE ALL from anon/authenticated
 * (table AND column grants), drop the permissive anon policies (and the 3 dead
 * superlative_submissions policies whose subquery on guests would start raising 42501), and drop
 * guests from supabase_realtime. This runner executes the migration FILE (single source of truth).
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
 * Exact rollback: the anon/authenticated entries of relacl (table) and attacl (columns) on both
 * tables are read from the catalog at runtime (aclexplode, so PG17 MAINTAIN and the 12 column-level
 * SELECT grants on guests are included). The dry run diffs them against BASELINE_ACL (prod,
 * 2026-11-13) and --simulate/--apply refuse on a diff. --apply also writes the live snapshot to
 * ACL_SNAPSHOT_FILE before changing anything; --rollback restores from that file if present,
 * else from BASELINE_ACL. --simulate proves the rollback by comparing relacl + attacl + policies +
 * publication before vs after the in-transaction rollback.
 *
 * Modes (exactly one; default is a read-only dry run):
 *   (none)       dry run, read-only: ACL entries + effective privileges, policies diffed against
 *                the rollback DDL, publication membership, realtime.subscription count,
 *                preconditions, the statements it would run.
 *   --simulate   one transaction (SET LOCAL lock_timeout + statement_timeout): migration, verify(),
 *                all anon/authenticated probes in ONE DO block (sub-blocks = implicit savepoints,
 *                SET LOCAL ROLE inside), CI guards C1/C3/C4 on the post-lockdown state, rollback
 *                DDL + exact-state comparison, then a sentinel error forces ROLLBACK. Prints the
 *                elapsed time the locks on guests/superlative_submissions were held. Run off-peak.
 *   --apply      the migration in ONE transaction (SET LOCAL lock_timeout '5s' + statement_timeout),
 *                verify() inside (throws -> rollback), re-verify after commit.
 *   --rollback   exact inverse in one transaction: REVOKE ALL, re-GRANT the snapshot ACL (table +
 *                column), CREATE POLICY only where missing, ADD TABLE only if guests is not a member.
 *
 * Flags: --skip-bundle-check (skip the live-bundle precondition), --allow-before-parties (D8 override).
 *
 *   node backend/scripts/apply-lockdown-guests.cjs [--simulate|--apply|--rollback]
 *
 * Never a session-level SET or a role reset (DATABASE_URL is the 6543 transaction pooler); only
 * SET LOCAL inside a transaction (the original role is restored with SET LOCAL ROLE <it>).
 * Prints names/counts/privilege names, never row values.
 */
const fs = require('fs');
const path = require('path');

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--apply') ? 'apply'
  : ARGS.includes('--simulate') ? 'simulate'
  : ARGS.includes('--rollback') ? 'rollback'
  : 'dry';
const SKIP_BUNDLE = ARGS.includes('--skip-bundle-check');
const ALLOW_BEFORE_PARTIES = ARGS.includes('--allow-before-parties');

const ROOT = path.join(__dirname, '../..');
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261113_guests_anon_lockdown/migration.sql');
const ACL_SNAPSHOT_FILE = path.join(__dirname, 'data/guests-lockdown-acl-snapshot.json');
const SAFE_PARTY = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/parties-anon-columns.json'), 'utf8'));
const BUNDLE_URL = 'https://www.rsv.pizza/';
const TABLES = ['guests', 'user_preferences'];
const ROLES = ['anon', 'authenticated'];
const PRIVS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'];
const TX_OPTS = { timeout: 60000, maxWait: 15000 };
const SENTINEL = 'SIMULATION_ROLLBACK';
const BROADCAST_TRIGGERS = ['trg_guests_broadcast_ins', 'trg_guests_broadcast_upd', 'trg_guests_broadcast_del'];

// anon/authenticated ACL entries on prod, read 2026-11-13 (relacl anon=arwdDxtm/postgres etc.,
// plus attacl anon=r/postgres, authenticated=r/postgres on 12 guests columns). Shape matches
// aclSnapshot(): { table: { table: { role: [privs] }, columns: { col: { role: [privs] } } } }.
const ALL8 = [...PRIVS].sort();
const GUESTS_COL_GRANTS = ['email_resend_id', 'email_status', 'email_status_updated_at', 'ethconf_opt_in',
  'optin_ab_variant', 'reminder_sent_at', 'reminders_unsubscribed', 'swc_au_opt_in', 'swc_br_opt_in',
  'swc_ca_opt_in', 'swc_eu_opt_in', 'swc_uk_opt_in'];
const BASELINE_ACL = {
  guests: {
    table: { anon: ALL8, authenticated: ALL8 },
    columns: Object.fromEntries(GUESTS_COL_GRANTS.map((c) => [c, { anon: ['SELECT'], authenticated: ['SELECT'] }])),
  },
  user_preferences: { table: { anon: ALL8, authenticated: ALL8 }, columns: {} },
};

// The policies Migration B drops, exactly as pg_policies shows them on prod (read 2026-11-13).
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

const qi = (id) => `"${String(id).replace(/"/g, '""')}"`;
const createPolicySql = (p) =>
  `CREATE POLICY "${p.name}" ON public.${p.table} FOR ${p.cmd} TO ${p.roles.join(', ')}` +
  (p.qual !== null ? ` USING (${p.qual})` : '') + (p.check !== null ? ` WITH CHECK (${p.check})` : '');

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

// --------------------------------------------------------------------------------------- ACLs
/** Canonical JSON (sorted keys) so two snapshots compare with ===. */
function canon(v) {
  if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/** anon/authenticated entries of relacl + attacl on TABLES, from the catalog (aclexplode). */
async function aclSnapshot(db) {
  const rows = await db.$queryRawUnsafe(`
    SELECT c.relname AS t, NULL::text AS col, r.rolname AS role, x.privilege_type AS priv, x.is_grantable AS g
      FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) x JOIN pg_roles r ON r.oid = x.grantee
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[]) AND r.rolname = ANY($2::text[])
    UNION ALL
    SELECT c.relname, a.attname::text, r.rolname, x.privilege_type, x.is_grantable
      FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      CROSS JOIN LATERAL aclexplode(a.attacl) x JOIN pg_roles r ON r.oid = x.grantee
     WHERE c.relnamespace = 'public'::regnamespace AND c.relname = ANY($1::text[]) AND r.rolname = ANY($2::text[])
       AND a.attnum > 0 AND NOT a.attisdropped AND a.attacl IS NOT NULL`, TABLES, ROLES);
  const out = Object.fromEntries(TABLES.map((t) => [t, { table: {}, columns: {} }]));
  for (const r of rows) {
    const priv = r.g ? `${r.priv} WITH GRANT OPTION` : r.priv;
    const bucket = r.col === null ? out[r.t].table : (out[r.t].columns[r.col] = out[r.t].columns[r.col] || {});
    (bucket[r.role] = bucket[r.role] || []).push(priv);
  }
  for (const t of TABLES) {
    for (const k of Object.keys(out[t].table)) out[t].table[k].sort();
    for (const c of Object.keys(out[t].columns)) for (const k of Object.keys(out[t].columns[c])) out[t].columns[c][k].sort();
  }
  return out;
}
const aclEntries = (a) => TABLES.reduce((n, t) => n + Object.keys(a[t].table).length
  + Object.values(a[t].columns).reduce((m, c) => m + Object.keys(c).length, 0), 0);
const aclSummary = (a) => TABLES.map((t) => `${t}: table {${Object.entries(a[t].table).map(([r, p]) => `${r}: ${p.join('/')}`).join('; ') || 'none'}}, column grants on ${Object.keys(a[t].columns).length} columns`).join(' | ');

/** GRANT statements that recreate an ACL snapshot exactly (after a REVOKE ALL). */
function grantSql(acl) {
  const out = [];
  for (const t of TABLES) {
    for (const role of ROLES) {
      const privs = acl[t].table[role] || [];
      const plain = privs.filter((p) => !p.endsWith(' WITH GRANT OPTION'));
      const gopt = privs.filter((p) => p.endsWith(' WITH GRANT OPTION')).map((p) => p.replace(' WITH GRANT OPTION', ''));
      if (plain.length) out.push(`GRANT ${plain.join(', ')} ON public.${t} TO ${role}`);
      if (gopt.length) out.push(`GRANT ${gopt.join(', ')} ON public.${t} TO ${role} WITH GRANT OPTION`);
      const byPriv = {};
      for (const [col, roles] of Object.entries(acl[t].columns)) {
        for (const p of roles[role] || []) (byPriv[p] = byPriv[p] || []).push(col);
      }
      for (const [p, cols] of Object.entries(byPriv)) {
        const g = p.endsWith(' WITH GRANT OPTION');
        out.push(`GRANT ${p.replace(' WITH GRANT OPTION', '')} (${cols.sort().map(qi).join(', ')}) ON public.${t} TO ${role}${g ? ' WITH GRANT OPTION' : ''}`);
      }
    }
  }
  return out;
}

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
const policyState = (live) => canon(live.map((p) => [p.table, p.name, p.cmd, [...p.roles].sort(), p.permissive, norm(p.qual), norm(p.check)]));

async function inPublication(db) {
  const [r] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'guests'`);
  return r.n === 1;
}

/** Everything --rollback must restore, as one comparable string. */
async function fullState(db) {
  return canon({ acl: await aclSnapshot(db), policies: policyState(await policies(db)), pub: await inPublication(db) });
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
  const acl = await aclSnapshot(db);
  if (aclEntries(acl)) problems.push(`anon/authenticated ACL entries remain: ${aclSummary(acl)}`);
  const priv = await privileges(db); // effective, so PUBLIC grants / role memberships count too
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

async function rollbackStatements(db, acl) {
  const live = await policies(db);
  const stmts = [
    'REVOKE ALL ON public.guests, public.user_preferences FROM anon, authenticated',
    ...grantSql(acl),
  ];
  for (const p of DROPPED_POLICIES) {
    if (!live.find((x) => x.table === p.table && x.name === p.name)) stmts.push(createPolicySql(p));
  }
  if (!(await inPublication(db))) stmts.push('ALTER PUBLICATION supabase_realtime ADD TABLE public.guests');
  stmts.push(`NOTIFY pgrst, 'reload schema'`);
  return stmts;
}

function loadRollbackAcl() {
  if (fs.existsSync(ACL_SNAPSHOT_FILE)) {
    return { acl: JSON.parse(fs.readFileSync(ACL_SNAPSHOT_FILE, 'utf8')).acl, source: path.relative(ROOT, ACL_SNAPSHOT_FILE) };
  }
  return { acl: BASELINE_ACL, source: 'BASELINE_ACL (hardcoded, prod 2026-11-13)' };
}

// ------------------------------------------------------------------------------------- simulation
function simulationChecks(partyCols) {
  const Z = `'00000000-0000-0000-0000-000000000000'`;
  const denied = [
    ['guests select id', `SELECT id FROM public.guests LIMIT 1`],
    ['guests count(*)', `SELECT count(*) FROM public.guests`],
    ['guests select email', `SELECT email FROM public.guests LIMIT 1`],
    ['guests select a formerly column-granted col', `SELECT email_status FROM public.guests LIMIT 1`],
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
    ['parties SAFE select by custom_url', `SELECT ${partyCols.map(qi).join(', ')} FROM public.parties WHERE custom_url = 'zz-sim' LIMIT 1`],
  ];
  return { denied, ok };
}

/**
 * Every probe for every role in ONE DO block (one round trip). Each probe runs in its own
 * BEGIN/EXCEPTION sub-block (an implicit savepoint, so a failure can't poison the transaction).
 * The role is switched with SET LOCAL ROLE and restored with SET LOCAL ROLE <original role>.
 * Results (labels + SQLSTATE, never values) come back via a transaction-local custom setting.
 */
function probeBlock(partyCols, origRole) {
  const { denied, ok } = simulationChecks(partyCols);
  const probes = [...denied.map(([l, s]) => [l, s, true]), ...ok.map(([l, s]) => [l, s, false])];
  for (const [l, s] of probes) if (/\$q\$|\$l\$|\$sim\$/.test(l + s)) throw new Error('probe text collides with dollar quotes');
  const body = [];
  for (const role of ROLES) {
    body.push(`  EXECUTE 'SET LOCAL ROLE ${role}';`);
    for (const [label, sql, expectDenied] of probes) {
      body.push(`  BEGIN EXECUTE $q$${sql}$q$; st := 'ok'; EXCEPTION WHEN OTHERS THEN st := SQLSTATE; END;`);
      body.push(`  res := res || $l$${role}$l$ || chr(9) || $l$${label}$l$ || chr(9) || ${expectDenied ? "'denied'" : "'ok'"} || chr(9) || st || chr(10);`);
    }
    body.push(`  EXECUTE 'SET LOCAL ROLE ${qi(origRole).replace(/'/g, "''")}';`);
  }
  return `DO $sim$
DECLARE res text := ''; st text;
BEGIN
${body.join('\n')}
  PERFORM set_config('lockdown_sim.results', res, true);
END
$sim$`;
}

function parseProbeResults(text) {
  return String(text || '').split('\n').filter(Boolean).map((line) => {
    const [role, label, expect, st] = line.split('\t');
    const outcome = st === 'ok' ? 'ok' : st === '42501' ? 'denied' : `error ${st}`;
    return { label: `[${role}] ${label}`, expect: expect === 'denied' ? 'denied(42501)' : 'ok', outcome, pass: outcome === expect };
  });
}

// ------------------------------------------------------------------------------------------- main
async function main() {
  // Loaded here (not at module top) so tests can require the pure helpers without a DB client.
  // eslint-disable-next-line global-require
  require('dotenv').config();
  // eslint-disable-next-line global-require
  const { PrismaClient } = require('@prisma/client');
  const prisma = new PrismaClient();
  try {
    console.log(`\n=== lockdown guests + user_preferences (${MODE.toUpperCase()}) ===\n`);

    if (MODE === 'rollback') {
      const { acl, source } = loadRollbackAcl();
      console.log(`restoring ACL from ${source}: ${aclSummary(acl)}`);
      const stmts = await rollbackStatements(prisma, acl);
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
        for (const s of stmts) await tx.$executeRawUnsafe(s);
      }, TX_OPTS);
      const now = await aclSnapshot(prisma);
      const d = policyDiff(await policies(prisma));
      const pub = await inPublication(prisma);
      const aclOk = canon(now) === canon(acl);
      const ok = aclOk && pub && !d.missing.length && !d.differ.length;
      console.log(`ran ${stmts.length} statements; ACL identical to ${source}=${aclOk}; guests in publication=${pub}; policies missing=${d.missing.length}, differing=${d.differ.length}`);
      console.log(ok ? 'OK   pre-lockdown state restored' : 'FAIL not fully restored - investigate');
      if (!ok) process.exitCode = 1;
      return;
    }

    // ---- state + preconditions (all modes but rollback)
    const priv = await privileges(prisma);
    for (const [k, r] of Object.entries(priv)) {
      console.log(`[${k}] effective privileges: ${heldPrivs(r).join(', ') || 'none'}; readable columns ${r.readable_cols}/${r.total_cols}`);
    }
    const aclBefore = await aclSnapshot(prisma);
    const aclMatches = canon(aclBefore) === canon(BASELINE_ACL);
    const alreadyLocked = aclEntries(aclBefore) === 0;
    console.log(`ACL entries (relacl + attacl) for anon/authenticated: ${aclEntries(aclBefore)}; ${aclSummary(aclBefore)}`);
    console.log(`ACL vs BASELINE_ACL (what --rollback restores without a snapshot file): ${aclMatches ? 'identical' : alreadyLocked ? 'no entries (already locked down?)' : 'DIFFERS'}`);
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
    console.log(`  ${aclMatches || alreadyLocked ? 'ok  ' : 'FAIL'} live ACL matches BASELINE_ACL`);
    console.log(`  ${partiesDone ? 'ok  ' : 'WARN'} D8 parties lockdown applied first${partiesDone ? '' : ' (NOT yet: anon still has table-level SELECT on parties)'}`);

    const stmts = migrationStatements(pub);
    console.log(`\n${MODE === 'apply' ? 'Running' : 'Would run'} ${stmts.length} statements (from ${path.relative(ROOT, MIGRATION)}):`);
    for (const s of stmts) console.log('  ' + s.replace(/\s+/g, ' '));
    const rb = await rollbackStatements(prisma, aclMatches || alreadyLocked ? loadRollbackAcl().acl : aclBefore);
    console.log(`Rollback would run ${rb.length} statements (REVOKE ALL; ${grantSql(BASELINE_ACL).length} GRANTs incl. MAINTAIN + column grants; CREATE POLICY for missing ones; ADD TABLE if needed; NOTIFY).`);

    if (MODE === 'dry') {
      console.log('\nDry run only (read-only). Use --simulate (rolled back) to test, --apply to execute, --rollback to undo.');
      return;
    }

    const refusals = [];
    if (missingTrg.length) refusals.push('Migration A triggers missing (run apply-guests-broadcast-trigger.cjs --apply first)');
    if (!bundle.ok) refusals.push('live bundle check failed (PR1b not live?) - override with --skip-bundle-check');
    if (diff.differ.length) refusals.push('live policies differ from the rollback DDL (rollback would not be exact)');
    if (!aclMatches && !alreadyLocked) refusals.push('live ACL differs from BASELINE_ACL (update BASELINE_ACL after review)');
    if (MODE === 'apply' && !partiesDone && !ALLOW_BEFORE_PARTIES) refusals.push('D8: parties lockdown not applied yet - override with --allow-before-parties');
    if (refusals.length) {
      console.error('\nREFUSING:\n  - ' + refusals.join('\n  - '));
      process.exitCode = 1;
      return;
    }

    if (MODE === 'simulate') {
      const partyCols = (await prisma.$queryRawUnsafe(
        `SELECT column_name AS c FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'parties'`))
        .map((r) => r.c).filter((c) => SAFE_PARTY.includes(c));
      // eslint-disable-next-line global-require
      const guards = require(path.join(ROOT, 'scripts/check-rls-anon-exposure.js'));
      const stateBefore = await fullState(prisma);
      let results = null;
      let guardOut = null;
      let t0 = 0;
      let t1 = 0;
      try {
        await prisma.$transaction(async (tx) => {
          await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '3s'`);
          await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '10s'`);
          const [{ u }] = await tx.$queryRawUnsafe(`SELECT current_user::text AS u`);
          const block = probeBlock(partyCols, u);
          t0 = Date.now(); // locks on guests / superlative_submissions are taken from here on
          for (const s of stmts) await tx.$executeRawUnsafe(s);
          const problems = await verify(tx);
          await tx.$executeRawUnsafe(block);
          const [{ r }] = await tx.$queryRawUnsafe(`SELECT current_setting('lockdown_sim.results', true) AS r`);
          const [{ u2 }] = await tx.$queryRawUnsafe(`SELECT current_user::text AS u2`);
          results = parseProbeResults(r);
          results.push({ label: 'role restored after probes (inside txn)', expect: u, outcome: u2, pass: u2 === u });
          results.push({ label: 'verify() inside txn', expect: '0 problems', outcome: `${problems.length} problems${problems.length ? ': ' + problems.slice(0, 5).join('; ') : ''}`, pass: problems.length === 0 });
          // CI guards C1/C3/C4 against the post-lockdown state (the state CI will see after --apply).
          guardOut = await guards.guestsClassChecks((sql, params = []) => tx.$queryRawUnsafe(sql, ...params));
          results.push({ label: 'CI guards C1/C3/C4 (post-lockdown)', expect: '0 failures', outcome: `${guardOut.fail.length} lines`, pass: guardOut.fail.length === 0 });
          // Rollback DDL (from the live pre-lockdown ACL) must restore relacl + attacl + policies + publication exactly.
          for (const s of await rollbackStatements(tx, aclBefore)) await tx.$executeRawUnsafe(s);
          const restored = (await fullState(tx)) === stateBefore;
          results.push({ label: 'rollback restores relacl + attacl + policies + publication exactly (inside txn)', expect: 'identical', outcome: restored ? 'identical' : 'DIFFERENT', pass: restored });
          throw new Error(SENTINEL); // force ROLLBACK: nothing is ever committed in --simulate
        }, TX_OPTS);
      } catch (e) {
        t1 = Date.now();
        if (!String(e.message).includes(SENTINEL)) throw e;
      }
      console.log('');
      for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${r.label}  (expected ${r.expect}, got ${r.outcome})`);
      if (guardOut) for (const l of [...guardOut.info, ...guardOut.fail]) console.log('  guard: ' + l.trim());
      console.log(`\nlocks on guests/superlative_submissions held for ~${t1 - t0} ms (first migration statement -> ROLLBACK)`);
      const [{ u }] = await prisma.$queryRawUnsafe(`SELECT current_user::text AS u`);
      const unchanged = (await fullState(prisma)) === stateBefore;
      console.log(`after rollback: current_user=${u}; relacl/attacl/policies/publication unchanged=${unchanged}`);
      const bad = results.filter((r) => !r.pass);
      console.log(bad.length ? `\n${bad.length} check(s) FAILED (transaction was rolled back regardless)` : '\nAll simulation checks passed. Transaction rolled back; nothing changed.');
      if (bad.length || !unchanged) process.exitCode = 1;
      return;
    }

    // --apply: snapshot the exact pre-lockdown ACL first (names + privilege names only).
    if (!alreadyLocked) {
      fs.mkdirSync(path.dirname(ACL_SNAPSHOT_FILE), { recursive: true });
      fs.writeFileSync(ACL_SNAPSHOT_FILE, JSON.stringify({ taken_at: new Date().toISOString(), acl: aclBefore }, null, 2) + '\n');
      console.log(`wrote ACL snapshot for --rollback: ${path.relative(ROOT, ACL_SNAPSHOT_FILE)}`);
    }
    const t0 = Date.now();
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '15s'`);
      for (const s of stmts) await tx.$executeRawUnsafe(s);
      const problems = await verify(tx);
      if (problems.length) throw new Error(`verification failed inside txn (rolled back): ${problems.join('; ')}`);
    }, TX_OPTS);
    console.log(`transaction committed; locks held ~${Date.now() - t0} ms`);
    const problems = await verify(prisma);
    console.log(`applied ${stmts.length} statements; post-commit problems: ${problems.length}`);
    for (const p of problems) console.log('  - ' + p);
    console.log(problems.length ? '\nFAIL not locked down as expected - consider --rollback'
      : '\nOK   anon/authenticated hold no privilege (table or column) on guests/user_preferences; no permissive policy; guests out of supabase_realtime');
    if (problems.length) process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => { console.error('FAILED:', e.message); process.exitCode = 1; });
}

module.exports = { DROPPED_POLICIES, KEPT_GUESTS_POLICIES, BASELINE_ACL, MIGRATION, splitStatements, createPolicySql, policyDiff, norm, grantSql, probeBlock, parseProbeResults, canon };
