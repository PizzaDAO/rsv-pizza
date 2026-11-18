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
 *
 * Automation bypass: when the server-only env var SITE_GATE_BYPASS is set AND
 * is at least 32 chars, a request carrying an `x-site-gate-bypass` header equal
 * to it (constant-time compare) skips the gate as if it had a valid cookie. No
 * cookie is set, and query params are never accepted (header only, so the
 * secret stays out of URLs/logs). Unset or shorter = no bypass; a wrong header
 * falls through to the normal gate with no distinct error.
 * Uses only Web Crypto, so it runs in the Vercel Edge runtime.
 */

export const GATE_PATH = '/__gate';
export const GATE_COOKIE = 'site_gate';
const COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days
const HMAC_MESSAGE = 'site-gate-v1';
export const BYPASS_HEADER = 'x-site-gate-bypass';
const BYPASS_MIN_LENGTH = 32;

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
  '/brands/monad/logo-dark.png',
  '/brands/monad/favicon.png',
  '/brands/monad/og.png',
  '/brands/doge/logo.png',
  '/brands/doge/favicon.png',
  '/brands/doge/og.png',
  '/brands/doge/frame.png',
  '/brands/swc/logo.png',
  '/brands/swc/favicon.png',
  '/brands/swc/og.png',
]);

