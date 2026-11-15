import { describe, it, expect } from 'vitest';
import {
  extractCityAndState,
  cleanCity,
  generatePressRelease,
  getPressReleaseRsvpUrl,
  formatPressReleaseDate,
  PLACEHOLDER_KEYS,
} from './pressReleaseUtils';
import type { Party } from '../../types';

const asParty = (p: Partial<Party>) => p as Party;

describe('pressReleaseUtils', () => {
  it('extractCityAndState handles 1, 2 and 3+ part addresses', () => {
    expect(extractCityAndState('')).toEqual({ city: '', stateOrCountry: '' });
    expect(extractCityAndState('Austin')).toEqual({ city: 'Austin', stateOrCountry: '' });
    expect(extractCityAndState('Austin, TX')).toEqual({ city: 'Austin', stateOrCountry: 'TX' });
    expect(extractCityAndState('1 Main St, Austin, TX 78701')).toEqual({ city: 'Austin', stateOrCountry: 'TX 78701' });
  });

  it('cleanCity strips trailing zip codes', () => {
    expect(cleanCity('Austin 78701')).toBe('Austin');
    expect(cleanCity('Austin 78701-1234')).toBe('Austin');
    expect(cleanCity('Austin')).toBe('Austin');
  });

  it('generatePressRelease replaces every occurrence and flags empty values', () => {
    const out = generatePressRelease('{city} and {city}: {host_name} {venue}', { city: 'Rome', host_name: '', venue: 'Hall' });
    expect(out).toBe('Rome and Rome: [host_name] Hall');
  });

  it('getPressReleaseRsvpUrl prefers the custom url', () => {
    expect(getPressReleaseRsvpUrl(asParty({ customUrl: 'rome', inviteCode: 'abc' }))).toBe('rsv.pizza/rome');
    expect(getPressReleaseRsvpUrl(asParty({ customUrl: null, inviteCode: 'abc' }))).toBe('rsv.pizza/rsvp/abc');
  });

  it('formatPressReleaseDate formats in the event timezone and falls back when missing', () => {
    expect(formatPressReleaseDate(asParty({}), 'en-US', 'TBD')).toBe('TBD');
    expect(formatPressReleaseDate(asParty({ date: '2026-05-10T18:00:00Z', timezone: 'UTC' }))).toBe('May 10, 2026');
  });

  it('formatPressReleaseDate keeps the event-local day regardless of the viewer TZ', () => {
    // 2026-05-10 23:30 in Los Angeles (UTC-7) is already 05-11 in UTC.
    expect(formatPressReleaseDate(asParty({ date: '2026-05-11T06:30:00Z', timezone: 'America/Los_Angeles' }))).toBe('May 10, 2026');
    expect(formatPressReleaseDate(asParty({ date: '2026-05-10T23:30:00Z', timezone: 'Pacific/Kiritimati' }))).toBe('May 11, 2026');
    expect(formatPressReleaseDate(asParty({ date: '2026-05-10T12:00:00Z', timezone: 'UTC' }))).toBe('May 10, 2026');
  });

  it('formatPressReleaseDate falls back to TBD on an invalid timezone or date', () => {
    expect(formatPressReleaseDate(asParty({ date: '2026-05-10T12:00:00Z', timezone: 'Not/AZone' }), 'en-US', 'TBD')).toBe('TBD');
    expect(formatPressReleaseDate(asParty({ date: 'garbage', timezone: 'UTC' }), 'en-US', 'TBD')).toBe('TBD');
  });

  it('exposes the nine placeholder keys', () => {
    expect(PLACEHOLDER_KEYS).toHaveLength(9);
  });
});
