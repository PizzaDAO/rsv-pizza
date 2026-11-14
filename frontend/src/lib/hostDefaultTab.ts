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
