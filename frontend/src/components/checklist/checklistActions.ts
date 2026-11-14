import type { ChecklistItem } from '../../types';

/**
 * brand-checklists: what clicking a host-dashboard checklist row does.
 *
 * 'gpp' reproduces the original GPPDashboardTab behavior exactly: actions are
 * matched by GPP item NAME, anything else with a link navigates to that tab.
 *
 * 'series' (brand-series parties) resolves by auto rule + link instead, so brand
 * items get the same behavior as the GPP items with the same meaning:
 *   - team_built                       -> inline co-host manager ("Build a Team")
 *   - venue_added rule + link 'venue'  -> Find Venue modal ("Find a Venue")
 *   - link 'attendance'                -> Estimated Attendance modal
 *   - link 'social-post'               -> Social Post modal
 *   - any other link                   -> navigate to that host tab
 *
 * In both modes a legacy link 'sponsors' (not a host tab; on older GPP2026
 * rows) navigates to the Partners tab.
 */
export type ChecklistAction =
  | { kind: 'hosts' }
  | { kind: 'venue-modal' }
  | { kind: 'attendance-modal' }
  | { kind: 'social-modal' }
  | { kind: 'tab'; tab: string };

export type ChecklistVariant = 'gpp' | 'series';

type ActionItem = Pick<ChecklistItem, 'name' | 'autoRule' | 'linkTab'>;

/** Legacy link values that aren't host tabs, mapped to the tab they meant. */
const LEGACY_TAB_ALIASES: Record<string, string> = { sponsors: 'partners' };

function tabAction(linkTab: string | null | undefined): ChecklistAction | null {
  if (!linkTab) return null;
  return { kind: 'tab', tab: LEGACY_TAB_ALIASES[linkTab] ?? linkTab };
}

// Original GPPDashboardTab name matches (pre brand-checklists).
const GPP_NAME_ACTIONS: Record<string, ChecklistAction> = {
  'Build a Team': { kind: 'hosts' },
  'Find Partners': { kind: 'tab', tab: 'partners' },
  'Find a Venue': { kind: 'venue-modal' },
  'Estimated Attendance': { kind: 'attendance-modal' },
  'Post about the party on socials': { kind: 'social-modal' },
};

export function resolveChecklistAction(item: ActionItem, variant: ChecklistVariant = 'gpp'): ChecklistAction | null {
  if (variant === 'gpp') {
    return GPP_NAME_ACTIONS[item.name] ?? tabAction(item.linkTab);
  }
  if (item.autoRule === 'team_built') return { kind: 'hosts' };
  if (item.linkTab === 'venue' && item.autoRule === 'venue_added') return { kind: 'venue-modal' };
  if (item.linkTab === 'attendance') return { kind: 'attendance-modal' };
  if (item.linkTab === 'social-post') return { kind: 'social-modal' };
  return tabAction(item.linkTab);
}

/**
 * Path for a host tab. Settings is always `/host/:code/details` — `/host/:code`
 * is the party's DEFAULT tab, which is the dashboard for GPP and brand-series
 * parties, so it can't be assumed to mean Settings.
 */
export function hostTabPath(inviteCode: string, tab: string): string {
  return `/host/${inviteCode}/${tab}`;
}

/** Sort by due date ascending, undated last (stable for equal keys). */
export function sortByDueDate<T extends { dueDate: string | null }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (!a.dueDate && !b.dueDate) return 0;
    if (!a.dueDate) return 1;
    if (!b.dueDate) return -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
}
