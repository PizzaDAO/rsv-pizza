import { proxyAvatarToStorage } from '../lib/supabase';

const HANDLE_RE = /^[a-zA-Z0-9_]{1,15}$/;

/**
 * Normalize an X/Twitter handle from a raw URL or @-handle.
 * Returns null if the input doesn't resolve to a valid handle.
 */
export function cleanXHandle(input: string): string | null {
  if (!input) return null;
  let h = input.trim();
  if (!h) return null;
  h = h.replace(/^https?:\/\/(www\.)?(x\.com|twitter\.com)\//i, '');
  h = h.split(/[/?#]/)[0];
  h = h.replace(/^@/, '').trim();
  return HANDLE_RE.test(h) ? h : null;
}

/**
 * Fetch the real X profile picture via fxtwitter, mirror it to Supabase storage,
 * and return the public URL. Returns null if the lookup or upload fails.
 */
export async function fetchXAvatarToSupabase(handleOrUrl: string): Promise<string | null> {
  const handle = cleanXHandle(handleOrUrl);
  if (!handle) {
    console.warn('fetchXAvatarToSupabase: invalid handle', handleOrUrl);
    return null;
  }
  try {
    const res = await fetch(`https://api.fxtwitter.com/${encodeURIComponent(handle)}`);
    if (!res.ok) {
      console.warn('fetchXAvatarToSupabase: fxtwitter HTTP', res.status, handle);
      return null;
    }
    const json = await res.json();
    if (json.code !== 200 || !json.user?.avatar_url) {
      console.warn('fetchXAvatarToSupabase: fxtwitter no avatar', { code: json.code, handle });
      return null;
    }
    const big = String(json.user.avatar_url).replace(/_normal(\.[a-zA-Z0-9]+)$/, '_400x400$1');
    // Mirror twimg URL into Supabase storage
    return await proxyAvatarToStorage(big);
  } catch (err) {
    console.warn('fetchXAvatarToSupabase: fetch threw', handle, err);
    return null;
  }
}

/**
 * Detect URLs that came from the legacy unavatar.io X auto-fill so that the X
 * onBlur handler can safely replace them. User-uploaded files (Supabase
 * storage URLs) and other manually-set avatars return false so we don't
 * clobber them on blur.
 */
export const isAutoFilledXAvatar = (url: string): boolean =>
  url.trim().startsWith('https://unavatar.io/x/');
