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

const env = import.meta.env;

/** Bare domain, no scheme, no trailing slash. e.g. "rsv.pizza" */
const domain = (env.VITE_BRAND_DOMAIN || 'rsv.pizza').trim().replace(/\/+$/, '');

export const BRAND = {
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
  /** User-facing support address. */
  supportEmail: (env.VITE_BRAND_SUPPORT_EMAIL || 'help@rsv.pizza').trim(),
  /**
   * Optional theme class applied at the app root (see index.css). Empty string
   * = the default `:root` theme (current RSV.Pizza dark theme). Precedent: the
   * existing `.gpp-theme` class.
   */
  themeClass: (env.VITE_BRAND_THEME_CLASS || '').trim(),
} as const;

/** Build an absolute brand URL: brandUrl('my-party') -> https://rsv.pizza/my-party */
export function brandUrl(path = ''): string {
  return `${BRAND.url}/${String(path).replace(/^\/+/, '')}`;
}
