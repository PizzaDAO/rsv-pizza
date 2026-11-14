#!/usr/bin/env node
/**
 * SECURITY BACKFILL (budget-receipts-private): move BUDGET receipt files out of
 * the PUBLIC `event-images` bucket (`receipts/<partyId>/<file>`) into the
 * PRIVATE `payout-receipts` bucket (same object path) and repoint the DB from
 * public URLs to bare object paths, so the backend serves them only as
 * short-lived signed URLs (middleware/payoutReceiptUrls.ts, budget namespace).
 * Same approach as backfill-payout-receipts-private.cjs (PR #1225); shared
 * storage helpers live in scripts/lib/private-receipts-backfill.cjs.
 *
 * Columns that can hold an event-images/receipts/ URL:
 *   budget_items.receipt_url                         (the only writer: uploadReceipt)
 *   deletion_log.record_data->>'receipt_url'         (snapshots of hard-deleted
 *                                                     budget_items rows; restorable)
 * Both are REPOINTED (old public URL -> bare path). Every other text / varchar
 * / json / jsonb / array column in the public schema is SWEPT read-only for
 * `/event-images/receipts/`; an object referenced from any of them (e.g. also
 * used as a public photo, or pasted into notes) is SKIPPED and stays public.
 *
 * What moves:
 *   1. every object referenced by one of the two repointed columns
 *   2. RESUME: rows already on a bare receipts/ path whose public copy still
 *      exists (interrupted run): sha256-verify the private copy (copy first if
 *      missing), then delete the public one
 *   3. with --orphans: unreferenced objects under event-images/receipts/<uuid>/
 *
 * Safety:
 *   - DRY RUN by default: only SELECTs, prints the plan + counts, changes nothing.
 *   - --apply refuses to run if any column of the sweep could not be scanned.
 *   - --apply first writes a JSON backup of every affected row, then per
 *     object: copy -> verify bytes (sha256) -> repoint rows in ONE transaction
 *     -> verify no budget row, snapshot, or swept column still points at the
 *     public object -> delete the public object. Any failure keeps the public
 *     object (rows untouched, or already on a verified private copy).
 *   - Idempotent / resume-safe: repointed rows are not selected again; a copy
 *     already made by an interrupted run is reused.
 *
 * Env: DATABASE_URL (required). SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY only
 * for --apply. The storage.objects inventory (orphans/resume/missing sources)
 * is read over DATABASE_URL when the role can see it.
 *
 * Run from backend/ AFTER the backend deploy that signs budget receipt paths:
 *   npx tsx --env-file=.env scripts/backfill-budget-receipts-private.cjs                 # dry run
 *   npx tsx --env-file=.env scripts/backfill-budget-receipts-private.cjs --apply         # execute
 *   options: --limit=N (objects per run)  --backup=/path/file.json  --orphans
 */
try { require('dotenv').config(); } catch (_) { /* dotenv optional (use --env-file) */ }
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');
const {
  OLD_BUCKET, NEW_BUCKET, PUBLIC_MARKER, UUID,
  objectPathFromPublicUrl, sha256, storage, ensureBucket, download, copyVerified,
} = require('./lib/private-receipts-backfill.cjs');

