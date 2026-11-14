/**
 * Shared helpers for the "move receipts from the PUBLIC event-images bucket to
 * the PRIVATE payout-receipts bucket" backfills:
 *   - backfill-payout-receipts-private.cjs  (payouts/<party>/...)
 *   - backfill-budget-receipts-private.cjs  (receipts/<party>/...)
 *
 * Bucket config mirrors backend/src/services/payoutReceiptStorage.service.ts
 * (explicit MIME allowlist, no image/* wildcard so no SVG, 25MB cap).
 */
const crypto = require('crypto');

const OLD_BUCKET = 'event-images';
const NEW_BUCKET = 'payout-receipts';
const PUBLIC_MARKER = `/storage/v1/object/public/${OLD_BUCKET}/`;
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';

const BUCKET_OPTIONS = {
  public: false,
  allowedMimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf'],
  fileSizeLimit: '25MB',
};

/** event-images object path from a public URL, or null. */
function objectPathFromPublicUrl(u) {
  if (typeof u !== 'string') return null;
  const i = u.indexOf(PUBLIC_MARKER);
  if (i === -1) return null;
  try {
    return decodeURIComponent(u.slice(i + PUBLIC_MARKER.length).split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
}

const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function guessContentType(p, fallback) {
  const ext = p.toLowerCase().split('.').pop();
  const map = { pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif' };
  return map[ext] || fallback || 'application/octet-stream';
}

let supabase = null;
/** Service-role storage client, or null when SUPABASE_URL / key are not set. */
function storage() {
  if (supabase) return supabase;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  supabase = createClient(url, key, { auth: { persistSession: false } });
  return supabase;
}

async function ensureBucket(sb) {
  const { error } = await sb.storage.createBucket(NEW_BUCKET, BUCKET_OPTIONS);
  if (error && !/already exists|resource already exists|duplicate/i.test(error.message)) {
    throw new Error(`ensureBucket failed: ${error.message}`);
  }
  const { data, error: getErr } = await sb.storage.getBucket(NEW_BUCKET);
  if (getErr || !data) throw new Error(`getBucket failed: ${getErr && getErr.message}`);
  if (data.public) throw new Error(`Bucket ${NEW_BUCKET} exists but is PUBLIC — refusing to continue.`);
}

async function download(sb, bucket, p) {
  const { data, error } = await sb.storage.from(bucket).download(p);
  if (error || !data) return null;
  return { buf: Buffer.from(await data.arrayBuffer()), type: data.type || '' };
}

/** Copy event-images/<from> -> payout-receipts/<to> and verify. Returns sha or throws. */
async function copyVerified(sb, from, to, { optional = false } = {}) {
  let src = await download(sb, OLD_BUCKET, from);
  if (!src) {
    // Interrupted earlier run may have already moved it.
    const already = await download(sb, NEW_BUCKET, to);
    if (already) return { sha: sha256(already.buf), reused: true, missingSource: true };
    if (optional) return null;
    throw new Error(`source missing: ${OLD_BUCKET}/${from}`);
  }
  const contentType = guessContentType(from, src.type);
  const up = await sb.storage.from(NEW_BUCKET).upload(to, src.buf, { contentType, upsert: true, cacheControl: '3600' });
  if (up.error) throw new Error(`upload ${to}: ${up.error.message}`);
  const check = await download(sb, NEW_BUCKET, to);
  if (!check) throw new Error(`verify download failed: ${NEW_BUCKET}/${to}`);
  const want = sha256(src.buf);
  if (sha256(check.buf) !== want) throw new Error(`verify sha256 mismatch: ${to}`);
  return { sha: want, reused: false, missingSource: false };
}

module.exports = {
  OLD_BUCKET,
  NEW_BUCKET,
  PUBLIC_MARKER,
  UUID,
  BUCKET_OPTIONS,
  objectPathFromPublicUrl,
  sha256,
  guessContentType,
  storage,
  ensureBucket,
  download,
  copyVerified,
};
