import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  eventSeries: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import router from './brandConfig.routes.js';
import { _resetSiteBrandCache } from '../lib/siteBrand.js';

const ROW = {
  id: 'series-ex',
  slug: 'example',
  siteUrl: 'https://pizza.example.org/',
  brandName: 'Example Pizza',
  displayName: 'Example',
  name: 'Example Pizza Parties',
  tagline: 'Slices for all',
  metaDescription: 'Example description',
  supportEmail: 'help@example.org',
  logoUrl: '/brands/example/logo.png',
  logoLightUrl: null,
  faviconUrl: 'https://cdn.example.org/fav.png',
  ogImageUrl: 'https://cdn.example.org/og.png',
  themeClass: 'example-theme',
  themeTokens: { accent: '#E6212F' },
  flyerTemplateKey: 'standard',
  flyerArt: { hero: 'a.png' },
  configVersion: 7,
  siteAliases: ['https://alt.example.org'],
  // Internal columns that must never be served:
  emailFromAddress: 'secret-sender@example.org',
  emailFromName: 'Secret Sender',
  emailReplyTo: 'reply@example.org',
  emailDomain: 'example.org',
  emailDomainVerifiedAt: new Date(),
  internalTags: ['internal-tag'],
  fundingWalletAddress: '0xWALLET',
  resendDomainId: 'resend-id',
  pendingDomainToken: 'pending-token',
};

const app = express();
app.use('/api/brand-config', router);

describe('GET /api/brand-config', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSiteBrandCache();
    mockPrisma.eventSeries.findMany.mockResolvedValue([ROW]);
  });

  it('resolves by host (site_url) with the sanitized shape and cache headers', async () => {
    const res = await request(app).get('/api/brand-config?host=pizza.example.org');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=60, s-maxage=60, stale-while-revalidate=86400');
    expect(res.headers.etag).toBeTruthy();
    expect(res.body).toEqual({
      v: 7,
      slug: 'example',
      seriesId: 'series-ex',
      name: 'Example Pizza',
      tagline: 'Slices for all',
      description: 'Example description',
      domain: 'pizza.example.org',
      url: 'https://pizza.example.org',
      logoUrl: '/brands/example/logo.png',
      logoLightUrl: null,
      faviconUrl: 'https://cdn.example.org/fav.png',
      ogImageUrl: 'https://cdn.example.org/og.png',
      hasCustomOgImage: true,
      supportEmail: 'help@example.org',
      themeClass: 'example-theme',
      tokens: { accent: '#E6212F' },
      flyer: { templateKey: 'standard', art: { hero: 'a.png' } },
    });
  });

  it('never exposes internal fields anywhere in the body', async () => {
    const res = await request(app).get('/api/brand-config?host=pizza.example.org');
    const text = res.text;
    for (const secret of ['secret-sender', 'Secret Sender', 'reply@example.org', '0xWALLET', 'internal-tag', 'resend-id', 'pending-token']) {
      expect(text).not.toContain(secret);
    }
    expect(Object.keys(res.body).sort()).toEqual([
      'description', 'domain', 'faviconUrl', 'flyer', 'hasCustomOgImage', 'logoLightUrl', 'logoUrl', 'name',
      'ogImageUrl', 'seriesId', 'slug', 'supportEmail', 'tagline', 'themeClass', 'tokens', 'url', 'v',
    ]);
  });

  it('resolves an alias host and a slug', async () => {
    expect((await request(app).get('/api/brand-config?host=alt.example.org')).body.slug).toBe('example');
    expect((await request(app).get('/api/brand-config?slug=example')).body.slug).toBe('example');
  });

  it('404s an unknown host or slug and 400s a malformed one', async () => {
    expect((await request(app).get('/api/brand-config?host=nope.example.net')).status).toBe(404);
    expect((await request(app).get('/api/brand-config?slug=nope')).status).toBe(404);
    expect((await request(app).get('/api/brand-config')).status).toBe(400);
    expect((await request(app).get('/api/brand-config?host=a/b')).status).toBe(400);
    expect((await request(app).get('/api/brand-config?slug=A%20B')).status).toBe(400);
  });

  it('answers 304 for a matching If-None-Match', async () => {
    const first = await request(app).get('/api/brand-config?host=pizza.example.org');
    const second = await request(app).get('/api/brand-config?host=pizza.example.org').set('If-None-Match', first.headers.etag);
    expect(second.status).toBe(304);
  });

  it('is cheap: repeated requests hit the siteBrand cache, not the DB', async () => {
    for (let i = 0; i < 5; i++) await request(app).get('/api/brand-config?host=pizza.example.org');
    expect(mockPrisma.eventSeries.findMany).toHaveBeenCalledTimes(1);
  });

  it('503 (not a cacheable 404) when the DB fails and there is no last-good copy', async () => {
    mockPrisma.eventSeries.findMany.mockRejectedValue(new Error('db down'));
    const res = await request(app).get('/api/brand-config?host=pizza.example.org');
    expect(res.status).toBe(503);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('drops unsafe URLs and class names instead of serving them', async () => {
    mockPrisma.eventSeries.findMany.mockResolvedValue([
      { ...ROW, logoUrl: 'javascript:alert(1)', faviconUrl: '//evil.example.net/x.png', ogImageUrl: 'data:text/html,x', themeClass: 'a b"><script>' },
    ]);
    const res = await request(app).get('/api/brand-config?slug=example');
    expect(res.body.logoUrl).toBeNull();
    expect(res.body.faviconUrl).toBeNull();
    expect(res.body.ogImageUrl).toBeNull();
    expect(res.body.hasCustomOgImage).toBe(false);
    expect(res.body.themeClass).toBeNull();
  });
});
