import { describe, it, expect, vi, beforeEach } from 'vitest';

const gpp = vi.hoisted(() => vi.fn());
const side = vi.hoisted(() => vi.fn());
vi.mock('./gpp27.js', () => ({ isGpp27Hidden: gpp }));
vi.mock('./side.js', () => ({ isSideHidden: side }));

import { isEventHiddenFrom } from './eventVisibility.js';

const base = { eventType: null as string | null, eventTags: [] as string[], date: new Date('2027-05-22T18:00:00Z'), region: 'usa', city: 'Austin' };

beforeEach(() => {
  vi.clearAllMocks();
  gpp.mockResolvedValue(false);
  side.mockResolvedValue(false);
});

describe('isEventHiddenFrom (shared with GET /api/events/:slug)', () => {
  it('ordinary events: never hidden, no gate lookups', async () => {
    expect(await isEventHiddenFrom(base, 'a@b.co')).toBe(false);
    expect(gpp).not.toHaveBeenCalled();
    expect(side).not.toHaveBeenCalled();
  });

  it('GPP events go through the GPP27 gate with the party year', async () => {
    gpp.mockResolvedValue(true);
    expect(await isEventHiddenFrom({ ...base, eventType: 'gpp', eventTags: ['gpp27'] }, 'x@y.co')).toBe(true);
    expect(gpp).toHaveBeenCalledWith({ year: 2027, eventTags: ['gpp27'], region: 'usa', city: 'Austin' }, 'x@y.co');
  });

  it('side events (type or side-prelaunch tag) go through the side gate', async () => {
    side.mockResolvedValue(true);
    expect(await isEventHiddenFrom({ ...base, eventType: 'side' }, undefined)).toBe(true);
    expect(await isEventHiddenFrom({ ...base, eventTags: ['side-prelaunch'] }, undefined)).toBe(true);
    expect(side).toHaveBeenCalledTimes(2);
  });
});
