#!/usr/bin/env node
/**
 * claim-later-nft: apply backend/prisma/migrations/20261117_nft_claims/migration.sql
 * (new table `nft_claims` + indexes, RLS on, no anon/authenticated grants). This runner
 * executes the migration FILE (single source of truth). Additive and idempotent
 * (CREATE ... IF NOT EXISTS, REVOKE is a no-op when nothing is granted).
 *
 * APPLY TO PROD BEFORE MERGING the PR: the claim routes, cron and the my-guest claim card
 * read this table (my-guest degrades gracefully, the rest 500 without it), and CI
 * schema-drift fails until it exists.
 *
 * Modes (default is a read-only dry run):
 *   (none)       dry run, read-only: connection target, current state of the table / indexes /
 *                RLS / anon+authenticated privileges, and the statements --apply would run.
 *   --apply      the migration in ONE transaction (SET LOCAL lock_timeout + statement_timeout),
 *                verify() inside (throws -> rollback), re-verify after commit.
 *   --rollback   DROP TABLE nft_claims (one transaction). Only after the backend code that uses
 *                it has been reverted. Refuses while any row exists unless --force.
 *
 *   cd backend && node --env-file=.env scripts/apply-nft-claims.cjs [--apply|--rollback [--force]]
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
const TABLE = 'nft_claims';
const INDEXES = [
  'nft_claims_token_hash_key',
  'nft_claims_party_id_idx',
  'nft_claims_status_minting_started_at_idx',
  'nft_claims_minted_at_idx',
];
const ROLES = ['anon', 'authenticated'];
const MIGRATION = path.join(__dirname, '../prisma/migrations/20261117_nft_claims/migration.sql');
// column -> [data_type, nullable]
const EXPECTED_COLUMNS = {
  guest_id: ['uuid', false],
  party_id: ['uuid', false],
  token_hash: ['text', true],
  token_expires_at: ['timestamp with time zone', true],
  status: ['text', false],
  source: ['text', false],
  recipient_address: ['text', true],
  recipient_input: ['text', true],
  previous_address: ['text', true],
  attempts: ['integer', false],
  last_error: ['text', true],
  minting_started_at: ['timestamp with time zone', true],
  minted_at: ['timestamp with time zone', true],
  tx_hash: ['text', true],
  token_id: ['integer', true],
  email_sent_at: ['timestamp with time zone', true],
  email_resend_id: ['text', true],
  created_at: ['timestamp with time zone', false],
  updated_at: ['timestamp with time zone', false],
};
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
              has_table_privilege($1, rel, 'TRUNCATE') AS trunc FROM r`, role, TABLE);
    privs[role] = Object.entries({ SELECT: p.sel, INSERT: p.ins, UPDATE: p.upd, DELETE: p.del, TRUNCATE: p.trunc })
      .filter(([, v]) => v).map(([k]) => k);
  }
  const policies = await db.$queryRawUnsafe(`SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = $1`, TABLE);
  const fks = await db.$queryRawUnsafe(
    `SELECT conname FROM pg_constraint WHERE conrelid = ('public.' || $1)::regclass AND contype = 'f' ORDER BY conname`, TABLE);
  const [{ rows, minted }] = await db.$queryRawUnsafe(
    `SELECT count(*)::int AS rows, count(*) FILTER (WHERE status = 'minted')::int AS minted FROM ${TABLE}`);
  return { exists: true, cols, rls, idx, privs, policies: policies.map((p) => p.policyname), fks: fks.map((f) => f.conname), rows, minted };
}

function problems(s) {
  const out = [];
  if (!s.exists) return [`${TABLE} does not exist`];
  const got = Object.fromEntries(s.cols.map((c) => [c.column_name, c]));
  for (const [c, [t, nullable]] of Object.entries(EXPECTED_COLUMNS)) {
    if (!got[c]) { out.push(`column ${c} missing`); continue; }
    if (got[c].data_type !== t) out.push(`column ${c}: expected ${t}, got ${got[c].data_type}`);
    if ((got[c].is_nullable === 'YES') !== nullable) out.push(`column ${c}: nullability differs`);
  }
  for (const name of INDEXES) if (!s.idx[name]) out.push(`index ${name} missing`);
  if (s.fks.length !== 2) out.push(`expected 2 foreign keys (guests, parties), got ${s.fks.length}`);
  if (!s.rls) out.push('row level security is OFF');
  for (const role of ROLES) if (s.privs[role].length) out.push(`${role} holds ${s.privs[role].join('/')}`);
  if (s.policies.length) out.push(`unexpected policies: ${s.policies.join(', ')}`);
  return out;
}

function print(s) {
  if (!s.exists) { console.log(`  ${TABLE}: does not exist`); return; }
  console.log(`  ${TABLE}: exists, ${s.rows} row(s), ${s.minted} minted`);
  console.log(`  columns: ${s.cols.map((c) => `${c.column_name} ${c.data_type}${c.is_nullable === 'NO' ? ' not null' : ''}`).join(', ')}`);
  for (const name of INDEXES) console.log(`  index ${name}: ${s.idx[name] ? 'present' : 'MISSING'}`);
  console.log(`  foreign keys: ${s.fks.join(', ') || 'none'}`);
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
    console.log(`\n=== nft_claims (${MODE.toUpperCase()}${MODE === 'dry' ? ', read-only' : ''}) ===`);
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
    if (before.rows > 0 && !FORCE) {
      throw new Error(`${before.rows} row(s) exist (${before.minted} minted). Revert the backend code first, or pass --force.`);
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
