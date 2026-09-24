#!/usr/bin/env node
/**
 * salame-92110 follow-up: fail PRs that add a new table without locking it down.
 *
 * Supabase auto-exposes every public-schema table through PostgREST, and new
 * tables inherit default SELECT privileges for the `anon` role. Unless a
 * migration ENABLEs Row Level Security or REVOKEs `anon`, the table is
 * world-readable by unauthenticated clients. This is exactly how `tax_forms`
 * leaked SSN/EIN + signatures (see backend/prisma/migrations/
 * 20260924_taxform_rls_lockdown/migration.sql).
 *
 * This check scans the migration SQL ADDED in the current PR. For every newly
 * CREATEd table it requires the same PR to also either:
 *   - ALTER TABLE <t> ENABLE ROW LEVEL SECURITY, or
 *   - REVOKE ... ON <t> FROM anon
 * Tables listed in scripts/rls-check-allowlist.json are exempt (intentionally
 * public).
 *
 * Static + git-diff based — no DB access needed. Run in CI on PRs; runnable
 * locally with:  BASE_SHA=origin/master node scripts/check-rls-on-new-tables.js
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const MIGRATION_DIRS = ['supabase/migrations', 'backend/prisma/migrations'];
const BASE = process.env.BASE_SHA || process.env.BASE_REF || 'origin/master';

function loadAllowlist() {
  try {
    const raw = fs.readFileSync(path.join(__dirname, 'rls-check-allowlist.json'), 'utf8');
    return new Set((JSON.parse(raw).allow || []).map((s) => s.toLowerCase()));
  } catch (_) {
    return new Set();
  }
}

function addedMigrationText() {
  let diff = '';
  for (const range of [`${BASE}...HEAD`, `${BASE}`]) {
    try {
      diff = execSync(`git diff ${range} -- ${MIGRATION_DIRS.join(' ')}`, {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
      });
      break;
    } catch (_) {
      /* try next range form */
    }
  }
  return diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .map((l) => l.slice(1))
    .join('\n');
}

function normTable(raw) {
  let t = raw.replace(/"/g, '').trim();
  if (t.includes('.')) t = t.split('.').pop();
  return t.toLowerCase();
}

function collect(re, text) {
  const out = new Set();
  let m;
  while ((m = re.exec(text))) out.add(normTable(m[1]));
  return out;
}

function main() {
  const text = addedMigrationText();

  const newTables = collect(
    /create\s+table\s+(?:if\s+not\s+exists\s+)?("?[\w.]+"?)/gi,
    text,
  );

  if (newTables.size === 0) {
    console.log('✓ RLS check: no new tables added in this PR.');
    return;
  }

  const secured = new Set([
    ...collect(/alter\s+table\s+("?[\w.]+"?)\s+enable\s+row\s+level\s+security/gi, text),
    ...collect(/revoke\s+[^;]*\son\s+("?[\w.]+"?)\s+from\s+[^;]*\banon\b/gi, text),
  ]);

  const allow = loadAllowlist();
  const violations = [...newTables].filter((t) => !secured.has(t) && !allow.has(t));

  if (violations.length) {
    console.error('\n✗ RLS check FAILED — new table(s) added without RLS or an `anon` REVOKE:\n');
    violations.forEach((t) => console.error(`   - ${t}`));
    console.error('\nSupabase exposes public tables to the `anon` role via PostgREST. In the');
    console.error('migration that CREATEs each table above, add ONE of:');
    console.error('   ALTER TABLE "<table>" ENABLE ROW LEVEL SECURITY;   -- then add policies');
    console.error('   REVOKE ALL ON "<table>" FROM anon;                 -- if never client-read');
    console.error('Or, if the table is intentionally public, add it to');
    console.error('scripts/rls-check-allowlist.json.');
    console.error('\nContext: the tax_forms SSN/EIN leak (20260924_taxform_rls_lockdown).\n');
    process.exit(1);
  }

  console.log(
    `✓ RLS check passed — all ${newTables.size} new table(s) enable RLS or revoke anon.`,
  );
}

main();
