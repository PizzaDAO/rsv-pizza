import { describe, it, expect } from 'vitest';
import {
  filterEvents, EMPTY_FILTERS, filtersToSearchParams, searchParamsToFilters, parseTagsParam, SearchableEvent,
} from './eventSearch';

const mk = (o: Partial<SearchableEvent>): SearchableEvent => ({
  id: 'x', name: 'E', city: 'Austin', slug: 'e', date: null, venueName: null, address: null,
  country: 'US', region: null, rsvpCount: 0, ...o,
});

describe('eventSearch tags (blackolive-70521)', () => {
  const a = mk({ id: 'a', labels: ['dj', 'outdoor'] });
  const b = mk({ id: 'b', labels: ['dj'] });
  const c = mk({ id: 'c' });

  it('empty tags means no filtering', () => {
    expect(filterEvents([a, b, c], EMPTY_FILTERS).map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  it('one tag keeps events that have it', () => {
    expect(filterEvents([a, b, c], { ...EMPTY_FILTERS, tags: ['dj'] }).map((e) => e.id)).toEqual(['a', 'b']);
  });

  it('multiple tags are ANDed', () => {
    expect(filterEvents([a, b, c], { ...EMPTY_FILTERS, tags: ['dj', 'outdoor'] }).map((e) => e.id)).toEqual(['a']);
  });

  it('round-trips through the URL', () => {
    const p = filtersToSearchParams({ ...EMPTY_FILTERS, tags: ['dj', 'outdoor'] });
    expect(p.get('tags')).toBe('dj,outdoor');
    expect(searchParamsToFilters(p).tags).toEqual(['outdoor', 'dj']); // canonical (allowlist) order
    expect(filtersToSearchParams(EMPTY_FILTERS).has('tags')).toBe(false);
  });

  it('ignores unknown / malformed tags params', () => {
    expect(parseTagsParam('bogus, DJ ,,dj')).toEqual(['dj']);
    expect(parseTagsParam(null)).toEqual([]);
  });
});
