#!/usr/bin/env node
/**
 * wl-self-serve-brands PR 1: apply backend/prisma/migrations/20261118_wl_self_serve/migration.sql
 *   - 19 new nullable/defaulted columns on `event_series`
 *   - new tables `series_admins` and `series_audit` (indexes, CHECKs, RLS on, no anon/authenticated
 *     grants)
 * Executes the migration FILE (single source of truth). Additive and idempotent (ADD COLUMN IF NOT
 * EXISTS, CREATE ... IF NOT EXISTS; REVOKE is a no-op when nothing is granted).
 *
 * APPLY TO PROD BEFORE MERGING the PR: Prisma SELECTs every declared field, so schema.prisma merged
 * ahead of these columns 500s every event_series query (incident 2026-05-17), and CI schema-drift /
 * rls-anon-exposure fail until the columns and tables exist.
 *
 * Modes (default is a read-only dry run):
 *   (none)       dry run, read-only: connection target, current state of the columns / tables /
 *                indexes / RLS / anon+authenticated privileges, and the statements --apply would run.
 *   --apply      the migration in ONE transaction (SET LOCAL lock_timeout + statement_timeout),
 *                verify() inside (throws -> rollback), re-verify after commit.
 *   --rollback   DROP both new tables and the new event_series columns (one transaction). Only after
 *                the backend code that uses them has been reverted. Refuses while either table has
 *                rows, or while any new event_series column holds data, unless --force.
 *
 *   cd backend && node --env-file=.env scripts/apply-wl-self-serve.cjs [--apply|--rollback [--force]]
 *
 * Never a session-level SET (DATABASE_URL is the 6543 transaction pooler); only SET LOCAL inside a
 * transaction. Prints names/counts, never row values.
 */
const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');

const ARGS = process.argv.slice(2);
const MODE = ARGS.includes('--apply') ? 'apply' : ARGS.includes('--rollback') ? 'rollback' : 'dry';
const FORCE = ARGS.includes('--force');
const ROLES = ['anon', 'authenticated'];
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261118_wl_self_serve/migration.sql');
const TX_OPTS = { timeout: 60000, maxWait: 15000 };

// event_series: column -> [data_type, nullable]
const SERIES_COLUMNS = {
  tagline: ['text', true],
  meta_description: ['text', true],
  support_email: ['text', true],
  favicon_url: ['text', true],
  logo_light_url: ['text', true],
  theme_tokens: ['jsonb', true],
  flyer_art: ['jsonb', true],
  config_version: ['integer', false],
  site_aliases: ['ARRAY', false],
  email_from_address: ['text', true],
  email_from_name: ['text', true],
  email_reply_to: ['text', true],
  email_domain: ['text', true],
  resend_domain_id: ['text', true],
  email_domain_verified_at: ['timestamp with time zone', true],
  pending_domain: ['text', true],
  pending_domain_token: ['text', true],
  pending_domain_status: ['text', true],
  pending_domain_checked_at: ['timestamp with time zone', true],
};

const TABLES = {
  series_admins: {
    columns: {
      id: ['uuid', false],
      series_id: ['uuid', false],
      email: ['text', false],
      user_id: ['text', true],
      role: ['text', false],
      status: ['text', false],
      alerts_enabled: ['boolean', false],
      invite_token_hash: ['text', true],
      invite_expires_at: ['timestamp with time zone', true],
      invited_by: ['text', false],
      accepted_at: ['timestamp with time zone', true],
      revoked_at: ['timestamp with time zone', true],
      revoked_by: ['text', true],
      created_at: ['timestamp with time zone', false],
      updated_at: ['timestamp with time zone', false],
    },
    indexes: ['series_admins_pkey', 'series_admins_series_id_email_key', 'series_admins_email_idx', 'series_admins_invite_token_hash_idx'],
    fks: 2, // event_series, User
    checks: 2, // role, status
  },
  series_audit: {
    columns: {
      id: ['uuid', false],
      series_id: ['uuid', false],
      actor_email: ['text', false],
      actor_kind: ['text', false],
      action: ['text', false],
      changes: ['jsonb', true],
      snapshot: ['jsonb', true],
      created_at: ['timestamp with time zone', false],
    },
    indexes: ['series_audit_pkey', 'series_audit_series_id_created_at_idx'],
    fks: 1, // event_series
    checks: 1, // actor_kind
  },
};

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

