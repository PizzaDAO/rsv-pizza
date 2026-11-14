/**
 * Process-level cache of signed read URLs for the public gallery + TV display (PR 6).
 *
 * Why signed URLs and not an image proxy route: the backend runs as a Vercel function, so a
 * proxy would stream every image (up to 10 MB, over Vercel's 4.5 MB response cap) through
 * Express and pay function time per view. Signed URLs send the browser straight to Supabase
 * storage (its CDN serves the bytes).
 *
 * Why the cache: the gallery is unauthenticated and the display polls, so signing per request
 * would call storage once per page view. A signed URL is minted with READ_URL_TTL_SECONDS
 * (15 min) and reused while at least MIN_REMAINING_MS (5 min) of it is left. That keeps the
 * number of storage calls to about one per image per 10 min per warm instance, and it hands
 * every viewer the SAME URL for that window, so browsers (and the storage CDN) cache the image
 * instead of re-downloading it on each poll. A URL handed out is always valid for >= 5 min,
 * longer than the gallery's 60 s response cache.
 */
import { READ_URL_TTL_SECONDS, signImagePaths } from './media.js';

const MIN_REMAINING_MS = 5 * 60_000;
const MAX_ENTRIES = 5000;

const cache = new Map<string, { url: string; expiresAt: number }>();

export type Signer = (paths: string[]) => Promise<Record<string, string>>;

/** path -> signed URL (missing on failure, like signImagePaths). */
export async function signImagePathsCached(paths: string[], now = Date.now(), signer: Signer = signImagePaths): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const misses: string[] = [];
  for (const p of new Set(paths.filter(Boolean))) {
    const hit = cache.get(p);
    if (hit && hit.expiresAt - now >= MIN_REMAINING_MS) out[p] = hit.url;
    else misses.push(p);
  }
  if (!misses.length) return out;

  const signed = await signer(misses);
  const expiresAt = now + READ_URL_TTL_SECONDS * 1000;
  for (const p of misses) {
    const url = signed[p];
    if (!url) continue;
    out[p] = url;
    cache.delete(p); // re-insert = most recent (Map keeps insertion order)
    cache.set(p, { url, expiresAt });
  }
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
  return out;
}

/** Tests only. */
export function _resetSignedUrlCache(): void {
  cache.clear();
}
