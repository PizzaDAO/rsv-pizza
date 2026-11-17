import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFileSync } from 'node:fs';
import { cleanHost, EMPTY_SCRIPT, pickFromSnapshot, renderBrandScript, type RuntimeBrandConfig } from './_brandConfig.js';

/**
 * /brand-config.js (vercel.json rewrites it here with the request host). A blocking script loaded
 * first in <head> on runtime-brand builds (VITE_BRAND_RUNTIME=1): it sets window.__BRAND__ before
 * the app runs, so the brand never flashes. Inert (404) on every deploy that doesn't set the flag.
 *
 * Fallback chain: backend (CDN-cached upstream) -> this instance's last good copy -> the build-time
 * snapshot (api/_brand-snapshot.json) -> an empty script (the app then uses its VITE_BRAND_* env).
 */
type VercelRequest = IncomingMessage & { query: Record<string, string | string[]> };
type VercelResponse = ServerResponse & {
  status(code: number): VercelResponse;
  send(body: string): VercelResponse;
};

const API_URL = (process.env.VITE_API_URL || 'https://backend-pizza-dao.vercel.app').replace(/\/+$/, '');
const CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=86400';
const lastGood = new Map<string, RuntimeBrandConfig>();

function readSnapshot(): { configs?: RuntimeBrandConfig[] } | null {
  const candidates: Array<() => string> = [
    () => readFileSync(new URL('./_brand-snapshot.json', import.meta.url), 'utf8'),
    () => readFileSync(`${process.cwd()}/api/_brand-snapshot.json`, 'utf8'),
  ];
  for (const read of candidates) {
    try {
      return JSON.parse(read());
    } catch {
      /* try the next location */
    }
  }
  return null;
}

type Fetched = { kind: 'ok'; cfg: RuntimeBrandConfig } | { kind: 'unknown' } | { kind: 'error' };

async function fetchConfig(slug: string, host: string): Promise<Fetched> {
  const qs = slug ? `slug=${encodeURIComponent(slug)}` : `host=${encodeURIComponent(host)}`;
  try {
    const r = await fetch(`${API_URL}/api/brand-config?${qs}`, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(2500),
    });
    if (r.status === 404) return { kind: 'unknown' };
    if (!r.ok) return { kind: 'error' };
    const cfg = (await r.json()) as RuntimeBrandConfig;
    if (!cfg || typeof cfg !== 'object' || typeof cfg.slug !== 'string') return { kind: 'error' };
    return { kind: 'ok', cfg };
  } catch {
    return { kind: 'error' };
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if ((process.env.VITE_BRAND_RUNTIME || '').trim() !== '1') {
    return res.status(404).setHeader('Content-Type', 'text/plain').send('Not found');
  }

  const slug = (process.env.VITE_BRAND_SERIES_SLUG || '').trim().toLowerCase();
  const host = cleanHost(req.query.host) || cleanHost(req.headers['x-forwarded-host']) || cleanHost(req.headers.host);
  const key = slug || host;
  res.setHeader('Content-Type', 'text/javascript; charset=utf-8');
  if (!key) {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).send(EMPTY_SCRIPT);
  }

  const got = await fetchConfig(slug, host);
  if (got.kind === 'ok') {
    lastGood.set(key, got.cfg);
    res.setHeader('Cache-Control', CACHE);
    return res.status(200).send(renderBrandScript(got.cfg));
  }
  if (got.kind === 'unknown') {
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    return res.status(200).send(EMPTY_SCRIPT);
  }

  const fallback = lastGood.get(key) ?? pickFromSnapshot(readSnapshot(), slug, host);
  if (fallback) {
    res.setHeader('Cache-Control', 'public, max-age=10, s-maxage=10');
    return res.status(200).send(renderBrandScript(fallback));
  }
  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).send(EMPTY_SCRIPT);
}