async function tableState(db, table) {
  const [{ exists }] = await db.$queryRawUnsafe(`SELECT to_regclass('public.${table}') IS NOT NULL AS exists`);
  if (!exists) return { exists: false };
  const cols = await db.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`, table);
  const [{ rls }] = await db.$queryRawUnsafe(
    `SELECT c.relrowsecurity AS rls FROM pg_class c WHERE c.oid = ('public.' || $1)::regclass`, table);
  const idx = {};
  for (const name of TABLES[table].indexes) {
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
              has_table_privilege($1, rel, 'TRUNCATE') AS trunc FROM r`, role, table);
    privs[role] = Object.entries({ SELECT: p.sel, INSERT: p.ins, UPDATE: p.upd, DELETE: p.del, TRUNCATE: p.trunc })
      .filter(([, v]) => v).map(([k]) => k);
  }
  const policies = await db.$queryRawUnsafe(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`, table);
  const cons = await db.$queryRawUnsafe(
    `SELECT contype FROM pg_constraint WHERE conrelid = ('public.' || $1)::regclass AND contype IN ('f', 'c')`, table);
  const [{ rows }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS rows FROM "${table}"`);
  return {
    exists: true, cols, rls, idx, privs, policies: policies.map((p) => p.policyname),
    fks: cons.filter((c) => c.contype === 'f').length, checks: cons.filter((c) => c.contype === 'c').length, rows,
  };
}

async function state(db) {
  const cols = await db.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'event_series' AND column_name = ANY($1::text[])`,
    Object.keys(SERIES_COLUMNS));
  const out = { series: { cols }, tables: {} };
  for (const t of Object.keys(TABLES)) out.tables[t] = await tableState(db, t);
  // How many event_series rows exist (names/counts only); the new columns must not change them.
  const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM event_series`);
  out.seriesRows = n;
  return out;
}

function problems(s) {
  const out = [];
  const got = Object.fromEntries(s.series.cols.map((c) => [c.column_name, c]));
  for (const [c, [t, nullable]] of Object.entries(SERIES_COLUMNS)) {
    if (!got[c]) { out.push(`event_series.${c} missing`); continue; }
    if (got[c].data_type !== t) out.push(`event_series.${c}: expected ${t}, got ${got[c].data_type}`);
    if ((got[c].is_nullable === 'YES') !== nullable) out.push(`event_series.${c}: nullability differs`);
  }
  for (const [table, spec] of Object.entries(TABLES)) {
    const ts = s.tables[table];
    if (!ts.exists) { out.push(`${table} does not exist`); continue; }
    const tg = Object.fromEntries(ts.cols.map((c) => [c.column_name, c]));
    for (const [c, [t, nullable]] of Object.entries(spec.columns)) {
      if (!tg[c]) { out.push(`${table}.${c} missing`); continue; }
      if (tg[c].data_type !== t) out.push(`${table}.${c}: expected ${t}, got ${tg[c].data_type}`);
      if ((tg[c].is_nullable === 'YES') !== nullable) out.push(`${table}.${c}: nullability differs`);
    }
    for (const name of spec.indexes) if (!ts.idx[name]) out.push(`index ${name} missing`);
    if (ts.fks !== spec.fks) out.push(`${table}: expected ${spec.fks} foreign key(s), got ${ts.fks}`);
    if (ts.checks !== spec.checks) out.push(`${table}: expected ${spec.checks} check constraint(s), got ${ts.checks}`);
    if (!ts.rls) out.push(`${table}: row level security is OFF`);
    for (const role of ROLES) if (ts.privs[role].length) out.push(`${table}: ${role} holds ${ts.privs[role].join('/')}`);
    if (ts.policies.length) out.push(`${table}: unexpected policies: ${ts.policies.join(', ')}`);
  }
  return out;
}

