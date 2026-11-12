/**
 * Optional site-wide password gate (white-label previews).
 *
 * Active ONLY when the server-side env var SITE_PASSWORD is set (deliberately
 * not VITE_-prefixed, so it never reaches the client bundle). Unset = no gate,
 * and middleware.ts behaves exactly as it always has.
 *
 * Flow: any gated request without a valid cookie gets a minimal password form
 * (401). The form POSTs to /__gate; a correct password sets an HttpOnly,
 * Secure, SameSite=Lax cookie that holds an HMAC of the password (never the
 * raw value) and redirects back. Remove the gate by unsetting SITE_PASSWORD.
 * Uses only Web Crypto, so it runs in the Vercel Edge runtime.
 */

export const GATE_PATH = '/__gate';
export const GATE_COOKIE = 'site_gate';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const HMAC_MESSAGE = 'site-gate-v1';

/**
 * Real public files (frontend/public) that may load before login, e.g. on the
 * password form or in link previews. Exact paths only: vercel.json rewrites
 * every unknown path to index.html, so an extension or prefix match would let
 * the SPA shell through ungated.
 */
const OPEN_FILES = new Set([
  '/logo.png',
  '/favicon.ico',
  '/party.svg',
  '/fonts/Hub-191-Display.otf',
  '/fonts/Hub-191-Regular.otf',
  '/brands/team1/logo.png',
  '/brands/team1/favicon.png',
  '/brands/team1/og.png',
  '/brands/monad/logo.png',
  '/brands/monad/favicon.png',
  '/brands/monad/og.png',
]);

/** Paths that bypass the gate: hashed build assets and an explicit file allowlist. */
export function isOpenAsset(pathname: string): boolean {
  return pathname.startsWith('/assets/') || OPEN_FILES.has(pathname);
}

async function hmacHex(key: string, message: string): Promise<string> {
  const enc = new TextEncoder();
  const k = await crypto.subtle.importKey('raw', enc.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', k, enc.encode(message));
  return Array.from(new Uint8Array(sig), (b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function readCookie(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) return part.slice(idx + 1).trim();
  }
  return null;
}

function safeNext(value: unknown): string {
  if (typeof value !== 'string') return '/';
  // Same-origin relative paths only (blocks //evil.com and /\evil.com).
  // Printable ASCII only: rejects tabs/newlines (browsers strip them, turning "/\t/evil.com" into "//evil.com")
  // and non-Latin-1 text that would make the Location header throw.
  if (!/^[\x20-\x7e]+$/.test(value)) return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.startsWith('/\\')) return '/';
  if (value.startsWith(GATE_PATH)) return '/';
  return value;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function formPage(next: string, failed: boolean): Response {
  const html = `<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Password required</title>
<style>
  body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#111;color:#fff;font-family:system-ui,sans-serif}
  form{display:flex;flex-direction:column;gap:12px;width:min(320px,86vw)}
  input,button{font:inherit;padding:12px 14px;border-radius:8px;border:1px solid #444;background:#1c1c1c;color:#fff}
  button{background:#fff;color:#111;border:0;font-weight:600;cursor:pointer}
  p{margin:0;color:#ff7b7b;font-size:14px}
</style></head><body>
<form method="POST" action="${GATE_PATH}">
  <input type="password" name="password" placeholder="Password" autofocus autocomplete="current-password" required>
  <input type="hidden" name="next" value="${escapeAttr(next)}">
  ${failed ? '<p>Incorrect password.</p>' : ''}
  <button type="submit">Enter</button>
</form></body></html>`;
  return new Response(html, {
    status: 401,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}

/**
 * Returns a Response to short-circuit the request (form / redirect), or null
 * when the request may proceed (gate disabled, open asset, or valid cookie).
 */
export async function siteGate(request: Request, password: string | undefined): Promise<Response | null> {
  if (!password) return null;

  const url = new URL(request.url);
  const expected = await hmacHex(password, HMAC_MESSAGE);

  if (url.pathname === GATE_PATH) {
    if (request.method !== 'POST') {
      return new Response(null, { status: 303, headers: { Location: '/', 'Cache-Control': 'no-store' } });
    }
    let submitted = '';
    let next = '/';
    try {
      const form = await request.formData();
      submitted = String(form.get('password') ?? '');
      next = safeNext(form.get('next'));
    } catch {
      /* malformed body -> treated as wrong password */
    }
    const got = await hmacHex(password, HMAC_MESSAGE + '|' + submitted);
    const want = await hmacHex(password, HMAC_MESSAGE + '|' + password);
    if (!timingSafeEqual(got, want)) return formPage(next, true);
    return new Response(null, {
      status: 303,
      headers: {
        Location: next,
        'Set-Cookie': `${GATE_COOKIE}=${expected}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_MAX_AGE}`,
        'Cache-Control': 'no-store',
      },
    });
  }

  // Anything a browser asks for as a page is gated, whatever the path.
  const wantsHtml = (request.headers.get('accept') || '').includes('text/html');
  if (!wantsHtml && isOpenAsset(url.pathname)) return null;
  if (wantsHtml && url.pathname.startsWith('/assets/')) return null;

  const cookie = readCookie(request.headers.get('cookie'), GATE_COOKIE);
  if (cookie && timingSafeEqual(cookie, expected)) return null;

  return formPage(safeNext(url.pathname + url.search), false);
}
