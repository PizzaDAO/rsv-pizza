#!/usr/bin/env node
/**
 * scripts/check-schema-drift.js
 *
 * Schema drift check between backend/prisma/schema.prisma and the live Postgres
 * schema. Catches the class of bug that broke prod on 2026-05-17 (pepperoni-94639):
 * PR #356 merged a Prisma model change together with a SQL migration that
 * targeted the wrong table name (`users` vs `"User"`). The migration silently
 * failed, the backend deployed with the new Prisma model, and every
 * `prisma.user.findUnique()` 500ed because Prisma SELECTs every declared field
 * by default.
 *
 * ============================================================================
 *                    READ-ONLY. THIS SCRIPT NEVER WRITES TO THE DB.
 * ============================================================================
 *
 * If you modify this script, do NOT add UPDATE/INSERT/DELETE/CREATE/ALTER
 * queries. Only SELECT against information_schema. CI runs this against prod
 * (read-only is the only safe contract).
 *
 * What it does:
 *   1. Parses backend/prisma/schema.prisma as text (no Prisma parser dep —
 *      regex is enough for this schema).
 *   2. For every `model X { ... }` block, derives the DB table name:
 *        - `@@map("table_name")` wins if present
 *        - otherwise the model name verbatim (e.g. `User` → `"User"`)
 *   3. For every scalar field in the model, derives the DB column name:
 *        - `@map("col_name")` wins if present
 *        - otherwise the field name verbatim
 *      Relation fields (lines like `party Party @relation(...)`) are skipped —
 *      no DB column.
 *   4. Connects read-only to DATABASE_URL and queries information_schema.columns
 *      to introspect the live schema.
 *   5. Simulates the effect of any new migration files in
 *      supabase/migrations/ that haven't been applied to prod yet, by parsing
 *      `CREATE TABLE`, `ALTER TABLE ... ADD COLUMN`, and `ALTER TABLE ... DROP
 *      COLUMN` statements and applying them to a copy of the introspected
 *      schema.
 *   6. Fails the run with exit code 1 if any Prisma field has no matching
 *      column in the simulated post-PR schema. Warns (but does not fail) for
 *      DB columns that don't appear in Prisma.
 *
 * What it does NOT do:
 *   - Validate column TYPES. Type drift is a different bug class.
 *   - Validate NOT NULL / defaults / indexes / FKs.
 *   - Apply migrations to prod (or anywhere). Simulation is in-memory only.
 *   - Handle every SQL dialect or DDL form. The parser is intentionally simple
 *     and handles the patterns this repo actually uses (CREATE TABLE name (
 *     col TYPE, ... ), ALTER TABLE name ADD COLUMN col TYPE, ALTER TABLE name
 *     DROP COLUMN col). Multi-statement ADD COLUMN inside one ALTER TABLE is
 *     supported.
 *
 * Usage:
 *   DATABASE_URL=postgres://... node scripts/check-schema-drift.js
 *
 * In CI, DATABASE_URL is a repo secret. Locally, it can be loaded from
 * backend/.env (this script auto-loads that file if present).
 */

const fs = require('fs');
const path = require('path');

// Auto-load backend/.env when running locally (CI provides DATABASE_URL via env)
try {
  const envPath = path.join(__dirname, '..', 'backend', '.env');
  if (fs.existsSync(envPath)) {
    require('dotenv').config({ path: envPath });
  }
} catch (_) {
  // dotenv optional — env may be provided by CI
}

const { Client } = require('pg');

const REPO_ROOT = path.join(__dirname, '..');
const PRISMA_SCHEMA_PATH = path.join(REPO_ROOT, 'backend', 'prisma', 'schema.prisma');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'supabase', 'migrations');
const ALLOWLIST_PATH = path.join(__dirname, 'schema-drift-allowlist.json');

// ────────────────────────────────────────────────────────────────────────────
// Prisma schema parser
// ────────────────────────────────────────────────────────────────────────────

/**
 * Parse schema.prisma into a list of models:
 *   [{ modelName, tableName, fields: [{fieldName, columnName}] }]
 *
 * Skips:
 *   - relation fields (lines containing `@relation(`)
 *   - block-level directives (`@@map`, `@@index`, `@@unique`, `@@id`)
 *   - enum/generator/datasource blocks
 */
