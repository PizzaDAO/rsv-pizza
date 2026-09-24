#!/usr/bin/env node
/**
 * salame-92110 SECURITY BACKFILL: move existing tax-form PDFs out of the PUBLIC
 * `event-images` bucket into the PRIVATE `tax-forms` bucket, and rewrite
 * `tax_forms.pdf_url` from a public URL to a bucket-relative object path so the
 * app mints signed URLs for it going forward.
 *
 * For each tax_forms row whose pdf_url is still a public event-images URL:
 *   1. download the object from event-images
 *   2. upload it to the private tax-forms bucket (same relative sub-path,
 *      dropping the redundant leading `tax-forms/` segment)
 *   3. set tax_forms.pdf_url = <new object path>
 *   4. delete the original public object from event-images
 *
 * DRY RUN by default — prints the plan and changes nothing. Pass --apply to
 * perform the migration.
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (service_role bypasses
 * the RLS added in 20260924_taxform_rls_lockdown). Run AFTER that migration and
 * AFTER the backend deploy that writes paths, or in either order — it is
 * idempotent and skips rows already migrated to a bare path.
 *
 *   node backend/scripts/backfill-taxform-private-storage.cjs           # dry run
 *   node backend/scripts/backfill-taxform-private-storage.cjs --apply   # execute
 */
try { require('dotenv').config(); } catch (_) { /* dotenv optional */ }
const { createClient } = require('@supabase/supabase-js');

const APPLY = process.argv.includes('--apply');
const OLD_BUCKET = 'event-images';
const NEW_BUCKET = 'tax-forms';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('ERROR: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.');
  process.exit(1);
}
const supabase = createClient(url, key);

function log(...a) { console.log(...a); }

/** Extract the event-images object path from a stored public URL. */
function oldObjectPath(pdfUrl) {
  const marker = `/object/public/${OLD_BUCKET}/`;
  const i = pdfUrl.indexOf(marker);
  if (i === -1) return null;
  return decodeURIComponent(pdfUrl.slice(i + marker.length).split('?')[0]);
}

async function ensureBucket() {
  const { error } = await supabase.storage.createBucket(NEW_BUCKET, {
    public: false,
    allowedMimeTypes: ['application/pdf'],
    fileSizeLimit: '10MB',
  });
  if (error && !/already exists|resource already exists/i.test(error.message)) {
    throw new Error(`ensureBucket failed: ${error.message}`);
  }
}

async function main() {
  log(`\n=== tax-form private-storage backfill (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
  if (APPLY) await ensureBucket();

  // service_role bypasses RLS.
  const { data: rows, error } = await supabase
    .from('tax_forms')
    .select('id, pdf_url')
    .not('pdf_url', 'is', null);
  if (error) throw new Error(`select tax_forms failed: ${error.message}`);

  let migrated = 0, skipped = 0, failed = 0;
  for (const row of rows) {
    const val = row.pdf_url;
    if (!/^https?:\/\//i.test(val)) {
      log(`SKIP  ${row.id}  already a path: ${val}`);
      skipped++;
      continue;
    }
    const oldPath = oldObjectPath(val);
    if (!oldPath) {
      log(`SKIP  ${row.id}  unrecognized URL (not an event-images public URL): ${val}`);
      skipped++;
      continue;
    }
    // event-images path is `tax-forms/{userId}/{file}`; new bucket drops the
    // redundant `tax-forms/` prefix.
    const newPath = oldPath.replace(/^tax-forms\//, '');
    log(`MOVE  ${row.id}  ${OLD_BUCKET}/${oldPath}  ->  ${NEW_BUCKET}/${newPath}`);
    if (!APPLY) { migrated++; continue; }

    try {
      const dl = await supabase.storage.from(OLD_BUCKET).download(oldPath);
      if (dl.error || !dl.data) throw new Error(`download: ${dl.error?.message || 'no data'}`);
      const buf = Buffer.from(await dl.data.arrayBuffer());

      const up = await supabase.storage.from(NEW_BUCKET).upload(newPath, buf, {
        contentType: 'application/pdf',
        upsert: true,
        cacheControl: '3600',
      });
      if (up.error) throw new Error(`upload: ${up.error.message}`);

      const upd = await supabase.from('tax_forms').update({ pdf_url: newPath }).eq('id', row.id);
      if (upd.error) throw new Error(`update pdf_url: ${upd.error.message}`);

      const rm = await supabase.storage.from(OLD_BUCKET).remove([oldPath]);
      if (rm.error) log(`  WARN  moved + repointed, but failed to delete old public object: ${rm.error.message}`);

      log(`  OK    ${row.id} migrated`);
      migrated++;
    } catch (e) {
      log(`  FAIL  ${row.id}: ${e.message}`);
      failed++;
    }
  }

  log(`\n=== done: ${migrated} ${APPLY ? 'migrated' : 'to migrate'}, ${skipped} skipped, ${failed} failed ===`);
  if (!APPLY) log('Dry run only — re-run with --apply to perform the migration.');
  if (failed > 0) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
