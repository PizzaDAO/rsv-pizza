import { describe, it, expect } from 'vitest';
import { applyBrandOverlay, type OverlayableBrand } from './brandRuntime';

const base: OverlayableBrand = {
  name: 'Base Pizza',
  tagline: 'Base tagline',
  domain: 'base.example.org',
  url: 'https://base.example.org',
  logoUrl: '/logo.png',
  ogImageUrl: '/logo.png',
  faviconUrl: '/logo.png',
  hasCustomOgImage: false,
  supportEmail: 'help@base.example.org',
  themeClass: '',
  description: 'Base description',
  seriesSlug: '',
  isBranded: false,
};

describe('applyBrandOverlay', () => {
  it('returns the env defaults untouched when there is no runtime config', () => {
    expect(applyBrandOverlay(base, undefined)).toBe(base);
    expect(applyBrandOverlay(base, null)).toBe(base);
    expect(applyBrandOverlay(base, {})).toBe(base);
    expect(applyBrandOverlay(base, { name: 'No slug' })).toBe(base);
  });

  it('overlays supplied fields and keeps defaults for the rest', () => {
    const out = applyBrandOverlay(base, {
      slug: 'example',
      name: 'Example Pizza',
      domain: 'pizza.example.org',
      url: 'https://pizza.example.org/',
      ogImageUrl: 'https://cdn.example.org/og.png',
      themeClass: 'example-theme',
      tagline: null,
    });
    expect(out.name).toBe('Example Pizza');
    expect(out.url).toBe('https://pizza.example.org');
    expect(out.domain).toBe('pizza.example.org');
    expect(out.ogImageUrl).toBe('https://cdn.example.org/og.png');
    expect(out.hasCustomOgImage).toBe(true);
    expect(out.themeClass).toBe('example-theme');
    expect(out.seriesSlug).toBe('example');
    expect(out.isBranded).toBe(true);
    expect(out.tagline).toBe('Base tagline');
    expect(out.supportEmail).toBe('help@base.example.org');
  });

  it('favicon follows a supplied logo unless it has its own, like the env defaults', () => {
    expect(applyBrandOverlay(base, { slug: 'x', logoUrl: '/brands/x/logo.png' }).faviconUrl).toBe('/brands/x/logo.png');
    expect(applyBrandOverlay(base, { slug: 'x', logoUrl: '/l.png', faviconUrl: '/f.png' }).faviconUrl).toBe('/f.png');
  });

  it('ignores wrong-typed values', () => {
    const out = applyBrandOverlay(base, { slug: 'x', name: 5, themeClass: { a: 1 }, supportEmail: [] });
    expect(out.name).toBe('Base Pizza');
    expect(out.themeClass).toBe('');
    expect(out.supportEmail).toBe('help@base.example.org');
  });
});
