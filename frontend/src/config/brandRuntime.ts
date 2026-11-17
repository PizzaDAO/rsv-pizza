/**
 * Runtime brand overlay (plans/wl-self-serve-brands.md, PR 7).
 *
 * On VITE_BRAND_RUNTIME=1 builds, /brand-config.js (loaded before the app) sets `window.__BRAND__`
 * from the DB. `applyBrandOverlay` lays those values over the build-time env defaults so `BRAND`
 * stays a const and nothing else in the app needs to change. Any field the config doesn't supply
 * (or supplies with a wrong type) keeps its env default, so a partial or broken config is harmless.
 */

export interface RuntimeBrand {
  slug?: unknown;
  name?: unknown;
  tagline?: unknown;
  description?: unknown;
  domain?: unknown;
  url?: unknown;
  logoUrl?: unknown;
  faviconUrl?: unknown;
  ogImageUrl?: unknown;
  hasCustomOgImage?: unknown;
  supportEmail?: unknown;
  themeClass?: unknown;
}

/** The part of BRAND the overlay can change. */
export interface OverlayableBrand {
  name: string;
  tagline: string;
  domain: string;
  url: string;
  logoUrl: string;
  ogImageUrl: string;
  faviconUrl: string;
  hasCustomOgImage: boolean;
  supportEmail: string;
  themeClass: string;
  description: string;
  seriesSlug: string;
  isBranded: boolean;
}

const s = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function applyBrandOverlay<T extends OverlayableBrand>(base: T, rt: RuntimeBrand | null | undefined): T {
  if (!rt || typeof rt !== 'object' || !s(rt.slug)) return base;
  const domain = s(rt.domain).replace(/\/+$/, '') || base.domain;
  const logoUrl = s(rt.logoUrl) || base.logoUrl;
  return {
    ...base,
    name: s(rt.name) || base.name,
    tagline: s(rt.tagline) || base.tagline,
    domain,
    url: s(rt.url).replace(/\/+$/, '') || `https://${domain}`,
    logoUrl,
    ogImageUrl: s(rt.ogImageUrl) || base.ogImageUrl,
    faviconUrl: s(rt.faviconUrl) || (s(rt.logoUrl) ? logoUrl : base.faviconUrl),
    hasCustomOgImage: s(rt.ogImageUrl) ? true : base.hasCustomOgImage,
    supportEmail: s(rt.supportEmail) || base.supportEmail,
    themeClass: s(rt.themeClass) || base.themeClass,
    description: s(rt.description) || base.description,
    seriesSlug: s(rt.slug),
    isBranded: true,
  };
}

/**
 * Boolean presentation flags carried in the runtime theme tokens (themeTokens.ts `hideHeaderName`,
 * `hideHeroLogo`). They replace the per-brand CSS that used to `display:none` the header name / hero
 * logo. Only a literal `true` from the (server-validated) tokens turns one on.
 */
export type BrandFlag = 'hideHeaderName' | 'hideHeroLogo';

export function runtimeFlag(rt: { tokens?: unknown } | null | undefined, key: BrandFlag): boolean {
  const t = rt && typeof rt === 'object' ? rt.tokens : null;
  return !!t && typeof t === 'object' && (t as Record<string, unknown>)[key] === true;
}
