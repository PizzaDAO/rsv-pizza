/**
 * Public runtime brand config (plans/wl-self-serve-brands.md, PR 7).
 *
 * `toBrandConfig` is the ONLY place that decides what leaves the backend for /api/brand-config.
 * It is an explicit allowlist built from validated columns: tags, wallet, sender/domain
 * internals, admin data and pending-domain tokens are never read, so they cannot leak.
 */
import { sanitizeFlyerArt } from './flyerArt.js';
import type { SeriesBrandRow } from './siteBrand.js';
import { normalizeThemeTokens, deriveThemeVars, type ThemeTokens } from './themeTokens.js';

export interface BrandConfig {
  v: number;
  slug: string;
  seriesId: string;
  name: string;
  tagline: string | null;
  description: string | null;
  domain: string;
  url: string;
  logoUrl: string | null;
  logoLightUrl: string | null;
  faviconUrl: string | null;
  ogImageUrl: string | null;
  hasCustomOgImage: boolean;
  supportEmail: string | null;
  themeClass: string | null;
  /** Validated, normalised theme tokens (null when unset or invalid). */
  tokens: ThemeTokens | null;
  /** deriveThemeVars(tokens), so the blocking /brand-config.js applier needs no theme code. */
  themeVars: Record<string, string> | null;
  flyer: { templateKey: string | null; art: Record<string, unknown> | null };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);

/** Only http(s) or root-relative asset URLs; anything else (javascript:, data:, //host) is dropped. */
function urlOrNull(v: unknown): string | null {
  const s = str(v);
  if (!s) return null;
  if (/^https?:\/\/[^\s"'<>\\]+$/i.test(s)) return s;
  if (/^\/(?!\/)[^\s"'<>\\]*$/.test(s)) return s;
  return null;
}

function plainObject(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

/** CSS class names only: letters, digits, dash, underscore. */
function classOrNull(v: unknown): string | null {
  const s = str(v);
  return s && /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(s) ? s : null;
}

export function toBrandConfig(row: SeriesBrandRow): BrandConfig {
  const tokens = normalizeThemeTokens(row.themeTokens);
  const url = (str(row.siteUrl) || '').replace(/\/+$/, '');
  const domain = url.replace(/^https?:\/\//i, '');
  const ogImageUrl = urlOrNull(row.ogImageUrl);
  return {
    v: row.configVersion,
    slug: row.slug,
    seriesId: row.id,
    name: str(row.brandName) || str(row.displayName) || row.name,
    tagline: str(row.tagline),
    description: str(row.metaDescription),
    domain,
    url,
    logoUrl: urlOrNull(row.logoUrl),
    logoLightUrl: urlOrNull(row.logoLightUrl),
    faviconUrl: urlOrNull(row.faviconUrl),
    ogImageUrl,
    hasCustomOgImage: !!ogImageUrl,
    supportEmail: str(row.supportEmail),
    themeClass: classOrNull(row.themeClass),
    tokens,
    themeVars: tokens ? deriveThemeVars(tokens) : null,
    flyer: { templateKey: str(row.flyerTemplateKey), art: sanitizeFlyerArt(row.flyerArt) },
  };
}
