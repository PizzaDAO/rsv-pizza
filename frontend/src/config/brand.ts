/**
 * White-label brand config (frontend).
 *
 * Single source of truth for brand-specific chrome: name, domain, logo, colors,
 * support email. Every value falls back to the RSV.Pizza defaults, so with NO
 * `VITE_BRAND_*` env vars set the app renders exactly as before — deploying a
 * different brand is purely a matter of setting these at the Vercel project
 * level. See plans/whitelabel-brand-config.md.
 *
 * Vite inlines `import.meta.env.VITE_*` at build time; each brand is its own
 * deploy, so build-time config is sufficient (no runtime tenant lookup).
 *
 * IMPORTANT: import `BRAND` / `brandUrl` here instead of hardcoding "RSV.Pizza",
 * "rsv.pizza", logo paths, etc. in components. The brand-hardcoding CI check
 * (.github/workflows/brand-check.yml) enforces this for new code.
 */

import { applyBrandOverlay, runtimeFlag, type RuntimeBrand } from './brandRuntime';

const env = import.meta.env;

/** Bare domain, no scheme, no trailing slash. e.g. "rsv.pizza" */
const domain = (env.VITE_BRAND_DOMAIN || 'rsv.pizza').trim().replace(/\/+$/, '');

const brandDefaults = {
  /** Display name used in UI chrome + meta titles. */
  name: (env.VITE_BRAND_NAME || 'RSV.Pizza').trim(),
  /** Short tagline / product descriptor. */
  tagline: (env.VITE_BRAND_TAGLINE || 'Pizza Party Planner').trim(),
  /** Bare domain (no scheme). */
  domain,
  /** Canonical https origin, no trailing slash. e.g. "https://rsv.pizza" */
  url: `https://${domain}`,
  /** Header/nav logo. Defaults to the bundled /logo.png. */
  logoUrl: (env.VITE_BRAND_LOGO_URL || '/logo.png').trim(),
  /** Social share / OG image. */
  ogImageUrl: (env.VITE_BRAND_OG_IMAGE || '/logo.png').trim(),
  /** Browser-tab icon. Defaults to the logo (previous behavior). */
  faviconUrl: (env.VITE_BRAND_FAVICON_URL || env.VITE_BRAND_LOGO_URL || '/logo.png').trim(),
  /** True when a brand supplied its own (wide, 1200x630) OG image. */
  hasCustomOgImage: !!(env.VITE_BRAND_OG_IMAGE || '').trim(),
  /** User-facing support address. */
  supportEmail: (env.VITE_BRAND_SUPPORT_EMAIL || 'help@rsv.pizza').trim(),
  /**
   * Optional theme class applied at the app root (see index.css). Empty string
   * = the default `:root` theme (current RSV.Pizza dark theme). Precedent: the
   * existing `.gpp-theme` class.
   */
  themeClass: (env.VITE_BRAND_THEME_CLASS || '').trim(),
  /** Default meta description (BrandHelmet + index.html). */
  description: (env.VITE_BRAND_DESCRIPTION || 'Invite your friends to share some pizza!').trim(),
  /**
   * Event series this build is scoped to (white-label deploys). Empty string =
   * unscoped (rsv.pizza). Not consumed yet; wired up in a later PR.
   */
  seriesSlug: (env.VITE_BRAND_SERIES_SLUG || '').trim(),
  /** True when this build is a white-label (non-default) brand. */
  isBranded: !!(env.VITE_BRAND_NAME || env.VITE_BRAND_DOMAIN || '').trim(),
} as const;

/**
 * VITE_BRAND_RUNTIME=1 builds overlay the DB config (window.__BRAND__, set by the blocking
 * /brand-config.js) onto these env defaults. Otherwise `__BRAND_RUNTIME__` is a compile-time false,
 * the overlay is stripped from the bundle, and BRAND is exactly the env-derived object above.
 */
export const BRAND: typeof brandDefaults = __BRAND_RUNTIME__
  ? applyBrandOverlay(brandDefaults, (window as unknown as { __BRAND__?: RuntimeBrand }).__BRAND__)
  : brandDefaults;

// Theme tokens (PR 8): turn on the generic .wl-theme layer when the runtime config carries a valid
// token set. Dynamic import on purpose: with VITE_BRAND_RUNTIME unset the whole branch (and the theme
// module with its font table) is compiled out, so non-runtime builds keep byte-identical JS. The
// blocking /brand-config.js has already set the class and variables, so nothing waits on this.
if (__BRAND_RUNTIME__) {
  void import('./themeRuntime').then((m) =>
    m.applyThemeTokens((window as unknown as { __BRAND__?: { tokens?: unknown } }).__BRAND__),
  );
}

/**
 * Presentation flags from the runtime theme tokens (always false unless VITE_BRAND_RUNTIME=1 and the
 * brand's tokens set them): Header drops the name text beside the logo, the series landing page drops
 * the repeated hero logo.
 */
const runtimeBrand = (): { tokens?: unknown } | undefined =>
  (window as unknown as { __BRAND__?: { tokens?: unknown } }).__BRAND__;
export const HIDE_HEADER_NAME: boolean = __BRAND_RUNTIME__ && runtimeFlag(runtimeBrand(), 'hideHeaderName');
export const HIDE_HERO_LOGO: boolean = __BRAND_RUNTIME__ && runtimeFlag(runtimeBrand(), 'hideHeroLogo');

/** Build an absolute brand URL: brandUrl('my-party') -> https://rsv.pizza/my-party */
export function brandUrl(path = ''): string {
  return `${BRAND.url}/${String(path).replace(/^\/+/, '')}`;
}
