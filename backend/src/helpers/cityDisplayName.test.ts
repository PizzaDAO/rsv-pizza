import { describe, it, expect, vi } from 'vitest';

const { findMany } = vi.hoisted(() => ({ findMany: vi.fn() }));
vi.mock('../config/database.js', () => ({ prisma: { party: { findMany } } }));
vi.mock('../middleware/auth.js', () => ({ isAdmin: () => false }));

import { buildCityDisplayNameMap, titleCaseCityKey } from './underbossScope.js';

describe('city display names', () => {
  it('title-cases keys', () => {
    expect(titleCaseCityKey('mexico city')).toBe('Mexico City');
    expect(titleCaseCityKey('winston-salem')).toBe('Winston-Salem');
    expect(titleCaseCityKey('')).toBe('');
  });

  it('prefers the party-name casing and falls back to title case', async () => {
    findMany.mockResolvedValue([
      { name: 'Global Pizza Party São Paulo' },
      { name: 'Global Pizza Party Other' },
    ]);
    const m = await buildCityDisplayNameMap(['são paulo', 'new york']);
    expect(m.get('são paulo')).toBe('São Paulo');
    expect(m.get('new york')).toBe('New York');
  });
});
