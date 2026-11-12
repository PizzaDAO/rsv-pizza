import { next } from '@vercel/edge';

// ---- Optional password gate ----
// Kept in this file on purpose: Vercel may run middleware as unbundled Node ESM,
// where an extensionless relative import (./siteGate) fails to resolve.
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
export const OPEN_FILES = new Set([
  '/logo.png',
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

// ---- Bot detection ----
const CRAWLER_USER_AGENTS = [
  'twitterbot',
  'facebookexternalhit',
  'facebot',
  'linkedinbot',
  'slackbot',
  'telegrambot',
  'discordbot',
  'whatsapp',
  'googlebot',
  'bingbot',
  'yandex',
  'embedly',
  'quora link preview',
  'showyoubot',
  'outbrain',
  'pinterest',
  'applebot',
  'webpage bot',
];

function isCrawler(userAgent: string | null): boolean {
  if (!userAgent) return false;
  const ua = userAgent.toLowerCase();
  return CRAWLER_USER_AGENTS.some((crawler) => ua.includes(crawler));
}

// ---- Paths that are NOT event slugs ----
const SKIP_PREFIXES = [
  '/api/',
  '/assets/',
  '/host/',
  '/rsvp/',
  '/auth/',
  '/create',
  '/login',
  '/parties',
  '/_next/',
  '/favicon',
  '/logo',
  '/og-static/',
];

// ---- Minimal markdown stripper (duplicated from frontend/src/lib/utils.ts) ----
function stripMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links
    .replace(/\*\*(.+?)\*\*/g, '$1') // bold **
    .replace(/__(.+?)__/g, '$1') // bold __
    .replace(/\*(.+?)\*/g, '$1') // italic *
    .replace(/_(.+?)_/g, '$1') // italic _
    .replace(/~~(.+?)~~/g, '$1') // strikethrough
    .replace(/^#{1,6}\s+/gm, '') // headers
    .replace(/^>\s+/gm, '') // blockquotes
    .replace(/^[\s]*[-*+]\s+/gm, '') // unordered lists
    .replace(/^[\s]*\d+\.\s+/gm, '') // ordered lists
    .replace(/`([^`]*)`/g, '$1') // inline code
    .replace(/^[-*_]{3,}\s*$/gm, '') // horizontal rules
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeHtml(text: string): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// ---- Main middleware ----
export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Optional password gate (white-label previews). Inert unless SITE_PASSWORD is set.
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword) {
    const gated = await siteGate(request, sitePassword);
    if (gated) return gated;
  }

  // Skip home page
  if (pathname === '/') return next();

  // Skip known non-event paths and files with extensions (e.g. .js, .css, .png)
  if (
    SKIP_PREFIXES.some((p) => pathname.startsWith(p)) ||
    pathname.includes('.')
  ) {
    return next();
  }

  // Only rewrite OG tags for crawlers/bots — regular browsers don't use them.
  // Also skip the OG rewriter's own internal fetch to prevent infinite loop.
  const userAgent = request.headers.get('user-agent');
  if (!userAgent || userAgent === 'RSVPizza-OG-Rewriter' || !isCrawler(userAgent)) return next();

  // Extract slug (remove leading slash and trailing slash)
  const slug = pathname.replace(/^\//, '').replace(/\/$/, '');
  if (!slug || slug.includes('/')) return next(); // multi-segment paths are not event slugs

  try {
    // Fetch event data from the backend API
    const apiUrl =
      process.env.VITE_API_URL || 'https://backend-pizza-dao.vercel.app';
    const apiResponse = await fetch(
      `${apiUrl}/api/events/${encodeURIComponent(slug)}`,
      { headers: { Accept: 'application/json' } }
    );

    if (!apiResponse.ok) {
      // Event not found or API error -- fall through to normal SPA
      return next();
    }

    const data = await apiResponse.json();
    const event = data?.event;
    if (!event) return next();

    // ---- Build meta tag values (mirrors EventPage.tsx logic) ----
    // Default keeps today's www host; a brand deploy sets VITE_BRAND_DOMAIN.
    const brandDomain = (process.env.VITE_BRAND_DOMAIN || '').trim().replace(/\/+$/, '');
    const baseUrl = brandDomain ? `https://${brandDomain}` : 'https://www.rsv.pizza'; // brand-check-ignore-line
    const brandName = (process.env.VITE_BRAND_NAME || 'RSV.Pizza').trim(); // brand-check-ignore-line
    const pageUrl = `${baseUrl}/${slug}`;

    const ogImageUrl = (() => {
      if (!event.eventImageUrl) return `${baseUrl}/logo.png`;
      if (event.eventImageUrl.startsWith('http')) return event.eventImageUrl;
      if (event.eventImageUrl.startsWith('/'))
        return `${baseUrl}${event.eventImageUrl}`;
      return `${baseUrl}/${event.eventImageUrl}`;
    })();

    const hasCustomImage = !!event.eventImageUrl;

    const eventDate = event.date ? new Date(event.date) : null;
    const formattedDate = eventDate
      ? eventDate.toLocaleDateString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          timeZone: event.timezone || undefined,
        })
      : null;
    const formattedTime = eventDate
      ? eventDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          timeZone: event.timezone || undefined,
        })
      : null;

    const metaTitle = event.name || 'Pizza Party';

    // Build description: "Hosted by X * Date @ Time * Address. description..."
    const detailsParts: string[] = [];
    if (event.hostName) detailsParts.push(`Hosted by ${event.hostName}`);
    if (formattedDate)
      detailsParts.push(
        `${formattedDate}${formattedTime ? ` @ ${formattedTime}` : ''}`
      );
    if (event.address) detailsParts.push(event.address);

    const details = detailsParts.join(' \u2022 '); // bullet separator
    let metaDescription = details;

    if (event.description) {
      const cleanDescription = stripMarkdown(event.description);
      const remainingChars = 300 - details.length;
      if (remainingChars > 10) {
        metaDescription += `. ${cleanDescription.substring(0, remainingChars)}${cleanDescription.length > remainingChars ? '...' : ''}`;
      }
    } else if (!metaDescription) {
      metaDescription = `Join us for ${metaTitle}! RSVP now.`;
    }

    const twitterCard = hasCustomImage ? 'summary_large_image' : 'summary';

    // ---- Fetch original SPA HTML and rewrite meta tags ----
    const originalResponse = await fetch(request.url, {
      headers: {
        // Override user-agent so this request doesn't re-trigger the middleware
        'User-Agent': 'RSVPizza-OG-Rewriter',
        Accept: 'text/html',
      },
    });

    let html = await originalResponse.text();

    // Replace <title>
    html = html.replace(
      /<title>[^<]*<\/title>/,
      `<title>${escapeHtml(metaTitle)} | ${escapeHtml(brandName)}</title>`
    );

    // Replace meta name="title"
    html = html.replace(
      /<meta\s+name="title"\s+content="[^"]*"\s*\/?>/,
      `<meta name="title" content="${escapeHtml(metaTitle)}" />`
    );

    // Replace meta name="description"
    html = html.replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${escapeHtml(metaDescription)}" />`
    );

    // Replace OG tags
    html = html.replace(
      /<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:url" content="${pageUrl}" />`
    );
    html = html.replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${escapeHtml(metaTitle)}" />`
    );
    html = html.replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${escapeHtml(metaDescription)}" />`
    );
    html = html.replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${ogImageUrl}" />`
    );
    html = html.replace(
      /<meta\s+property="og:image:width"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image:width" content="1200" />`
    );
    html = html.replace(
      /<meta\s+property="og:image:height"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image:height" content="1200" />`
    );

    // Replace Twitter tags
    html = html.replace(
      /<meta\s+name="twitter:card"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:card" content="${twitterCard}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:url"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:url" content="${pageUrl}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:title" content="${escapeHtml(metaTitle)}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:description" content="${escapeHtml(metaDescription)}" />`
    );
    html = html.replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:image" content="${ogImageUrl}" />`
    );

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
      },
    });
  } catch (error) {
    // On any error, fall through to normal SPA behavior
    console.error('OG middleware error:', error);
    return next();
  }
}

export const config = {
  matcher: [
    /*
     * Match all paths except built assets and API functions.
     * The middleware itself further filters by bot user-agent.
     * Prefixes end in "/" on purpose: vercel.json rewrites every other unknown
     * path to index.html, so a looser prefix (e.g. "/apixyz", "/logo.pngx")
     * would serve the app past the password gate.
     */
    '/((?!api/|assets/).*)',
  ],
};
