// panuozzo-92114: pure (no-React) (de)serializer for the /payments filter bar +
// view-mode toggle <-> URL query string. Wired into PaymentsAdminPage via
// react-router's useSearchParams so a refresh / shared link restores the exact
// view. Kept React-free so it can be unit-tested in isolation.
//
// Design: diff-against-defaults. We only emit a query key when its value
// differs from DEFAULT_FILTERS, which keeps URLs short and makes "no params" a
// faithful representation of the default view. The two default-TRUE booleans
// (hideClosed / hideScams) are the sharp edge here — see filtersToSearchParams.
import type { AdminPayoutFilters } from '../../types';
// Source-of-truth filter value lists (React-free; shared with PayoutsFilterBar).
import {
  STATUS_TAB_VALUES,
  METHOD_VALUES as METHOD_OPTION_VALUES,
  PURPOSE_VALUES as PURPOSE_OPTION_VALUES,
  SORT_VALUES as SORT_OPTION_VALUES,
  type SortValue,
} from './paymentsFilterOptions';

export type ViewMode = 'by-city' | 'by-payment' | 'payments';

const VIEW_MODES: ViewMode[] = ['by-city', 'by-payment', 'payments'];

// panuozzo-92114: must mirror DEFAULT_FILTERS in PaymentsAdminPage.tsx for the
// diff-against-defaults logic. We intentionally only list the fields this
// module serializes (the user-facing ones); prop-derived / plumbing fields
// (regions, cursor, limit, provenOnly, currency) are never touched here.
const DEFAULTS = {
  status: 'all' as NonNullable<AdminPayoutFilters['status']>,
  payoutMethod: 'all' as NonNullable<AdminPayoutFilters['payoutMethod']>,
  tag: 'all',
  purpose: 'all' as NonNullable<AdminPayoutFilters['purpose']>,
  sort: 'created_desc' as SortValue,
  hideClosed: true,
  hideScams: true,
  hideUsCities: true,
  // tigella-58512: default-FALSE — only emitted (as `tbd=1`) when turned ON.
  showTbdUnsubmitted: false,
  // farinata-58532: default-FALSE — only emitted (as `receipts=1`) when turned ON.
  hasReceipts: false,
};
const DEFAULT_VIEW: ViewMode = 'by-city';

// Source-of-truth value sets, derived from the canonical lists in
// paymentsFilterOptions.ts so they can never drift from the rendered controls.
const STATUS_VALUES = new Set<string>(STATUS_TAB_VALUES.map(String));
const METHOD_VALUES = new Set<string>(METHOD_OPTION_VALUES.map(String));
const PURPOSE_VALUES = new Set<string>(PURPOSE_OPTION_VALUES.map(String));
const SORT_VALUES = new Set<string>(SORT_OPTION_VALUES.map(String));

/**
 * Serialize the active filters + view mode to a URLSearchParams. A key is
 * written ONLY when its value differs from the default, so the default view
 * produces an empty query string. Booleans use `0`/`1`; the default-TRUE
 * booleans are therefore only emitted as `=0` when the user turns them OFF.
 */
export function filtersToSearchParams(
  filters: AdminPayoutFilters,
  viewMode: ViewMode,
): URLSearchParams {
  const params = new URLSearchParams();

  const status = filters.status ?? DEFAULTS.status;
  if (status !== DEFAULTS.status) params.set('status', String(status));

  const method = filters.payoutMethod ?? DEFAULTS.payoutMethod;
  if (method !== DEFAULTS.payoutMethod) params.set('method', String(method));

  if (filters.partyId && filters.partyId.trim()) params.set('partyId', filters.partyId.trim());
  if (filters.search && filters.search.trim()) params.set('q', filters.search.trim());

  const tag = filters.tag ?? DEFAULTS.tag;
  if (tag !== DEFAULTS.tag) params.set('tag', String(tag));

  // cornetto-58510: tri-state tag/country filters (by-city view, client-side).
  // Only emitted when non-empty so the default view stays param-free.
  if (filters.tagIncludes && filters.tagIncludes.length) params.set('tagInc', filters.tagIncludes.join(','));
  if (filters.tagExcludes && filters.tagExcludes.length) params.set('tagExc', filters.tagExcludes.join(','));
  if (filters.countryIncludes && filters.countryIncludes.length) params.set('countryInc', filters.countryIncludes.join(','));
  if (filters.countryExcludes && filters.countryExcludes.length) params.set('countryExc', filters.countryExcludes.join(','));

  const purpose = filters.purpose ?? DEFAULTS.purpose;
  if (purpose !== DEFAULTS.purpose) params.set('purpose', String(purpose));

  // regionPortals: admin /payments multi-select only. Empty/undefined = no key.
  if (Array.isArray(filters.regionPortals) && filters.regionPortals.length > 0) {
    params.set('regions', filters.regionPortals.join(','));
  }

  if (filters.dateFrom) params.set('from', filters.dateFrom);
  if (filters.dateTo) params.set('to', filters.dateTo);

  const sort = filters.sort ?? DEFAULTS.sort;
  if (sort !== DEFAULTS.sort) params.set('sort', String(sort));

  // Default-TRUE booleans: only emit when the user turned them OFF.
  if (filters.hideClosed === false) params.set('hideClosed', '0');
  if (filters.hideScams === false) params.set('hideScams', '0');
  if (filters.hideUsCities === false) params.set('hideUsCities', '0');

  // tigella-58512: default-FALSE toggle — only emit when turned ON.
  if (filters.showTbdUnsubmitted === true) params.set('tbd', '1');

  // farinata-58532: default-FALSE toggle — only emit when turned ON.
  if (filters.hasReceipts === true) params.set('receipts', '1');

  if (viewMode !== DEFAULT_VIEW) params.set('view', viewMode);

  return params;
}

