/**
 * Allow-list for checklist `link_tab` values. Mirrors the host-page TabType
 * enumeration (excluding `dashboard`, `checklist`, `apps`, and null/empty which
 * is "no link"). Shared by the GPP defaults route (admin.routes.ts) and the
 * series checklist route (admin-series.routes.ts).
 */
export const ALLOWED_LINK_TABS = [
  'details', 'venue', 'pizza', 'guests', 'photos', 'partners', 'music',
  'report', 'staff', 'displays', 'raffle', 'budget', 'gpp', 'promo',
  'flyer', 'print', 'party-guide', 'payments',
];

/**
 * Checklist-only sentinels the host checklist opens as modals instead of tabs
 * (ChecklistTab / HostChecklistCard). Brand-series rows use them, so the series
 * route accepts them in addition to the tab list.
 */
export const CHECKLIST_MODAL_LINKS = ['attendance', 'social-post'];

export function isValidLinkTab(v: unknown): v is string | null {
  if (v === null || v === undefined) return true;
  if (typeof v !== 'string') return false;
  if (v === '') return true; // coerced to null upstream
  return ALLOWED_LINK_TABS.includes(v);
}

export function isValidSeriesLinkTab(v: unknown): v is string | null {
  return isValidLinkTab(v) || (typeof v === 'string' && CHECKLIST_MODAL_LINKS.includes(v));
}
