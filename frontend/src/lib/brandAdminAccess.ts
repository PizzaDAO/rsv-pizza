import { useEffect, useState } from 'react';
import { BRAND } from '../config/brand';
import { fetchBrandAdminMe, type BrandAdminSeries } from './brandAdminApi';

/**
 * Which series this site's /brand-admin may manage (plans/wl-self-serve-brands.md §2.4).
 *  - On a brand site (a series slug is set): only that brand's series, for its admins and super-admins.
 *  - On the unscoped main site: super-admins only (all active series, with a picker), for support.
 */
export function resolveAccessibleSeries(all: BrandAdminSeries[], siteSeriesSlug: string): BrandAdminSeries[] {
  if (siteSeriesSlug) return all.filter((s) => s.slug === siteSeriesSlug);
  return all.filter((s) => s.actorKind === 'super_admin');
}

export type BrandAdminAccess =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; series: BrandAdminSeries[] };

/** Loads (re-keyed on `userKey`, e.g. the user id, so another user's result is never shown).
 *  Loads /api/brand-admin/me for a signed-in user. `enabled` false (signed out) never calls the API. */
export function useBrandAdminAccess(enabled: boolean, userKey: string | null = null, retryKey = 0): BrandAdminAccess {
  const [state, setState] = useState<BrandAdminAccess>({ status: 'loading' });
  useEffect(() => {
    setState({ status: 'loading' }); // never show a previous user's series
    if (!enabled) return;
    let cancelled = false;
    fetchBrandAdminMe()
      .then((res) => { if (!cancelled) setState({ status: 'ready', series: resolveAccessibleSeries(res.series ?? [], BRAND.seriesSlug) }); })
      .catch((e: Error) => { if (!cancelled) setState({ status: 'error', message: e?.message || 'Could not check your access' }); });
    return () => { cancelled = true; };
  }, [enabled, userKey, retryKey]);
  return state;
}
