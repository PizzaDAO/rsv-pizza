/**
 * SECURITY: private storage for payout receipt files.
 *
 * Payout receipts (and PDF receipts' `.thumb.png` siblings) carry names, phone
 * numbers and card digits. They used to live in the PUBLIC `event-images`
 * bucket under `payouts/{partyId}/...`, so anyone holding a URL could open
 * them. They now live in the PRIVATE `payout-receipts` bucket (same object
 * path, e.g. `payouts/{partyId}/{group}/receipt/{ts}-{rand}.pdf`) and are only
 * ever surfaced through short-lived signed URLs. Same pattern as the tax-form
 * fix (taxFormStorage.service.ts, PR #1043).
 *
 * Storage-reference formats a DB column may hold (payout_documents.url,
 * payouts.external_proof_url, image_authenticity_checks.image_url):
 *   - bare private path  `payouts/<partyUuid>/...`  (new rows + backfilled rows)
 *   - legacy public URL  `https://<proj>.supabase.co/storage/v1/object/public/event-images/payouts/...`
 *     (pre-backfill rows; still works until backfill-payout-receipts-private.cjs
 *     moves the object and repoints the row)
 *   - anything else (e.g. `pizza-order://` draft markers) is passed through.
 *
 * Reads: `middleware/payoutReceiptUrls.ts`, mounted only on the receipt
 * routers, swaps bare private paths under receipt keys for signed URLs after a
 * per-caller party check (and normalises signed URLs that clients send back
 * into bare paths). Server-side fetches (OCR, authenticity check, rotate) go
 * through `resolveFetchableUrl`.
 *
 * budget-receipts-private: BUDGET receipts (budget_items.receipt_url) share
 * this bucket under their own prefix, `receipts/<partyUuid>/<file>` (the same
 * object path they had in event-images). Same sensitivity, MIME allowlist and
 * size cap, so one private bucket; the two namespaces are kept apart by path
 * predicate: payout routers only sign `payouts/...` paths, the budget router
 * only signs `receipts/...` paths (see isBudgetReceiptPath).
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';

/** PRIVATE bucket — created idempotently via ensurePayoutReceiptsBucket(). */
export const PAYOUT_RECEIPTS_BUCKET = 'payout-receipts';

/** Lifetime of signed URLs handed to browsers. Minted fresh on every read. */
export const RECEIPT_SIGNED_URL_TTL_SECONDS = 60 * 60; // 1 hour

/** Lifetime of signed URLs the backend mints for its own fetches (OCR etc.). */
const SERVER_FETCH_TTL_SECONDS = 60 * 10; // 10 minutes

/**
 * A bare private object path. Always `payouts/<party uuid>/<rest>`; no scheme,
 * no query string, no whitespace, no `..` segments.
 */
const PRIVATE_RECEIPT_PATH_RE = /^payouts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^\s?#]+$/i;

export function isPrivateReceiptPath(value: unknown): value is string {
  return typeof value === 'string' && PRIVATE_RECEIPT_PATH_RE.test(value) && !value.includes('..');
}

/** Party id embedded in a private receipt path (or null). */
export function partyIdFromPrivateReceiptPath(path: string): string | null {
  if (!isPrivateReceiptPath(path)) return null;
  return path.split('/')[1] ?? null;
}

/**
 * budget-receipts-private: a bare BUDGET receipt path in the same private
 * bucket. Always `receipts/<party uuid>/<rest>`; same shape rules as above.
 */
