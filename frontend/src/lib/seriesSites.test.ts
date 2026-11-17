import { describe, it, expect } from 'vitest';
import { foreignEventOrigin, foreignSeriesOrigin, ownSiteOriginForSeries, seriesBrandName, seriesSiteOrigin } from './seriesSites';
import { DEFAULT_SITE_ORIGIN } from '../config/brandScope';
import type { PublicSeriesWithId } from './seriesApi';

const mk = (o: Partial<PublicSeriesWithId>) => ({ displayName: 'X', name: 'X', ...o }) as PublicSeriesWithId;
const ALL = [
  mk({ id: 'a', slug: 'team1', siteUrl: 'https://team1.example.com', brandName: 'Team1 Pizza' }),
  mk({ id: 'b', slug: 'monad', siteUrl: 'https://monad.example.com/' }),
  mk({ id: 'g', slug: 'gpp2026', siteUrl: null }),
];
const HERE = 'https://team1.example.com';

describe('white-label foreign event / series redirects', () => {
  it('an event in this build\'s series stays', () => {
    expect(foreignEventOrigin(ALL, 'team1', 'a', HERE)).toBeNull();
  });

  it('an event in another branded series goes to that series\' site (trailing slash trimmed)', () => {
    expect(foreignEventOrigin(ALL, 'team1', 'b', HERE)).toBe('https://monad.example.com');
  });

  it('GPP and series-less events go to the default site', () => {
    expect(foreignEventOrigin(ALL, 'team1', 'g', HERE)).toBe(DEFAULT_SITE_ORIGIN);
    expect(foreignEventOrigin(ALL, 'team1', null, HERE)).toBe(DEFAULT_SITE_ORIGIN);
    expect(foreignEventOrigin(ALL, 'team1', undefined, HERE)).toBe(DEFAULT_SITE_ORIGIN);
  });

  it('unscoped builds, unknown own series, and self-targets never redirect', () => {
    expect(foreignEventOrigin(ALL, '', 'b', HERE)).toBeNull();
    expect(foreignEventOrigin(ALL, 'nope', 'b', HERE)).toBeNull();
    expect(foreignEventOrigin(ALL, 'team1', 'b', 'https://monad.example.com')).toBeNull();
    expect(foreignEventOrigin(ALL, 'team1', null, DEFAULT_SITE_ORIGIN)).toBeNull();
  });

  it('/series/:slug of another series goes to its own site, else not-found', () => {
    expect(foreignSeriesOrigin(ALL, 'team1', 'monad', HERE)).toBe('https://monad.example.com');
    expect(foreignSeriesOrigin(ALL, 'team1', 'gpp2026', HERE)).toBeNull(); // no site: not found
    expect(foreignSeriesOrigin(ALL, 'team1', 'unknown', HERE)).toBeNull();
    expect(foreignSeriesOrigin(ALL, 'team1', 'team1', HERE)).toBeNull();
    expect(foreignSeriesOrigin(ALL, '', 'monad', HERE)).toBeNull();
  });

  it('helpers: origin fallback and brand name', () => {
    expect(seriesSiteOrigin(null)).toBe(DEFAULT_SITE_ORIGIN);
    expect(seriesBrandName(ALL[0])).toBe('Team1 Pizza');
    expect(seriesBrandName(mk({ brandName: null, displayName: 'Disp' }))).toBe('Disp');
  });
});

describe('default build: /series/:slug of a series with its own site', () => {
  const DEFAULT = DEFAULT_SITE_ORIGIN;
  it('redirects to the series\' own site (trailing slash trimmed)', () => {
    expect(ownSiteOriginForSeries(ALL, 'team1', DEFAULT)).toBe('https://team1.example.com');
    expect(ownSiteOriginForSeries(ALL, 'monad', DEFAULT)).toBe('https://monad.example.com');
  });
  it('GPP (no siteUrl), unknown slugs and whitespace-only siteUrls are unaffected', () => {
    expect(ownSiteOriginForSeries(ALL, 'gpp2026', DEFAULT)).toBeNull();
    expect(ownSiteOriginForSeries(ALL, 'unknown', DEFAULT)).toBeNull();
    expect(ownSiteOriginForSeries([mk({ id: 'w', slug: 'w', siteUrl: '  ' })], 'w', DEFAULT)).toBeNull();
    expect(ownSiteOriginForSeries([], 'team1', DEFAULT)).toBeNull();
  });
  it('never redirects to the origin it is already on', () => {
    expect(ownSiteOriginForSeries(ALL, 'team1', 'https://team1.example.com')).toBeNull();
    expect(ownSiteOriginForSeries(ALL, 'team1', 'https://TEAM1.example.com/')).toBeNull();
  });
});