const APPLY = process.argv.includes('--apply');
const ORPHANS = process.argv.includes('--orphans');
const LIMIT = (() => {
  const a = process.argv.find((x) => x.startsWith('--limit='));
  const n = a ? parseInt(a.split('=')[1], 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : Infinity;
})();
const BACKUP_PATH = (() => {
  const a = process.argv.find((x) => x.startsWith('--backup='));
  if (a) return path.resolve(a.slice('--backup='.length));
  return path.resolve(`budget-receipts-backfill-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
})();

const BUDGET_PATH_RE = new RegExp(`^receipts/${UUID}/[^\\s?#]+$`, 'i');
const LIKE_PUBLIC_RECEIPTS = `%${PUBLIC_MARKER}receipts/%`;
// Broader marker for the sweep: also catches render/transform URLs.
const SWEEP_MARKER = `/${OLD_BUCKET}/receipts/`;
const SWEEP_PATH_RE = new RegExp(`/${OLD_BUCKET}/(receipts/[^\\s"'?#<>)\\\\]+)`, 'gi');

function log(...a) { console.log(...a); }
const isBudgetPath = (p) => typeof p === 'string' && BUDGET_PATH_RE.test(p) && !p.includes('..');
const partyOfPath = (p) => p.split('/')[1].toLowerCase();
const qi = (s) => `"${String(s).replace(/"/g, '""')}"`;

/** Every object path under receipts/ mentioned in a text blob. */
function receiptPathsIn(text) {
  const out = new Set();
  if (typeof text !== 'string') return out;
  for (const m of text.matchAll(SWEEP_PATH_RE)) {
    try { out.add(decodeURIComponent(m[1])); } catch { out.add(m[1]); }
  }
  return out;
}

async function tableExists(db, name) {
  const r = await db.query(`SELECT to_regclass($1) AS t`, [`public.${name}`]);
  return !!r.rows[0].t;
}

/**
 * Read-only sweep of every text-ish column in the public schema (except the
 * two repointed ones) for `/event-images/receipts/`. One scan per table.
 * Returns { hits: [{table, column, rows}], foreign: Map<path, Set<"t.c">>, failed: [...] }.
 */
async function sweepOtherColumns(db) {
  const cols = (await db.query(
    `SELECT c.table_name, c.column_name
       FROM information_schema.columns c
       JOIN information_schema.tables t
         ON t.table_schema = c.table_schema AND t.table_name = c.table_name
      WHERE c.table_schema = 'public' AND t.table_type = 'BASE TABLE'
        AND (c.data_type IN ('text', 'character varying', 'json', 'jsonb', 'ARRAY', 'USER-DEFINED')
             OR c.udt_name IN ('text', 'varchar', 'json', 'jsonb', '_text', '_varchar'))
      ORDER BY c.table_name, c.ordinal_position`)).rows;
  const byTable = new Map();
  for (const { table_name: t, column_name: c } of cols) {
    if (t === 'budget_items' && c === 'receipt_url') continue; // repointed
    if (!byTable.has(t)) byTable.set(t, []);
    byTable.get(t).push(c);
  }
  const hits = [];
  const foreign = new Map();
  const failed = [];
  for (const [t, cs] of byTable) {
    const sel = cs.map((c, i) => `${qi(c)}::text AS c${i}`).join(', ');
    // deletion_log: budget_items snapshots' receipt_url is repointed, not foreign.
    const conds = cs.map((c) => {
      if (t === 'deletion_log' && c === 'record_data') {
        return `(CASE WHEN table_name = 'budget_items' THEN (record_data - 'receipt_url')::text ELSE record_data::text END) LIKE $1`;
      }
      return `${qi(c)}::text LIKE $1`;
    }).join(' OR ');
    try {
      await db.query('BEGIN READ ONLY');
      await db.query(`SET LOCAL statement_timeout = '120s'`);
      const extra = t === 'deletion_log' ? ', table_name AS __t' : '';
      const rows = (await db.query(`SELECT ${sel}${extra} FROM ${qi(t)} WHERE ${conds}`, [`%${SWEEP_MARKER}%`])).rows;
      await db.query('COMMIT');
      const perCol = new Map();
      for (const r of rows) {
        cs.forEach((c, i) => {
          let v = r[`c${i}`];
          if (t === 'deletion_log' && c === 'record_data' && r.__t === 'budget_items' && v) {
            try { const o = JSON.parse(v); delete o.receipt_url; v = JSON.stringify(o); } catch { /* keep raw */ }
          }
          const ps = receiptPathsIn(v);
          if (!ps.size) return;
          perCol.set(c, (perCol.get(c) || 0) + 1);
          for (const p of ps) {
            if (!foreign.has(p)) foreign.set(p, new Set());
            foreign.get(p).add(`${t}.${c}`);
          }
        });
      }
      for (const [c, n] of perCol) hits.push({ table: t, column: c, rows: n });
    } catch (e) {
      try { await db.query('ROLLBACK'); } catch { /* ignore */ }
      failed.push({ table: t, error: e.message });
    }
  }
  return { hits, foreign, failed, tablesScanned: byTable.size };
}

async function main() {
  log(`\n=== budget receipts -> private bucket backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  if (!process.env.DATABASE_URL) {
    console.error('ERROR: DATABASE_URL must be set.');
    process.exit(1);
  }
  const sb = storage();
  if (APPLY && !sb) {
    console.error('ERROR: --apply needs SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.');
    process.exit(1);
  }

  const db = new Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    // ---- 1. Collect references (read-only) ----
    const items = (await db.query(
      `SELECT id, party_id, receipt_url, deleted_at FROM budget_items
        WHERE receipt_url LIKE $1 ORDER BY created_at`, [LIKE_PUBLIC_RECEIPTS])).rows;
    const hasDeletionLog = await tableExists(db, 'deletion_log');
    const snaps = hasDeletionLog
      ? (await db.query(
          `SELECT id, record_id, record_data->>'party_id' AS party_id, record_data->>'receipt_url' AS receipt_url
             FROM deletion_log
            WHERE table_name = 'budget_items' AND record_data->>'receipt_url' LIKE $1`, [LIKE_PUBLIC_RECEIPTS])).rows
      : [];

    const groups = new Map(); // objectPath -> { urls:Set, itemIds:[], snapIds:[], crossParty:[] }
    const unrecognized = [];
    const addRef = (url, kind, id, partyId) => {
      const p = objectPathFromPublicUrl(url);
      if (!p || !isBudgetPath(p)) { unrecognized.push({ kind, id, url }); return; }
      let g = groups.get(p);
      if (!g) { g = { urls: new Set(), itemIds: [], snapIds: [], crossParty: [] }; groups.set(p, g); }
      g.urls.add(url);
      if (kind === 'item') g.itemIds.push(id); else g.snapIds.push(id);
      if (partyId && String(partyId).toLowerCase() !== partyOfPath(p)) g.crossParty.push(`${kind}:${id}`);
    };
    for (const r of items) addRef(r.receipt_url, 'item', r.id, r.party_id);
    for (const r of snaps) addRef(r.receipt_url, 'snapshot', r.id, r.party_id);

    // Sweep everything else; objects referenced elsewhere stay public.
    const sweep = await sweepOtherColumns(db);
    const skippedShared = [];
    for (const p of [...groups.keys()]) {
      if (sweep.foreign.has(p)) {
        skippedShared.push({ path: p, refs: [...sweep.foreign.get(p)], urls: [...groups.get(p).urls] });
        groups.delete(p);
      }
    }

    // storage.objects inventory (missing sources, resume, orphans). Optional.
    let inventory = null;
    try {
      const rows = (await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = $1 AND name LIKE 'receipts/%'`, [OLD_BUCKET])).rows;
      inventory = new Set(rows.map((r) => r.name));
    } catch (e) {
      log(`(storage.objects not readable over DATABASE_URL: ${e.message} — inventory skipped)`);
    }
    let privateInventory = null;
    try {
      const rows = (await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = $1 AND name LIKE 'receipts/%'`, [NEW_BUCKET])).rows;
      privateInventory = new Set(rows.map((r) => r.name));
    } catch { /* optional */ }

    const missingSource = inventory
      ? [...groups.keys()].filter((p) => !inventory.has(p) && !(privateInventory && privateInventory.has(p)))
      : [];

    // RESUME: rows already on a bare path whose public copy still exists.
    const barePaths = new Set();
    for (const r of (await db.query(`SELECT receipt_url AS u FROM budget_items WHERE receipt_url LIKE 'receipts/%'`)).rows) {
      if (isBudgetPath(r.u)) barePaths.add(r.u);
    }
    if (hasDeletionLog) {
      for (const r of (await db.query(
        `SELECT record_data->>'receipt_url' AS u FROM deletion_log
          WHERE table_name = 'budget_items' AND record_data->>'receipt_url' LIKE 'receipts/%'`)).rows) {
        if (isBudgetPath(r.u)) barePaths.add(r.u);
      }
    }
    const resume = [];
    for (const p of barePaths) {
      if (groups.has(p) || sweep.foreign.has(p)) continue;
      if (inventory) { if (inventory.has(p)) resume.push({ path: p, main: true }); }
      else resume.push({ path: p, main: null }); // unknown: probed on --apply
    }

    // Orphans: receipt objects nobody references.
    const orphans = [];
    if (inventory) {
      const referenced = new Set([...groups.keys(), ...barePaths, ...sweep.foreign.keys()]);
      for (const s of skippedShared) referenced.add(s.path);
      for (const u of unrecognized) { const p = objectPathFromPublicUrl(u.url); if (p) referenced.add(p); }
      for (const name of inventory) {
        if (!isBudgetPath(name) || referenced.has(name)) continue;
        orphans.push(name);
      }
    }

    // ---- 2. Report ----
    const groupList = [...groups.entries()];
    const crossParty = groupList.filter(([, g]) => g.crossParty.length);
    log(`budget_items.receipt_url on public receipts/ URLs : ${items.length}  (soft-deleted: ${items.filter((r) => r.deleted_at).length})`);
    log(`deletion_log budget_items snapshots on public URLs: ${hasDeletionLog ? snaps.length : 'n/a (no deletion_log)'}`);
    log(`distinct objects to move                          : ${groupList.length}` +
        `  (PDFs: ${groupList.filter(([p]) => p.toLowerCase().endsWith('.pdf')).length})`);
    log(`  source missing from event-images inventory      : ${inventory ? missingSource.length : 'unknown (no inventory)'}`);
    for (const p of missingSource) log(`  MISSING ${p}`);
    log(`  cross-party (path party != row party)           : ${crossParty.length}`);
    for (const [p, g] of crossParty) log(`  XPARTY ${p}  ${g.crossParty.join(' ')}`);
    log(`sweep: ${sweep.tablesScanned} tables scanned; other columns mentioning ${SWEEP_MARKER}: ${sweep.hits.length}`);
    for (const h of sweep.hits) log(`  ${h.table}.${h.column}: ${h.rows} row(s)`);
    if (sweep.failed.length) {
      log(`  SWEEP FAILED for ${sweep.failed.length} table(s) — --apply will refuse to run:`);
      for (const f of sweep.failed) log(`    ${f.table}: ${f.error}`);
    }
    log(`SKIPPED (also referenced from another column)     : ${skippedShared.length}`);
    for (const s of skippedShared) log(`  SKIP shared  ${s.path}  [${s.refs.join(', ')}]`);
    log(`RESUME: bare-path rows w/ public copy left         : ${inventory ? resume.length : `unknown (${resume.length} bare-path refs probed on --apply)`}`);
    log(`orphan receipt objects (unreferenced)              : ${inventory ? orphans.length : 'unknown (no inventory)'}${ORPHANS ? '' : '  (moved only with --orphans)'}`);
    log(`event-images receipts/ objects in inventory       : ${inventory ? inventory.size : 'unknown'}`);
    log(`unrecognized URLs (left alone)                    : ${unrecognized.length}`);
    for (const u of unrecognized) log(`  ???  ${u.kind} ${u.id}  ${u.url}`);
    if (LIMIT !== Infinity) log(`--limit=${LIMIT}: at most ${LIMIT} objects this run`);

    if (!APPLY) {
      for (const [p, g] of groupList.slice(0, LIMIT === Infinity ? groupList.length : LIMIT)) {
        log(`MOVE  ${OLD_BUCKET}/${p}  ->  ${NEW_BUCKET}/${p}  [items:${g.itemIds.length} snapshots:${g.snapIds.length}]`);
      }
      if (inventory) for (const r of resume) log(`RESUME ${r.path}`);
      if (ORPHANS) for (const o of orphans) log(`MOVE  ${OLD_BUCKET}/${o}  ->  ${NEW_BUCKET}/${o}  [orphan]`);
      log('\nDry run only — nothing changed. Re-run with --apply to perform the migration.');
      return;
    }

    if (sweep.failed.length) {
      console.error('ERROR: the column sweep did not complete, so "nothing else points at the public URL" cannot be verified. Aborting.');
      process.exitCode = 1;
      return;
    }

    // ---- 3. Backup (before any change) ----
    const itemIds = groupList.flatMap(([, g]) => g.itemIds);
    const snapIds = groupList.flatMap(([, g]) => g.snapIds);
    const backup = {
      createdAt: new Date().toISOString(),
      note: 'budget-receipts-private backfill: pre-change values. Restore by writing these back by id ' +
        '(budget_items.receipt_url; deletion_log.record_data.receipt_url).',
      budget_items: itemIds.length ? (await db.query(`SELECT id, party_id, receipt_url FROM budget_items WHERE id = ANY($1)`, [itemIds])).rows : [],
      deletion_log: snapIds.length
        ? (await db.query(`SELECT id, record_id, record_data->>'receipt_url' AS receipt_url FROM deletion_log WHERE id = ANY($1)`, [snapIds])).rows
        : [],
      objects: groupList.map(([p, g]) => ({ path: p, urls: [...g.urls] })),
      skippedShared,
      resume,
      orphans: ORPHANS ? orphans : [],
    };
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2), { mode: 0o600 });
    log(`\nbackup written: ${BACKUP_PATH}`);

    await ensureBucket(sb);

    // Columns the sweep found mentions in: re-checked per object before delete.
    const recheckCols = sweep.hits.map((h) => ({ table: h.table, column: h.column }));
    async function stillReferenced(objectPath, oldUrls) {
      const n = {};
      const needle = `/${OLD_BUCKET}/${objectPath}`;
      n.items = (await db.query(
        `SELECT count(*)::int AS n FROM budget_items WHERE receipt_url = ANY($1) OR strpos(receipt_url, $2) > 0`,
        [oldUrls, needle])).rows[0].n;
      n.snapshots = hasDeletionLog
        ? (await db.query(
            `SELECT count(*)::int AS n FROM deletion_log WHERE table_name = 'budget_items'
                AND (record_data->>'receipt_url' = ANY($1) OR strpos(record_data->>'receipt_url', $2) > 0)`,
            [oldUrls, needle])).rows[0].n
        : 0;
      for (const { table, column } of recheckCols) {
        const cond = table === 'deletion_log' && column === 'record_data'
          ? `strpos(CASE WHEN table_name = 'budget_items' THEN (record_data - 'receipt_url')::text ELSE record_data::text END, $1) > 0`
          : `strpos(${qi(column)}::text, $1) > 0`;
        const c = (await db.query(`SELECT count(*)::int AS n FROM ${qi(table)} WHERE ${cond}`, [needle])).rows[0].n;
        if (c) n[`${table}.${column}`] = c;
      }
      return Object.entries(n).filter(([, v]) => v > 0);
    }

    // ---- 4. Move receipts ----
    let moved = 0, failed = 0, done = 0;
    for (const [p, g] of groupList) {
      if (done >= LIMIT) break;
      done++;
      const oldUrls = [...g.urls];
      try {
        await copyVerified(sb, p, p);

        await db.query('BEGIN');
        try {
          await db.query(`UPDATE budget_items SET receipt_url = $1 WHERE receipt_url = ANY($2)`, [p, oldUrls]);
          if (hasDeletionLog) {
            await db.query(
              `UPDATE deletion_log SET record_data = jsonb_set(record_data, '{receipt_url}', to_jsonb($1::text))
                WHERE table_name = 'budget_items' AND record_data->>'receipt_url' = ANY($2)`, [p, oldUrls]);
          }
          await db.query('COMMIT');
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        }

        const left = await stillReferenced(p, oldUrls);
        if (left.length) {
          log(`  WARN  ${p}: still referenced after repoint (${left.map(([k, v]) => `${k}:${v}`).join(' ')}) — public object KEPT`);
          failed++;
          continue;
        }

        const rm = await sb.storage.from(OLD_BUCKET).remove([p]);
        if (rm.error) log(`  WARN  ${p}: moved + repointed, but deleting the public object failed: ${rm.error.message}`);
        log(`  OK    ${p}  items:${g.itemIds.length} snapshots:${g.snapIds.length}`);
        moved++;
      } catch (e) {
        log(`  FAIL  ${p}: ${e.message}`);
        failed++;
      }
    }

    // ---- 4b. Resume: delete leftover public copies of already-repointed rows ----
    let resumed = 0;
    for (const r of resume) {
      try {
        const pub = await download(sb, OLD_BUCKET, r.path);
        if (!pub) continue; // no public copy (or already deleted)
        let priv = await download(sb, NEW_BUCKET, r.path);
        if (!priv) {
          await copyVerified(sb, r.path, r.path);
          priv = await download(sb, NEW_BUCKET, r.path);
        }
        if (!priv || sha256(priv.buf) !== sha256(pub.buf)) {
          log(`  WARN  resume ${r.path}: private copy missing or differs from the public one — public copy KEPT`);
          failed++;
          continue;
        }
        const left = await stillReferenced(r.path, []);
        if (left.length) {
          log(`  WARN  resume ${r.path}: still referenced (${left.map(([k, v]) => `${k}:${v}`).join(' ')}) — public copy KEPT`);
          failed++;
          continue;
        }
        const rm = await sb.storage.from(OLD_BUCKET).remove([r.path]);
        if (rm.error) { log(`  WARN  resume ${r.path}: delete failed: ${rm.error.message}`); failed++; continue; }
        log(`  OK    resume ${r.path}`);
        resumed++;
      } catch (err) {
        log(`  FAIL  resume ${r.path}: ${err.message}`);
        failed++;
      }
    }

    // ---- 5. Orphans ----
    let orphansMoved = 0;
    if (ORPHANS) {
      for (const o of orphans) {
        try {
          await copyVerified(sb, o, o);
          const left = await stillReferenced(o, []);
          if (left.length) { log(`  WARN  orphan ${o}: now referenced — public copy KEPT`); failed++; continue; }
          const rm = await sb.storage.from(OLD_BUCKET).remove([o]);
          if (rm.error) log(`  WARN  orphan ${o}: copied, but deleting the public object failed: ${rm.error.message}`);
          orphansMoved++;
        } catch (err) {
          log(`  FAIL  orphan ${o}: ${err.message}`);
          failed++;
        }
      }
    }

    log(`\n=== done: ${moved} receipt objects moved, ${resumed} resumed, ${orphansMoved} orphans moved, ${failed} failed ===`);
    log(`backup: ${BACKUP_PATH}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
