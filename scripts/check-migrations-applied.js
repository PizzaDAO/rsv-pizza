#!/usr/bin/env node
/**
 * scripts/check-migrations-applied.js
 *
 * Enforces the repo's "apply migrations to prod BEFORE merging" convention
 * (CLAUDE.md). This repo applies migrations via raw SQL (no _prisma_migrations
 * tracking), and schema-drift.js *simulates* pending migrations — which can mask
 * a migration that was committed but never applied. This check closes that gap:
 * for every migration.sql ADDED in the PR, it parses the tables/columns it
 * CREATEs/ADDs and verifies they ACTUALLY EXIST in the live DB. If not, the
 * migration hasn't been applied to prod yet → fail.
 *
 * ============================================================================
 *                    READ-ONLY. NEVER WRITES TO THE DB.
 * ============================================================================
 * Only SELECTs information_schema. Covers both supabase/migrations/** and
 * backend/prisma/migrations/**.
 *
 * Local run:  BASE_SHA=origin/master DATABASE_URL=... node scripts/check-migrations-applied.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const { Client } = require('pg');

const BASE = process.env.BASE_SHA || process.env.BASE_REF || 'origin/master';
const MIGRATION_GLOBS = ['supabase/migrations', 'backend/prisma/migrations'];

function addedMigrationFiles() {
  let out = '';
  for (const range of [`${BASE}...HEAD`, `${BASE}`]) {
    try {
      out = execSync(`git diff --name-only --diff-filter=A ${range} -- ${MIGRATION_GLOBS.join(' ')}`, {
        encoding: 'utf8', maxBuffer: 32 * 1024 * 1024,
      });
      break;
    } catch (_) { /* try next */ }
  }
  return out.split('\n').map((s) => s.trim()).filter((f) => f.endsWith('.sql'));
}

// Parse CREATE TABLE / ALTER TABLE ... ADD COLUMN targets from a migration.
function parseTargets(sql) {
  const stripped = sql.replace(/--[^\n]*/g, '');
  const tables = new Set();
  const columns = []; // { table, column }
  let m;
  const createRe = /create\s+table\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z0-9_]+)"?/gi;
  while ((m = createRe.exec(stripped))) tables.add(m[1]);
  const addColRe = /alter\s+table\s+"?([a-zA-Z0-9_]+)"?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?"?([a-zA-Z0-9_]+)"?/gi;
  while ((m = addColRe.exec(stripped))) columns.push({ table: m[1], column: m[2] });
  return { createdTables: [...tables], columns };
}

async function main() {
  const files = addedMigrationFiles();
  if (files.length === 0) {
    console.log('✓ migrations-applied: no new migration files in this PR.');
    return;
  }
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL not set — cannot verify migrations applied.');
    process.exit(1);
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const problems = [];

  for (const file of files) {
    let sql;
    try { sql = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const { createdTables, columns } = parseTargets(sql);

    for (const t of createdTables) {
      const r = await client.query(
        `SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1`, [t]);
      if (r.rowCount === 0) problems.push(`${file}: table "${t}" not found in prod (migration not applied?)`);
    }
    for (const { table, column } of columns) {
      const r = await client.query(
        `SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
        [table, column]);
      if (r.rowCount === 0) problems.push(`${file}: column "${table}"."${column}" not found in prod (migration not applied?)`);
    }
  }
  await client.end();

  if (problems.length) {
    console.error('\n✗ migrations-applied FAILED — these were committed but are NOT applied to prod:\n');
    problems.forEach((p) => console.error('   - ' + p));
    console.error('\nApply the migration(s) to prod BEFORE merging (backend auto-deploys from master and');
    console.error('Prisma SELECTs every field, so merging schema ahead of the columns 500s prod). See CLAUDE.md.');
    process.exit(1);
  }
  console.log(`✓ migrations-applied: all tables/columns from ${files.length} new migration file(s) exist in prod.`);
}

main().catch((e) => { console.error('FAILED:', e.message); process.exit(1); });
