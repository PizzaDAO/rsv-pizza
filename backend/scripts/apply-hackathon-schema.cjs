#!/usr/bin/env node
/**
 * hackathon-platform PR 1: apply backend/prisma/migrations/hackathon-1-core.sql (12 new
 * hackathon_* tables + indexes, composite same-hackathon FKs, RLS on with no policies, no
 * anon/authenticated privileges). This runner executes the migration FILE (single source of
 * truth), minus its own BEGIN / SET LOCAL / COMMIT lines (the runner opens the transaction and
 * sets the timeouts). Purely additive and idempotent (CREATE ... IF NOT EXISTS; REVOKE is a
 * no-op when nothing is granted).
 *
 * APPLY TO PROD BEFORE MERGING the PR: Prisma SELECTs every declared field, so the
 * Hackathon* models must not deploy ahead of their tables (the 2026-05-17 incident class).
 *
 * Modes (default is a read-only dry run):
 *   (none)       dry run, read-only: connection target, current state of every table
 *                (columns, indexes, FK delete rules, RLS, policies, anon/authenticated
 *                privileges on the table and on any owned sequence, row count), the checks,
 *                and the statements --apply would run.
 *   --apply      the migration in ONE short transaction. Creating the FKs takes SHARE ROW
 *                EXCLUSIVE locks on parties / "User" / guests until COMMIT (blocks writers to
 *                them), so: SET LOCAL lock_timeout = 3s (fail fast instead of queueing writers
 *                behind us), statement_timeout = 30s, and only ONE aggregated sanity query
 *                inside (tables exist, RLS on, no anon/authenticated privilege). The full
 *                verification runs after COMMIT. Prints the transaction's elapsed time.
 *   --rollback   DROP the 12 tables (one transaction, children first, no CASCADE). Refuses if
 *                ANY of them holds a row (re-checked under lock). There is no --force.
 *
 *   cd backend && node --env-file=.env scripts/apply-hackathon-schema.cjs [--apply|--rollback]
 *
 * Never a session-level SET (DATABASE_URL is the 6543 transaction pooler); only SET LOCAL
 * inside a transaction. Prints names/counts, never row values.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--apply') ? 'apply' : ARGS.includes('--rollback') ? 'rollback' : 'dry';
const ROLES = ['anon', 'authenticated'];
const MIGRATION = path.join(__dirname, '../prisma/migrations/hackathon-1-core.sql');
const TX_OPTS = { timeout: 60000, maxWait: 15000 };
const LOCK_TIMEOUT = '3s';
const STATEMENT_TIMEOUT = '30s';

const U = 'uuid', T = 'text', I = 'integer', B = 'boolean', TS = 'timestamp with time zone';
const N = 'numeric', A = 'ARRAY', J = 'jsonb';
// pg_constraint.confdeltype
const RULE = { a: 'NO ACTION', r: 'RESTRICT', c: 'CASCADE', n: 'SET NULL', d: 'SET DEFAULT' };

// Parent tables first (creation order); rollback drops in reverse.
// cols: expected column -> information_schema data_type. idx: every expected index incl. pkey
// and UNIQUE constraints. fks: every expected FOREIGN KEY constraint -> ON DELETE rule.
const TABLES = {
  hackathons: {
    cols: {
      id: U, party_id: U, rules: T, submissions_open_at: TS, submission_deadline: TS,
      team_min_size: I, team_max_size: I, max_tracks_per_submission: I, eligibility: T,
      blind_judging: B, judging_status: T, published_at: TS, gallery_visibility: T,
      results_revealed_at: TS, disabled_at: TS, created_at: TS, updated_at: TS,
    },
    idx: ['hackathons_pkey', 'hackathons_party_id_key'],
    fks: { hackathons_party_id_fkey: 'RESTRICT' },
  },
  hackathon_tracks: {
    cols: { id: U, hackathon_id: U, name: T, description: T, sponsor_name: T, sort_order: I, created_at: TS, updated_at: TS },
    idx: ['hackathon_tracks_pkey', 'hackathon_tracks_id_hackathon_id_key', 'hackathon_tracks_hackathon_id_sort_order_idx'],
    fks: { hackathon_tracks_hackathon_id_fkey: 'CASCADE' },
  },
  hackathon_prizes: {
    cols: {
      id: U, hackathon_id: U, track_id: U, name: T, description: T, rank: I, amount_text: T,
      amount_value: N, currency: T, quantity: I, kind: T, sort_order: I, created_at: TS, updated_at: TS,
    },
    idx: [
      'hackathon_prizes_pkey', 'hackathon_prizes_id_hackathon_id_key',
      'hackathon_prizes_hackathon_id_sort_order_idx', 'hackathon_prizes_track_id_idx',
    ],
    fks: { hackathon_prizes_hackathon_id_fkey: 'CASCADE', hackathon_prizes_track_id_hackathon_id_fkey: 'NO ACTION' },
  },
  hackathon_criteria: {
    cols: { id: U, hackathon_id: U, name: T, description: T, weight: I, max_score: I, sort_order: I, created_at: TS, updated_at: TS },
    idx: ['hackathon_criteria_pkey', 'hackathon_criteria_hackathon_id_sort_order_idx'],
    fks: { hackathon_criteria_hackathon_id_fkey: 'CASCADE' },
  },
  hackathon_teams: {
    cols: { id: U, hackathon_id: U, name: T, invite_code: T, created_by_user_id: T, created_at: TS, updated_at: TS },
    idx: [
      'hackathon_teams_pkey', 'hackathon_teams_invite_code_key', 'hackathon_teams_id_hackathon_id_key',
      'hackathon_teams_hackathon_id_idx', 'hackathon_teams_created_by_user_id_idx',
    ],
    fks: { hackathon_teams_hackathon_id_fkey: 'CASCADE', hackathon_teams_created_by_user_id_fkey: 'SET NULL' },
  },
  hackathon_team_members: {
    cols: { id: U, team_id: U, hackathon_id: U, user_id: T, guest_id: U, role: T, show_on_gallery: B, joined_at: TS },
    idx: [
      'hackathon_team_members_pkey', 'hackathon_team_members_hackathon_id_user_id_key',
      'hackathon_team_members_one_captain_per_team', 'hackathon_team_members_team_id_idx',
      'hackathon_team_members_user_id_idx', 'hackathon_team_members_guest_id_idx',
    ],
    fks: {
      hackathon_team_members_team_id_hackathon_id_fkey: 'CASCADE',
      hackathon_team_members_hackathon_id_fkey: 'CASCADE',
      hackathon_team_members_user_id_fkey: 'CASCADE',
      hackathon_team_members_guest_id_fkey: 'SET NULL',
    },
  },
  hackathon_submissions: {
    cols: {
      id: U, hackathon_id: U, team_id: U, name: T, slug: T, tagline: T, description: T, repo_url: T,
      demo_video_url: T, deck_url: T, live_url: T, cover_path: T, screenshot_paths: A, status: T,
      submitted_at: TS, disqualified_reason: T, table_number: T, created_at: TS, updated_at: TS,
    },
    idx: [
      'hackathon_submissions_pkey', 'hackathon_submissions_team_id_key', 'hackathon_submissions_id_hackathon_id_key',
      'hackathon_submissions_hackathon_id_slug_key', 'hackathon_submissions_hackathon_id_status_idx',
    ],
    fks: {
      hackathon_submissions_hackathon_id_fkey: 'NO ACTION',
      hackathon_submissions_team_id_hackathon_id_fkey: 'RESTRICT',
    },
  },
  hackathon_submission_tracks: {
    cols: { submission_id: U, track_id: U, hackathon_id: U, created_at: TS },
    idx: ['hackathon_submission_tracks_pkey', 'hackathon_submission_tracks_track_id_idx'],
    fks: {
      hackathon_submission_tracks_submission_id_hackathon_id_fkey: 'CASCADE',
      hackathon_submission_tracks_track_id_hackathon_id_fkey: 'NO ACTION',
    },
  },
  hackathon_judges: {
    cols: {
      id: U, hackathon_id: U, email: T, name: T, user_id: T, status: T, invited_by: T, created_at: TS, updated_at: TS,
    },
    idx: [
      'hackathon_judges_pkey', 'hackathon_judges_id_hackathon_id_key', 'hackathon_judges_hackathon_id_email_key',
      'hackathon_judges_email_idx', 'hackathon_judges_user_id_idx',
    ],
    fks: { hackathon_judges_hackathon_id_fkey: 'CASCADE', hackathon_judges_user_id_fkey: 'SET NULL' },
  },
  hackathon_judge_tracks: {
    cols: { judge_id: U, track_id: U, hackathon_id: U, created_at: TS },
    idx: ['hackathon_judge_tracks_pkey', 'hackathon_judge_tracks_track_id_idx'],
    fks: {
      hackathon_judge_tracks_judge_id_hackathon_id_fkey: 'CASCADE',
      hackathon_judge_tracks_track_id_hackathon_id_fkey: 'CASCADE',
    },
  },
  hackathon_scores: {
    cols: {
      id: U, hackathon_id: U, judge_id: U, submission_id: U, criterion_scores: J, total: N, private_comment: T,
      team_feedback: T, created_at: TS, updated_at: TS,
    },
    idx: ['hackathon_scores_pkey', 'hackathon_scores_judge_id_submission_id_key', 'hackathon_scores_submission_id_idx'],
    fks: {
      hackathon_scores_judge_id_hackathon_id_fkey: 'NO ACTION',
      hackathon_scores_submission_id_hackathon_id_fkey: 'NO ACTION',
    },
  },
  hackathon_awards: {
    cols: {
      id: U, hackathon_id: U, prize_id: U, submission_id: U, place: I, awarded_at: TS, awarded_by: T,
      payout_status: T, recipient_user_id: T, recipient_wallet: T, payout_reference: T, paid_at: TS,
      payout_notes: T, updated_at: TS,
    },
    idx: [
      'hackathon_awards_pkey', 'hackathon_awards_prize_id_submission_id_key', 'hackathon_awards_submission_id_idx',
      'hackathon_awards_recipient_user_id_idx',
    ],
    fks: {
      hackathon_awards_prize_id_hackathon_id_fkey: 'NO ACTION',
      hackathon_awards_submission_id_hackathon_id_fkey: 'RESTRICT',
      hackathon_awards_recipient_user_id_fkey: 'SET NULL',
    },
  },
};
const NAMES = Object.keys(TABLES);

/**
 * Split the migration into statements: strip -- comments, split on ';', and drop the file's own
 * BEGIN / COMMIT / SET LOCAL (the runner wraps everything in one transaction itself).
 * The file has no $$ blocks and no ';' inside string literals.
 */
