import type { ChecklistItem } from '../../types';

/**
 * brand-checklists: what clicking a host checklist row does. Shared by the GPP
 * dashboard and the brand-series dashboard so both behave the same.
 *
 * Resolved from the item's auto rule / link tab (not its name) so brand items
 * get the same behavior as the GPP items with the same meaning:
 *   - team_built            -> expand the co-host manager inline ("Build a Team")
 *   - link 'venue'          -> Find Venue modal ("Find a Venue")
 *   - link 'attendance'     -> Estimated Attendance modal
 *   - link 'social-post'    -> Social Post modal
 *   - any other link tab    -> navigate to that host tab
 */
export type ChecklistAction =
  | { kind: 'hosts' }
  | { kind: 'venue-modal' }
  | { kind: 'attendance-modal' }
  | { kind: 'social-modal' }
  | { kind: 'tab'; tab: string };

type ActionItem = Pick<ChecklistItem, 'name' | 'autoRule' | 'linkTab'>;

export function resolveChecklistAction(item: ActionItem): ChecklistAction | null {
  if (item.autoRule === 'team_built' || item.name === 'Build a Team') return { kind: 'hosts' };
  switch (item.linkTab) {
    case 'venue':
      return { kind: 'venue-modal' };
    case 'attendance':
      return { kind: 'attendance-modal' };
    case 'social-post':
      return { kind: 'social-modal' };
    case null:
    case undefined:
    case '':
      return null;
    default:
      return { kind: 'tab', tab: item.linkTab };
  }
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