function print(s) {
  const got = new Set(s.series.cols.map((c) => c.column_name));
  const have = Object.keys(SERIES_COLUMNS).filter((c) => got.has(c));
  console.log(`  event_series: ${s.seriesRows} row(s); ${have.length}/${Object.keys(SERIES_COLUMNS).length} new columns present`);
  const missing = Object.keys(SERIES_COLUMNS).filter((c) => !got.has(c));
  if (missing.length) console.log(`    missing: ${missing.join(', ')}`);
  for (const [t, ts] of Object.entries(s.tables)) {
    if (!ts.exists) { console.log(`  ${t}: does not exist`); continue; }
    console.log(`  ${t}: exists, ${ts.rows} row(s), ${ts.cols.length} columns`);
    for (const name of TABLES[t].indexes) console.log(`    index ${name}: ${ts.idx[name] ? 'present' : 'MISSING'}`);
    console.log(`    foreign keys: ${ts.fks}, check constraints: ${ts.checks}`);
    console.log(`    RLS: ${ts.rls ? 'on' : 'OFF'}; policies: ${ts.policies.length ? ts.policies.join(', ') : 'none'}`);
    for (const role of ROLES) console.log(`    ${role}: ${ts.privs[role].length ? ts.privs[role].join('/') : 'no privileges'}`);
  }
}

/**
 * Names of the new event_series columns that hold data: any non-null value, except the two NOT NULL
 * defaulted columns, which count only when they differ from their default (config_version <> 1,
 * site_aliases <> '{}'). Existing columns only; counts, never values.
 */
async function columnsHoldingData(db) {
  const present = (await db.$queryRawUnsafe(
    `SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'event_series' AND column_name = ANY($1::text[])`,
    Object.keys(SERIES_COLUMNS))).map((r) => r.column_name);
  const held = [];
  for (const c of present) {
    const cond = c === 'config_version' ? `"${c}" <> 1` : c === 'site_aliases' ? `cardinality("${c}") > 0` : `"${c}" IS NOT NULL`;
    const [{ n }] = await db.$queryRawUnsafe(`SELECT count(*)::int AS n FROM event_series WHERE ${cond}`);
    if (n > 0) held.push(`${c}=${n}`);
  }
  return held;
}

function target() {
  try {
    const u = new URL(process.env.DATABASE_URL);
    return `${u.hostname}:${u.port || 5432}${u.pathname}`;
  } catch {
    return '(DATABASE_URL unparseable)';
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL not set (run with node --env-file=.env)');
  const prisma = new PrismaClient();
  try {
    const stmts = splitStatements(fs.readFileSync(MIGRATION, 'utf8'));
    console.log(`\n=== wl_self_serve (${MODE.toUpperCase()}${MODE === 'dry' ? ', read-only' : ''}) ===`);
    console.log(`target: ${target()}`);
    console.log('\ncurrent state:');
    const before = await state(prisma);
    print(before);
    const pb = problems(before);

    if (MODE === 'dry') {
      console.log('\n--apply would run, in ONE transaction (SET LOCAL lock_timeout = 5s, statement_timeout = 30s):');
      for (const s of stmts) console.log(`  ${s.replace(/\s+/g, ' ').slice(0, 150)}${s.replace(/\s+/g, ' ').length > 150 ? ' ...' : ''};`);
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
    const busy = Object.entries(before.tables).filter(([, t]) => t.exists && t.rows > 0).map(([n, t]) => `${n}=${t.rows}`);
    if (busy.length && !FORCE) {
      throw new Error(`rows exist (${busy.join(', ')}). Revert the backend code first, or pass --force.`);
    }
    const held = await columnsHoldingData(prisma);
    if (held.length && !FORCE) {
      throw new Error(`event_series columns hold data (${held.join(', ')}). Dropping them loses it; pass --force to proceed.`);
    }
    await prisma.$transaction(async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL lock_timeout = '5s'`);
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "series_admins"`);
      await tx.$executeRawUnsafe(`DROP TABLE IF EXISTS "series_audit"`);
      for (const c of Object.keys(SERIES_COLUMNS)) {
        await tx.$executeRawUnsafe(`ALTER TABLE "event_series" DROP COLUMN IF EXISTS "${c}"`);
      }
    }, TX_OPTS);
    const after = await state(prisma);
    const left = Object.entries(after.tables).filter(([, t]) => t.exists).map(([n]) => n);
    if (left.length || after.series.cols.length) throw new Error('objects still exist after rollback');
    console.log('\nOK: rolled back.');
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error('FAILED:', e.message);
    process.exit(1);
  });
}

module.exports = { MODE, MIGRATION, SERIES_COLUMNS, TABLES, splitStatements, problems, columnsHoldingData };