function splitStatements(sql) {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s) => !/^(BEGIN|COMMIT)$/i.test(s) && !/^SET\s+LOCAL\b/i.test(s));
}

async function tableState(db, table) {
  const [{ exists }] = await db.$queryRawUnsafe(`SELECT to_regclass('public.' || quote_ident($1)) IS NOT NULL AS exists`, table);
  if (!exists) return { exists: false };
  const rel = `('public.' || quote_ident($1))::regclass`;
  const cols = await db.$queryRawUnsafe(
    `SELECT column_name, data_type FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, table);
  const [{ rls }] = await db.$queryRawUnsafe(`SELECT c.relrowsecurity AS rls FROM pg_class c WHERE c.oid = ${rel}`, table);
  const idxRows = await db.$queryRawUnsafe(`SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND tablename = $1`, table);
  const fkRows = await db.$queryRawUnsafe(
    `SELECT conname, confdeltype::text AS rule FROM pg_constraint WHERE conrelid = ${rel} AND contype = 'f'`, table);
  const [{ checks }] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS checks FROM pg_constraint WHERE conrelid = ${rel} AND contype = 'c'`, table);
  const seqRows = await db.$queryRawUnsafe(
    `SELECT s.oid::regclass::text AS seq FROM pg_class s
       JOIN pg_depend d ON d.objid = s.oid AND d.classid = 'pg_class'::regclass AND d.deptype IN ('a', 'i')
      WHERE s.relkind = 'S' AND d.refobjid = ${rel}`, table);
  const privs = {};
  for (const role of ROLES) {
    const [{ has_role }] = await db.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS has_role`, role);
    if (!has_role) { privs[role] = []; continue; }
    const [p] = await db.$queryRawUnsafe(
      `WITH r AS (SELECT ('public.' || quote_ident($2))::regclass AS rel)
       SELECT has_any_column_privilege($1, rel, 'SELECT') AS sel,
              has_any_column_privilege($1, rel, 'INSERT') AS ins,
              has_any_column_privilege($1, rel, 'UPDATE') AS upd,
              has_any_column_privilege($1, rel, 'REFERENCES') AS refs,
              has_table_privilege($1, rel, 'DELETE') AS del,
              has_table_privilege($1, rel, 'TRUNCATE') AS trunc,
              has_table_privilege($1, rel, 'TRIGGER') AS trig FROM r`, role, table);
    const held = Object.entries({
      SELECT: p.sel, INSERT: p.ins, UPDATE: p.upd, REFERENCES: p.refs, DELETE: p.del, TRUNCATE: p.trunc, TRIGGER: p.trig,
    }).filter(([, v]) => v).map(([k]) => k);
    for (const { seq } of seqRows) {
      for (const priv of ['USAGE', 'SELECT', 'UPDATE']) {
        const [{ ok }] = await db.$queryRawUnsafe(`SELECT has_sequence_privilege($1, $2::regclass, $3) AS ok`, role, seq, priv);
        if (ok) held.push(`SEQUENCE ${seq} ${priv}`);
      }
    }
    privs[role] = held;
  }
  const policies = await db.$queryRawUnsafe(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`, table);
  const [{ rows }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS rows FROM public.${table}`);
  return {
    exists: true, cols, rls, idx: idxRows.map((r) => r.indexname),
    fks: Object.fromEntries(fkRows.map((r) => [r.conname, RULE[r.rule] || r.rule])), checks,
    seqs: seqRows.map((r) => r.seq), privs, policies: policies.map((p) => p.policyname), rows,
  };
}

async function state(db) {
  const out = {};
  for (const t of NAMES) out[t] = await tableState(db, t);
  const realtime = await db.$queryRawUnsafe(
    `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename LIKE 'hackathon%'`);
  return { tables: out, realtime: realtime.map((r) => r.tablename) };
}

function problems(s) {
  const out = [];
  for (const t of NAMES) {
    const st = s.tables[t];
    const spec = TABLES[t];
    if (!st.exists) { out.push(`${t} does not exist`); continue; }
    const got = Object.fromEntries(st.cols.map((c) => [c.column_name, c.data_type]));
    for (const [c, type] of Object.entries(spec.cols)) {
      if (got[c] !== type) out.push(`${t}.${c}: expected ${type}, got ${got[c] ?? 'missing'}`);
    }
    for (const c of Object.keys(got)) if (!(c in spec.cols)) out.push(`${t}.${c}: unexpected column`);
    for (const name of spec.idx) if (!st.idx.includes(name)) out.push(`${t}: index ${name} missing`);
    for (const [name, rule] of Object.entries(spec.fks)) {
      if (st.fks[name] !== rule) out.push(`${t}: FK ${name} expected ON DELETE ${rule}, got ${st.fks[name] ?? 'missing'}`);
    }
    for (const name of Object.keys(st.fks)) if (!(name in spec.fks)) out.push(`${t}: unexpected FK ${name}`);
    if (!st.rls) out.push(`${t}: row level security is OFF`);
    if (st.policies.length) out.push(`${t}: unexpected policies ${st.policies.join(', ')}`);
    for (const role of ROLES) if (st.privs[role].length) out.push(`${t}: ${role} holds ${st.privs[role].join('/')}`);
  }
  if (s.realtime.length) out.push(`in supabase_realtime (must not be): ${s.realtime.join(', ')}`);
  return out;
}

/**
 * The only check inside the apply transaction (keeps the FK locks on parties / "User" / guests
 * short): ONE query over all tables, returning those that are missing, RLS-off, or on which
 * anon/authenticated hold any table privilege. The full verification runs after COMMIT.
 */
async function quickProblems(db) {
  const rows = await db.$queryRawUnsafe(
    `SELECT n.t,
            c.oid IS NULL AS missing,
            COALESCE(NOT c.relrowsecurity, false) AS rls_off,
            COALESCE((SELECT bool_or(has_table_privilege(r.rolname, c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'))
                        FROM pg_roles r WHERE r.rolname = ANY ($2::text[])), false) AS granted
       FROM unnest($1::text[]) AS n(t)
       LEFT JOIN pg_class c ON c.oid = to_regclass('public.' || quote_ident(n.t))`, NAMES, ROLES);
  return rows.filter((r) => r.missing || r.rls_off || r.granted)
    .map((r) => `${r.t}: ${r.missing ? 'missing' : r.rls_off ? 'RLS off' : 'anon/authenticated privilege'}`);
}

function print(s) {
  for (const t of NAMES) {
    const st = s.tables[t];
    if (!st.exists) { console.log(`  ${t}: does not exist`); continue; }
    const roles = ROLES.map((r) => `${r}: ${st.privs[r].length ? st.privs[r].join('/') : 'none'}`).join('; ');
    const fks = Object.entries(st.fks).map(([n, r]) => `${n.replace(`${t}_`, '').replace(/_fkey$/, '')}=${r}`).join(', ');
    console.log(`  ${t}: ${st.rows} row(s), ${st.cols.length} cols, ${st.idx.length} indexes, ${st.checks} CHECKs, ` +
      `sequences: ${st.seqs.length ? st.seqs.join(', ') : 'none'}, RLS ${st.rls ? 'on' : 'OFF'}, ` +
      `policies: ${st.policies.length ? st.policies.join(', ') : 'none'}, privileges ${roles}\n      FKs: ${fks}`);
  }
  console.log(`  supabase_realtime hackathon tables: ${s.realtime.length ? s.realtime.join(', ') : 'none'}`);
}

function target() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL unparseable)';
  }
}

async function prereqs(db) {
  const out = [];
  for (const rel of ['parties', '"User"', 'guests']) {
    const [{ ok }] = await db.$queryRawUnsafe(`SELECT to_regclass($1) IS NOT NULL AS ok`, `public.${rel}`);
    if (!ok) out.push(`FK target ${rel} missing`);
  }
  const [{ ok }] = await db.$queryRawUnsafe(`SELECT to_regproc('gen_random_uuid') IS NOT NULL AS ok`);
  if (!ok) out.push('gen_random_uuid() not available');
  return out;
}

async function setLocal(tx) {
  await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '${LOCK_TIMEOUT}'`);
  await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${STATEMENT_TIMEOUT}'`);
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set (run with node --env-file=.env)');
  const prisma = new PrismaClient();
  try {
    const stmts = splitStatements(fs.readFileSync(MIGRATION, 'utf8'));
    console.log(`\n=== hackathon-1-core (${MODE.toUpperCase()}${MODE === 'dry' ? ', read-only' : ''}) ===`);
    console.log(`target: ${target()}`);
    const pre = await prereqs(prisma);
    console.log(`prerequisites: ${pre.length ? pre.join('; ') : 'parties, "User", guests, gen_random_uuid() present'}`);
    console.log('\ncurrent state:');
    const before = await state(prisma);
    print(before);
    const pb = problems(before);

    if (MODE === 'dry') {
      console.log(`\n--apply would run ${stmts.length} statements in ONE transaction ` +
        `(SET LOCAL lock_timeout = ${LOCK_TIMEOUT}, statement_timeout = ${STATEMENT_TIMEOUT}; one aggregated check inside, full verify after COMMIT):`);
      for (const s of stmts) console.log(`  ${s.replace(/\s+/g, ' ')};`);
      const missing = NAMES.filter((t) => !before.tables[t].exists);
      console.log(pb.length
        ? `\nchecks: ${pb.length} problem(s) now (${missing.length} of ${NAMES.length} tables missing, expected before apply):\n  - ${pb.slice(0, 40).join('\n  - ')}${pb.length > 40 ? `\n  ... ${pb.length - 40} more` : ''}`
        : '\nchecks: already applied and correct; --apply would be a no-op.');
      console.log('\nDRY RUN: nothing changed.');
      return;
    }

    if (MODE === 'apply') {
      if (pre.length) throw new Error(`prerequisites missing: ${pre.join('; ')}`);
      const t0 = process.hrtime.bigint();
      await prisma.$transaction(async (tx) => {
        await setLocal(tx);
        for (const s of stmts) await tx.$executeRawUnsafe(s);
        const p = await quickProblems(tx);
        if (p.length) throw new Error(`check failed inside the transaction (rolled back): ${p.join('; ')}`);
      }, TX_OPTS);
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`\ntransaction committed in ${ms.toFixed(0)} ms (locks on parties / "User" / guests held this long)`);
      const after = await state(prisma);
      console.log('\nafter commit:');
      print(after);
      const pa = problems(after);
      if (pa.length) throw new Error(`post-commit verify failed: ${pa.join('; ')}`);
      console.log('\nOK: applied and verified.');
      return;
    }

    // rollback
    const present = NAMES.filter((t) => before.tables[t].exists);
    if (!present.length) { console.log('\nnothing to roll back.'); return; }
    const withRows = present.filter((t) => before.tables[t].rows > 0);
    if (withRows.length) {
      throw new Error(`refusing to roll back: rows exist in ${withRows.map((t) => `${t} (${before.tables[t].rows})`).join(', ')}`);
    }
    const t0 = process.hrtime.bigint();
    await prisma.$transaction(async (tx) => {
      await setLocal(tx);
      // Re-check emptiness inside the transaction, under lock, before dropping anything.
      for (const t of [...present].reverse()) {
        await tx.$executeRawUnsafe(`LOCK TABLE public.${t} IN ACCESS EXCLUSIVE MODE`);
        const [{ n }] = await tx.$queryRawUnsafe(`SELECT count(*)::int AS n FROM public.${t}`);
        if (n > 0) throw new Error(`refusing to roll back: ${t} gained ${n} row(s)`);
      }
      for (const t of [...present].reverse()) await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS public.${t}`);
    }, TX_OPTS);
    console.log(`\nrollback transaction committed in ${(Number(process.hrtime.bigint() - t0) / 1e6).toFixed(0)} ms`);
    const after = await state(prisma);
    const left = NAMES.filter((t) => after.tables[t].exists);
    if (left.length) throw new Error(`still present after rollback: ${left.join(', ')}`);
    console.log('\nOK: dropped all hackathon tables.');
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  // Prisma messages start with a blank line and an invocation dump; the cause is at the end.
  const lines = String(e && e.message ? e.message : e).split('\n').map((l) => l.trim()).filter(Boolean);
  console.error('FAILED:', lines.slice(-3).join(' | '));
  process.exit(1);
});
