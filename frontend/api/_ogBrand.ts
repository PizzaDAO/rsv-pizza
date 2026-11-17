/**
 * White-label helpers for the OG endpoint (api/event/[slug].ts). The leading underscore keeps
 * Vercel from deploying this file as its own function. Pure: env and series data are passed in.
 */

export interface OgSeries {
  id: string;
  slug: string;
  ogImageUrl?: string | null;
  logoUrl?: string | null;
}

export interface OgBrandEnv {
  VITE_BRAND_SERIES_SLUG?: string;
  VITE_BRAND_OG_IMAGE?: string;
  VITE_BRAND_LOGO_URL?: string;
}

/** The series slug this deployment is scoped to, or '' on the default (unbranded / unscoped) site. */
export function brandSeriesSlug(env: OgBrandEnv): string {
  return (env.VITE_BRAND_SERIES_SLUG || '').trim();
}

/**
 * Whether a party may be served on this deployment. Unscoped deployments serve everything
 * (unchanged). A series-scoped deployment serves only parties in its own series; if the series
 * could not be resolved it fails closed.
 */
export function partyAllowedOnBrand(
  env: OgBrandEnv,
  party: { event_series_id?: string | null },
  series: OgSeries | null,
): boolean {
  if (!brandSeriesSlug(env)) return true;
  if (!series) return false;
  return !!party.event_series_id && party.event_series_id === series.id;
}

/**
 * Image used when an event has none (and for the "not found" page). Default deployments keep
 * /logo.png. A brand deployment uses its own OG image, then its logo (env first, then the series'
 * own settings), before falling back to /logo.png.
 */
export function ogFallbackImage(env: OgBrandEnv, siteUrl: string, series: OgSeries | null): string {
  const scoped = !!brandSeriesSlug(env) || !!(env.VITE_BRAND_OG_IMAGE || env.VITE_BRAND_LOGO_URL || '').trim();
  if (!scoped) return `${siteUrl}/logo.png`;
  const pick =
    (env.VITE_BRAND_OG_IMAGE || '').trim() ||
    (series?.ogImageUrl || '').trim() ||
    (env.VITE_BRAND_LOGO_URL || '').trim() ||
    (series?.logoUrl || '').trim() ||
    '/logo.png';
  if (/^https?:\/\//i.test(pick)) return pick;
  return `${siteUrl}${pick.startsWith('/') ? '' : '/'}${pick}`;
}
