#!/usr/bin/env node
/**
 * SECURITY BACKFILL (payout-receipts-private): move payout receipt files out of
 * the PUBLIC `event-images` bucket into the PRIVATE `payout-receipts` bucket and
 * repoint the DB rows from public URLs to bare object paths, so the backend
 * serves them only as short-lived signed URLs. Same idea as
 * backfill-taxform-private-storage.cjs (PR #1043).
 *
 * What moves (object path is kept: event-images/<p>  ->  payout-receipts/<p>):
 *   1. every object referenced by payout_documents.url where kind='receipt'
 *      and url is a public event-images/payouts/... URL, plus its PDF
 *      `<p>.thumb.png` sibling when one exists
 *   2. every object referenced by payouts.external_proof_url (admin-uploaded
 *      external-payment proof) under event-images/payouts/...
 *   3. ELA overlays of receipts (image_authenticity_checks.ela_artifact_url for
 *      source_kind='receipt', event-images/image-authenticity/...) ->
 *      payout-receipts/payouts/<partyId>/authenticity/<file>
 *   4. with --orphans: receipt objects under event-images/payouts/<party>/<group>/receipt/
 *      or event-images/payouts/<party>/tg-* (Telegram uploads) that no DB row
 *      references (abandoned uploads, superseded rotations)
 *   5. RESUME: rows that already hold a bare path (an interrupted earlier run,
 *      or a row repointed by hand) whose public copy still exists: the private
 *      copy is verified against the public one by sha256 (copied first if
 *      missing), then the public copy (and PDF thumb) is deleted.
 *
 * DB columns rewritten (old public URL -> bare path):
 *   payout_documents.url               (kind='receipt' rows only)
 *   payouts.external_proof_url
 *   image_authenticity_checks.image_url (cache key; incl. `.thumb.png` variants)
 *   image_authenticity_checks.ela_artifact_url (receipt checks)
 *
 * Safety:
 *   - DRY RUN by default: only SELECTs, prints the plan + counts, changes nothing.
 *   - --apply first writes a JSON backup of every affected row (before any
 *     change), then per object: copy -> verify bytes (sha256) in the private
 *     bucket -> repoint rows in one transaction -> verify no row still points
 *     at the old URL -> delete the public object. A failure at any step leaves
 *     the public object in place and the rows untouched (or already repointed
 *     to a verified private copy).
 *   - An object that is ALSO referenced as a pizza/event photo (non-receipt
 *     payout_documents row or photos.url) is skipped and reported.
 *   - Idempotent: rows already holding bare paths are not selected again; an
 *     object already copied by an interrupted run is reused.
 *
 * Env: DATABASE_URL (required). SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are
 * required for --apply (storage writes); for a dry run they are optional (used
 * only to check thumbnails exist). The storage.objects inventory used for
 * thumbnails/orphans is read over DATABASE_URL when the role can see it.
 *
 * Run from backend/ AFTER the backend deploy that reads paths + signs URLs:
 *   npx tsx --env-file=.env scripts/backfill-payout-receipts-private.cjs                 # dry run
 *   npx tsx --env-file=.env scripts/backfill-payout-receipts-private.cjs --apply         # execute
 *   options: --limit=N (objects per run)  --backup=/path/file.json  --orphans
 */
