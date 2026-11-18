import { describe, it, expect, beforeEach } from 'vitest';
import { saveEventDraft, loadEventDraft, clearEventDraft, hasEventDraft, DRAFT_TTL_MS } from './eventDraft';
import { authErrorKey } from './authErrors';
import { groupEvents, paginateGroups, formatPartyDate } from './homeEvents';
import { shouldShowNextSteps, dismissNextSteps, isNextStepsDismissed } from './nextSteps';

const store: Record<string, string> = {};
beforeEach(() => {
  for (const k of Object.keys(store)) delete store[k];
  (globalThis as any).localStorage = {
    getItem: (k: string) => (k in store ? store[k] : null),
    setItem: (k: string, v: string) => { store[k] = v; },
    removeItem: (k: string) => { delete store[k]; },
  };
});

describe('eventDraft', () => {
  it('round-trips and clears', () => {
    saveEventDraft({ partyName: 'A' }, 1000);
    expect(loadEventDraft(2000)).toEqual({ partyName: 'A' });
    clearEventDraft();
    expect(hasEventDraft(2000)).toBe(false);
  });
  it('expires after 24h', () => {
    saveEventDraft({ partyName: 'A' }, 1000);
    expect(loadEventDraft(1000 + DRAFT_TTL_MS + 1)).toBeNull();
    expect(store['pendingEventDraft']).toBeUndefined();
  });
  it('ignores corrupt data', () => {
    store['pendingEventDraft'] = '{nope';
    expect(loadEventDraft()).toBeNull();
  });
});

describe('authErrorKey', () => {
  it('maps raw server strings', () => {
    expect(authErrorKey('Invalid code')).toBe('errors.invalidCode');
    expect(authErrorKey('Code has expired')).toBe('errors.codeExpired');
    expect(authErrorKey('Try again in a few minutes', 'send')).toBe('errors.tooManyAttempts');
    expect(authErrorKey('boom')).toBe('errors.verifyFailed');
    expect(authErrorKey('boom', 'send')).toBe('errors.sendFailed');
  });
});

describe('homeEvents', () => {
  const now = new Date('2026-06-01T12:00:00Z');
  const mk = (id: string, role: string, date: string | null, name = id) =>
    ({ id, name, inviteCode: id, date, address: null, eventImageUrl: null, guestCount: 0, role }) as any;
  const parties = [
    mk('h1', 'host', '2026-07-01T00:00:00Z'),
    mk('c1', 'cohost', '2026-08-01T00:00:00Z'),
    mk('g1', 'guest', '2026-09-01T00:00:00Z', 'Pizza night'),
    mk('t1', 'host', null),
    mk('p1', 'host', '2026-01-01T00:00:00Z'),
  ];
  it('groups upcoming', () => {
    const g = groupEvents(parties, { filter: 'upcoming', query: '', now });
    expect(g.hosting.map((p) => p.id)).toEqual(['h1', 'c1']);
    expect(g.attending.map((p) => p.id)).toEqual(['g1']);
    expect(g.tbd.map((p) => p.id)).toEqual(['t1']);
  });
  it('groups past and searches', () => {
    expect(groupEvents(parties, { filter: 'past', query: '', now }).hosting.map((p) => p.id)).toEqual(['p1']);
    expect(groupEvents(parties, { filter: 'upcoming', query: 'pizza', now }).attending).toHaveLength(1);
    expect(groupEvents(parties, { filter: 'upcoming', query: 'pizza', now }).hosting).toHaveLength(0);
  });
  it('paginates across groups', () => {
    const g = groupEvents(parties, { filter: 'upcoming', query: '', now });
    const p = paginateGroups(g, 2);
    expect(p.hosting).toHaveLength(2);
    expect(p.attending).toHaveLength(0);
    expect(p.total).toBe(3);
  });
  it('shows year only when not current', () => {
    expect(formatPartyDate('2027-03-05T12:00:00Z', 'TBD', now)).toContain('2027');
    expect(formatPartyDate('2026-03-05T12:00:00Z', 'TBD', now)).not.toContain('2026');
    expect(formatPartyDate(null, 'TBD', now)).toBe('TBD');
  });
});

describe('nextSteps', () => {
  const now = Date.parse('2026-06-10T00:00:00Z');
  it('shows for new empty parties only', () => {
    expect(shouldShowNextSteps({ createdAt: '2026-06-08T00:00:00Z' }, 0, now)).toBe(true);
    expect(shouldShowNextSteps({ createdAt: '2026-06-08T00:00:00Z' }, 1, now)).toBe(false);
    expect(shouldShowNextSteps({ createdAt: '2026-05-01T00:00:00Z' }, 0, now)).toBe(false);
    expect(shouldShowNextSteps({}, 0, now)).toBe(false);
  });
  it('remembers dismissal', () => {
    expect(isNextStepsDismissed('p')).toBe(false);
    dismissNextSteps('p');
    expect(isNextStepsDismissed('p')).toBe(true);
  });
});