const BUDGET_RECEIPT_PATH_RE = /^receipts\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[^\s?#]+$/i;

export function isBudgetReceiptPath(value: unknown): value is string {
  return typeof value === 'string' && BUDGET_RECEIPT_PATH_RE.test(value) && !value.includes('..');
}

/** Party id embedded in a budget receipt path (or null). */
export function partyIdFromBudgetReceiptPath(path: string): string | null {
  if (!isBudgetReceiptPath(path)) return null;
  return path.split('/')[1] ?? null;
}

/** Any object path this module may sign / upload: payout OR budget receipts. */
export function isPrivateBucketPath(value: unknown): value is string {
  return isPrivateReceiptPath(value) || isBudgetReceiptPath(value);
}

const SIGNED_URL_MARKER = `/storage/v1/object/sign/${PAYOUT_RECEIPTS_BUCKET}/`;

/**
 * If `value` is a signed URL for a PAYOUT receipt in the private
 * payout-receipts bucket (as handed out by this backend), return the bare
 * object path. Otherwise null. Only Supabase-hosted URLs are recognised.
 */
export function privatePathFromSignedUrl(value: unknown): string | null {
  return pathFromSignedUrl(value, isPrivateReceiptPath);
}

/** Same as privatePathFromSignedUrl, for BUDGET receipt paths (`receipts/...`). */
export function budgetPathFromSignedUrl(value: unknown): string | null {
  return pathFromSignedUrl(value, isBudgetReceiptPath);
}

function pathFromSignedUrl(value: unknown, accept: (p: string) => boolean): string | null {
  if (typeof value !== 'string' || !value.includes(SIGNED_URL_MARKER)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (!/\.supabase\.co$/i.test(url.hostname)) return null;
  const idx = url.pathname.indexOf(SIGNED_URL_MARKER);
  if (idx === -1) return null;
  let path: string;
  try {
    path = decodeURIComponent(url.pathname.slice(idx + SIGNED_URL_MARKER.length));
  } catch {
    return null;
  }
  return accept(path) ? path : null;
}

/** Signed private URL → bare path; every other value is returned unchanged. */
export function normalizeReceiptRef<T>(value: T): T | string {
  const path = privatePathFromSignedUrl(value);
  return path ?? value;
}

let _client: ReturnType<typeof createClient> | null = null;
function getSupabaseAdmin() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for payout receipt storage');
  }
  _client = createClient(url, key);
  return _client;
}

/**
 * Explicit MIME allowlist (no wildcard: `image/*` would admit SVG, which can
 * carry script). Matches what uploadPayoutPhoto accepts for receipts after
 * HEIC→JPEG conversion, plus HEIC/HEIF for legacy objects moved by the backfill.
 */
export const PAYOUT_RECEIPT_MIME_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
];
const BUCKET_OPTIONS = {
  public: false,
  allowedMimeTypes: [...PAYOUT_RECEIPT_MIME_TYPES],
  fileSizeLimit: '25MB',
};

let _bucketEnsured = false;
/**
 * Idempotently ensure the private bucket exists with the explicit MIME
 * allowlist and 25MB cap. If it already exists it is VERIFIED: a bucket that
 * somehow became public (or has a different allowlist) is updated back to the
 * private config, and we throw if it is still public afterwards — receipts are
 * never written to a public bucket.
 */
export async function ensurePayoutReceiptsBucket(): Promise<void> {
  if (_bucketEnsured) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.createBucket(PAYOUT_RECEIPTS_BUCKET, BUCKET_OPTIONS);
  if (error) {
    if (!/already exists|resource already exists|duplicate/i.test(error.message)) {
      throw new Error(`Failed to ensure private payout-receipts bucket: ${error.message}`);
    }
    const { data: existing, error: getErr } = await supabase.storage.getBucket(PAYOUT_RECEIPTS_BUCKET);
    if (getErr || !existing) {
      throw new Error(`Could not verify payout-receipts bucket: ${getErr?.message || 'not found'}`);
    }
    const mimes = [...(existing.allowed_mime_types ?? [])].sort().join(',');
    const wantMimes = [...PAYOUT_RECEIPT_MIME_TYPES].sort().join(',');
    if (existing.public || mimes !== wantMimes) {
      console.error(
        `[payout-receipts] bucket config drift (public=${existing.public}, mimes=${mimes || 'any'}); resetting to private`,
      );
      const { error: updErr } = await supabase.storage.updateBucket(PAYOUT_RECEIPTS_BUCKET, BUCKET_OPTIONS);
      const { data: after } = await supabase.storage.getBucket(PAYOUT_RECEIPTS_BUCKET);
      if (updErr || !after || after.public) {
        throw new Error('payout-receipts bucket is PUBLIC and could not be made private — refusing to use it');
      }
    }
  }
  _bucketEnsured = true;
}

/**
 * Mint signed URLs for a set of bare private paths in ONE storage call.
 * Paths that don't exist (e.g. a PDF whose thumbnail never got uploaded) are
 * simply absent from the result map.
 */
export async function signReceiptPaths(
  paths: Iterable<string>,
  ttlSeconds: number = RECEIPT_SIGNED_URL_TTL_SECONDS,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(Array.from(paths).filter(isPrivateBucketPath)));
  const out = new Map<string, string>();
  if (unique.length === 0) return out;
  const supabase = getSupabaseAdmin();
  // createSignedUrls is a single request per call; chunk defensively.
  const CHUNK = 500;
  for (let i = 0; i < unique.length; i += CHUNK) {
    const chunk = unique.slice(i, i + CHUNK);
    const { data, error } = await supabase.storage
      .from(PAYOUT_RECEIPTS_BUCKET)
      .createSignedUrls(chunk, ttlSeconds);
    if (error || !data) {
      console.error('[payout-receipts] createSignedUrls failed:', error?.message);
      continue;
    }
    for (const row of data) {
      if (row.path && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
    }
  }
  return out;
}

