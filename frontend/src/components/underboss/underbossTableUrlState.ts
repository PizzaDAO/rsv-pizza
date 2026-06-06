// montanara-58497: pure (no-React) (de)serializer for the /underboss EventTable
// filter bar + the dashboard's active tab <-> URL query string. Wired into
// UnderbossDashboard via react-router's useSearchParams so a refresh / shared
// link restores the exact view. Mirrors paymentsUrlState.ts in style: kept
// React-free so it can be unit-tested in isolation, and uses diff-against-
// defaults so the default view produces an EMPTY query string and a mangled URL
// can never crash the page (every enum/list is validated on parse).
//
// NOTE: the tag filter is the tri-state include/exclude model introduced in
// provola-58497 (NOT a single `tagFilter` string). We persist the include +
// exclude lists; tagTouchOrder (purely cosmetic dropdown ordering) is NOT
// persisted — it's reconstructed from the active lists on apply.

export type UnderbossTab =
  | 'events'
  | 'cities'
  | 'partners'
  | 'fake-detection'
  | 'superlatives'
  | 'survey'
  | 'outreach'
  | 'telegram-groups';

const UNDERBOSS_TABS: UnderbossTab[] = [
  'events',
  'cities',
  'partners',
  'fake-detection',
  'superlatives',
  'survey',
  'outreach',
  'telegram-groups',
];

// The default tab UnderbossDashboard mounts on. Skipped from the query string.
const DEFAULT_TAB: UnderbossTab = 'events';

export type EventTableSortField =
  | 'name'
  | 'date'
  | 'guestCount'
  | 'progress'
  | 'appealsFirst';

const SORT_FIELDS: EventTableSortField[] = [
  'name',
  'date',
  'guestCount',
  'progress',
  'appealsFirst',
];

export interface EventTableFilters {
  search: string;
  sortField: EventTableSortField;
  sortDir: 'asc' | 'desc';
  progressIncludes: string[];
  progressExcludes: string[];
  regionFilter: string; // country, 'all' default
  tagIncludes: string[]; // tri-state tag filter (provola-58497)
  tagExcludes: string[];
  rsvpComparator: '>' | '<';
  rsvpThreshold: string; // '' default
  appealsOnly: boolean;
}

export const DEFAULT_EVENT_TABLE_FILTERS: EventTableFilters = {
  search: '',
  sortField: 'date',
  sortDir: 'asc',
  progressIncludes: [],
  progressExcludes: [],
  regionFilter: 'all',
  tagIncludes: [],
  tagExcludes: [],
  rsvpComparator: '>',
  rsvpThreshold: '',
  appealsOnly: false,
};

// Allowed progress-filter keys: the PROGRESS_FILTER_KEYS in EventTable.tsx plus
// the four status pills. Exported so EventTable can stay the single source of
// truth in tandem; we validate every `inc`/`exc` segment against this set so a
// hand-mangled URL can't inject an unknown key.
export const ALLOWED_PROGRESS_KEYS = new Set<string>([
  'hasPartyKit',
  'hasCoHosts',
  'hasVenue',
  'hasBudget',
  'hasSponsors',
  'hasSocialPosts',
  'hasThrown',
  'hasEstimatedAttendance',
  'hasSubmittedReceipt',
  'hasSubmittedPaymentInfo',
  'approved',
  'rejected',
  'hidden',
  'listed',
]);

