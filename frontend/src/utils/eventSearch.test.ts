import { describe, it, expect } from 'vitest';
import {
  filterEvents, EMPTY_FILTERS, regionToContinent, filtersToSearchParams, searchParamsToFilters, SearchableEvent,
} from './eventSearch';

const mk = (o: Partial<SearchableEvent>): SearchableEvent => ({
  id: 'x', name: 'GPP', city: '', slug: 'x', date: null, venueName: null, address: null,
  country: null, region: null, rsvpCount: 0, ...o,
});
const events = [
  mk({ id: '1', name: 'GPP São Paulo', city: 'São Paulo', country: 'Brazil', region: 'south-america', venueName: 'Pizza Hall' }),
  mk({ id: '2', name: 'GPP Berlin', city: 'Berlin', country: 'Germany', region: 'western-europe' }),
  mk({ id: '3', name: 'GPP Austin', city: 'Austin', country: 'United States', region: 'usa', venueName: 'Home Slice' }),
];

describe('filterEvents', () => {
  it('returns all with empty filters', () => {
    expect(filterEvents(events, EMPTY_FILTERS)).toHaveLength(3);
  });
  it('keyword is accent-insensitive and searches venue', () => {
    expect(filterEvents(events, { ...EMPTY_FILTERS, q: 'sao' }).map((e) => e.id)).toEqual(['1']);
    expect(filterEvents(events, { ...EMPTY_FILTERS, q: 'home slice' }).map((e) => e.id)).toEqual(['3']);
  });
  it('filters by continent, country, region', () => {
    expect(filterEvents(events, { ...EMPTY_FILTERS, continent: 'Europe' }).map((e) => e.id)).toEqual(['2']);
    expect(filterEvents(events, { ...EMPTY_FILTERS, country: 'brazil' }).map((e) => e.id)).toEqual(['1']);
    expect(filterEvents(events, { ...EMPTY_FILTERS, region: 'usa' }).map((e) => e.id)).toEqual(['3']);
  });
  it('combines filters', () => {
    expect(filterEvents(events, { ...EMPTY_FILTERS, continent: 'Europe', q: 'austin' })).toHaveLength(0);
  });
});

describe('url state', () => {
  it('round-trips and omits empty values', () => {
    const f = { ...EMPTY_FILTERS, q: 'pizza', country: 'Brazil' };
    const p = filtersToSearchParams(f);
    expect(p.toString()).toBe('q=pizza&country=Brazil');
    expect(searchParamsToFilters(p)).toEqual(f);
  });
});

describe('regionToContinent', () => {
  it('maps known regions, null otherwise', () => {
    expect(regionToContinent('India')).toBe('Asia');
    expect(regionToContinent('nope')).toBeNull();
    expect(regionToContinent(null)).toBeNull();
  });
});
