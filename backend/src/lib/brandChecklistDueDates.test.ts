import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { BRAND_DUE_OFFSETS, brandDueDate, withBrandDueDates, localDateString } from './brandChecklistDueDates.js';

const require = createRequire(import.meta.url);
const { BRAND_CHECKLISTS } = require('../../scripts/seed-brand-checklists.cjs');

const FLOW_FOR_SLUG: Record<string, keyof typeof BRAND_DUE_OFFSETS> = {
  doge: 'global_day',
  team1: 'meetup',
  monad: 'hackathon',
};

const ymd = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

describe('brand checklist due dates', () => {
  it('every brand item except "Create your event" has an offset, and every offset names a real item', () => {
    for (const [slug, flow] of Object.entries(FLOW_FOR_SLUG)) {
      const names = (BRAND_CHECKLISTS[slug] as [string][]).map(([n]) => n);
      const offsetNames = Object.keys(BRAND_DUE_OFFSETS[flow]);
      for (const n of offsetNames) expect(names).toContain(n);
      for (const n of names) {
        if (n !== 'Create your event') expect(offsetNames).toContain(n);
      }
    }
  });

  const dogeParty = {
    date: new Date('2027-11-02T22:00:00.000Z'), // 6pm America/New_York
    endTime: new Date('2027-11-03T01:00:00.000Z'),
    timezone: 'America/New_York',
    createdAt: new Date('2026-11-01T12:00:00.000Z'),
  };

  it('Doge Day dates count back from Nov 2 2027 in the party time zone', () => {
    expect(ymd(brandDueDate('global_day', 'Pick a venue', dogeParty))).toBe('2027-09-21');
    expect(ymd(brandDueDate('global_day', 'Use your Party Guide on Doge Day', dogeParty))).toBe('2027-11-02');
    expect(ymd(brandDueDate('global_day', 'Upload photos after the party', dogeParty))).toBe('2027-11-05');
  });

  it('uses the local date, not the UTC date', () => {
    // 2027-11-03T01:00Z is still Nov 2 in New York.
    expect(localDateString(new Date('2027-11-03T01:00:00.000Z'), 'America/New_York')).toBe('2027-11-02');
    expect(localDateString(new Date('2027-11-03T01:00:00.000Z'), 'not/a-zone')).toBe('2027-11-03');
  });

  it('hackathon post-event items anchor on the end date', () => {
    const p = {
      date: new Date('2027-03-01T15:00:00.000Z'),
      endTime: new Date('2027-03-03T23:00:00.000Z'),
      timezone: 'UTC',
      createdAt: new Date('2026-12-01T00:00:00.000Z'),
    };
    expect(ymd(brandDueDate('hackathon', 'Day-of: check-in and displays', p))).toBe('2027-03-01');
    expect(ymd(brandDueDate('hackathon', 'Run demos and judging', p))).toBe('2027-03-03');
    expect(ymd(brandDueDate('hackathon', 'Send prizes to winners', p))).toBe('2027-03-17');
  });

  it('clamps to the creation date so late-created events do not start overdue', () => {
    const p = {
      date: new Date('2027-01-20T23:30:00.000Z'),
      timezone: 'UTC',
      createdAt: new Date('2027-01-10T09:00:00.000Z'),
    };
    expect(ymd(brandDueDate('meetup', 'Confirm venue', p))).toBe('2027-01-10'); // -21 -> clamped
    expect(ymd(brandDueDate('meetup', 'Remind guests the day before', p))).toBe('2027-01-19');
  });

  it('returns null for GPP (no preset), unknown items, or undated parties', () => {
    expect(brandDueDate(null, 'Get approved', dogeParty)).toBeNull();
    expect(brandDueDate('global_day', 'Create your event', dogeParty)).toBeNull();
    expect(brandDueDate('global_day', 'Get approved', { ...dogeParty, date: null })).toBeNull();
  });

  it('withBrandDueDates fills only null dates on default items', () => {
    const stored = new Date('2027-10-01T00:00:00.000Z');
    const items = [
      { name: 'Get approved', dueDate: null, isDefault: true },
      { name: 'Pick a venue', dueDate: stored, isDefault: true },
      { name: 'Get approved', dueDate: null, isDefault: false },
    ];
    const out = withBrandDueDates(items, 'global_day', dogeParty);
    expect(ymd(out[0].dueDate)).toBe('2027-09-21');
    expect(out[1].dueDate).toBe(stored);
    expect(out[2].dueDate).toBeNull();
    expect(withBrandDueDates(items, null, dogeParty)).toBe(items);
  });
});
