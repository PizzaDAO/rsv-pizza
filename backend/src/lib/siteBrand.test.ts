import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  eventSeries: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import {
  siteForParty,
  siteForOrigin,
  getSeriesSites,
  brandedSeriesBySlug,
  normalizeOrigin,
  _resetSiteBrandCache,
} from './siteBrand.js';
import { brand } from '../config/brand.js';

const TEAM1 = {
  id: 'series-team1',
  slug: 'team1',
  siteUrl: 'https://team1.rsv.pizza',
  brandName: 'Team1 Pizza',
  displayName: 'Team1',
  name: 'Team1 Pizza Parties',
};
const MONAD = {
  id: 'series-monad',
  slug: 'monad',
  siteUrl: 'https://monad.rsv.pizza/',
  brandName: null,
  displayName: 'Monad',
  name: 'Monad Pizza Parties',
};

describe('siteBrand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSiteBrandCache();
    mockPrisma.eventSeries.findMany.mockResolvedValue([TEAM1, MONAD]);
  });

  describe('siteForParty', () => {
    it('no series: returns the call-site fallback + deploy brand, with no DB access', async () => {
      for (const party of [{}, { eventSeriesId: null }, null, undefined]) {
        const site = await siteForParty(party as any, 'https://rsv.pizza');
        expect(site).toEqual({ url: 'https://rsv.pizza', name: brand.name, fromEmail: brand.fromEmail });
      }
      expect(mockPrisma.eventSeries.findMany).not.toHaveBeenCalled();
    });

    it('keeps each call site its own fallback literal (no normalization)', async () => {
      const a = await siteForParty({ eventSeriesId: null }, 'https://rsv.pizza');
      const b = await siteForParty({ eventSeriesId: null }, 'http://localhost:5176');
      expect(a.url).toBe('https://rsv.pizza');
      expect(b.url).toBe('http://localhost:5176');
    });

    it('series without site_url (e.g. gpp2026) falls back unchanged', async () => {
      // findMany only returns series with site_url, so gpp2026's id is absent from the cache.
      const site = await siteForParty({ eventSeriesId: 'series-gpp2026' }, 'https://rsv.pizza');
      expect(site).toEqual({ url: 'https://rsv.pizza', name: brand.name, fromEmail: brand.fromEmail });
    });

    it('branded series: its origin, brand_name and noreply@rsv.pizza sender', async () => {
      const site = await siteForParty({ eventSeriesId: 'series-team1' }, 'https://rsv.pizza');
      expect(site).toEqual({
        url: 'https://team1.rsv.pizza',
        name: 'Team1 Pizza',
        fromEmail: `Team1 Pizza <${brand.noreplyEmail}>`,
      });
    });

    it('strips a trailing slash and falls back to displayName when brand_name is null', async () => {
      const site = await siteForParty({ eventSeriesId: 'series-monad' }, 'https://rsv.pizza');
      expect(site.url).toBe('https://monad.rsv.pizza');
      expect(site.name).toBe('Monad');
    });

    it('DB failure falls back instead of throwing', async () => {
      mockPrisma.eventSeries.findMany.mockRejectedValue(new Error('db down'));
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const site = await siteForParty({ eventSeriesId: 'series-team1' }, 'https://rsv.pizza');
      expect(site.url).toBe('https://rsv.pizza');
      spy.mockRestore();
    });
  });

  describe('siteForOrigin (exact match only)', () => {
    it('registered origin resolves to the branded site', async () => {
      const site = await siteForOrigin('https://team1.rsv.pizza', 'https://rsv.pizza');
      expect(site.url).toBe('https://team1.rsv.pizza');
      expect(site.name).toBe('Team1 Pizza');
    });

    it('trailing slash / case differences still match the same registered origin', async () => {
      expect((await siteForOrigin('https://TEAM1.rsv.pizza/', 'x')).url).toBe('https://team1.rsv.pizza');
    });

    it.each([
      ['unknown origin', 'https://evil.example.com'],
      ['rsv.pizza itself', 'https://rsv.pizza'],
      ['subdomain spoof', 'https://team1.rsv.pizza.evil.com'],
      ['prefix spoof', 'https://evilteam1.rsv.pizza'],
      ['suffix spoof', 'https://team1.rsv.pizza.'],
      ['userinfo spoof', 'https://team1.rsv.pizza@evil.com'],
      ['http downgrade', 'http://team1.rsv.pizza'],
      ['path appended', 'https://team1.rsv.pizza/evil'],
      ['port appended', 'https://team1.rsv.pizza:8443'],
      ['parent domain', 'https://pizza'],
      ['null origin', 'null'],
      ['empty', ''],
    ])('%s falls back', async (_label, origin) => {
      const site = await siteForOrigin(origin, 'https://rsv.pizza');
      expect(site).toEqual({ url: 'https://rsv.pizza', name: brand.name, fromEmail: brand.fromEmail });
    });

    it('missing origin falls back without DB access', async () => {
      const site = await siteForOrigin(undefined, 'http://localhost:5176');
      expect(site.url).toBe('http://localhost:5176');
      expect(mockPrisma.eventSeries.findMany).not.toHaveBeenCalled();
    });
  });

  describe('cache', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('queries only active series with a site_url, once per 60 s', async () => {
      await getSeriesSites();
      await getSeriesSites();
      await siteForParty({ eventSeriesId: 'series-team1' }, 'x');
      expect(mockPrisma.eventSeries.findMany).toHaveBeenCalledTimes(1);
      expect(mockPrisma.eventSeries.findMany.mock.calls[0][0].where).toEqual({
        siteUrl: { not: null },
        isActive: true,
      });

      vi.advanceTimersByTime(59_000);
      await getSeriesSites();
      expect(mockPrisma.eventSeries.findMany).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2_000);
      await getSeriesSites();
      expect(mockPrisma.eventSeries.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('brandedSeriesBySlug', () => {
    it('requires active + site_url in the query', async () => {
      mockPrisma.eventSeries.findFirst.mockResolvedValue({ id: 'series-team1' });
      expect(await brandedSeriesBySlug(' team1 ')).toEqual({ id: 'series-team1' });
      expect(mockPrisma.eventSeries.findFirst.mock.calls[0][0].select).toMatchObject({ id: true, publicTags: true, createFlow: true, nameTemplate: true });
      expect(mockPrisma.eventSeries.findFirst.mock.calls[0][0].where).toEqual({
        slug: 'team1',
        isActive: true,
        siteUrl: { not: null },
      });
    });

    it('non-string / blank slugs never hit the DB', async () => {
      for (const v of [undefined, null, 42, {}, [], '', '   ']) {
        expect(await brandedSeriesBySlug(v)).toBeNull();
      }
      expect(mockPrisma.eventSeries.findFirst).not.toHaveBeenCalled();
    });
  });

  it('normalizeOrigin', () => {
    expect(normalizeOrigin(' https://A.b/// ')).toBe('https://a.b');
    expect(normalizeOrigin('')).toBeNull();
    expect(normalizeOrigin(undefined)).toBeNull();
  });
});