try { require('dotenv').config(); } catch (_) { /* dotenv optional (use --env-file) */ }
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

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
  return path.resolve(`payout-receipts-backfill-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
})();

const {
  OLD_BUCKET, NEW_BUCKET, PUBLIC_MARKER, UUID,
  objectPathFromPublicUrl, sha256, storage, ensureBucket, download, copyVerified,
} = require('./lib/private-receipts-backfill.cjs');
const PAYOUT_PATH_RE = new RegExp(`^payouts/${UUID}/[^\\s?#]+$`, 'i');
const ORPHAN_RECEIPT_RE = new RegExp(`^payouts/${UUID}/(?:[^/]+/receipt/[^/]+|tg-[^/]+)$`, 'i');
const LIKE_PAYOUTS = `%${PUBLIC_MARKER}payouts/%`;
const LIKE_ELA = `%${PUBLIC_MARKER}image-authenticity/%`;

function log(...a) { console.log(...a); }

async function main() {
  log(`\n=== payout receipts -> private bucket backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
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
    const docs = (await db.query(
      `SELECT id, party_id, url, mime_type FROM payout_documents
        WHERE kind = 'receipt' AND url LIKE $1 ORDER BY created_at`, [LIKE_PAYOUTS])).rows;
    const proofs = (await db.query(
      `SELECT id, party_id, external_proof_url FROM payouts WHERE external_proof_url LIKE $1`, [LIKE_PAYOUTS])).rows;
    // Public uses of the same objects (pizza/event photos) — never move those.
    const publicUses = new Set();
    for (const r of (await db.query(
      `SELECT url FROM payout_documents WHERE kind <> 'receipt' AND url LIKE $1`, [LIKE_PAYOUTS])).rows) {
      const p = objectPathFromPublicUrl(r.url); if (p) publicUses.add(p);
    }
    for (const r of (await db.query(`SELECT url FROM photos WHERE url LIKE $1`, [LIKE_PAYOUTS])).rows) {
      const p = objectPathFromPublicUrl(r.url); if (p) publicUses.add(p);
    }

    // Group by object path.
    const groups = new Map(); // objectPath -> { urls:Set, docIds:[], payoutIds:[], isPdf }
    const unrecognized = [];
    const addRef = (url, kind, id, mime) => {
      const p = objectPathFromPublicUrl(url);
      if (!p || !PAYOUT_PATH_RE.test(p) || p.includes('..')) { unrecognized.push({ kind, id, url }); return; }
      let g = groups.get(p);
      if (!g) { g = { urls: new Set(), docIds: [], payoutIds: [], isPdf: false }; groups.set(p, g); }
      g.urls.add(url);
      if (kind === 'doc') g.docIds.push(id); else g.payoutIds.push(id);
      if ((mime || '').toLowerCase() === 'application/pdf' || p.toLowerCase().endsWith('.pdf')) g.isPdf = true;
    };
    for (const d of docs) addRef(d.url, 'doc', d.id, d.mime_type);
    for (const p of proofs) addRef(p.external_proof_url, 'proof', p.id, null);

    const skippedShared = [];
    for (const p of [...groups.keys()]) {
      if (publicUses.has(p)) { skippedShared.push({ path: p, ...groups.get(p), urls: [...groups.get(p).urls] }); groups.delete(p); }
    }

    // storage.objects inventory (thumb existence + orphans). Optional.
    let inventory = null;
    try {
      const rows = (await db.query(
        `SELECT name FROM storage.objects WHERE bucket_id = $1 AND name LIKE 'payouts/%'`, [OLD_BUCKET])).rows;
      inventory = new Set(rows.map((r) => r.name));
    } catch (e) {
      log(`(storage.objects not readable over DATABASE_URL: ${e.message} — thumbnail/orphan inventory skipped)`);
    }

    // Thumbs.
    let thumbsKnown = 0, thumbsUnknown = 0;
    for (const [p, g] of groups) {
      if (!g.isPdf) continue;
      if (inventory) { g.hasThumb = inventory.has(`${p}.thumb.png`); if (g.hasThumb) thumbsKnown++; }
      else { g.hasThumb = null; thumbsUnknown++; }
    }

    // RESUME: rows already on a bare path whose public copy still exists.
    const barePaths = new Set();
    for (const r of (await db.query(
      `SELECT url AS u FROM payout_documents WHERE kind = 'receipt' AND url LIKE 'payouts/%'
       UNION SELECT external_proof_url FROM payouts WHERE external_proof_url LIKE 'payouts/%'`)).rows) {
      if (PAYOUT_PATH_RE.test(r.u) && !r.u.includes('..')) barePaths.add(r.u);
    }
    const resume = []; // { path, thumb: bool|null }
    for (const p of barePaths) {
      if (groups.has(p)) continue; // also referenced by a legacy URL: handled by the main pass
      if (inventory) {
        if (inventory.has(p) || inventory.has(`${p}.thumb.png`)) {
          resume.push({ path: p, main: inventory.has(p), thumb: inventory.has(`${p}.thumb.png`) });
        }
      } else {
        resume.push({ path: p, main: null, thumb: null }); // unknown: probed in --apply
      }
    }

    // Authenticity cache rows keyed by the old URLs (+ their .thumb.png variants).
    const allOldUrls = [];
    for (const g of groups.values()) for (const u of g.urls) { allOldUrls.push(u); allOldUrls.push(`${u}.thumb.png`); }
    const authRows = allOldUrls.length
      ? (await db.query(`SELECT id, image_url, ela_artifact_url, party_id FROM image_authenticity_checks WHERE image_url = ANY($1)`, [allOldUrls])).rows
      : [];
    // ELA overlays of receipt checks still in the public bucket.
    const elaRows = (await db.query(
      `SELECT id, party_id, image_url, ela_artifact_url FROM image_authenticity_checks
        WHERE source_kind = 'receipt' AND ela_artifact_url LIKE $1`, [LIKE_ELA])).rows;
    const elaPlan = [];
    for (const r of elaRows) {
      const from = objectPathFromPublicUrl(r.ela_artifact_url);
      const partyFromImage = (() => {
        const p = objectPathFromPublicUrl(r.image_url) || r.image_url;
        const m = typeof p === 'string' && p.match(new RegExp(`^payouts/(${UUID})/`, 'i'));
        return m ? m[1] : null;
      })();
      const partyId = r.party_id || partyFromImage;
      if (!from || !partyId) { unrecognized.push({ kind: 'ela', id: r.id, url: r.ela_artifact_url }); continue; }
      elaPlan.push({ id: r.id, from, to: `payouts/${partyId}/authenticity/${path.posix.basename(from)}`, oldUrl: r.ela_artifact_url });
    }

    // Orphans: receipt-shaped objects nobody references.
    let orphans = [];
    if (inventory) {
      const referenced = new Set(groups.keys());
      for (const s of skippedShared) referenced.add(s.path);
      const anyRef = (await db.query(
        `SELECT url AS u FROM payout_documents WHERE url LIKE $1
         UNION SELECT url FROM photos WHERE url LIKE $1
         UNION SELECT external_proof_url FROM payouts WHERE external_proof_url LIKE $1`, [LIKE_PAYOUTS])).rows;
      for (const r of anyRef) { const p = objectPathFromPublicUrl(r.u); if (p) referenced.add(p); }
      for (const p of barePaths) referenced.add(p);
      for (const name of inventory) {
        if (!ORPHAN_RECEIPT_RE.test(name)) continue;
        const base = name.endsWith('.thumb.png') ? name.slice(0, -'.thumb.png'.length) : name;
        if (referenced.has(name) || referenced.has(base)) continue;
        orphans.push(name);
      }
    }

    // ---- 2. Report ----
    const groupList = [...groups.entries()];
    log(`receipt payout_documents rows on public URLs : ${docs.length}`);
    log(`payouts.external_proof_url rows on public URLs: ${proofs.length}`);
    log(`distinct objects to move                      : ${groupList.length}` +
        `  (PDFs: ${groupList.filter(([, g]) => g.isPdf).length}, with .thumb.png: ${inventory ? thumbsKnown : `unknown x${thumbsUnknown}`})`);
    log(`image_authenticity_checks.image_url to repoint: ${authRows.length}`);
    log(`receipt ELA overlays to move                  : ${elaPlan.length}`);
    log(`RESUME: bare-path rows w/ public copy left     : ${inventory ? resume.length : `unknown (${resume.length} bare-path refs probed on --apply)`}`);
    log(`orphan receipt objects (unreferenced)          : ${inventory ? orphans.length : 'unknown (no inventory)'}${ORPHANS ? '' : '  (moved only with --orphans)'}`);
    log(`SKIPPED (also used as a public photo)         : ${skippedShared.length}`);
    for (const s of skippedShared) log(`  SKIP shared  ${s.path}`);
    log(`unrecognized URLs (left alone)                : ${unrecognized.length}`);
    for (const u of unrecognized) log(`  ???  ${u.kind} ${u.id}  ${u.url}`);
    if (LIMIT !== Infinity) log(`--limit=${LIMIT}: at most ${LIMIT} objects this run`);

    if (!APPLY) {
      for (const [p, g] of groupList.slice(0, LIMIT === Infinity ? groupList.length : LIMIT)) {
        log(`MOVE  ${OLD_BUCKET}/${p}  ->  ${NEW_BUCKET}/${p}  [docs:${g.docIds.length} proofs:${g.payoutIds.length}${g.isPdf ? ` thumb:${g.hasThumb == null ? '?' : g.hasThumb}` : ''}]`);
      }
      for (const e of elaPlan) log(`MOVE  ${OLD_BUCKET}/${e.from}  ->  ${NEW_BUCKET}/${e.to}  [ela ${e.id}]`);
      if (inventory) for (const r of resume) log(`RESUME ${r.path}  [public main:${r.main} thumb:${r.thumb}]`);
      if (ORPHANS) for (const o of orphans) log(`MOVE  ${OLD_BUCKET}/${o}  ->  ${NEW_BUCKET}/${o}  [orphan]`);
      log('\nDry run only — nothing changed. Re-run with --apply to perform the migration.');
      return;
    }

    // ---- 3. Backup (before any change) ----
    const docIds = groupList.flatMap(([, g]) => g.docIds);
    const payoutIds = groupList.flatMap(([, g]) => g.payoutIds);
    const backup = {
      createdAt: new Date().toISOString(),
      note: 'payout-receipts-private backfill: pre-change values. Restore by writing these columns back by id.',
      payout_documents: docIds.length ? (await db.query(`SELECT id, party_id, kind, url FROM payout_documents WHERE id = ANY($1)`, [docIds])).rows : [],
      payouts: payoutIds.length ? (await db.query(`SELECT id, party_id, external_proof_url FROM payouts WHERE id = ANY($1)`, [payoutIds])).rows : [],
      image_authenticity_checks: (await db.query(
        `SELECT id, image_url, ela_artifact_url FROM image_authenticity_checks WHERE id = ANY($1)`,
        [[...new Set([...authRows.map((r) => r.id), ...elaPlan.map((e) => e.id)])]])).rows,
      objects: groupList.map(([p, g]) => ({ path: p, isPdf: g.isPdf, urls: [...g.urls] })),
      ela: elaPlan,
      resume,
      orphans: ORPHANS ? orphans : [],
    };
    fs.writeFileSync(BACKUP_PATH, JSON.stringify(backup, null, 2), { mode: 0o600 });
    log(`\nbackup written: ${BACKUP_PATH}`);

    await ensureBucket(sb);

    // ---- 4. Move receipts ----
    let moved = 0, failed = 0, done = 0;
    for (const [p, g] of groupList) {
      if (done >= LIMIT) break;
      done++;
      const oldUrls = [...g.urls];
      try {
        await copyVerified(sb, p, p);
        let thumbMoved = false;
        if (g.isPdf && g.hasThumb !== false) {
          thumbMoved = !!(await copyVerified(sb, `${p}.thumb.png`, `${p}.thumb.png`, { optional: true }));
        }

        await db.query('BEGIN');
        try {
          await db.query(`UPDATE payout_documents SET url = $1 WHERE kind = 'receipt' AND url = ANY($2)`, [p, oldUrls]);
          await db.query(`UPDATE payouts SET external_proof_url = $1 WHERE external_proof_url = ANY($2)`, [p, oldUrls]);
          await db.query(`UPDATE image_authenticity_checks SET image_url = $1 WHERE image_url = ANY($2)`, [p, oldUrls]);
          await db.query(`UPDATE image_authenticity_checks SET image_url = $1 WHERE image_url = ANY($2)`,
            [`${p}.thumb.png`, oldUrls.map((u) => `${u}.thumb.png`)]);
          await db.query('COMMIT');
        } catch (e) {
          await db.query('ROLLBACK');
          throw e;
        }

        // Verify nothing still points at the public object.
        const left = (await db.query(
          `SELECT
             (SELECT count(*) FROM payout_documents WHERE url = ANY($1))::int AS docs,
             (SELECT count(*) FROM payouts WHERE external_proof_url = ANY($1))::int AS proofs,
             (SELECT count(*) FROM photos WHERE url = ANY($1))::int AS photos`, [oldUrls])).rows[0];
        if (left.docs || left.proofs || left.photos) {
          log(`  WARN  ${p}: still referenced after repoint (docs:${left.docs} proofs:${left.proofs} photos:${left.photos}) — public object KEPT`);
          failed++;
          continue;
        }

        const toRemove = [p];
        if (thumbMoved) toRemove.push(`${p}.thumb.png`);
        const rm = await sb.storage.from(OLD_BUCKET).remove(toRemove);
        if (rm.error) log(`  WARN  ${p}: moved + repointed, but deleting the public object failed: ${rm.error.message}`);
        log(`  OK    ${p}${thumbMoved ? ' (+thumb)' : ''}  docs:${g.docIds.length} proofs:${g.payoutIds.length}`);
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
        const removed = [];
        for (const p of [r.path, `${r.path}.thumb.png`]) {
          const pub = await download(sb, OLD_BUCKET, p);
          if (!pub) continue; // no public copy (or already deleted)
          let priv = await download(sb, NEW_BUCKET, p);
          if (!priv) {
            await copyVerified(sb, p, p); // private copy missing: copy + verify first
            priv = await download(sb, NEW_BUCKET, p);
          }
          if (!priv || sha256(priv.buf) !== sha256(pub.buf)) {
            log(`  WARN  resume ${p}: private copy missing or differs from the public one — public copy KEPT`);
            failed++;
            continue;
          }
          removed.push(p);
        }
        if (removed.length) {
          const rm = await sb.storage.from(OLD_BUCKET).remove(removed);
          if (rm.error) { log(`  WARN  resume ${r.path}: delete failed: ${rm.error.message}`); failed++; continue; }
          log(`  OK    resume ${removed.join(' + ')}`);
          resumed++;
        }
      } catch (err) {
        log(`  FAIL  resume ${r.path}: ${err.message}`);
        failed++;
      }
    }

    // ---- 5. ELA overlays ----
    let elaMoved = 0;
    for (const e of elaPlan) {
      try {
        await copyVerified(sb, e.from, e.to);
        await db.query(`UPDATE image_authenticity_checks SET ela_artifact_url = $1 WHERE id = $2 AND ela_artifact_url = $3`, [e.to, e.id, e.oldUrl]);
        const still = (await db.query(`SELECT count(*)::int AS n FROM image_authenticity_checks WHERE ela_artifact_url = $1`, [e.oldUrl])).rows[0].n;
        if (still) { log(`  WARN  ela ${e.id}: still referenced — public object KEPT`); failed++; continue; }
        const rm = await sb.storage.from(OLD_BUCKET).remove([e.from]);
        if (rm.error) log(`  WARN  ela ${e.id}: moved, but deleting the public object failed: ${rm.error.message}`);
        elaMoved++;
      } catch (err) {
        log(`  FAIL  ela ${e.id}: ${err.message}`);
        failed++;
      }
    }

    // ---- 6. Orphans ----
    let orphansMoved = 0;
    if (ORPHANS) {
      for (const o of orphans) {
        try {
          await copyVerified(sb, o, o);
          const rm = await sb.storage.from(OLD_BUCKET).remove([o]);
          if (rm.error) log(`  WARN  orphan ${o}: copied, but deleting the public object failed: ${rm.error.message}`);
          orphansMoved++;
        } catch (err) {
          log(`  FAIL  orphan ${o}: ${err.message}`);
          failed++;
        }
      }
    }

    log(`\n=== done: ${moved} receipt objects moved, ${resumed} resumed, ${elaMoved} ELA overlays moved, ${orphansMoved} orphans moved, ${failed} failed ===`);
    log(`backup: ${BACKUP_PATH}`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await db.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