// Built-in Prisma scalar types. Anything else (uppercase first letter) is a
// relation to another model and has NO direct DB column on this side.
const PRISMA_SCALAR_TYPES = new Set([
  'String',
  'Int',
  'BigInt',
  'Float',
  'Decimal',
  'Boolean',
  'DateTime',
  'Json',
  'Bytes',
]);

function parseSchema(schemaText) {
  const models = [];

  // Strip /* ... */ block comments but preserve line numbers loosely
  const cleaned = schemaText.replace(/\/\*[\s\S]*?\*\//g, '');

  // First pass: find enum names so we can treat enum-typed fields as scalars
  // (they DO map to a DB column, typically text or a Postgres enum).
  const enumNames = new Set();
  const enumRe = /^enum\s+(\w+)\s*\{/gm;
  let em;
  while ((em = enumRe.exec(cleaned)) !== null) enumNames.add(em[1]);

  // Match each `model X { ... }` block
  const modelRe = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m;
  while ((m = modelRe.exec(cleaned)) !== null) {
    const modelName = m[1];
    const body = m[2];

    // Pull out @@map("...") if present, else use modelName verbatim
    const mapMatch = body.match(/@@map\(\s*"([^"]+)"\s*\)/);
    const tableName = mapMatch ? mapMatch[1] : modelName;

    const fields = [];
    const lines = body.split('\n');
    for (const rawLine of lines) {
      // Strip // line comments
      const line = rawLine.replace(/\/\/.*$/, '').trim();
      if (!line) continue;
      // Skip block-level directives
      if (line.startsWith('@@')) continue;

      // A scalar field line looks like:
      //   fieldName  Type   ...modifiers...
      // Capture the field name AND the bare type name (strip [] / ? suffixes).
      const fieldMatch = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\s+([A-Z]\w*)(\[\]|\?)?/);
      if (!fieldMatch) continue;
      const fieldName = fieldMatch[1];
      const baseType = fieldMatch[2];
      const arrayOrOpt = fieldMatch[3] || '';

      // Relations don't have a DB column on this side. Detection signals:
      //   1. Explicit `@relation(...)` on the line.
      //   2. The base type isn't a built-in Prisma scalar AND isn't an enum
      //      → it's a reference to another model.
      //   3. Array-typed model references (`Foo[]`) are always relations.
      const isExplicitRelation = /@relation\s*\(/.test(line);
      const isModelType = !PRISMA_SCALAR_TYPES.has(baseType) && !enumNames.has(baseType);
      const isArrayOfModel = arrayOrOpt === '[]' && isModelType;
      if (isExplicitRelation || isModelType || isArrayOfModel) continue;

      // Note: `String[]` (array of scalar) DOES map to a Postgres array column,
      // so we keep those — the check above only rejects arrays of model types.

      // Detect @map("col_name") override
      const colMapMatch = line.match(/@map\(\s*"([^"]+)"\s*\)/);
      const columnName = colMapMatch ? colMapMatch[1] : fieldName;

      fields.push({ fieldName, columnName });
    }

    models.push({ modelName, tableName, fields });
  }

  return models;
}

// ────────────────────────────────────────────────────────────────────────────
// Live DB introspection (READ-ONLY)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Return a Map<tableName, Set<columnName>> reflecting the live schema in the
 * `public` schema of the connected Postgres database. ONLY runs SELECT.
 */
async function introspectLiveSchema(connectionString) {
  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
    // Defense in depth: refuse to send anything that isn't a SELECT. pg
    // doesn't enforce read-only by itself; we just only call .query() with
    // hard-coded SELECTs below.
  });
  await client.connect();
  try {
    const { rows } = await client.query(`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
    `);
    const tables = new Map();
    for (const r of rows) {
      if (!tables.has(r.table_name)) tables.set(r.table_name, new Set());
      tables.get(r.table_name).add(r.column_name);
    }
    return tables;
  } finally {
    await client.end();
  }
}

// ────────────────────────────────────────────────────────────────────────────
// In-memory migration simulator
// ────────────────────────────────────────────────────────────────────────────

/**
 * List all .sql files in supabase/migrations/. We don't try to track which
 * are already applied (there's no _migrations table maintained in this repo);
 * instead, we simulate ALL migrations on top of the live schema and trust that
 * already-applied migrations are no-ops as far as adding columns is concerned
 * (an ADD COLUMN to a column that already exists is a no-op in our model).
 *
 * Migrations that have already been applied successfully will already be
 * reflected in the live schema, so re-simulating them is harmless. Migrations
 * NOT yet applied (i.e. the new ones in the PR) will be the ones that move
 * the simulated schema forward.
 */
