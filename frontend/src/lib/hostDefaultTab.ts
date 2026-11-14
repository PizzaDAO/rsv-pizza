import type { Party } from '../types';

type PartyLike = Pick<Party, 'eventType' | 'eventSeriesId'> | null | undefined;

/**
 * brand-checklists: a party in a non-GPP event series (Team1, Monad, Doge Day,
 * ...). GPP parties are also linked to a series (gpp2026/gpp2027) but keep
 * their own GPP dashboard.
 */
export function isBrandSeriesParty(party: PartyLike): boolean {
  return !!party && party.eventType !== 'gpp' && !!party.eventSeriesId;
}

/**
 * The host page's default tab (what `/host/:code` shows). GPP and brand-series
 * hosts land on the dashboard with their task list; everyone else on Settings.
 * Settings is always reachable at `/host/:code/details`.
 */
export function hostDefaultTab(party: PartyLike): 'dashboard' | 'details' {
  if (!party) return 'details';
  return party.eventType === 'gpp' || isBrandSeriesParty(party) ? 'dashboard' : 'details';
}

/**
 * Which dashboard /host/:code/dashboard renders. Brand-series parties get the
 * series dashboard; everyone else (GPP and plain parties) keeps the original
 * routing: GPP27 preview when opted in, else the GPP dashboard.
 */
export function dashboardKind(isBrandSeries: boolean, useGpp27: boolean): 'series' | 'gpp27' | 'gpp' {
  if (isBrandSeries) return 'series';
  return useGpp27 ? 'gpp27' : 'gpp';
}