/**
 * Parse a URLSearchParams back into a filters object + view mode. Starts from
 * DEFAULT_FILTERS (re-derived from `DEFAULTS` here is NOT enough — the caller
 * passes the real default object via this module's shape) and overlays each
 * present param, validating enums so a hand-mangled URL can't crash the page.
 *
 * `regions` (prop-derived hard scope) is NEVER read from the URL — it is
 * re-injected from the `regions` arg, so a regional underboss can't widen their
 * scope by editing the query string.
 *
 * Returns `viewMode: null` when no `view` param is present so the caller can
 * fall back to localStorage.
 */
export function searchParamsToFilters(
  params: URLSearchParams,
  regions: string[] | undefined,
): { filters: AdminPayoutFilters; viewMode: ViewMode | null } {
  const filters: AdminPayoutFilters = {
    status: DEFAULTS.status,
    payoutMethod: DEFAULTS.payoutMethod,
    currency: 'all',
    country: 'all',
    tag: DEFAULTS.tag,
    // cornetto-58510: tri-state tag/country arrays default empty (no filter).
    tagIncludes: [],
    tagExcludes: [],
    countryIncludes: [],
    countryExcludes: [],
    purpose: DEFAULTS.purpose,
    hideClosed: DEFAULTS.hideClosed,
    hideScams: DEFAULTS.hideScams,
    hideUsCities: DEFAULTS.hideUsCities,
    showTbdUnsubmitted: DEFAULTS.showTbdUnsubmitted,
    hasReceipts: DEFAULTS.hasReceipts,
    sort: DEFAULTS.sort,
    ...(regions ? { regions } : {}),
  };

  // status — may be a single value OR a comma list (e.g. `paid,completed`).
  // Validate every segment against STATUS_TABS; ignore the whole param if any
  // segment is unknown so a mangled URL falls back to the default.
  const statusRaw = params.get('status');
  if (statusRaw) {
    const segs = statusRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (segs.length > 0 && segs.every((s) => STATUS_VALUES.has(s))) {
      filters.status = segs.join(',');
    }
  }

  const methodRaw = params.get('method');
  if (methodRaw && METHOD_VALUES.has(methodRaw)) {
    filters.payoutMethod = methodRaw as AdminPayoutFilters['payoutMethod'];
  }

  const partyId = params.get('partyId');
  if (partyId) filters.partyId = partyId;

  const q = params.get('q');
  if (q) filters.search = q;

  const tag = params.get('tag');
  if (tag) filters.tag = tag;

  // cornetto-58510: parse tri-state tag/country lists from the URL.
  const parseList = (key: string) => {
    const raw = params.get(key);
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  };
  filters.tagIncludes = parseList('tagInc');
  filters.tagExcludes = parseList('tagExc');
  filters.countryIncludes = parseList('countryInc');
  filters.countryExcludes = parseList('countryExc');

  const purposeRaw = params.get('purpose');
  if (purposeRaw && PURPOSE_VALUES.has(purposeRaw)) {
    filters.purpose = purposeRaw as AdminPayoutFilters['purpose'];
  }

  // regionPortals — admin /payments only. The regions arg is the prop-derived
  // hard scope; on a regional portal we never let the URL set regionPortals
  // either (the portal owns scope), so only honor it when regions is undefined.
  const regionsRaw = params.get('regions');
  if (regionsRaw && !regions) {
    const list = regionsRaw.split(',').map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) filters.regionPortals = list;
  }

  const from = params.get('from');
  if (from) filters.dateFrom = from;
  const to = params.get('to');
  if (to) filters.dateTo = to;

  const sortRaw = params.get('sort');
  if (sortRaw && SORT_VALUES.has(sortRaw)) {
    filters.sort = sortRaw as SortValue;
  }

  // Default-TRUE booleans: when the param is present, `0` => false, anything
  // else => true. Absent => leave the default (true).
  if (params.has('hideClosed')) filters.hideClosed = params.get('hideClosed') !== '0';
  if (params.has('hideScams')) filters.hideScams = params.get('hideScams') !== '0';
  if (params.has('hideUsCities')) filters.hideUsCities = params.get('hideUsCities') !== '0';

  // tigella-58512: default-FALSE toggle — present `tbd=1` => true; absent =>
  // leave the default (false). Any non-`1` value is treated as false.
  if (params.has('tbd')) filters.showTbdUnsubmitted = params.get('tbd') === '1';

  // farinata-58532: default-FALSE toggle — present `receipts=1` => true; absent
  // => leave the default (false). Any non-`1` value is treated as false.
  if (params.has('receipts')) filters.hasReceipts = params.get('receipts') === '1';

  const viewRaw = params.get('view');
  const viewMode: ViewMode | null =
    viewRaw && VIEW_MODES.includes(viewRaw as ViewMode) ? (viewRaw as ViewMode) : null;

  return { filters, viewMode };
}
