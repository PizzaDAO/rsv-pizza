/**
 * Public event search helpers (truffle-83044).
 *
 * Pure functions so the /events page and its tests share one implementation.
 * Continent mapping mirrors REGION_TO_CONTINENT in
 * backend/src/services/pizzaIndex.service.ts (keep in sync).
 */

export interface SearchableEvent {
  id: string;
  name: string;
  city: string;
  slug: string;
  date: string | null;
  venueName: string | null;
  address: string | null;
  country: string | null;
  region: string | null;
  rsvpCount: number;
  eventImageUrl?: string | null;
}

export interface EventSearchFilters {
  q: string;
  continent: string;
  country: string;
  region: string;
  city: string;
}

export const EMPTY_FILTERS: EventSearchFilters = { q: '', continent: '', country: '', region: '', city: '' };

const REGION_TO_CONTINENT: Record<string, string> = {
  usa: 'North America', canada: 'North America', 'central-america': 'North America',
  'south-america': 'South America',
  'western-europe': 'Europe', 'eastern-europe': 'Europe',
  'west-africa': 'Africa', 'east-africa': 'Africa', 'south-africa': 'Africa',
  india: 'Asia', asia: 'Asia', china: 'Asia', 'middle-east': 'Asia',
  oceania: 'Oceania',
};

export function regionToContinent(region: string | null | undefined): string | null {
  if (!region) return null;
  return REGION_TO_CONTINENT[region.trim().toLowerCase()] ?? null;
}

/** Lowercase + strip diacritics so "sao" matches "São Paulo". */
export function fold(s: string | null | undefined): string {
  return (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

export function eventContinent(e: SearchableEvent): string | null {
  return regionToContinent(e.region);
}

export function filterEvents(events: SearchableEvent[], f: EventSearchFilters): SearchableEvent[] {
  const tokens = fold(f.q).split(/\s+/).filter(Boolean);
  const country = fold(f.country);
  const city = fold(f.city);
  return events.filter((e) => {
    if (f.continent && eventContinent(e) !== f.continent) return false;
    if (country && fold(e.country) !== country) return false;
    if (f.region && (e.region || '').toLowerCase() !== f.region) return false;
    if (city && fold(e.city) !== city) return false;
    if (tokens.length) {
      const hay = fold([e.name, e.city, e.venueName, e.address, e.country, e.region].filter(Boolean).join(' '));
      if (!tokens.every((t) => hay.includes(t))) return false;
    }
    return true;
  });
}

export function filtersToSearchParams(f: EventSearchFilters): URLSearchParams {
  const p = new URLSearchParams();
  (Object.keys(f) as (keyof EventSearchFilters)[]).forEach((k) => {
    if (f[k]) p.set(k, f[k]);
  });
  return p;
}

export function searchParamsToFilters(p: URLSearchParams): EventSearchFilters {
  return {
    q: p.get('q') || '',
    continent: p.get('continent') || '',
    country: p.get('country') || '',
    region: p.get('region') || '',
    city: p.get('city') || '',
  };
}

export function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}
