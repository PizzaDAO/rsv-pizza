import { describe, it, expect } from 'vitest';
import { buildBadges, typedBadges, blankBadges, safeName } from './nametagData';
import type { Guest, CoHost } from '../../../types';

const g = (o: Partial<Guest>): Guest => ({ name: 'X', dietaryRestrictions: [], toppings: [], dislikedToppings: [], ...o });
const labels = { host: 'Host', coHost: 'Co-host', partner: 'Partner' };
const base = { source: 'going' as const, roleLabels: labels, locale: 'en' };

describe('buildBadges', () => {
  const guests = [
    g({ id: '1', name: 'Zed', approved: true, email: 'zed@x.com' }),
    g({ id: '2', name: 'Amy', approved: null, status: 'CONFIRMED', email: 'amy@x.com', checkedInAt: '2027-01-01' }),
    g({ id: '3', name: 'Wait', status: 'WAITLISTED' }),
    g({ id: '4', name: 'Nope', approved: false }),
    g({ id: '1', name: 'Zed dup', approved: true }),
    g({ id: '5', name: '   ' }),
  ];

  it('everyone going: no waitlist, no rejected, deduped, empty skipped, sorted', () => {
    expect(buildBadges(guests, [], base).map((b) => b.name)).toEqual(['Amy', 'Zed']);
  });
  it('include waitlist', () => {
    expect(buildBadges(guests, [], { ...base, includeWaitlist: true }).map((b) => b.name)).toContain('Wait');
  });
  it('approved only / checked in / none', () => {
    expect(buildBadges(guests, [], { ...base, source: 'approved' }).map((b) => b.name)).toEqual(['Zed']);
    expect(buildBadges(guests, [], { ...base, source: 'checkedIn' }).map((b) => b.name)).toEqual(['Amy']);
    expect(buildBadges(guests, [], { ...base, source: 'none' })).toEqual([]);
  });
  it('locale-aware sort', () => {
    const l = [g({ id: 'a', name: 'Émile' }), g({ id: 'b', name: 'Eve' }), g({ id: 'c', name: 'Zoe' })];
    expect(buildBadges(l, [], { ...base, locale: 'fr' }).map((b) => b.name)).toEqual(['Émile', 'Eve', 'Zoe']);
  });
  it('role matching is case-insensitive; partner; host by name; rsvp role fallback', () => {
    const co = [{ id: 'c', name: 'C', email: 'ZED@x.com' }, { id: 'p', name: 'P', email: 'p@x.com', isPartner: true }] as CoHost[];
    const l = [
      g({ id: '1', name: 'Zed', email: 'zed@X.com' }),
      g({ id: '2', name: 'Pat', email: 'p@x.com' }),
      g({ id: '3', name: 'Sam Host' }),
      g({ id: '4', name: 'Dev Dan', roles: ['Dev'] }),
    ];
    const out = buildBadges(l, co, { ...base, roleLine: true, hostName: 'sam host' });
    const by = Object.fromEntries(out.map((b) => [b.name, b.role]));
    expect(by).toEqual({ Zed: 'Co-host', Pat: 'Partner', 'Sam Host': 'Host', 'Dev Dan': 'Dev' });
    expect(buildBadges(l, co, base).every((b) => b.role === undefined)).toBe(true);
  });
  it('badges carry no email', () => {
    const out = buildBadges(guests, [], base);
    expect(JSON.stringify(out)).not.toContain('@');
    expect(out.every((b) => !('email' in b))).toBe(true);
  });
  it('CJK names are left whole', () => {
    expect(buildBadges([g({ id: 'j', name: '山田太郎' })], [], base)[0].name).toBe('山田太郎');
  });
});

describe('helpers', () => {
  it('safeName strips emails used as names', () => {
    expect(safeName('bob@example.com')).toBe('bob');
    expect(safeName('  Ann   Lee ')).toBe('Ann Lee');
  });
  it('typed badge keys are stable when other lines change', () => {
    expect(typedBadges('Ann\nBob\nAnn').map((b) => b.key)).toEqual(['t-Ann-1', 't-Bob-1', 't-Ann-2']);
    expect(typedBadges('New\nAnn\nBob\nAnn').find((b) => b.name === 'Bob')!.key).toBe('t-Bob-1');
  });
  it('typed + blank badges', () => {
    expect(typedBadges('A\n\n b@x.io \nC').map((b) => b.name)).toEqual(['A', 'b', 'C']);
    expect(blankBadges(3)).toHaveLength(3);
    expect(blankBadges(999)).toHaveLength(48);
    expect(blankBadges(-1)).toHaveLength(0);
  });
});
