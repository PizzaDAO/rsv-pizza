/**
 * Project images in the PRIVATE `hackathon-media` bucket (plans/hackathon-platform.md §5, §11).
 * Created in the Supabase dashboard (images only, 10 MB). Same signed-upload pattern as
 * services/pizzaSubmission.service.ts: the browser uploads straight to storage, so image
 * bytes never travel in an Express request body (Vercel's 4.5 MB limit). The backend does
 * download each upload once, server-side, in step 3 to verify it.
 *
 *   1. upload-url: the backend mints a signed upload token for
 *        {hackathonId}/{submissionId}/tmp/{uuid}.{ext}
 *      (MIME + size checked here; the bucket enforces both again).
 *   2. The browser uploads with supabase-js uploadToSignedUrl.
 *   3. attach: the backend downloads the tmp object, checks size + magic bytes, re-uploads it to
 *        {hackathonId}/{submissionId}/{uuid}.{ext}
 *      with an explicit content type (so the client's token, which can overwrite the tmp path
 *      until it expires, can't touch the stored file), deletes the tmp object and records the
 *      final path on the submission.
 * Only object PATHS are stored. Viewers get short-lived signed read URLs minted per request.
 */
import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { AppError } from '../../middleware/error.js';

export const MEDIA_BUCKET = 'hackathon-media';
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_SCREENSHOTS = 6; // DB CHECK cardinality(screenshot_paths) <= 6
export const READ_URL_TTL_SECONDS = 60 * 15;

/** Types every browser can render (HEIC is left out on purpose: most browsers can't show it). */
export const IMAGE_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

let _client: ReturnType<typeof createClient> | null = null;
function admin() {
  if (_client) return _client;
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new AppError('Image uploads are not configured', 503, 'UPLOADS_UNAVAILABLE');
  _client = createClient(url, key);
  return _client;
}
const bucket = () => admin().storage.from(MEDIA_BUCKET);

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const EXT = '(jpg|png|webp|gif|avif)';

/** True when `path` is a tmp upload for exactly this submission. */
export function isTmpPathFor(path: unknown, hackathonId: string, submissionId: string): path is string {
  if (typeof path !== 'string' || path.length > 200) return false;
  const m = new RegExp(`^(${UUID})/(${UUID})/tmp/${UUID}\\.${EXT}$`).exec(path);
  return !!m && m[1] === hackathonId && m[2] === submissionId;
}

/** True when `path` is a stored (final) image of exactly this submission. */
export function isFinalPathFor(path: unknown, hackathonId: string, submissionId: string): path is string {
  if (typeof path !== 'string' || path.length > 200) return false;
  const m = new RegExp(`^(${UUID})/(${UUID})/${UUID}\\.${EXT}$`).exec(path);
  return !!m && m[1] === hackathonId && m[2] === submissionId;
}

export function validateImageRequest(mimeType: unknown, fileSize: unknown): string {
  if (typeof mimeType !== 'string' || !IMAGE_MIME[mimeType]) {
    throw new AppError('Please upload a JPEG, PNG, WebP, GIF or AVIF image', 400, 'BAD_FILE_TYPE');
  }
  if (typeof fileSize !== 'number' || !Number.isFinite(fileSize) || fileSize <= 0) {
    throw new AppError('Missing file size', 400, 'BAD_FILE_SIZE');
  }
  if (fileSize > MAX_IMAGE_BYTES) throw new AppError('That image is too big (10 MB max)', 413, 'FILE_TOO_BIG');
  return IMAGE_MIME[mimeType];
}

/** Magic-byte sniff. Returns an IMAGE_MIME key or null. */
export function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.subarray(0, 4).toString('latin1') === 'RIFF' && buf.subarray(8, 12).toString('latin1') === 'WEBP') return 'image/webp';
  const g = buf.subarray(0, 6).toString('latin1');
  if (g === 'GIF87a' || g === 'GIF89a') return 'image/gif';
  if (buf.subarray(4, 8).toString('latin1') === 'ftyp' && ['avif', 'avis'].includes(buf.subarray(8, 12).toString('latin1'))) return 'image/avif';
  return null;
}