function sanitizeKeyList(raw: string | null): string[] {
  if (!raw) return [];
  const segs = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  // Keep only allowed keys; dedupe while preserving order.
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of segs) {
    if (ALLOWED_PROGRESS_KEYS.has(s) && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// Tag lists are free-form (any string is a valid tag); we just trim + dedupe
// and bound the count so a pathological URL can't blow up.
function sanitizeTagList(raw: string | null): string[] {
  if (!raw) return [];
  const segs = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of segs) {
    if (!seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
    if (out.length >= 100) break;
  }
  return out;
}

/**
 * Serialize the active EventTable filters + the dashboard tab to a
 * URLSearchParams. A key is written ONLY when its value differs from the
 * default, so the default view produces an empty query string.
 */
export function eventTableFiltersToSearchParams(
  filters: EventTableFilters,
  activeTab: UnderbossTab,
): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search && filters.search.trim()) {
    params.set('q', filters.search.trim());
  }

  const sort = `${filters.sortField}_${filters.sortDir}`;
  if (sort !== `${DEFAULT_EVENT_TABLE_FILTERS.sortField}_${DEFAULT_EVENT_TABLE_FILTERS.sortDir}`) {
    params.set('sort', sort);
  }

  if (filters.progressIncludes.length > 0) {
    params.set('inc', filters.progressIncludes.join(','));
  }
  if (filters.progressExcludes.length > 0) {
    params.set('exc', filters.progressExcludes.join(','));
  }

  if (filters.regionFilter && filters.regionFilter !== 'all') {
    params.set('country', filters.regionFilter);
  }

  if (filters.tagIncludes.length > 0) {
    params.set('tagInc', filters.tagIncludes.join(','));
  }
  if (filters.tagExcludes.length > 0) {
    params.set('tagExc', filters.tagExcludes.join(','));
  }

  const threshold = filters.rsvpThreshold.trim();
  if (threshold !== '' && Number.isFinite(Number(threshold))) {
    const comparator = filters.rsvpComparator === '<' ? '<' : '>';
    params.set('rsvp', `${comparator}${threshold}`);
  }

  if (filters.appealsOnly) {
    params.set('appeals', '1');
  }

  if (activeTab !== DEFAULT_TAB) {
    params.set('tab', activeTab);
  }

  return params;
}

/**
 * Parse a URLSearchParams back into an EventTableFilters object + activeTab.
 * Starts from DEFAULT_EVENT_TABLE_FILTERS and overlays each present param,
 * validating enums / key sets so a hand-mangled URL can't crash the page.
 *
 * Returns `activeTab: null` when no `tab` param is present so the caller can
 * keep its current default tab.
 */
export function searchParamsToEventTableFilters(
  params: URLSearchParams,
): { filters: EventTableFilters; activeTab: UnderbossTab | null } {
  const filters: EventTableFilters = {
    ...DEFAULT_EVENT_TABLE_FILTERS,
    progressIncludes: [],
    progressExcludes: [],
    tagIncludes: [],
    tagExcludes: [],
  };

  const q = params.get('q');
  if (q) filters.search = q;

  const sortRaw = params.get('sort');
  if (sortRaw) {
    const idx = sortRaw.lastIndexOf('_');
    if (idx > 0) {
      const field = sortRaw.slice(0, idx);
      const dir = sortRaw.slice(idx + 1);
      if (
        (SORT_FIELDS as string[]).includes(field) &&
        (dir === 'asc' || dir === 'desc')
      ) {
        filters.sortField = field as EventTableSortField;
        filters.sortDir = dir;
      }
    }
  }

  filters.progressIncludes = sanitizeKeyList(params.get('inc'));
  filters.progressExcludes = sanitizeKeyList(params.get('exc'));

  const country = params.get('country');
  if (country && country.trim()) filters.regionFilter = country.trim();

  filters.tagIncludes = sanitizeTagList(params.get('tagInc'));
  filters.tagExcludes = sanitizeTagList(params.get('tagExc'));

  const rsvpRaw = params.get('rsvp');
  if (rsvpRaw) {
    const comparator = rsvpRaw[0];
    if (comparator === '>' || comparator === '<') {
      const rest = rsvpRaw.slice(1).trim();
      const num = Number(rest);
      if (rest !== '' && Number.isFinite(num)) {
        filters.rsvpComparator = comparator;
        filters.rsvpThreshold = rest;
      }
    }
  }

  if (params.has('appeals')) {
    filters.appealsOnly = params.get('appeals') !== '0';
  }

  const tabRaw = params.get('tab');
  const activeTab: UnderbossTab | null =
    tabRaw && UNDERBOSS_TABS.includes(tabRaw as UnderbossTab)
      ? (tabRaw as UnderbossTab)
      : null;

  return { filters, activeTab };
}
