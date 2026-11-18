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
  latitude?: number | null;
  longitude?: number | null;
}

export interface EventSearchFilters {
  q: string;
  continent: string;
  country: string;
  region: string;
  city: string;
  when: DateWindow | '';
}

export type DateWindow = 'week' | 'month' | 'upcoming' | 'past';
export const DATE_WINDOWS: DateWindow[] = ['week', 'month', 'upcoming', 'past'];

export const EMPTY_FILTERS: EventSearchFilters = { q: '', continent: '', country: '', region: '', city: '', when: '' };

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
  const now = new Date();
  return events.filter((e) => {
    if (f.when && !inDateWindow(e.date, f.when, now)) return false;
    if (f.continent && eventContinent(e) !== f.continent) return false;
    if (country && fold(e.country) !== country) return false;
    if (f.region && (e.region || '').toLowerCase() !== f.region) return false;
    if (city && fold(cleanCity(e.city) || '') !== city) return false;
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
    when: (DATE_WINDOWS as string[]).includes(p.get('when') || '') ? (p.get('when') as DateWindow) : '',
  };
}

export function uniqueSorted(values: (string | null | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v))).sort((a, b) => a.localeCompare(b));
}

/**
 * Normalize a host-entered city into something fit for a dropdown, or null when it does not look
 * like a city (event names, test data, empty). Strips stray leading/trailing punctuation, drops a
 * trailing ", ST" state suffix, and title-cases ALL-CAPS Latin values.
 */
export function cleanCity(raw: string | null | undefined): string | null {
  let c = (raw || '').trim().replace(/^[\s\-–—,.:;|/]+|[\s\-–—,.:;|/]+$/g, '');
  c = c.replace(/,\s*[A-Za-z]{2}$/, '').trim();
  if (!c || c.length > 40) return null;
  if (/[:\d()[\]@#!?]/.test(c)) return null;
  if (/\b(test|probe|party|edition|delete)\b/i.test(c)) return null;
  if (c.split(/\s+/).length > 5) return null;
  if (/^[A-Z\s]+$/.test(c) && c.length > 3) {
    c = c.toLowerCase().replace(/\b\p{L}/gu, (m) => m.toUpperCase());
  }
  return c;
}

/** Unique, sorted, display-ready city options (deduped accent/case-insensitively). */
export function cityOptions(events: SearchableEvent[]): string[] {
  const seen = new Map<string, string>();
  for (const e of events) {
    const c = cleanCity(e.city);
    if (!c) continue;
    const key = fold(c);
    if (!seen.has(key)) seen.set(key, c);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
}

/**
 * True when regions add nothing over countries: at most one region present, or regions and
 * countries map one-to-one (each region holds a single country and vice versa).
 */
export function regionDuplicatesCountry(events: SearchableEvent[]): boolean {
  const byRegion = new Map<string, Set<string>>();
  const byCountry = new Map<string, Set<string>>();
  for (const e of events) {
    const r = (e.region || '').toLowerCase();
    const c = fold(e.country);
    if (!r || !c) continue;
    if (!byRegion.has(r)) byRegion.set(r, new Set());
    byRegion.get(r)!.add(c);
    if (!byCountry.has(c)) byCountry.set(c, new Set());
    byCountry.get(c)!.add(r);
  }
  if (byRegion.size <= 1) return true;
  return [...byRegion.values()].every((s) => s.size === 1) && [...byCountry.values()].every((s) => s.size === 1);
}

export function inDateWindow(date: string | null, win: DateWindow, now: Date = new Date()): boolean {
  if (!date) return false;
  const t = new Date(date).getTime();
  if (Number.isNaN(t)) return false;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (win === 'past') return t < startOfToday;
  if (t < startOfToday) return false;
  if (win === 'upcoming') return true;
  if (win === 'week') return t < startOfToday + 7 * 86400000;
  // month: through the end of the current calendar month
  return t < new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Distance from `origin` to an event, or null when the event has no usable coordinates. */
export function eventDistanceKm(e: SearchableEvent, origin: { lat: number; lng: number }): number | null {
  if (typeof e.latitude !== 'number' || typeof e.longitude !== 'number') return null;
  if (e.latitude === 0 && e.longitude === 0) return null;
  return distanceKm(origin, { lat: e.latitude, lng: e.longitude });
}