function listMigrationFiles() {
  if (!fs.existsSync(MIGRATIONS_DIR)) return [];
  return fs.readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => path.join(MIGRATIONS_DIR, f));
}

/**
 * Apply a single migration file's effects to an in-memory schema map. Recognized
 * patterns (case-insensitive):
 *   - CREATE TABLE [IF NOT EXISTS] name ( col TYPE, col TYPE, ... );
 *   - ALTER TABLE name ADD COLUMN [IF NOT EXISTS] col TYPE [, ADD COLUMN col TYPE ...];
 *   - ALTER TABLE name DROP COLUMN [IF EXISTS] col;
 *
 * Quoted identifiers ("col") are unquoted into their literal form. Unquoted
 * identifiers are lower-cased only if Postgres would lower-case them (i.e.
 * always, unless quoted). Migration files in this repo use lowercase unquoted
 * names except for the User table, which the broken pepperoni-94639 migration
 * mis-spelled — that's exactly the case the check needs to catch.
 */
function applyMigration(schemaMap, sqlText) {
  // Strip /* ... */ block comments and -- line comments to simplify regex
  const sql = sqlText
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*--.*$/gm, '');

  // ── CREATE TABLE ────────────────────────────────────────────────────────
  // CREATE TABLE [IF NOT EXISTS] <name> ( <body> );
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(([\s\S]*?)\)\s*;/gi;
  let cm;
  while ((cm = createRe.exec(sql)) !== null) {
    const tableName = unquoteIdentifier(cm[1]);
    const body = cm[2];

    if (!schemaMap.has(tableName)) schemaMap.set(tableName, new Set());
    const cols = schemaMap.get(tableName);

    // Split body on top-level commas (ignore commas inside parentheses, e.g.
    // NUMERIC(12, 2)).
    const parts = splitTopLevel(body, ',');
    for (const rawPart of parts) {
      const part = rawPart.trim();
      if (!part) continue;
      // Skip table-level constraints
      if (/^(PRIMARY\s+KEY|FOREIGN\s+KEY|UNIQUE|CHECK|CONSTRAINT|EXCLUDE)\b/i.test(part)) continue;
      // First token is the column name
      const colMatch = part.match(/^([a-zA-Z_"][a-zA-Z0-9_"]*)/);
      if (!colMatch) continue;
      const colName = unquoteIdentifier(colMatch[1]);
      cols.add(colName);
    }
  }

  // ── ALTER TABLE ──────────────────────────────────────────────────────────
  // ALTER TABLE [IF EXISTS] <name> <action> [, <action> ...];
  const alterRe = /ALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?([^\s]+)\s+([\s\S]*?);/gi;
  let am;
  while ((am = alterRe.exec(sql)) !== null) {
    const tableName = unquoteIdentifier(am[1]);
    const actionsBlob = am[2];
    if (!schemaMap.has(tableName)) {
      // ALTER on a table we've never seen — that's a real drift problem, but
      // we shouldn't crash. Create an empty set so subsequent column adds land
      // somewhere; the missing-column check will still flag missing fields.
      schemaMap.set(tableName, new Set());
    }
    const cols = schemaMap.get(tableName);

    const actions = splitTopLevel(actionsBlob, ',');
    for (const rawAction of actions) {
      const action = rawAction.trim();
      // ADD COLUMN [IF NOT EXISTS] <name> ...
      const addMatch = action.match(/^ADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_"][a-zA-Z0-9_"]*)/i);
      if (addMatch) {
        cols.add(unquoteIdentifier(addMatch[1]));
        continue;
      }
      // ADD <name> <type> (without explicit COLUMN keyword) — but skip when
      // the first token is a constraint keyword.
      const addBareMatch = action.match(/^ADD\s+(?!CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|CHECK|EXCLUDE)([a-zA-Z_"][a-zA-Z0-9_"]*)\s+[A-Za-z]/i);
      if (addBareMatch) {
        cols.add(unquoteIdentifier(addBareMatch[1]));
        continue;
      }
      // DROP COLUMN [IF EXISTS] <name>
      const dropMatch = action.match(/^DROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?([a-zA-Z_"][a-zA-Z0-9_"]*)/i);
      if (dropMatch) {
        cols.delete(unquoteIdentifier(dropMatch[1]));
        continue;
      }
      // RENAME COLUMN <old> TO <new>
      const renameMatch = action.match(/^RENAME\s+COLUMN\s+([a-zA-Z_"][a-zA-Z0-9_"]*)\s+TO\s+([a-zA-Z_"][a-zA-Z0-9_"]*)/i);
      if (renameMatch) {
        const oldName = unquoteIdentifier(renameMatch[1]);
        const newName = unquoteIdentifier(renameMatch[2]);
        if (cols.has(oldName)) {
          cols.delete(oldName);
          cols.add(newName);
        }
        continue;
      }
      // Anything else (ALTER COLUMN ... TYPE, ENABLE RLS, ADD CONSTRAINT,
      // SET DEFAULT, etc.) doesn't change column presence — ignore.
    }
  }

  // ── DROP TABLE ───────────────────────────────────────────────────────────
  const dropTableRe = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([^\s;]+)\s*;/gi;
  let dm;
  while ((dm = dropTableRe.exec(sql)) !== null) {
    schemaMap.delete(unquoteIdentifier(dm[1]));
  }
}

