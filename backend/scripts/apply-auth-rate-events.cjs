#!/usr/bin/env node
/**
 * durable-rate-limits: apply backend/prisma/migrations/20261114_auth_rate_events/migration.sql
 * (new table `auth_rate_events` + index, RLS on, no anon/authenticated grants). This runner
 * executes the migration FILE (single source of truth). Additive and idempotent
 * (CREATE ... IF NOT EXISTS, REVOKE is a no-op when nothing is granted).
 *
 * APPLY TO PROD BEFORE MERGING the PR: the new backend code reserves every sign-in code
 * check in this table and answers 503 at /api/auth/verify-code (fail closed) if it is missing.
 *
 * Modes (default is a read-only dry run):
 *   (none)       dry run, read-only: connection target, current state of the table / index /
 *                RLS / anon+authenticated privileges, and the statements --apply would run.
 *   --apply      the migration in ONE transaction (SET LOCAL lock_timeout + statement_timeout),
 *                verify() inside (throws -> rollback), re-verify after commit.
 *   --rollback   DROP TABLE auth_rate_events (one transaction). Only after the backend code that
 *                uses it has been reverted, or verify-code answers 503. Refuses while rows from
 *                the last 15 min exist (the code is live) unless --force.
 *
 *   cd backend && node --env-file=.env scripts/apply-auth-rate-events.cjs [--apply|--rollback [--force]]
 *
 * Never a session-level SET (DATABASE_URL is the 6543 transaction pooler); only SET LOCAL
 * inside a transaction. Prints names/counts, never row values.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--apply') ? 'apply' : ARGS.includes('--rollback') ? 'rollback' : 'dry';
const FORCE = ARGS.includes('--force');
const TABLE = 'auth_rate_events';
const INDEXES = ['auth_rate_events_bucket_key_created_at_idx', 'auth_rate_events_created_at_idx'];
const ROLES = ['anon', 'authenticated'];
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261114_auth_rate_events/migration.sql');
const EXPECTED_COLUMNS = { id: 'bigint', bucket: 'text', key: 'text', created_at: 'timestamp with time zone' };
const TX_OPTS = { timeout: 60000, maxWait: 15000 };

/** Split a SQL file into statements (no $$ blocks in this migration; strips -- comments). */
function splitStatements(sql) {
  return sql
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
    .split(';')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function state(db) {
  const [{ exists }] = await db.$queryRawUnsafe(`SELECT to_regclass('public.${TABLE}') IS NOT NULL AS exists`);
  if (!exists) return { exists: false };
  const cols = await db.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, TABLE);
  const [{ rls }] = await db.$queryRawUnsafe(
    `SELECT c.relrowsecurity AS rls FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, TABLE);
  const idx = {};
  for (const name of INDEXES) {
    const [{ ok }] = await db.$queryRawUnsafe(`SELECT to_regclass('public.' || $1) IS NOT NULL AS ok`, name);
    idx[name] = ok;
  }
  const privs = {};
  for (const role of ROLES) {
    const [{ has_role }] = await db.$queryRawUnsafe(`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS has_role`, role);
    if (!has_role) { privs[role] = ['(role missing)']; continue; }
    const [p] = await db.$queryRawUnsafe(
      `WITH r AS (SELECT ('public.' || $2)::regclass AS rel)
       SELECT has_any_column_privilege($1, rel, 'SELECT') AS sel,
              has_any_column_privilege($1, rel, 'INSERT') AS ins,
              has_any_column_privilege($1, rel, 'UPDATE') AS upd,
              has_table_privilege($1, rel, 'DELETE') AS del,
              has_table_privilege($1, rel, 'TRUNCATE') AS trunc,
              has_sequence_privilege($1, ('public.' || $2 || '_id_seq')::regclass, 'USAGE') AS seq_usage,
              has_sequence_privilege($1, ('public.' || $2 || '_id_seq')::regclass, 'SELECT') AS seq_select,
              has_sequence_privilege($1, ('public.' || $2 || '_id_seq')::regclass, 'UPDATE') AS seq_update FROM r`, role, TABLE);
    privs[role] = Object.entries({
      SELECT: p.sel, INSERT: p.ins, UPDATE: p.upd, DELETE: p.del, TRUNCATE: p.trunc,
      'SEQUENCE USAGE': p.seq_usage, 'SEQUENCE SELECT': p.seq_select, 'SEQUENCE UPDATE': p.seq_update,
    })
      .filter(([, v]) => v).map(([k]) => k);
  }
  const policies = await db.$queryRawUnsafe(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`, TABLE);
  const [{ rows, recent }] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS rows, count(*) FILTER (WHERE created_at > now() - interval '15 minutes')::int AS recent FROM ${TABLE}`);
  return { exists: true, cols, rls, idx, privs, policies: policies.map((p) => p.policyname), rows, recent };
}

function problems(s) {
  const out = [];
  if (!s.exists) return [`${TABLE} does not exist`];
  const got = Object.fromEntries(s.cols.map((c) => [c.column_name, c.data_type]));
  for (const [c, t] of Object.entries(EXPECTED_COLUMNS)) {
    if (got[c] !== t) out.push(`column ${c}: expected ${t}, got ${got[c] ?? 'missing'}`);
  }
  for (const c of s.cols) if (c.is_nullable !== 'NO') out.push(`column ${c.column_name} is nullable`);
  for (const name of INDEXES) if (!s.idx[name]) out.push(`index ${name} missing`);
  if (!s.rls) out.push('row level security is OFF');
  for (const role of ROLES) if (s.privs[role].length) out.push(`${role} holds ${s.privs[role].join('/')}`);
  if (s.policies.length) out.push(`unexpected policies: ${s.policies.join(', ')}`);
  return out;
}

function print(s) {
  if (!s.exists) { console.log(`  ${TABLE}: does not exist`); return; }
  console.log(`  ${TABLE}: exists, ${s.rows} row(s), ${s.recent} in the last 15 min`);
  console.log(`  columns: ${s.cols.map((c) => `${c.column_name} ${c.data_type}${c.is_nullable === 'NO' ? ' not null' : ''}`).join(', ')}`);
  for (const name of INDEXES) console.log(`  index ${name}: ${s.idx[name] ? 'present' : 'MISSING'}`);
  console.log(`  RLS: ${s.rls ? 'on' : 'OFF'}; policies: ${s.policies.length ? s.policies.join(', ') : 'none'}`);
  for (const role of ROLES) console.log(`  ${role}: ${s.privs[role].length ? s.privs[role].join('/') : 'no privileges'}`);
}

function target() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL unparseable)';
  }
}

(async () => {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set (run with node --env-file=.env)');
  const prisma = new PrismaClient();
  try {
    const stmts = splitStatements(fs.readFileSync(MIGRATION, 'utf8'));
    console.log(`\n=== auth_rate_events (${MODE.toUpperCase()}${MODE === 'dry' ? ', read-only' : ''}) ===`);
    console.log(`target: ${target()}`);
    console.log('\ncurrent state:');
    const before = await state(prisma);
    print(before);
    const pb = problems(before);

    if (MODE === 'dry') {
      console.log('\n--apply would run, in ONE transaction (SET LOCAL lock_timeout = 5s, statement_timeout = 30s):');
      for (const s of stmts) console.log(`  ${s.replace(/\s+/g, ' ')};`);
      console.log(pb.length
        ? `\nchecks: ${pb.length} problem(s) now (expected before apply): ${pb.join('; ')}`
        : '\nchecks: already applied and correct; --apply would be a no-op.');
      console.log('\nDRY RUN: nothing changed.');
      return;
    }

    if (MODE === 'apply') {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '30s'`);
        for (const s of stmts) await tx.$executeRawUnsafe(s);
        const p = problems(await state(tx));
        if (p.length) throw new Error(`verify failed inside the transaction (rolled back): ${p.join('; ')}`);
      }, TX_OPTS);
      const after = await state(prisma);
      console.log('\nafter commit:');
      print(after);
      const pa = problems(after);
      if (pa.length) throw new Error(`post-commit verify failed: ${pa.join('; ')}`);
      console.log('\nOK: applied and verified.');
      return;
    }

    // rollback
    if (!before.exists) { console.log('\nnothing to roll back.'); return; }
    if (before.recent > 0 && !FORCE) {
      throw new Error(`${before.recent} row(s) from the last 15 min: the backend code is live. Revert it first, or pass --force.`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "${TABLE}"`);
    }, TX_OPTS);
    const after = await state(prisma);
    if (after.exists) throw new Error('table still exists after rollback');
    console.log('\nOK: dropped.');
  } finally {
    await prisma.$disconnect();
  }
})().catch((e) => {
  console.error('FAILED:', e.message);
  process.exit(1);
});
