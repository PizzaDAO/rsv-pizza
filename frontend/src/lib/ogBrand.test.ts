import { describe, it, expect } from 'vitest';
import { brandSeriesSlug, ogFallbackImage, partyAllowedOnBrand } from '../../api/_ogBrand';

const SITE = 'https://brand.example.com';
const SERIES = { id: 's1', slug: 'team1', ogImageUrl: '/brands/team1/og.png', logoUrl: '/brands/team1/logo.png' };

describe('OG endpoint white-label helpers', () => {
  it('unscoped deployment serves every party and keeps /logo.png', () => {
    expect(brandSeriesSlug({})).toBe('');
    expect(partyAllowedOnBrand({}, { event_series_id: 'other' }, null)).toBe(true);
    expect(partyAllowedOnBrand({}, {}, null)).toBe(true);
    expect(ogFallbackImage({}, 'https://www.rsv.pizza', null)).toBe('https://www.rsv.pizza/logo.png'); // brand-check-ignore-line
  });

  it('series-scoped deployment serves only its own series', () => {
    const env = { VITE_BRAND_SERIES_SLUG: 'team1' };
    expect(partyAllowedOnBrand(env, { event_series_id: 's1' }, SERIES)).toBe(true);
    expect(partyAllowedOnBrand(env, { event_series_id: 's2' }, SERIES)).toBe(false);
    expect(partyAllowedOnBrand(env, { event_series_id: null }, SERIES)).toBe(false);
    expect(partyAllowedOnBrand(env, {}, SERIES)).toBe(false);
  });

  it('series-scoped deployment fails closed when the series cannot be resolved', () => {
    expect(partyAllowedOnBrand({ VITE_BRAND_SERIES_SLUG: 'team1' }, { event_series_id: 's1' }, null)).toBe(false);
  });

  it('brand fallback image: env OG, series OG, env logo, series logo, then /logo.png', () => {
    const base = { VITE_BRAND_SERIES_SLUG: 'team1' };
    expect(ogFallbackImage({ ...base, VITE_BRAND_OG_IMAGE: '/e-og.png', VITE_BRAND_LOGO_URL: '/e-logo.png' }, SITE, SERIES)).toBe(`${SITE}/e-og.png`);
    expect(ogFallbackImage({ ...base, VITE_BRAND_LOGO_URL: '/e-logo.png' }, SITE, SERIES)).toBe(`${SITE}/brands/team1/og.png`);
    expect(ogFallbackImage({ ...base, VITE_BRAND_LOGO_URL: '/e-logo.png' }, SITE, { ...SERIES, ogImageUrl: null })).toBe(`${SITE}/e-logo.png`);
    expect(ogFallbackImage(base, SITE, { ...SERIES, ogImageUrl: null })).toBe(`${SITE}/brands/team1/logo.png`);
    expect(ogFallbackImage(base, SITE, null)).toBe(`${SITE}/logo.png`);
    expect(ogFallbackImage({ VITE_BRAND_OG_IMAGE: 'https://cdn.example.com/og.png' }, SITE, null)).toBe('https://cdn.example.com/og.png');
  });
});
