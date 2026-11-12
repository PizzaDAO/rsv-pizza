#!/usr/bin/env node
/**
 * party-password-hash backfill: replace legacy plaintext values in
 * parties.password / report_password / venue_report_password with bcrypt hashes
 * (cost 10, same as backend/src/lib/secretHash.ts).
 *
 * DRY RUN by default (read-only): prints, per column, how many values are set and how many are
 * not bcrypt yet. Counts only; values are NEVER printed (not even lengths).
 *
 *   node backend/scripts/apply-hash-party-passwords.cjs                 # dry run
 *   node backend/scripts/apply-hash-party-passwords.cjs --apply         # hash in place
 *   node backend/scripts/apply-hash-party-passwords.cjs --apply --rollback-file [path]
 *
 * --apply
 *   For each column: read `id, <col>` where the value is set and is not a bcrypt hash, hash each
 *   value in Node, then in ONE transaction per column run
 *     UPDATE parties SET <col> = $hash WHERE id = $id AND <col> = $old
 *   (optimistic: if a host changed the value meanwhile, their write wins and the row is skipped).
 *   Afterwards re-counts and exits 1 if any non-bcrypt value remains.
 *   Empty strings ('') are left alone and reported separately: hashing '' would turn "no usable
 *   password" into a real one.
 *
 * --rollback-file [path]  (optional, off by default; only with --apply)
 *   Before any UPDATE, writes [{ id, col, old }] to a file OUTSIDE the repo, mode 600.
 *   Default path: ~/.rsv-pizza-secret-rollback/<timestamp>.json. It holds plaintext secrets:
 *   delete it after the 7-day verify window. Without it, rollback means hosts set new passwords.
 *
 * Run only AFTER party-password-hash (PR3) is live on the prod backend: older code compares
 * plaintext and would lock every protected event once its value is hashed.
 *
 * No session SET / SET ROLE: DATABASE_URL is the 6543 transaction pooler. Parameterized
 * statements only; column names come from the fixed list below.
 */
require('dotenv').config();
const fs = require('fs');
const os = require('os');
const path = require('path');
const bcrypt = require('bcryptjs');
const { PrismaClient } = require('@prisma/client');

const COLUMNS = ['password', 'report_password', 'venue_report_password'];
const COST = 10;
// Same shape as isBcryptHash in backend/src/lib/secretHash.ts.
const BCRYPT_RE_JS = /^\$2[aby]\$\d{2}\$[./A-Za-z0-9]{53}$/;
const BCRYPT_RE_SQL = '^\\$2[aby]\\$[0-9]{2}\\$[./A-Za-z0-9]{53}$';
const REPO_ROOT = path.resolve(__dirname, '..', '..');

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const rbIdx = args.indexOf('--rollback-file');
const ROLLBACK = rbIdx !== -1;
const ROLLBACK_ARG = ROLLBACK && args[rbIdx + 1] && !args[rbIdx + 1].startsWith('--') ? args[rbIdx + 1] : null;

const prisma = new PrismaClient();

async function counts() {
  const out = {};
  for (const col of COLUMNS) {
    // `col` is from the fixed COLUMNS list, never user input.
    const r = await prisma.$queryRawUnsafe(
      `SELECT count(*) FILTER (WHERE ${col} IS NOT NULL)::int AS total_non_null,
              count(*) FILTER (WHERE ${col} = '')::int AS empty_string,
              count(*) FILTER (WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} !~ $1)::int AS not_bcrypt
       FROM parties`,
      BCRYPT_RE_SQL,
    );
    out[col] = r[0];
  }
  return out;
}

function printCounts(label, c) {
  console.log(label);
  for (const col of COLUMNS) {
    const x = c[col];
    console.log(`  ${col.padEnd(22)} total non-null=${x.total_non_null}  not yet bcrypt=${x.not_bcrypt}  empty ''=${x.empty_string}`);
  }
}

function rollbackPath() {
  const p = path.resolve(
    ROLLBACK_ARG || path.join(os.homedir(), '.rsv-pizza-secret-rollback', `${new Date().toISOString().replace(/[:.]/g, '-')}.json`),
  );
  const rel = path.relative(REPO_ROOT, p);
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`--rollback-file must be outside the repo (${REPO_ROOT})`);
  }
  return p;
}

function writeRollback(file, entries) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  // 'wx': never overwrite an existing file.
  fs.writeFileSync(file, JSON.stringify(entries, null, 2), { mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
  console.log(`rollback file written: ${file} (${entries.length} entries, mode 600). Delete it after the verify window.`);
}

async function main() {
  console.log(`\n=== hash party passwords (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  if (ROLLBACK && !APPLY) console.log('(--rollback-file is ignored without --apply)\n');

  const before = await counts();
  printCounts('now:', before);
  const pending = COLUMNS.reduce((n, col) => n + before[col].not_bcrypt, 0);

  if (!APPLY) {
    console.log(`\n${pending} value(s) would be hashed. Dry run only; re-run with --apply.`);
    return;
  }
  if (pending === 0) {
    console.log('\nNothing to hash.');
    return;
  }

  // 1. Read every pending value and hash it in Node, before touching the DB.
  const plan = {};
  const rollbackEntries = [];
  for (const col of COLUMNS) {
    const rows = await prisma.$queryRawUnsafe(
      `SELECT id::text AS id, ${col} AS v FROM parties
       WHERE ${col} IS NOT NULL AND ${col} <> '' AND ${col} !~ $1`,
      BCRYPT_RE_SQL,
    );
    plan[col] = [];
    for (const r of rows) {
      if (BCRYPT_RE_JS.test(r.v)) continue; // belt and braces
      plan[col].push({ id: r.id, old: r.v, hash: await bcrypt.hash(r.v, COST) });
      if (ROLLBACK) rollbackEntries.push({ id: r.id, col, old: r.v });
    }
    console.log(`  ${col}: ${plan[col].length} hashed in memory`);
  }

  // 2. Optional rollback file, written before any UPDATE.
  if (ROLLBACK) writeRollback(rollbackPath(), rollbackEntries);

  // 3. One transaction per column; optimistic per-row UPDATE.
  for (const col of COLUMNS) {
    const items = plan[col];
    if (!items.length) continue;
    const res = await prisma.$transaction(async (tx) => {
      let updated = 0;
      let skipped = 0;
      for (const it of items) {
        const n = await tx.$executeRawUnsafe(
          `UPDATE parties SET ${col} = $1 WHERE id = $2::uuid AND ${col} = $3`,
          it.hash, it.id, it.old,
        );
        if (n === 1) updated += 1; else skipped += 1;
      }
      return { updated, skipped };
    }, { timeout: 120000, maxWait: 20000 });
    console.log(`  ${col}: updated=${res.updated} skipped (changed concurrently)=${res.skipped}`);
  }

  // 4. Re-verify.
  const after = await counts();
  printCounts('\nafter:', after);
  const left = COLUMNS.reduce((n, col) => n + after[col].not_bcrypt, 0);
  if (left > 0) {
    console.log(`\nFAIL ${left} non-bcrypt value(s) remain (a concurrent edit by old code, or a write path that skips hashing). Investigate, then re-run.`);
    process.exit(1);
  }
  console.log('\nOK   every set password is a bcrypt hash');
}

main()
  .catch((e) => { console.error('FAILED:', e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
