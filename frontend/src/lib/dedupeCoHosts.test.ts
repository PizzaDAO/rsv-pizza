import { describe, it, expect } from 'vitest';
import { dedupeCoHosts } from './dedupeCoHosts';

describe('dedupeCoHosts', () => {
  it('handles empty input', () => {
    expect(dedupeCoHosts(undefined)).toEqual([]);
    expect(dedupeCoHosts([])).toEqual([]);
  });
  it('dedupes by trimmed, case-insensitive name keeping first position', () => {
    const r = dedupeCoHosts([
      { id: '1', name: 'Ann' },
      { id: '2', name: 'Bob' },
      { id: '3', name: '  ann ' },
    ]);
    expect(r.map(h => h.id)).toEqual(['1', '2']);
  });
  it('prefers the richer duplicate', () => {
    const r = dedupeCoHosts([
      { id: '1', name: 'Ann' },
      { id: '2', name: 'ANN', avatar_url: 'a.png', twitter: 'ann' },
    ]);
    expect(r).toHaveLength(1);
    expect(r[0].id).toBe('2');
  });
  it('drops the main host, normalized', () => {
    const r = dedupeCoHosts([{ id: '1', name: 'Host Person' }, { id: '2', name: 'Bob' }], '  host person');
    expect(r.map(h => h.id)).toEqual(['2']);
  });
  it('keeps nameless entries unless they share an id', () => {
    const r = dedupeCoHosts([
      { id: '1', name: '' },
      { id: '2', name: '  ' },
      { id: '1', name: null },
    ]);
    expect(r.map(h => h.id)).toEqual(['1', '2']);
  });
});
