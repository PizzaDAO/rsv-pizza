import { describe, it, expect } from 'vitest';
import { localToUTC, localHM, isValidTimezone } from './localTime.js';

describe('localTime', () => {
  it('isValidTimezone', () => {
    expect(isValidTimezone('America/Chicago')).toBe(true);
    expect(isValidTimezone('Nope/Zone')).toBe(false);
    expect(isValidTimezone('')).toBe(false);
    expect(isValidTimezone(undefined)).toBe(false);
  });

  it('Austin 2027-11-02 18:00 is still CDT (UTC-5; DST ends Nov 7)', () => {
    expect(localToUTC(2027, 11, 2, 18, 0, 'America/Chicago').toISOString()).toBe('2027-11-02T23:00:00.000Z');
  });

  it('+14h (Pacific/Kiritimati): local Nov 2 18:00 is Nov 2 04:00Z', () => {
    expect(localToUTC(2027, 11, 2, 18, 0, 'Pacific/Kiritimati').toISOString()).toBe('2027-11-02T04:00:00.000Z');
  });

  it('-11h (Pacific/Pago_Pago): local Nov 2 21:00 is Nov 3 08:00Z', () => {
    expect(localToUTC(2027, 11, 2, 21, 0, 'Pacific/Pago_Pago').toISOString()).toBe('2027-11-03T08:00:00.000Z');
  });

  it('DST boundary: New York before vs after fall-back (Nov 7 2027)', () => {
    expect(localToUTC(2027, 11, 6, 18, 0, 'America/New_York').toISOString()).toBe('2027-11-06T22:00:00.000Z'); // EDT
    expect(localToUTC(2027, 11, 8, 18, 0, 'America/New_York').toISOString()).toBe('2027-11-08T23:00:00.000Z'); // EST
  });

  it('round-trips through localHM, incl. half-hour zones', () => {
    for (const tz of ['Asia/Kolkata', 'America/St_Johns', 'Pacific/Kiritimati', 'Europe/Berlin']) {
      expect(localHM(localToUTC(2027, 11, 2, 18, 30, tz), tz)).toBe('18:30');
    }
  });
});
