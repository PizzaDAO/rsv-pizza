/**
 * parmigiano-58493 (ported from calzone-58481 / PR #878): server-side catalog
 * of host apps that can be linked from a Telegram broadcast via the {appLink}
 * token. The URL segment is the app's `tab` value (the host app URL is
 * /host/:inviteCode/:tab), NOT its id.
 *
 * Keep this in sync with the frontend BROADCAST_APPS export in
 * frontend/src/lib/appDefinitions.ts. The frontend is the UX source of truth;
 * the backend only needs the set of valid `tab` values to validate an incoming
 * `appTab` so a literal {appLink} token can never ship to a recipient.
 */
export const BROADCAST_APP_TABS: readonly string[] = [
  'partners',
  'venue',
  'music',
  'report',
  'staff',
  'displays',
  'raffle',
  'budget',
  'checklist',
  'party-guide',
  'gpp',
  'promo',
  'flyer',
  'print',
  'payments',
  'pizza',
] as const;

export function isValidAppTab(tab: unknown): tab is string {
  return typeof tab === 'string' && BROADCAST_APP_TABS.includes(tab);
}
