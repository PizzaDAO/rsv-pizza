/**
 * romana-30802: First-party cookie that stamps each RSVP with a stable
 * per-browser UUID. Supplements (does not replace) the existing temporal-join
 * fake-detection heuristic. Same cookie value repeating across many RSVPs on
 * one event ≈ same browser padding the guest list.
 *
 * Cookie spec:
 *   name:     `_rsvp_sid`
 *   value:    crypto.randomUUID() (via existing `uuid()` helper)
 *   max-age:  90 days
 *   path:     `/`
 *   SameSite: Lax
 *   Secure:   on https only
 *   HttpOnly: NO (JS reads it)
 *   Domain:   unset (host-only)
 */

import { uuid } from './utils';

const COOKIE_NAME = '_rsvp_sid';
const NINETY_DAYS_SECONDS = 60 * 60 * 24 * 90;

function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : null;
}

function writeCookie(name: string, value: string, maxAgeSec: number): void {
  if (typeof document === 'undefined') return;
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:';
  document.cookie =
    `${name}=${encodeURIComponent(value)}; Max-Age=${maxAgeSec}; Path=/; SameSite=Lax` +
    (secure ? '; Secure' : '');
}

/** Returns the existing visitor session ID, or creates and persists a new one. */
export function getOrCreateVisitorSessionId(): string {
  const existing = readCookie(COOKIE_NAME);
  // Loose hex+dash sanity check — guards against tampering/garbage values.
  if (existing && /^[a-f0-9-]{20,}$/i.test(existing)) return existing;
  const fresh = uuid();
  writeCookie(COOKIE_NAME, fresh, NINETY_DAYS_SECONDS);
  return fresh;
}
