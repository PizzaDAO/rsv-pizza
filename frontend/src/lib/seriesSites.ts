import { useEffect, useState } from 'react';
import { BRAND } from '../config/brand';
import { DEFAULT_SITE_ORIGIN, IS_SERIES_SCOPED } from '../config/brandScope';
import { fetchPublicSeriesList, type PublicSeriesWithId } from './seriesApi';

/**
 * White-label: module-cached public series list (/api/series), so brand-aware UI can resolve a
 * party's series (brand name, own site origin) without each component refetching.
 */
let cache: Promise<PublicSeriesWithId[]> | null = null;

export function loadPublicSeries(): Promise<PublicSeriesWithId[]> {
  if (!cache) {
    cache = fetchPublicSeriesList()
      .then((r) => r.series)
      .catch(() => {
        cache = null; // retry next time
        return [] as PublicSeriesWithId[];
      });
  }
  return cache;
}

/** Test helper. */
export function _resetPublicSeriesCache(): void {
  cache = null;
}

/** Display name for a series: its brand name, else display name. */
export function seriesBrandName(s: Pick<PublicSeriesWithId, 'brandName' | 'displayName' | 'name'>): string {
  return (s.brandName && s.brandName.trim()) || s.displayName || s.name;
}

/** The series for an id, or null (no id, unknown id, still loading). */
export function useSeriesById(id: string | null | undefined): PublicSeriesWithId | null {
  const [series, setSeries] = useState<PublicSeriesWithId | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!id) {
      setSeries(null);
      return;
    }
    loadPublicSeries().then((all) => {
      if (!cancelled) setSeries(all.find((s) => s.id === id) ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [id]);
  return series;
}

const trimOrigin = (u: string) => u.trim().replace(/\/+$/, '').toLowerCase();

/** Origin a series' events live on: its own siteUrl, else the default site (GPP / no series). */
export function seriesSiteOrigin(series: Pick<PublicSeriesWithId, 'siteUrl'> | null | undefined): string {
  const u = series?.siteUrl?.trim().replace(/\/+$/, '');
  return u || DEFAULT_SITE_ORIGIN;
}

/**
 * Series-scoped build: where an event OUTSIDE this build's series should be viewed instead.
 * Null when the event belongs here, the build is unscoped, the build's own series is unknown
 * (fail open: the backend still decides what data is served), or the target is this very origin
 * (never send the browser to itself).
 */
export function foreignEventOrigin(
  all: PublicSeriesWithId[],
  brandSlug: string,
  eventSeriesId: string | null | undefined,
  currentOrigin: string,
): string | null {
  if (!brandSlug) return null;
  const mine = all.find((s) => s.slug === brandSlug);
  if (!mine) return null;
  if (eventSeriesId && eventSeriesId === mine.id) return null;
  const origin = seriesSiteOrigin(eventSeriesId ? all.find((s) => s.id === eventSeriesId) : null);
  return trimOrigin(origin) === trimOrigin(currentOrigin) ? null : origin;
}

/**
 * Series-scoped build asked for /series/:slug of another series: that series' own site, or null
 * when it has none / is this build's series / is unknown (the page then shows "not found").
 */
export function foreignSeriesOrigin(
  all: PublicSeriesWithId[],
  brandSlug: string,
  slug: string,
  currentOrigin: string,
): string | null {
  if (!brandSlug || slug === brandSlug) return null;
  return ownSiteOriginForSeries(all, slug, currentOrigin);
}

/**
 * Default (unscoped) build asked for /series/:slug of a series that has its own site (siteUrl):
 * that site's origin, so the page renders under the series' own chrome and theme. Null for series
 * without a siteUrl (e.g. GPP), unknown slugs, or when the target is this very origin.
 */
export function ownSiteOriginForSeries(
  all: PublicSeriesWithId[],
  slug: string,
  currentOrigin: string,
): string | null {
  const target = all.find((s) => s.slug === slug);
  if (!target?.siteUrl?.trim()) return null;
  const origin = seriesSiteOrigin(target);
  return trimOrigin(origin) === trimOrigin(currentOrigin) ? null : origin;
}

/** Send the browser to an event's own site when this series-scoped build is the wrong chrome. True if navigating away. */
export async function redirectForeignEvent(eventSeriesId: string | null | undefined, slug: string): Promise<boolean> {
  if (!IS_SERIES_SCOPED) return false;
  const all = await loadPublicSeries();
  const origin = foreignEventOrigin(all, BRAND.seriesSlug, eventSeriesId, window.location.origin);
  if (!origin) return false;
  window.location.replace(`${origin}/${slug}${window.location.search}`);
  return true;
}
