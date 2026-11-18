import { describe, it, expect } from 'vitest';
import {
  EMPTY_FILTERS, SearchableEvent, filterEvents, cleanCity, cityOptions, inDateWindow,
  regionDuplicatesCountry, eventDistanceKm,
} from './eventSearch';

const mk = (o: Partial<SearchableEvent>): SearchableEvent => ({
  id: 'x', name: 'GPP', city: '', slug: 'x', date: null, venueName: null, address: null,
  country: null, region: null, rsvpCount: 0, ...o,
});

describe('cleanCity / cityOptions', () => {
  it('drops event names and test data, normalizes the rest', () => {
    expect(cleanCity('- Nashville')).toBe('Nashville');
    expect(cleanCity('NYC: Modern Finance Edition')).toBeNull();
    expect(cleanCity('zz32557 probe party')).toBeNull();
    expect(cleanCity('Global Pizza Party Austin')).toBeNull();
    expect(cleanCity('Sioux Falls, SD')).toBe('Sioux Falls');
    expect(cleanCity('KUMAMOTO JAPAN')).toBe('Kumamoto Japan');
    expect(cleanCity('São Paulo')).toBe('São Paulo');
    expect(cleanCity('')).toBeNull();
    expect(cleanCity(null)).toBeNull();
  });
  it('dedupes accent/case-insensitively and sorts', () => {
    const evs = [mk({ city: 'sao paulo' }), mk({ city: 'São Paulo' }), mk({ city: 'Berlin' }), mk({ city: 'Test: x' })];
    expect(cityOptions(evs)).toEqual(['Berlin', 'sao paulo']);
  });
  it('city filter matches the cleaned value', () => {
    const evs = [mk({ id: 'a', city: '- Nashville' })];
    expect(filterEvents(evs, { ...EMPTY_FILTERS, city: 'Nashville' })).toHaveLength(1);
  });
});

describe('inDateWindow', () => {
  const now = new Date(2026, 10, 18, 15, 0); // Wed Nov 18 2026
  it('handles windows', () => {
    expect(inDateWindow(new Date(2026, 10, 20).toISOString(), 'week', now)).toBe(true);
    expect(inDateWindow(new Date(2026, 10, 30).toISOString(), 'week', now)).toBe(false);
    expect(inDateWindow(new Date(2026, 10, 30).toISOString(), 'month', now)).toBe(true);
    expect(inDateWindow(new Date(2026, 11, 2).toISOString(), 'month', now)).toBe(false);
    expect(inDateWindow(new Date(2027, 0, 2).toISOString(), 'upcoming', now)).toBe(true);
    expect(inDateWindow(new Date(2026, 10, 1).toISOString(), 'past', now)).toBe(true);
    expect(inDateWindow(new Date(2026, 10, 18, 9).toISOString(), 'past', now)).toBe(false);
    expect(inDateWindow(null, 'upcoming', now)).toBe(false);
  });
});

describe('regionDuplicatesCountry', () => {
  it('true when one-to-one, false when a region spans countries', () => {
    expect(regionDuplicatesCountry([mk({ country: 'Brazil', region: 'south-america' })])).toBe(true);
    expect(regionDuplicatesCountry([
      mk({ country: 'Brazil', region: 'south-america' }), mk({ country: 'Peru', region: 'south-america' }),
      mk({ country: 'Germany', region: 'western-europe' }),
    ])).toBe(false);
    expect(regionDuplicatesCountry([
      mk({ country: 'Brazil', region: 'south-america' }), mk({ country: 'Germany', region: 'western-europe' }),
    ])).toBe(true);
  });
});

describe('eventDistanceKm', () => {
  it('computes haversine and ignores missing coords', () => {
    const d = eventDistanceKm(mk({ latitude: 52.52, longitude: 13.405 }), { lat: 48.8566, lng: 2.3522 })!;
    expect(d).toBeGreaterThan(870);
    expect(d).toBeLessThan(890);
    expect(eventDistanceKm(mk({}), { lat: 0, lng: 0 })).toBeNull();
  });
});
