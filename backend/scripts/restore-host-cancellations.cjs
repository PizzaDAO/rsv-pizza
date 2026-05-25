#!/usr/bin/env node
/**
 * porchetta-81402: Restore parties (and their full child cascade) that
 * hosts hard-deleted from the dashboard before the soft-cancel flow
 * shipped. The companion migration
 * `supabase/migrations/20260521_porchetta_81402_cancel_event.sql`
 * adds `cancelled_at` / `cancelled_by` / `cancellation_reason`; this
 * script populates them by replaying rows from `deletion_log` so the
 * affected events show up on the host dashboard as cancelled (not
 * lost) and keep their public URL.
 *
 * Run:
 *   node backend/scripts/restore-host-cancellations.cjs            # dry-run
 *   node backend/scripts/restore-host-cancellations.cjs --apply    # apply
 *
 * Connection:
 *   Uses `pg` + DATABASE_URL from `backend/.env`. Prisma is intentionally
 *   avoided — this script does pure SQL. `pg` is a root workspace dep,
 *   so it's already on disk after `npm install` at the repo root.
 *
 * Realtime mitigation:
 *   `guests` is in `supabase_realtime`. Bulk inserts during a restore
 *   would fan out one WAL event per guest. We DROP guests from the
 *   publication for the duration of the apply phase and ADD it back in
 *   a try/finally so the publication is restored even on error.
 *
 * Column-type encoding:
 *   Each target table's columns are introspected at runtime via
 *   `information_schema.columns` (data_type + udt_name). Values from
 *   `record_data` are encoded based on the actual column type — JSON-
 *   stringified for `jsonb`/`json`, passed through as JS arrays for
 *   `ARRAY` (node-pg handles array literal formatting), pass-through
 *   for everything else. This replaces a hand-maintained allowlist
 *   that previously misclassified several `text[]` columns as JSONB
 *   and made every party insert fail with `malformed array literal`.
 *
 * Slug collisions:
 *   - custom_url collisions get rewritten to `<original>-cancelled-<shortid>`
 *   - invite_code collisions get a fresh cuid
 *   - When safe, we insert a `slug_aliases (old_slug → restored_party_id)`
 *     row so existing links continue to resolve.
 *
 * FK insertion order: parents first → guests → grandchildren.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Client } = require('pg');

// ------------------------------------------------------------------
// CLI flags + env loading
// ------------------------------------------------------------------
const APPLY = process.argv.includes('--apply');

function loadEnv() {
  const envPath = path.join(__dirname, '..', '.env');
  if (!fs.existsSync(envPath)) {
    console.error(`[restore] ${envPath} not found. Aborting.`);
    process.exit(1);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = val;
  }
}
loadEnv();

if (!process.env.DATABASE_URL) {
  console.error('[restore] DATABASE_URL is not set in backend/.env. Aborting.');
  process.exit(1);
}

function shortid(len = 6) {
  return crypto.randomBytes(8).toString('base64url').slice(0, len);
}

// Cuid-like generator — we don't pull in cuid as a dep because this is a
// one-shot script. The format roughly matches Prisma's default cuid() so the
// `parties.invite_code` rotation collides with nothing else.
function cuidLike() {
  return 'c' + crypto.randomBytes(12).toString('hex');
}

// ------------------------------------------------------------------
// Child table insertion order (parents first). Each entry includes the
// fields we expect to find in `record_data` JSONB; we filter on insert
// time to drop generated columns / unknown columns gracefully.
// ------------------------------------------------------------------
const CHILD_TABLES_IN_ORDER = [
  'venues',
  'venue_photos',
  'party_kits',
  'guests',
  'sponsors',
  'budget_items',
  'checklist_items',
  'staff',
  'performers',
  'displays',
  'raffles',
  'raffle_prizes',
  'raffle_entries',
  'raffle_winners',
  'photos',
  'notable_attendees',
  'social_posts',
  'orders',
  'donations',
  'sponsor_checklist_items',
  'partner_event_notes',
];

// Generated columns we must NOT try to insert into. Currently only
// co_hosts_public on parties (sanitize_co_hosts(co_hosts)).
const GENERATED_COLUMNS_BY_TABLE = {
  parties: new Set(['co_hosts_public']),
};

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------
async function fetchTableColumns(client, tableName) {
  const res = await client.query(
    `
    SELECT column_name, is_generated, data_type, udt_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = $1
    `,
    [tableName],
  );
  const live = new Set();
  const generated = new Set();
  const types = new Map();
  for (const row of res.rows) {
    if (row.is_generated === 'ALWAYS') {
      generated.add(row.column_name);
    } else {
      live.add(row.column_name);
    }
    types.set(row.column_name, { data_type: row.data_type, udt_name: row.udt_name });
  }
  // Merge static knowledge so an env without the column metadata still
  // sees `co_hosts_public` as generated.
  const staticallyKnown = GENERATED_COLUMNS_BY_TABLE[tableName];
  if (staticallyKnown) {
    for (const col of staticallyKnown) generated.add(col);
  }
  return { live, generated, types };
}

function encodeArrayValue(val) {
  // node-pg formats JS arrays into Postgres array literals natively, so the
  // preferred shape is a JS array.
  if (val === null || val === undefined) return null;
  if (Array.isArray(val)) return val;
  if (typeof val === 'string') {
    // record_data may already contain a JSON-shaped string (e.g. '["a","b"]').
    const trimmed = val.trim();
    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
      } catch {
        // Fall through — wrap as a single-element array below.
      }
    }
    return [val];
  }
  // Anything else (number, bool, object) — wrap as a single-element array so
  // the bind doesn't blow up; deletion_log values for ARRAY columns should
  // realistically only be arrays or null, so this is defensive.
  return [val];
}

function buildInsertParams(tableName, recordData, columnInfo) {
  const cols = [];
  const placeholders = [];
  const values = [];
  let i = 1;
  for (const [col, val] of Object.entries(recordData)) {
    if (!columnInfo.live.has(col)) continue;
    if (columnInfo.generated.has(col)) continue;
    cols.push(`"${col}"`);
    placeholders.push(`$${i++}`);
    if (val === null || val === undefined) {
      values.push(null);
      continue;
    }
    const typeInfo = columnInfo.types ? columnInfo.types.get(col) : null;
    const dataType = typeInfo ? typeInfo.data_type : null;
    if (dataType === 'jsonb' || dataType === 'json') {
      // pg's JSONB binding expects a string OR will JSONify a JS object.
      // Be explicit so arrays/objects from record_data round-trip correctly.
      values.push(JSON.stringify(val));
    } else if (dataType === 'ARRAY') {
      // node-pg formats JS arrays into Postgres array literals.
      values.push(encodeArrayValue(val));
    } else {
      // Date / string / number / bool / etc. — pass through unchanged.
      values.push(val);
    }
  }
  return { cols, placeholders, values };
}

// ------------------------------------------------------------------
// Phase 1: load `deletion_log` rows by table + context filter
// ------------------------------------------------------------------
async function loadHostDeletions(client) {
  console.log('[restore] loading deletion_log rows where context=host_dashboard');

  // Distribution of contexts so the operator can sanity-check.
  const ctxRes = await client.query(`
    SELECT context, COUNT(*) AS n
    FROM deletion_log
    WHERE table_name = 'parties'
    GROUP BY context
    ORDER BY n DESC
  `);
  console.log('[restore] parties deletion_log context distribution:');
  for (const row of ctxRes.rows) {
    console.log(`  context=${row.context ?? '<null>'}  n=${row.n}`);
  }

  // Pick the latest deletion per record_id (so re-deleted IDs don't restore
  // an older snapshot).
  const partiesRes = await client.query(`
    SELECT DISTINCT ON (record_id) record_id, deleted_at, deleted_by, record_data
    FROM deletion_log
    WHERE table_name = 'parties'
      AND context = 'host_dashboard'
    ORDER BY record_id, deleted_at DESC
  `);
  console.log(`[restore] candidate parties to restore: ${partiesRes.rows.length}`);

  if (partiesRes.rows.length > 0) {
    const sample = partiesRes.rows.slice(0, 3);
    console.log('[restore] sample (first 3) record_data keys:');
    for (const row of sample) {
      const keys = Object.keys(row.record_data || {}).slice(0, 20).join(', ');
      console.log(`  id=${row.record_id}  deleted_at=${row.deleted_at.toISOString?.() ?? row.deleted_at}  keys=[${keys}...]`);
    }
  }

  return partiesRes.rows;
}

// ------------------------------------------------------------------
// Phase 2: per-row preflight (FK + slug collision detection)
// ------------------------------------------------------------------
async function checkUserFk(client, userId) {
  if (!userId) return true; // no FK to worry about
  const res = await client.query(`SELECT 1 FROM "User" WHERE id = $1`, [userId]);
  return res.rows.length > 0;
}

async function customUrlInUse(client, slug, partyIdToIgnore) {
  if (!slug) return false;
  const res = await client.query(
    `SELECT id FROM parties WHERE custom_url = $1 AND id <> $2 AND cancelled_at IS NULL`,
    [slug, partyIdToIgnore],
  );
  return res.rows.length > 0;
}

async function inviteCodeInUse(client, code, partyIdToIgnore) {
  if (!code) return false;
  const res = await client.query(
    `SELECT id FROM parties WHERE invite_code = $1 AND id <> $2`,
    [code, partyIdToIgnore],
  );
  return res.rows.length > 0;
}

async function aliasOrLiveOwnsSlug(client, slug) {
  if (!slug) return true;
  const liveRes = await client.query(
    `SELECT 1 FROM parties WHERE custom_url = $1 OR invite_code = $1`,
    [slug],
  );
  if (liveRes.rows.length > 0) return true;
  const aliasRes = await client.query(`SELECT 1 FROM slug_aliases WHERE old_slug = $1`, [slug]);
  return aliasRes.rows.length > 0;
}

// ------------------------------------------------------------------
// Realtime publication helpers
// ------------------------------------------------------------------
async function publicationState(client, tableName) {
  const res = await client.query(
    `
    SELECT 1
    FROM pg_publication p
    JOIN pg_publication_tables pt ON p.pubname = pt.pubname
    WHERE p.pubname = 'supabase_realtime' AND pt.schemaname = 'public' AND pt.tablename = $1
    `,
    [tableName],
  );
  return res.rows.length > 0;
}

async function dropFromPublication(client, tableName) {
  const present = await publicationState(client, tableName);
  if (!present) {
    console.log(`[restore] ${tableName} not currently in supabase_realtime — skipping DROP`);
    return false;
  }
  await client.query(`ALTER PUBLICATION supabase_realtime DROP TABLE ${tableName}`);
  console.log(`[restore] ALTER PUBLICATION supabase_realtime DROP TABLE ${tableName} — done`);
  return true;
}

async function addToPublication(client, tableName) {
  const present = await publicationState(client, tableName);
  if (present) {
    console.log(`[restore] ${tableName} already in supabase_realtime — skipping ADD`);
    return;
  }
  await client.query(`ALTER PUBLICATION supabase_realtime ADD TABLE ${tableName}`);
  console.log(`[restore] ALTER PUBLICATION supabase_realtime ADD TABLE ${tableName} — done`);
}

// ------------------------------------------------------------------
// Main
// ------------------------------------------------------------------
async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  console.log('[restore] mode:', APPLY ? 'APPLY' : 'DRY-RUN');

  // Pre-print publication state.
  for (const t of ['guests', 'parties']) {
    const present = await publicationState(client, t);
    console.log(`[restore] supabase_realtime contains ${t}? ${present}`);
  }

  const partyRows = await loadHostDeletions(client);
  if (partyRows.length === 0) {
    console.log('[restore] nothing to do — no host_dashboard deletions found.');
    await client.end();
    return;
  }

  const partiesColumnInfo = await fetchTableColumns(client, 'parties');

  // Phase 2: classify each row
  const plan = [];
  let nullifiedUserIds = 0;
  let customUrlRewrites = 0;
  let inviteCodeRewrites = 0;

  for (const row of partyRows) {
    const data = { ...(row.record_data || {}) };
    const originalCustomUrl = data.custom_url;
    const originalInviteCode = data.invite_code;
    const partyId = data.id ?? row.record_id;

    // Orphaned userId — NULL it before insert.
    if (data.user_id) {
      const ok = await checkUserFk(client, data.user_id);
      if (!ok) {
        nullifiedUserIds += 1;
        data.user_id = null;
      }
    }

    // Slug collisions
    if (data.custom_url) {
      const taken = await customUrlInUse(client, data.custom_url, partyId);
      if (taken) {
        data.custom_url = `${originalCustomUrl}-cancelled-${shortid()}`;
        customUrlRewrites += 1;
      }
    }
    if (data.invite_code) {
      const taken = await inviteCodeInUse(client, data.invite_code, partyId);
      if (taken) {
        data.invite_code = cuidLike();
        inviteCodeRewrites += 1;
      }
    }

    // Override cancellation columns with the snapshot's deletion metadata.
    data.cancelled_at = row.deleted_at;
    data.cancelled_by = row.deleted_by ?? 'host_dashboard_backfill';
    data.cancellation_reason = null;

    // Determine whether to create a slug alias afterwards
    let aliasCandidate = null;
    if (originalCustomUrl && originalCustomUrl !== data.custom_url) {
      const conflict = await aliasOrLiveOwnsSlug(client, originalCustomUrl);
      if (!conflict) {
        aliasCandidate = { oldSlug: originalCustomUrl, partyId };
      }
    }

    plan.push({
      partyId,
      data,
      deletedAt: row.deleted_at,
      originalCustomUrl,
      originalInviteCode,
      aliasCandidate,
    });
  }

  console.log('[restore] preflight summary:');
  console.log(`  parties to restore: ${plan.length}`);
  console.log(`  orphaned user_id NULLed: ${nullifiedUserIds}`);
  console.log(`  custom_url rewrites: ${customUrlRewrites}`);
  console.log(`  invite_code rewrites: ${inviteCodeRewrites}`);
  console.log(`  slug aliases queued: ${plan.filter(p => p.aliasCandidate).length}`);

  if (!APPLY) {
    console.log('[restore] dry-run complete. Re-run with --apply to insert.');
    await client.end();
    return;
  }

  // Phase 3: APPLY — wrap inserts so the realtime publication is restored
  // even on failure.
  let droppedGuestsFromPub = false;
  const summary = {
    partiesInserted: 0,
    aliasesInserted: 0,
    childRowsByTable: {},
  };
  try {
    droppedGuestsFromPub = await dropFromPublication(client, 'guests');

    // Insert parties first
    for (const entry of plan) {
      const { cols, placeholders, values } = buildInsertParams('parties', entry.data, partiesColumnInfo);
      const sql = `
        INSERT INTO parties (${cols.join(', ')})
        VALUES (${placeholders.join(', ')})
        ON CONFLICT (id) DO NOTHING
      `;
      try {
        const result = await client.query(sql, values);
        if (result.rowCount > 0) summary.partiesInserted += 1;
      } catch (err) {
        console.error(`[restore] FAILED inserting party ${entry.partyId}:`, err.message);
      }
    }

    // Insert aliases (only the ones we previously verified as safe)
    for (const entry of plan) {
      if (!entry.aliasCandidate) continue;
      try {
        const result = await client.query(
          `INSERT INTO slug_aliases (old_slug, party_id, created_at)
           VALUES ($1, $2, $3)
           ON CONFLICT (old_slug) DO NOTHING`,
          [entry.aliasCandidate.oldSlug, entry.aliasCandidate.partyId, entry.deletedAt],
        );
        if (result.rowCount > 0) summary.aliasesInserted += 1;
      } catch (err) {
        console.error(`[restore] FAILED inserting alias ${entry.aliasCandidate.oldSlug}:`, err.message);
      }
    }

    // Build a Map<partyId, deletedAt> for window scoping the child queries
    const restoredById = new Map(plan.map(p => [p.partyId, p.deletedAt]));
    const restoredIds = [...restoredById.keys()];

    for (const table of CHILD_TABLES_IN_ORDER) {
      const colInfo = await fetchTableColumns(client, table);
      // For each restored party, pull rows from deletion_log whose record_data
      // has party_id matching, and whose deleted_at is within ±5 minutes of
      // the parent deletion timestamp (so we capture the cascade, not
      // unrelated earlier deletes of the same child).
      let inserted = 0;
      for (const [partyId, parentDeletedAt] of restoredById) {
        const res = await client.query(
          `
          SELECT record_data
          FROM deletion_log
          WHERE table_name = $1
            AND context = 'host_dashboard'
            AND (record_data->>'party_id')::uuid = $2::uuid
            AND deleted_at BETWEEN ($3::timestamptz - interval '5 minutes')
                              AND ($3::timestamptz + interval '5 minutes')
          `,
          [table, partyId, parentDeletedAt],
        );
        for (const row of res.rows) {
          const data = { ...(row.record_data || {}) };
          const { cols, placeholders, values } = buildInsertParams(table, data, colInfo);
          if (cols.length === 0) continue;
          const sql = `
            INSERT INTO ${table} (${cols.join(', ')})
            VALUES (${placeholders.join(', ')})
            ON CONFLICT (id) DO NOTHING
          `;
          try {
            const result = await client.query(sql, values);
            if (result.rowCount > 0) inserted += 1;
          } catch (err) {
            console.error(
              `[restore] FAILED inserting ${table} row for party ${partyId}:`,
              err.message,
            );
          }
        }
      }
      summary.childRowsByTable[table] = inserted;
      console.log(`[restore] ${table}: inserted ${inserted}`);
      // Touch restoredIds so eslint/grep tools see we used it (also a sanity
      // line — `restoredIds.length` should match `partiesInserted` modulo
      // ON CONFLICT skips).
      void restoredIds.length;
    }

    console.log('[restore] APPLY complete. Summary:', JSON.stringify(summary, null, 2));
  } catch (err) {
    console.error('[restore] FATAL during apply:', err);
    throw err;
  } finally {
    if (droppedGuestsFromPub) {
      try {
        await addToPublication(client, 'guests');
      } catch (err) {
        console.error('[restore] FAILED to re-add guests to publication:', err.message);
        console.error('[restore] You MUST run: ALTER PUBLICATION supabase_realtime ADD TABLE guests;');
      }
    }
    // Post-print publication state.
    for (const t of ['guests', 'parties']) {
      const present = await publicationState(client, t);
      console.log(`[restore] (post) supabase_realtime contains ${t}? ${present}`);
    }
    await client.end();
  }
}

main().catch(err => {
  console.error('[restore] unhandled error:', err);
  process.exit(1);
});