/** Single-path convenience wrapper around signReceiptPaths. */
export async function signReceiptPath(
  path: string,
  ttlSeconds: number = RECEIPT_SIGNED_URL_TTL_SECONDS,
): Promise<string | null> {
  const map = await signReceiptPaths([path], ttlSeconds);
  return map.get(path) ?? null;
}

/**
 * Turn any stored storage reference into something the BACKEND can fetch:
 * bare private paths become a short-lived signed URL; legacy public URLs and
 * other values pass through unchanged. Throws if a private path can't be
 * signed (object missing / storage down) so callers see a fetch failure.
 */
export async function resolveFetchableUrl(ref: string): Promise<string> {
  const path = privatePathFromSignedUrl(ref) ?? ref;
  if (!isPrivateReceiptPath(path)) return ref;
  const signed = await signReceiptPath(path, SERVER_FETCH_TTL_SECONDS);
  if (!signed) {
    throw new Error(`Payout receipt not found in private storage: ${path}`);
  }
  return signed;
}

/** Upload bytes to the private bucket at `path` (server-side flows). */
export async function uploadPrivateReceipt(
  path: string,
  body: Buffer,
  contentType: string,
): Promise<void> {
  if (!isPrivateReceiptPath(path)) throw new Error(`Invalid private receipt path: ${path}`);
  await ensurePayoutReceiptsBucket();
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage
    .from(PAYOUT_RECEIPTS_BUCKET)
    .upload(path, body, { cacheControl: '3600', upsert: false, contentType });
  if (error) throw new Error(`Private receipt upload failed: ${error.message}`);
}

/** Best-effort delete of a private object (used when a file is re-classified). */
export async function removePrivateReceipt(path: string): Promise<void> {
  if (!isPrivateReceiptPath(path)) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(PAYOUT_RECEIPTS_BUCKET).remove([path]);
  if (error) console.warn('[payout-receipts] remove failed:', path, error.message);
}

const SAFE_SEGMENT_RE = /[^a-zA-Z0-9_-]/g;
const ALLOWED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif', 'pdf']);

/**
 * Build the object path for a browser receipt upload. The server picks the
 * path so a client can only ever write under its own party's folder. Shape
 * matches the historical public layout:
 *   payouts/{partyId}/{group}/receipt/{timestamp}-{rand}.{ext}
 */
export function buildReceiptUploadPath(partyId: string, group: string, ext: string): string {
  const safeGroup = (group || 'upload').replace(SAFE_SEGMENT_RE, '').slice(0, 64) || 'upload';
  const lowerExt = (ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ALLOWED_EXTS.has(lowerExt) ? lowerExt : 'jpg';
  const rand = randomBytes(6).toString('hex');
  return `payouts/${partyId}/${safeGroup}/receipt/${Date.now()}-${rand}.${safeExt}`;
}

/**
 * budget-receipts-private: server-chosen object path for a budget receipt
 * upload (same layout as the historical public one):
 *   receipts/{partyId}/{timestamp}-{rand}.{ext}
 */
export function buildBudgetReceiptUploadPath(partyId: string, ext: string): string {
  const lowerExt = (ext || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const safeExt = ALLOWED_EXTS.has(lowerExt) ? lowerExt : 'jpg';
  const rand = randomBytes(6).toString('hex');
  return `receipts/${partyId}/${Date.now()}-${rand}.${safeExt}`;
}

export interface ReceiptUploadTarget {
  path: string;
  token: string;
}

/**
 * Mint a one-shot signed UPLOAD URL so the browser can PUT the file straight
 * into the private bucket (supabase-js `uploadToSignedUrl(path, token, file)`)
 * without any storage RLS policy for anon/authenticated.
 */
export async function createReceiptUploadTarget(path: string): Promise<ReceiptUploadTarget> {
  if (!isPrivateBucketPath(path)) throw new Error(`Invalid private receipt path: ${path}`);
  await ensurePayoutReceiptsBucket();
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage
    .from(PAYOUT_RECEIPTS_BUCKET)
    .createSignedUploadUrl(path);
  if (error || !data) {
    throw new Error(`Could not create receipt upload URL: ${error?.message || 'no data'}`);
  }
  return { path: data.path, token: data.token };
}