export async function createImageUploadUrl(hackathonId: string, submissionId: string, ext: string) {
  const path = `${hackathonId}/${submissionId}/tmp/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await bucket().createSignedUploadUrl(path);
  if (error || !data) throw new AppError('Could not start the upload. Please try again.', 502, 'UPLOAD_URL_FAILED');
  return { path, token: data.token };
}

/** Verify a tmp upload and move it to a server-owned final path. Returns the final path. */
export async function finalizeImage(tmpPath: string, hackathonId: string, submissionId: string): Promise<string> {
  const { data: blob, error } = await bucket().download(tmpPath);
  if (error || !blob) throw new AppError('We could not find your uploaded image. Please try again.', 400, 'FILE_MISSING');
  const discard = () => bucket().remove([tmpPath]).then(() => undefined, () => undefined);
  const buf = Buffer.from(await blob.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_IMAGE_BYTES) {
    await discard();
    throw new AppError('That image is too big (10 MB max)', 413, 'FILE_TOO_BIG');
  }
  const mime = sniffImage(buf);
  if (!mime || IMAGE_MIME[mime] !== tmpPath.split('.').pop()) {
    await discard();
    throw new AppError('That file does not look like a JPEG, PNG, WebP, GIF or AVIF image', 400, 'BAD_FILE_TYPE');
  }
  const finalPath = `${hackathonId}/${submissionId}/${crypto.randomUUID()}.${IMAGE_MIME[mime]}`;
  const up = await bucket().upload(finalPath, buf, { contentType: mime, upsert: false });
  if (up.error) throw new AppError('Could not store your image. Please try again.', 502, 'STORE_FAILED');
  await discard();
  return finalPath;
}

/** Best-effort delete (a leftover object is harmless: private bucket, unreferenced). */
export async function removeImages(paths: string[]): Promise<void> {
  if (!paths.length) return;
  try {
    await bucket().remove(paths);
  } catch {
    /* ignore */
  }
}

const ABANDONED_AGE_MS = 24 * 3600_000;
const CLEANUP_MAX_DELETES = 1000;
const CLEANUP_MAX_LISTS = 2000;

type StoreLike = {
  list: (prefix: string, opts: { limit: number; offset?: number }) => Promise<{ data: Array<{ id: string | null; name: string; created_at?: string | null }> | null }>;
  remove: (paths: string[]) => Promise<unknown>;
};

/**
 * Daily cron (/api/cron/cleanup-hackathon-uploads): delete `{hackathonId}/{submissionId}/tmp/*`
 * objects older than 24h. A tmp object only exists between upload-url and attach (attach
 * moves it to a final path and deletes it), so anything older is an abandoned upload. Final
 * paths are never touched. Mirrors pizzaSubmission.service cleanupOrphanedUploads.
 */
export async function cleanupAbandonedUploads(now: Date = new Date(), store: StoreLike = bucket() as unknown as StoreLike): Promise<{ scanned: number; deleted: number }> {
  const cutoff = now.getTime() - ABANDONED_AGE_MS;
  const isFolder = (e: { id: string | null; name: string }) => !e.id && !!e.name;
  const uuidRe = new RegExp(`^${UUID}$`);
  let lists = 0;
  let scanned = 0;
  const doomed: string[] = [];
  const list = async (prefix: string) => {
    lists++;
    const { data } = await store.list(prefix, { limit: 1000 });
    return data ?? [];
  };
  outer: for (const h of (await list('')).filter((e) => isFolder(e) && uuidRe.test(e.name))) {
    for (const s of (await list(h.name)).filter((e) => isFolder(e) && uuidRe.test(e.name))) {
      if (lists >= CLEANUP_MAX_LISTS || doomed.length >= CLEANUP_MAX_DELETES) break outer;
      const files = await list(`${h.name}/${s.name}/tmp`);
      scanned += files.length;
      for (const f of files) {
        if (f.id && f.created_at && new Date(f.created_at).getTime() < cutoff) doomed.push(`${h.name}/${s.name}/tmp/${f.name}`);
      }
    }
  }
  const batch = doomed.slice(0, CLEANUP_MAX_DELETES);
  if (batch.length) await store.remove(batch);
  return { scanned, deleted: batch.length };
}

/** path -> short-lived signed URL (missing on failure; callers render without the image). */
export async function signImagePaths(paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const uniq = [...new Set(paths.filter(Boolean))];
  if (!uniq.length) return out;
  try {
    const { data } = await bucket().createSignedUrls(uniq, READ_URL_TTL_SECONDS);
    for (const row of data ?? []) {
      if (row.path && row.signedUrl && !row.error) out[row.path] = row.signedUrl;
    }
  } catch {
    /* uploads not configured / storage down: no images */
  }
  return out;
}