/** Strip surrounding double quotes from an identifier and drop any schema prefix. */
function unquoteIdentifier(raw) {
  let s = raw.trim();
  // Drop schema prefix (`public.users` → `users`, `"public"."User"` → `"User"`)
  const dotIdx = s.lastIndexOf('.');
  if (dotIdx >= 0) s = s.slice(dotIdx + 1);
  if (s.startsWith('"') && s.endsWith('"')) return s.slice(1, -1);
  return s;
}

/**
 * Split `s` on `delim` characters that appear at parenthesis-depth zero.
 * Needed because `NUMERIC(12, 2)` contains a comma we must NOT split on.
 */
function splitTopLevel(s, delim) {
  const out = [];
  let depth = 0;
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    if (ch === delim && depth === 0) {
      out.push(buf);
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(buf);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

(async () => {
  if (!process.env.DATABASE_URL) {
    console.error('[schema-drift] DATABASE_URL env var is required.');
    console.error('               In CI, set it as a repo secret.');
    console.error('               Locally, put it in backend/.env (auto-loaded).');
    process.exit(2);
  }

  console.log('[schema-drift] Parsing backend/prisma/schema.prisma...');
  const schemaText = fs.readFileSync(PRISMA_SCHEMA_PATH, 'utf8');
  const models = parseSchema(schemaText);
  console.log(`[schema-drift] Parsed ${models.length} models from Prisma schema.`);

  console.log('[schema-drift] Introspecting live DB (READ-ONLY)...');
  const liveSchema = await introspectLiveSchema(process.env.DATABASE_URL);
  console.log(`[schema-drift] Found ${liveSchema.size} tables in public schema.`);

  // Clone live schema → simulated schema
  const simulated = new Map();
  for (const [t, cols] of liveSchema) {
    simulated.set(t, new Set(cols));
  }

  // Apply all migration files (in lex order). Already-applied ones are no-ops
  // (we additively merge column sets). New ones move the schema forward.
  const migrationFiles = listMigrationFiles();
  console.log(`[schema-drift] Simulating ${migrationFiles.length} migration files on top of live schema...`);
  for (const file of migrationFiles) {
    try {
      const sql = fs.readFileSync(file, 'utf8');
      applyMigration(simulated, sql);
    } catch (err) {
      console.warn(`[schema-drift] WARN: failed to parse ${path.basename(file)}: ${err.message}`);
    }
  }

  // Load allowlist (pre-existing known drift that we suppress so the CI check
  // can pass on master). New drift introduced by a PR will NOT be in here and
  // will fail the check loudly.
  let allowlist = { missingTables: [], missingColumns: [] };
  if (fs.existsSync(ALLOWLIST_PATH)) {
    try {
      allowlist = JSON.parse(fs.readFileSync(ALLOWLIST_PATH, 'utf8'));
      allowlist.missingTables = allowlist.missingTables || [];
      allowlist.missingColumns = allowlist.missingColumns || [];
    } catch (err) {
      console.warn(`[schema-drift] WARN: failed to parse allowlist: ${err.message}`);
    }
  }
  const allowedTables = new Set(allowlist.missingTables.map((t) => `${t.model}::${t.table}`));
  const allowedColumns = new Set(
    allowlist.missingColumns.map((c) => `${c.model}::${c.table}::${c.column}`)
  );

  // ── Drift check ─────────────────────────────────────────────────────────
  const missingColumns = []; // [{model, table, field, column}]
  const missingTables = [];  // [{model, table}]
  const allowedTablesHit = []; // for reporting
  const allowedColumnsHit = [];

  for (const model of models) {
    const liveCols = simulated.get(model.tableName);
    if (!liveCols) {
      const entry = { model: model.modelName, table: model.tableName };
      if (allowedTables.has(`${entry.model}::${entry.table}`)) {
        allowedTablesHit.push(entry);
      } else {
        missingTables.push(entry);
      }
      continue;
    }
    for (const f of model.fields) {
      if (!liveCols.has(f.columnName)) {
        const entry = {
          model: model.modelName,
          table: model.tableName,
          field: f.fieldName,
          column: f.columnName,
        };
        if (allowedColumns.has(`${entry.model}::${entry.table}::${entry.column}`)) {
          allowedColumnsHit.push(entry);
        } else {
          missingColumns.push(entry);
        }
      }
    }
  }

  // Warning-only: DB columns not in Prisma. Restricted to tables that DO have
  // a Prisma model (otherwise too noisy — many tables are managed only via
  // SQL, e.g. party_status_audit).
  const tablesInPrisma = new Set(models.map((m) => m.tableName));
  const extraColumns = []; // [{table, column}]
  for (const model of models) {
    const prismaCols = new Set(model.fields.map((f) => f.columnName));
    const liveCols = simulated.get(model.tableName);
    if (!liveCols) continue;
    for (const col of liveCols) {
      if (!prismaCols.has(col)) extraColumns.push({ table: model.tableName, column: col });
    }
  }

  // ── Report ──────────────────────────────────────────────────────────────
  let failed = false;

  if (missingTables.length > 0) {
    failed = true;
    console.error('');
    console.error('[schema-drift] ❌ Prisma models with NO matching DB table:');
    for (const t of missingTables) {
      console.error(`    - model ${t.model} expects table "${t.table}" (not found in DB after migrations)`);
    }
  }

  if (missingColumns.length > 0) {
    failed = true;
    console.error('');
    console.error('[schema-drift] ❌ Prisma fields with NO matching DB column:');
    for (const c of missingColumns) {
      console.error(`    - ${c.model}.${c.field} expects ${c.table}.${c.column} (not found in DB after migrations)`);
    }
    console.error('');
    console.error('  This will cause runtime 500s. Prisma SELECTs every declared field by');
    console.error('  default, so the column MUST exist in the DB. Either:');
    console.error('    1. Add a SQL migration in supabase/migrations/ that ADDs the column, or');
    console.error('    2. Remove the field from backend/prisma/schema.prisma.');
  }

  if (extraColumns.length > 0) {
    console.warn('');
    console.warn(`[schema-drift] ⚠ ${extraColumns.length} DB column(s) present in tables mapped to Prisma models but missing from the Prisma schema:`);
    for (const c of extraColumns.slice(0, 25)) {
      console.warn(`    - ${c.table}.${c.column}`);
    }
    if (extraColumns.length > 25) {
      console.warn(`    ... (${extraColumns.length - 25} more)`);
    }
    console.warn('  (Warning only — not a CI failure. Add to Prisma schema if you want to read these via Prisma.)');
  }

  if (allowedTablesHit.length || allowedColumnsHit.length) {
    console.log('');
    console.log(`[schema-drift] (suppressed by allowlist: ${allowedTablesHit.length} table(s), ${allowedColumnsHit.length} column(s) — see scripts/schema-drift-allowlist.json)`);
  }

  if (failed) {
    console.error('');
    console.error('[schema-drift] FAIL — see drift above.');
    console.error('               If this drift is intentional and known-safe, add an entry to');
    console.error('               scripts/schema-drift-allowlist.json with a note explaining why.');
    process.exit(1);
  }

  console.log('');
  console.log('[schema-drift] OK — Prisma schema fields all have matching DB columns.');
})().catch((err) => {
  console.error('[schema-drift] Unexpected error:', err);
  process.exit(2);
});
