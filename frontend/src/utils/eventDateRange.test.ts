import { describe, it, expect } from 'vitest';
import { formatEventDateRange } from './eventDateRange';

describe('formatEventDateRange', () => {
  it('same-day events keep the long date', () => {
    const r = formatEventDateRange(new Date('2027-04-01T17:00:00Z'), new Date('2027-04-02T01:00:00Z'), 'America/New_York', 'en-US');
    expect(r.multiDay).toBe(false);
    expect(r.dateLine).toBe('Thursday, April 1, 2027');
  });
  it('no end is single-day', () => {
    expect(formatEventDateRange(new Date('2027-04-01T17:00:00Z'), null, 'UTC', 'en-US').multiDay).toBe(false);
  });
  it('multi-day shows a range', () => {
    const r = formatEventDateRange(new Date('2027-04-01T14:00:00Z'), new Date('2027-04-03T22:00:00Z'), 'America/New_York', 'en-US');
    expect(r.multiDay).toBe(true);
    expect(r.dateLine).toBe('Thu, Apr 1 – Sat, Apr 3, 2027');
  });
  it('uses the event timezone for day boundaries', () => {
    // 23:00Z -> 03:00Z next UTC day is 16:00 -> 20:00 the same day in Los Angeles.
    const r = formatEventDateRange(new Date('2027-04-01T23:00:00Z'), new Date('2027-04-02T03:00:00Z'), 'America/Los_Angeles', 'en-US');
    expect(r.multiDay).toBe(false);
  });
});
