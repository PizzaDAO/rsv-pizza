import { describe, it, expect } from 'vitest';
import { timeLeft } from './HackathonSection';
import { isoToLocalInput, localInputToIso, prizeAmount } from '../../lib/hackathonApi';
import { PINNABLE_APPS, BROADCAST_APPS } from '../../lib/appDefinitions';
import { ALL_HOST_TABS } from '../../lib/tabPermissions';
import { CREATE_PRESETS } from '../../config/createPresets';

describe('hackathon frontend helpers', () => {
  it('timeLeft: days+hours, hours+minutes, null when past', () => {
    const now = Date.parse('2027-01-01T00:00:00Z');
    expect(timeLeft('2027-01-03T05:00:00Z', now)).toBe('2d 5h left');
    expect(timeLeft('2027-01-01T03:07:00Z', now)).toBe('3h 7m left');
    expect(timeLeft('2026-12-31T00:00:00Z', now)).toBeNull();
    expect(timeLeft(null, now)).toBeNull();
  });

  it('datetime-local round trip', () => {
    const iso = '2027-03-06T23:00:00.000Z';
    expect(localInputToIso(isoToLocalInput(iso))).toBe(iso);
    expect(localInputToIso('')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });

  it('prizeAmount prefers the free text', () => {
    expect(prizeAmount({ amountText: '2,500 MON', amountValue: 1, currency: 'X' })).toBe('2,500 MON');
    expect(prizeAmount({ amountText: null, amountValue: null, currency: null })).toBeNull();
  });

  it('the app is pinnable, broadcastable, co-host-assignable, and pinned for the hackathon flow', () => {
    expect(PINNABLE_APPS.find((a) => a.id === 'hackathon')?.tab).toBe('hackathon');
    expect(BROADCAST_APPS.some((a) => a.tab === 'hackathon')).toBe(true);
    expect(ALL_HOST_TABS.some((t) => t.id === 'hackathon')).toBe(true);
    expect(CREATE_PRESETS.hackathon.pinnedApps).toContain('hackathon');
  });
});
