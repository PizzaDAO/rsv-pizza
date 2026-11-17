/** DB-derived CORS: active series' site_url + site_aliases are trusted; everything else is unchanged. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import cors from 'cors';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({ eventSeries: { findMany: vi.fn() } }));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import { errorHandler } from '../middleware/error.js';
import { corsOptionsDelegate } from './cors.js';
import { getSeriesOrigins, _resetSiteBrandCache } from './siteBrand.js';

const ENV = ['https://rsv.pizza']; // brand-check-ignore-line
const row = (over: Record<string, unknown> = {}) => ({
  id: 's1', slug: 'acme', siteUrl: 'https://acme.example.org', brandName: 'Acme', displayName: 'Acme', name: 'Acme',
  siteAliases: [], ...over,
});

const build = (withSeries = true) => {
  const app = express();
  app.use(cors(corsOptionsDelegate(ENV, withSeries ? getSeriesOrigins : undefined)));
  app.get('/api/parties/:id', (_req, res) => res.json({ ok: true }));
  app.get('/api/tax-form-requests/:t', (_req, res) => res.json({ ok: true }));
  app.use(errorHandler);
  return app;
};
const get = (o: string, p = '/api/parties/x', withSeries = true) => request(build(withSeries)).get(p).set('Origin', o);

beforeEach(() => {
  vi.clearAllMocks();
  _resetSiteBrandCache();
  mockPrisma.eventSeries.findMany.mockResolvedValue([row({ siteAliases: ['https://old.example.org'] })]);
});

describe('DB-derived CORS', () => {
  it('allows an active series site_url, with credentials', async () => {
    const res = await get('https://acme.example.org');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe('https://acme.example.org');
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('allows an alias (old host after cutover) and answers the preflight', async () => {
    const pre = await request(build())
      .options('/api/parties/x')
      .set('Origin', 'https://old.example.org')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,authorization');
    expect(pre.status).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('https://old.example.org');
  });

  it('an inactive series is not in the set (the cache query filters is_active), so it is rejected', async () => {
    mockPrisma.eventSeries.findMany.mockResolvedValue([]);
    const res = await get('https://acme.example.org');
    expect(res.status).toBe(403);
    expect(mockPrisma.eventSeries.findMany.mock.calls[0][0].where).toEqual({ siteUrl: { not: null }, isActive: true });
  });

  it('the env list still works, with or without the DB layer', async () => {
    expect((await get('https://rsv.pizza')).status).toBe(200); // brand-check-ignore-line
    mockPrisma.eventSeries.findMany.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    _resetSiteBrandCache();
    expect((await get('https://rsv.pizza')).status).toBe(200); // brand-check-ignore-line
  });

  it('DB error: fails closed to the env list only (series origin rejected, no 500)', async () => {
    mockPrisma.eventSeries.findMany.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await get('https://acme.example.org');
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CORS_FORBIDDEN');
  });

  it('preview regex still allowed; lookalikes and unknown origins rejected', async () => {
    expect((await get('https://rsvpizza-git-foo-pizza-dao.vercel.app')).status).toBe(200);
    for (const o of [
      'https://acme.example.org.evil.com',
      'https://evil-acme.example.org',
      'https://acme.example.org@evil.com',
      'http://acme.example.org',
      'https://acme.example.org:8443',
      'https://other.example.org',
    ]) {
      expect((await get(o)).status, o).toBe(403);
    }
  });

  it('is case-insensitive on the stored origin but matches the browser\'s exact Origin', async () => {
    mockPrisma.eventSeries.findMany.mockResolvedValue([row({ siteUrl: 'https://Acme.Example.org/' })]);
    expect((await get('https://acme.example.org')).status).toBe(200);
  });

  it('does not extend the tax-form paths (those keep their own list)', async () => {
    const res = await get('https://acme.example.org', '/api/tax-form-requests/abc');
    expect(res.status).toBe(403);
  });

  it('without the DB layer (no seriesOrigins) behavior is exactly today\'s', async () => {
    expect((await get('https://acme.example.org', '/api/parties/x', false)).status).toBe(403);
    expect(mockPrisma.eventSeries.findMany).not.toHaveBeenCalled();
  });

  it('requests without an Origin are allowed without touching the DB', async () => {
    const res = await request(build()).get('/api/parties/x');
    expect(res.status).toBe(200);
    expect(mockPrisma.eventSeries.findMany).not.toHaveBeenCalled();
  });
});

describe('getSeriesOrigins only returns exact https origins', () => {
  it.each([
    ['http origin', { siteUrl: 'http://plain.example.org' }],
    ['a path', { siteUrl: 'https://path.example.org/x' }],
    ['a wildcard', { siteUrl: 'https://*.example.org' }],
    ['userinfo', { siteUrl: 'https://u:p@h.example.org' }],
  ])('rejects %s even if a bad row got into the DB', async (_n, over) => {
    mockPrisma.eventSeries.findMany.mockResolvedValue([row({ ...over, siteAliases: [] })]);
    _resetSiteBrandCache();
    expect((await getSeriesOrigins()).size).toBe(0);
  });

  it('bad aliases are dropped, good ones kept', async () => {
    mockPrisma.eventSeries.findMany.mockResolvedValue([row({ siteAliases: ['http://a.example.org', 'https://b.example.org/p', 'https://c.example.org'] })]);
    _resetSiteBrandCache();
    expect([...(await getSeriesOrigins())].sort()).toEqual(['https://acme.example.org', 'https://c.example.org']);
  });
});
