// ciabatta-58918: pure (no-React) (de)serializer for the /partners filter bar
// <-> URL query string. Wired into PartnersPage via react-router's
// useSearchParams so a refresh / shared link restores the exact filtered view.
// Kept React-free so it can be unit-tested in isolation.
//
// Design: diff-against-defaults (mirrors paymentsUrlState.ts). We only emit a
// query key when its value differs from DEFAULT_FILTERS, so the default view
// produces an empty query string and shared URLs stay short.

export type PartnersSortValue =
  | 'events_desc'
  | 'name_asc'
  | 'name_desc'
  | 'eventcount_asc';

export const PARTNERS_SORT_VALUES: PartnersSortValue[] = [
  'events_desc',
  'name_asc',
  'name_desc',
  'eventcount_asc',
];

export interface PartnersFilters {
  /** case-insensitive substring over name + description + twitter + instagram */
  search: string;
  /** 'all' or one of the distinct category values present in the data */
  category: string;
  sort: PartnersSortValue;
  cityIncludes: string[];
  cityExcludes: string[];
  /** region portal keys (see regions.ts PAYMENTS_REGION_LABELS) */
  regionIncludes: string[];
  regionExcludes: string[];
  countryIncludes: string[];
  countryExcludes: string[];
}

export const DEFAULT_FILTERS: PartnersFilters = {
  search: '',
  category: 'all',
  sort: 'events_desc',
  cityIncludes: [],
  cityExcludes: [],
  regionIncludes: [],
  regionExcludes: [],
  countryIncludes: [],
  countryExcludes: [],
};

const SORT_VALUE_SET = new Set<string>(PARTNERS_SORT_VALUES);

/**
 * Serialize the active filters to a URLSearchParams. A key is written ONLY when
 * its value differs from the default, so the default view produces an empty
 * query string.
 */
export function filtersToSearchParams(filters: PartnersFilters): URLSearchParams {
  const params = new URLSearchParams();

  if (filters.search && filters.search.trim()) params.set('q', filters.search.trim());
  if (filters.category && filters.category !== DEFAULT_FILTERS.category) {
    params.set('category', filters.category);
  }
  if (filters.sort && filters.sort !== DEFAULT_FILTERS.sort) params.set('sort', filters.sort);

  if (filters.cityIncludes.length) params.set('cityInc', filters.cityIncludes.join(','));
  if (filters.cityExcludes.length) params.set('cityExc', filters.cityExcludes.join(','));
  if (filters.regionIncludes.length) params.set('regionInc', filters.regionIncludes.join(','));
  if (filters.regionExcludes.length) params.set('regionExc', filters.regionExcludes.join(','));
  if (filters.countryIncludes.length) params.set('countryInc', filters.countryIncludes.join(','));
  if (filters.countryExcludes.length) params.set('countryExc', filters.countryExcludes.join(','));

  return params;
}

/**
 * Parse a URLSearchParams back into a PartnersFilters object. Starts from
 * DEFAULT_FILTERS and overlays each present param, validating the sort enum so
 * a hand-mangled URL can't crash the page.
 */
export function searchParamsToFilters(params: URLSearchParams): PartnersFilters {
  const parseList = (key: string): string[] => {
    const raw = params.get(key);
    return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  };

  const filters: PartnersFilters = {
    ...DEFAULT_FILTERS,
    cityIncludes: [],
    cityExcludes: [],
    regionIncludes: [],
    regionExcludes: [],
    countryIncludes: [],
    countryExcludes: [],
  };

  const q = params.get('q');
  if (q) filters.search = q;

  const category = params.get('category');
  if (category) filters.category = category;

  const sortRaw = params.get('sort');
  if (sortRaw && SORT_VALUE_SET.has(sortRaw)) filters.sort = sortRaw as PartnersSortValue;

  filters.cityIncludes = parseList('cityInc');
  filters.cityExcludes = parseList('cityExc');
  filters.regionIncludes = parseList('regionInc');
  filters.regionExcludes = parseList('regionExc');
  filters.countryIncludes = parseList('countryInc');
  filters.countryExcludes = parseList('countryExc');

  return filters;
}

/** True when `filters` differs from DEFAULT_FILTERS in any user-facing field. */
export function activeFilterCount(filters: PartnersFilters): number {
  let n = 0;
  if (filters.search.trim()) n += 1;
  if (filters.category !== DEFAULT_FILTERS.category) n += 1;
  if (filters.sort !== DEFAULT_FILTERS.sort) n += 1;
  n += filters.cityIncludes.length + filters.cityExcludes.length;
  n += filters.regionIncludes.length + filters.regionExcludes.length;
  n += filters.countryIncludes.length + filters.countryExcludes.length;
  return n;
}
