/**
 * GET /api/brand-config?host=<host> | ?slug=<slug>
 *
 * Public, CDN-cacheable runtime brand config for white-label sites (plans/wl-self-serve-brands.md,
 * PR 7). Resolves through the siteBrand 60 s cache (no per-request DB query) and serves only
 * `toBrandConfig()` output, so no internal field can leak. Unknown host/slug: 404.
 */
import { Router, Request, Response } from 'express';
import { createHash } from 'node:crypto';
import { brandRowFor } from '../lib/siteBrand.js';
import { toBrandConfig } from '../lib/brandConfig.js';

const router = Router();

const HOST_RE = /^[a-z0-9]([a-z0-9.-]{0,251}[a-z0-9])?(:\d{1,5})?$/;
const SLUG_RE = /^[a-z0-9]([a-z0-9-]{0,62}[a-z0-9])?$/;
const OK_CACHE = 'public, max-age=60, s-maxage=60, stale-while-revalidate=86400';

function param(v: unknown): string {
  const one = Array.isArray(v) ? v[0] : v;
  return typeof one === 'string' ? one.trim().toLowerCase() : '';
}

router.get('/', async (req: Request, res: Response) => {
  const host = param(req.query.host);
  const slug = param(req.query.slug);
  if (slug ? !SLUG_RE.test(slug) : !HOST_RE.test(host)) {
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=60');
    return res.status(400).json({ error: 'host or slug is required' });
  }

  const { row, degraded } = await brandRowFor(slug ? { slug } : { host });
  if (!row) {
    if (degraded) {
      // The series cache failed to load and has no last-good copy: don't let the CDN cache a 404.
      res.setHeader('Cache-Control', 'no-store');
      return res.status(503).json({ error: 'brand config unavailable' });
    }
    res.setHeader('Cache-Control', 'public, max-age=30, s-maxage=30');
    return res.status(404).json({ error: 'Unknown brand' });
  }

  const body = JSON.stringify(toBrandConfig(row));
  const etag = `"${createHash('sha1').update(body).digest('hex').slice(0, 16)}"`;
  res.setHeader('Cache-Control', OK_CACHE);
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) return res.status(304).end();
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  return res.status(200).send(body);
});

export default router;