/** Paths that bypass the gate: hashed build assets and an explicit file allowlist. */
export function isOpenAsset(pathname: string): boolean {
  // /cdn/ is a storage rewrite (vercel.json), not the SPA shell, so a prefix match is safe here.
  return (
    pathname.startsWith('/assets/') || pathname.startsWith('/cdn/brand-assets/') ||
    pathname === '/brand-config.js' || // runtime brand script (VITE_BRAND_RUNTIME=1): a function, not a public file
    OPEN_FILES.has(pathname)
  );
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
      ...SECURITY_HEADERS,
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
export async function siteGate(
  request: Request,
  password: string | undefined,
  bypassSecret?: string
): Promise<Response | null> {
  if (!password) return null;

  // Automation bypass: header only, secret >= 32 chars. Compare HMACs so length is not leaked.
  const presented = request.headers.get(BYPASS_HEADER);
  if (bypassSecret && bypassSecret.length >= BYPASS_MIN_LENGTH && presented) {
    const a = await hmacHex(bypassSecret, 'site-gate-bypass-v1|' + presented);
    const b = await hmacHex(bypassSecret, 'site-gate-bypass-v1|' + bypassSecret);
    if (timingSafeEqual(a, b)) return null;
  }

  const url = new URL(request.url);
  const expected = await hmacHex(password, HMAC_MESSAGE);

  if (url.pathname === GATE_PATH) {
    if (request.method !== 'POST') {
      return new Response(null, { status: 303, headers: { ...SECURITY_HEADERS, Location: '/', 'Cache-Control': 'no-store' } });
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
        ...SECURITY_HEADERS,
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

// ---- Runtime brand config (VITE_BRAND_RUNTIME=1) ----
// Inlined on purpose: unbundled Node ESM cannot resolve extensionless relative imports.
export interface RuntimeBrandCfg {
  seriesId?: string;
  slug?: string;
  name?: string;
  tagline?: string | null;
  description?: string | null;
  url?: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  ogImageUrl?: string | null;
  hasCustomOgImage?: boolean;
}

const BRAND_CFG_TTL_MS = 60_000;
const brandCfgCache = new Map<string, { at: number; cfg: RuntimeBrandCfg | null }>();

/** True only on builds/deploys that opted in to runtime brand config. */
export function brandRuntimeOn(): boolean {
  return (process.env.VITE_BRAND_RUNTIME || '').trim() === '1';
}

/**
 * The brand config for a request, from the backend's public /api/brand-config (by series slug when
 * the deploy is pinned to one, else by host). 60 s in-isolate cache, 2 s timeout, and a failed
 * refresh keeps serving the last good copy. Null = unknown / unavailable: callers use env.
 */
export async function getBrandConfig(host: string, apiUrl: string, slug = ''): Promise<RuntimeBrandCfg | null> {
  const key = slug ? `slug:${slug}` : `host:${host.toLowerCase()}`;
  const hit = brandCfgCache.get(key);
  if (hit && Date.now() - hit.at < BRAND_CFG_TTL_MS) return hit.cfg;
  try {
    const qs = slug ? `slug=${encodeURIComponent(slug)}` : `host=${encodeURIComponent(host.toLowerCase())}`;
    const r = await fetch(`${apiUrl}/api/brand-config?${qs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2000),
    });
    if (r.status === 404) {
      brandCfgCache.set(key, { at: Date.now(), cfg: null });
      return null;
    }
    if (!r.ok) throw new Error(`brand-config HTTP ${r.status}`);
    const cfg = (await r.json()) as RuntimeBrandCfg;
    if (!cfg || typeof cfg.slug !== 'string') throw new Error('brand-config: unexpected body');
    brandCfgCache.set(key, { at: Date.now(), cfg });
    return cfg;
  } catch {
    // Keep the last good copy (even if stale) and retry in a minute.
    const stale = hit?.cfg ?? null;
    brandCfgCache.set(key, { at: Date.now(), cfg: stale });
    return stale;
  }
}

/** Absolute URL for an image path against a site origin. */
function absoluteUrl(origin: string, value: string): string {
  if (/^https?:\/\//i.test(value)) return value;
  return `${origin}${value.startsWith('/') ? '' : '/'}${value}`;
}

export interface MetaValues {
  /** <title> text (may differ from the social title). */
  docTitle: string;
  title: string;
  description?: string;
  url: string;
  image: string;
  imageWidth: number;
  imageHeight: number;
  twitterCard: string;
  /** og:site_name; omitted = leave the static value. */
  siteName?: string;
  /** Tab icon href; omitted = leave the static value. */
  favicon?: string;
}

/**
 * Rewrite the static SPA tags to `meta`. Every value is HTML-escaped (URLs included), and the
 * replacements are functions so a `$&` / `$1` inside a name or description is never interpreted.
 */
export function rewriteMeta(html: string, meta: MetaValues): string {
  const sub = (re: RegExp, text: string) => {
    html = html.replace(re, () => text);
  };
  const e = escapeHtml;
  sub(/<title>[^<]*<\/title>/, `<title>${e(meta.docTitle)}</title>`);
  sub(/<meta\s+name="title"\s+content="[^"]*"\s*\/?>/, `<meta name="title" content="${e(meta.title)}" />`);
  if (meta.description !== undefined) {
    sub(/<meta\s+name="description"\s+content="[^"]*"\s*\/?>/, `<meta name="description" content="${e(meta.description)}" />`);
    sub(/<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/, `<meta property="og:description" content="${e(meta.description)}" />`);
    sub(/<meta\s+name="twitter:description"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:description" content="${e(meta.description)}" />`);
  }
  sub(/<meta\s+property="og:url"\s+content="[^"]*"\s*\/?>/, `<meta property="og:url" content="${e(meta.url)}" />`);
  sub(/<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/, `<meta property="og:title" content="${e(meta.title)}" />`);
  sub(/<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image" content="${e(meta.image)}" />`);
  sub(/<meta\s+property="og:image:width"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image:width" content="${meta.imageWidth}" />`);
  sub(/<meta\s+property="og:image:height"\s+content="[^"]*"\s*\/?>/, `<meta property="og:image:height" content="${meta.imageHeight}" />`);
  sub(/<meta\s+name="twitter:card"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:card" content="${e(meta.twitterCard)}" />`);
  sub(/<meta\s+name="twitter:url"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:url" content="${e(meta.url)}" />`);
  sub(/<meta\s+name="twitter:title"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:title" content="${e(meta.title)}" />`);
  sub(/<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/, `<meta name="twitter:image" content="${e(meta.image)}" />`);
  if (meta.siteName !== undefined) {
    sub(/<meta\s+property="og:site_name"\s+content="[^"]*"\s*\/?>/, `<meta property="og:site_name" content="${e(meta.siteName)}" />`);
  }
  if (meta.favicon !== undefined) {
    sub(/<link\s+rel="icon"\s+type="image\/png"\s+href="[^"]*"\s*\/?>/, `<link rel="icon" type="image/png" href="${e(meta.favicon)}" />`);
  }
  return html;
}

/** Meta for the home page of a runtime-configured brand. */
export function homeMeta(cfg: RuntimeBrandCfg): MetaValues {
  const origin = (cfg.url || '').replace(/\/+$/, '');
  const name = (cfg.name || '').trim();
  const tagline = (cfg.tagline || process.env.VITE_BRAND_TAGLINE || 'Pizza Party Planner').trim();
  const title = `${name} - ${tagline}`;
  const imgRaw = (cfg.ogImageUrl || cfg.logoUrl || '').trim() || '/logo.png';
  const custom = !!cfg.hasCustomOgImage;
  return {
    docTitle: title,
    title,
    description: (cfg.description || '').trim() || undefined,
    url: `${origin}/`,
    image: absoluteUrl(origin, imgRaw),
    imageWidth: custom ? 1200 : 512,
    imageHeight: custom ? 630 : 512,
    twitterCard: custom ? 'summary_large_image' : 'summary',
    siteName: name,
    favicon: (cfg.faviconUrl || cfg.logoUrl || '').trim() || undefined,
  };
}

// ---- Main middleware ----
// Baseline security headers for the middleware's own responses (vercel.json covers the rest).
const SECURITY_HEADERS: Record<string, string> = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "frame-ancestors 'none'",
};

export default async function middleware(request: Request) {
  const url = new URL(request.url);
  const pathname = url.pathname;

  // Optional password gate (white-label previews). Inert unless SITE_PASSWORD is set.
  const sitePassword = process.env.SITE_PASSWORD;
  if (sitePassword) {
    const gated = await siteGate(request, sitePassword, process.env.SITE_GATE_BYPASS);
    if (gated) return gated;
  }

  // Home page: only runtime-brand builds rewrite it (and only for crawlers); everything else is untouched.
  if (pathname === '/') {
    if (!brandRuntimeOn()) return next();
    const ua = request.headers.get('user-agent');
    if (!ua || ua === 'RSVPizza-OG-Rewriter' || !isCrawler(ua)) return next();
    try {
      const apiUrl = process.env.VITE_API_URL || 'https://backend-pizza-dao.vercel.app';
      const cfg = await getBrandConfig(url.hostname, apiUrl, (process.env.VITE_BRAND_SERIES_SLUG || '').trim().toLowerCase());
      if (!cfg || !cfg.name || !cfg.url) return next();
      const original = await fetch(request.url, { headers: { 'User-Agent': 'RSVPizza-OG-Rewriter', Accept: 'text/html' } });
      if (!original.ok) return next();
      const html = rewriteMeta(await original.text(), homeMeta(cfg));
      return new Response(html, {
        status: 200,
        headers: {
          ...SECURITY_HEADERS,
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
        },
      });
    } catch (error) {
      console.error('OG middleware error (home):', error);
      return next();
    }
  }

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

  // Extract slug (remove leading slash and trailing slash). Hackathon PR 6: /:slug/projects and
  // /:slug/projects/:projectSlug get project OG tags; any other multi-segment path is not an event.
  const trimmed = pathname.replace(/^\//, '').replace(/\/$/, '');
  const projectsPath = /^([^/]+)\/projects(?:\/([a-z0-9]+(?:-[a-z0-9]+)*))?$/.exec(trimmed);
  const slug = projectsPath ? projectsPath[1] : trimmed;
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

    // Runtime brand config (VITE_BRAND_RUNTIME=1): origin, name and series scope come from the DB
    // config for this host/series. Unknown or unavailable config falls back to the env below.
    const scopedSlug = (process.env.VITE_BRAND_SERIES_SLUG || '').trim();
    const rt = brandRuntimeOn() ? await getBrandConfig(url.hostname, apiUrl, scopedSlug.toLowerCase()) : null;

    // White-label: a series-scoped deployment only emits event OG tags for its own series.
    // Anything else (or an unresolvable series) falls through to the SPA's generic brand tags.
    // Inlined on purpose: unbundled Node ESM cannot resolve extensionless relative imports.
    let brandSeriesOg: string | null = null;
    if (rt && rt.seriesId) {
      if (!event.eventSeriesId || event.eventSeriesId !== rt.seriesId) return next();
      brandSeriesOg = (rt.ogImageUrl || '').trim() || null;
    } else if (scopedSlug) {
      let mine: { id: string; ogImageUrl?: string | null } | null = null;
      try {
        const sr = await fetch(`${apiUrl}/api/series`, { headers: { Accept: 'application/json' } });
        if (sr.ok) mine = ((await sr.json())?.series || []).find((x: { slug: string }) => x.slug === scopedSlug) ?? null;
      } catch {
        mine = null;
      }
      if (!mine || !event.eventSeriesId || event.eventSeriesId !== mine.id) return next();
      brandSeriesOg = (mine.ogImageUrl || '').trim() || null;
    }

    // ---- Build meta tag values (mirrors EventPage.tsx logic) ----
    // Default keeps today's www host; a brand deploy sets VITE_BRAND_DOMAIN.
    const brandDomain = (process.env.VITE_BRAND_DOMAIN || '').trim().replace(/\/+$/, '');
    const envBaseUrl = brandDomain ? `https://${brandDomain}` : 'https://www.rsv.pizza'; // brand-check-ignore-line
    const baseUrl = rt && rt.url ? rt.url.replace(/\/+$/, '') : envBaseUrl;
    const brandName = rt && rt.name ? rt.name : (process.env.VITE_BRAND_NAME || 'RSV.Pizza').trim(); // brand-check-ignore-line
    const pageUrl = `${baseUrl}/${projectsPath ? trimmed : slug}`;

    // Hackathon gallery / project page: the public endpoints decide visibility (a hidden gallery
    // or project 404s / says unavailable -> normal SPA tags). Never the cover image: it's a
    // short-lived signed URL, and crawlers cache og:image for days.
    let projectMeta: { title: string; description: string } | null = null;
    if (projectsPath) {
      const projectSlug = projectsPath[2];
      const r = await fetch(
        projectSlug
          ? `${apiUrl}/api/parties/${encodeURIComponent(event.id)}/hackathon/projects/${projectSlug}`
          : `${apiUrl}/api/parties/${encodeURIComponent(event.id)}/hackathon/gallery`,
        { headers: { Accept: 'application/json' } }
      );
      if (!r.ok) return next();
      const body = await r.json();
      if (projectSlug) {
        const proj = body?.project;
        if (!proj?.name) return next();
        const text = proj.tagline || (proj.description ? stripMarkdown(proj.description) : '');
        projectMeta = {
          title: `${proj.name} · ${event.name || 'Hackathon'}`,
          description: (text || `A hackathon project from ${event.name || 'this event'}`).substring(0, 300),
        };
      } else {
        if (!body?.available) return next();
        const n = Array.isArray(body.projects) ? body.projects.length : 0;
        projectMeta = {
          title: `Projects · ${event.name || 'Hackathon'}`,
          description: `${n} hackathon project${n === 1 ? '' : 's'} from ${event.name || 'this event'}.`,
        };
      }
    }

    const ogImageUrl = (() => {
      // Default site keeps /logo.png; a brand deploy uses its own OG image / logo.
      if (!event.eventImageUrl) {
        const brandImg = (rt
          ? (rt.ogImageUrl || rt.logoUrl || '')
          : (process.env.VITE_BRAND_OG_IMAGE || brandSeriesOg || process.env.VITE_BRAND_LOGO_URL || '')
        ).trim();
        if (!brandImg) return `${baseUrl}/logo.png`;
        if (/^https?:\/\//i.test(brandImg)) return brandImg;
        return `${baseUrl}${brandImg.startsWith('/') ? '' : '/'}${brandImg}`;
      }
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

    const metaTitle = projectMeta?.title || event.name || 'Pizza Party';

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

    if (projectMeta) metaDescription = projectMeta.description;

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

    html = rewriteMeta(html, {
      docTitle: `${metaTitle} | ${brandName}`,
      title: metaTitle,
      description: metaDescription,
      url: pageUrl,
      image: ogImageUrl,
      imageWidth: 1200,
      imageHeight: 1200,
      twitterCard,
    });

    return new Response(html, {
      status: 200,
      headers: {
        ...SECURITY_HEADERS,
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
