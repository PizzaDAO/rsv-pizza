/**
 * PR 7 voting rules (pure): window / status, manual open / close, settings validation incl. the
 * scope lock, vote target parsing per scope, self-vote matching, ip_hash (HMAC, never the IP),
 * ip buckets, tally ranking per scope, People's Choice suggestions, the award guard and the
 * public / host serializers (no counts in the public shape).
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_VOTING,
  assertPeoplesChoiceAwardable,
  buildTally,
  hashVoteIp,
  hostVoting,
  ipBuckets,
  isOwnTeam,
  manualClose,
  manualOpen,
  parseVoteTarget,
  parseVotingSettings,
  publicVoting,
  rankTally,
  suggestPeoplesChoice,
  talliesVisible,
  votingStatus,
  type VotingSettings,
} from './voting.js';
import { decideEligibility } from './eligibility.js';

const NOW = new Date('2027-03-07T12:00:00Z');
const at = (min: number) => new Date(NOW.getTime() + min * 60_000);
const v = (over: Partial<VotingSettings> = {}): VotingSettings => ({ ...DEFAULT_VOTING, enabled: true, ...over });
const T1 = '33333333-3333-4333-8333-333333333333';
const T2 = '33333333-3333-4333-8333-444444444444';

describe('votingStatus / window', () => {
  it('no row or disabled = off; before opens_at (or none) = scheduled; inside = open; after closes_at = closed', () => {
    expect(votingStatus(null, NOW)).toBe('off');
    expect(votingStatus(v({ enabled: false, opensAt: at(-10) }), NOW)).toBe('off');
    expect(votingStatus(v(), NOW)).toBe('scheduled');
    expect(votingStatus(v({ opensAt: at(10) }), NOW)).toBe('scheduled');
    expect(votingStatus(v({ opensAt: at(-10) }), NOW)).toBe('open');
    expect(votingStatus(v({ opensAt: at(-10), closesAt: at(10) }), NOW)).toBe('open');
    expect(votingStatus(v({ opensAt: at(-10), closesAt: NOW }), NOW)).toBe('closed'); // [opens, closes)
    expect(votingStatus(v({ opensAt: at(-10), closesAt: at(-1) }), NOW)).toBe('closed');
  });
  it('a closed vote stays closed (tally visible) even if the host later turns voting off', () => {
    expect(votingStatus(v({ enabled: false, opensAt: at(-10), closesAt: at(-1) }), NOW)).toBe('closed');
  });
  it('tallies are visible only when closed (host included)', () => {
    expect(['off', 'scheduled', 'open'].map((s) => talliesVisible(s as any))).toEqual([false, false, false]);
    expect(talliesVisible('closed')).toBe(true);
  });
  it('manual open: opens now, keeps a future close, clears a past one (re-open)', () => {
    expect(manualOpen(v({ enabled: false }), NOW)).toEqual({ enabled: true, opensAt: NOW, closesAt: null });
    expect(manualOpen(v({ closesAt: at(60) }), NOW)).toEqual({ enabled: true, opensAt: NOW, closesAt: at(60) });
    expect(manualOpen(v({ opensAt: at(-60), closesAt: at(-1) }), NOW).closesAt).toBeNull();
    expect(votingStatus({ ...v(), ...manualOpen(v({ closesAt: at(-1) }), NOW) }, NOW)).toBe('open');
  });
  it('manual close: closes now, keeps a past open, clears a future open (window CHECK)', () => {
    expect(manualClose(v({ opensAt: at(-60) }), NOW)).toEqual({ opensAt: at(-60), closesAt: NOW });
    expect(manualClose(v({ opensAt: at(60) }), NOW)).toEqual({ opensAt: null, closesAt: NOW });
    expect(votingStatus({ ...v(), ...manualClose(v({ opensAt: at(-60) }), NOW) }, NOW)).toBe('closed');
  });
});

describe('parseVotingSettings', () => {
  it('merges valid fields onto the current settings', () => {
    const out = parseVotingSettings({ enabled: true, scope: 'track', eligibility: 'registered', opensAt: at(0).toISOString(), closesAt: at(60).toISOString() }, DEFAULT_VOTING, 0);
    expect(out).toEqual({ enabled: true, scope: 'track', eligibility: 'registered', opensAt: at(0), closesAt: at(60) });
    expect(parseVotingSettings({}, v({ scope: 'track' }), 3)).toEqual(v({ scope: 'track' }));
    expect(parseVotingSettings({ opensAt: null }, v({ opensAt: at(0) }), 0).opensAt).toBeNull();
  });
  it('rejects bad enums, non-boolean enabled, bad dates and close <= open', () => {
    expect(() => parseVotingSettings({ scope: 'global' }, DEFAULT_VOTING, 0)).toThrow(/scope/);
    expect(() => parseVotingSettings({ eligibility: 'logged_in' }, DEFAULT_VOTING, 0)).toThrow(/vote/);
    expect(() => parseVotingSettings({ enabled: 'yes' }, DEFAULT_VOTING, 0)).toThrow(/enabled/);
    expect(() => parseVotingSettings({ opensAt: 'nope' }, DEFAULT_VOTING, 0)).toThrow(/date/);
    expect(() => parseVotingSettings({ opensAt: at(10).toISOString(), closesAt: at(10).toISOString() }, DEFAULT_VOTING, 0)).toThrow(/close after/);
    expect(() => parseVotingSettings({ closesAt: at(-10).toISOString() }, v({ opensAt: at(0) }), 0)).toThrow(/close after/);
  });
  it('locks the scope once votes exist (409), but other changes still work', () => {
    try {
      parseVotingSettings({ scope: 'track' }, DEFAULT_VOTING, 2);
      throw new Error('should throw');
    } catch (e: any) {
      expect(e.statusCode).toBe(409);
      expect(e.code).toBe('VOTING_SCOPE_LOCKED');
    }
    expect(parseVotingSettings({ scope: 'event', eligibility: 'registered' }, DEFAULT_VOTING, 2).eligibility).toBe('registered');
  });
});

describe('parseVoteTarget', () => {
  it('event scope: slug, no track', () => {
    expect(parseVoteTarget({ projectSlug: 'slice-router' }, 'event', true)).toEqual({ projectSlug: 'slice-router', trackId: null });
    expect(() => parseVoteTarget({ projectSlug: 'slice-router', trackId: T1 }, 'event', true)).toThrow(/whole event/);
  });
  it('track scope: a track id is required', () => {
    expect(parseVoteTarget({ projectSlug: 'x', trackId: T1 }, 'track', true)).toEqual({ projectSlug: 'x', trackId: T1 });
    expect(() => parseVoteTarget({ projectSlug: 'x' }, 'track', true)).toThrow(/track/);
    expect(() => parseVoteTarget({ projectSlug: 'x', trackId: 'nope' }, 'track', true)).toThrow(/track/);
  });
  it('rejects malformed slugs', () => {
    for (const s of ['', 'Bad Slug', '../x', 'a'.repeat(121), 5]) expect(() => parseVoteTarget({ projectSlug: s }, 'event', true)).toThrow(/project/);
  });
});

describe('self-vote (isOwnTeam)', () => {
  const members = [
    { userId: 'u-a', userEmail: 'alice@example.com', guestEmail: 'Alice.RSVP@Example.com' },
    { userId: 'u-b', userEmail: 'bob@example.com', guestEmail: null },
  ];
  it('matches by user id, account email or RSVP email, case-insensitively', () => {
    expect(isOwnTeam(members, { userId: 'u-a', email: 'other@x.com' })).toBe(true);
    expect(isOwnTeam(members, { userId: 'u-new', email: 'BOB@example.com' })).toBe(true);
    expect(isOwnTeam(members, { userId: 'u-new', email: 'alice.rsvp@example.com' })).toBe(true);
    expect(isOwnTeam(members, { userId: 'u-x', email: 'rando@example.com' })).toBe(false);
    expect(isOwnTeam(members, { userId: 'u-x', email: '' })).toBe(false);
    expect(isOwnTeam([{ userId: 'u-c', userEmail: null, guestEmail: null }], { userId: 'u-x', email: null })).toBe(false);
  });
});

describe('voter eligibility (decideEligibility with the voting setting)', () => {
  const h = (eligibility: string) => ({ id: 'h', publishedAt: new Date(), disabledAt: null, eligibility });
  const g = (over: Record<string, unknown> = {}) => ({ id: 'g1', approved: true, status: 'CONFIRMED', checkedInAt: null as Date | null, ...over });
  const opts = { loggedIn: true, isJudge: false, requireApproval: true };
  it('checked_in (the default) needs a check-in; registered needs an approved, confirmed RSVP', () => {
    expect(decideEligibility(h('checked_in'), [g()], opts).reason).toBe('not_checked_in');
    expect(decideEligibility(h('checked_in'), [g({ checkedInAt: new Date() })], opts).eligible).toBe(true);
    expect(decideEligibility(h('registered'), [g()], opts).eligible).toBe(true);
    expect(decideEligibility(h('registered'), [g({ approved: null })], opts).reason).toBe('pending_approval');
    expect(decideEligibility(h('registered'), [g({ approved: false })], opts).reason).toBe('declined');
    expect(decideEligibility(h('registered'), [g({ status: 'WAITLISTED' })], opts).reason).toBe('waitlisted');
    expect(decideEligibility(h('registered'), [], opts).reason).toBe('no_rsvp');
    expect(decideEligibility(h('registered'), [], { ...opts, loggedIn: false }).reason).toBe('login');
  });
  it('the default eligibility is checked_in', () => {
    expect(DEFAULT_VOTING.eligibility).toBe('checked_in');
  });
});

describe('hashVoteIp', () => {
  const HID = '22222222-2222-4222-8222-222222222222';
  const OTHER = '22222222-2222-4222-8222-999999999999';
  it('64-hex HMAC, stable per hackathon, never contains the IP', () => {
    const a = hashVoteIp(HID, '203.0.113.7', 'secret');
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).toBe(hashVoteIp(HID, '203.0.113.7', 'secret'));
    expect(a).not.toContain('203');
    expect(hashVoteIp(HID, '::ffff:203.0.113.7', 'secret')).toBe(a); // v4-mapped normalizes
  });
  it('differs across hackathons, IPs and secrets; an IPv6 /64 is one bucket', () => {
    const a = hashVoteIp(HID, '203.0.113.7', 'secret');
    expect(hashVoteIp(OTHER, '203.0.113.7', 'secret')).not.toBe(a);
    expect(hashVoteIp(HID, '203.0.113.8', 'secret')).not.toBe(a);
    expect(hashVoteIp(HID, '203.0.113.7', 'other-secret')).not.toBe(a);
    expect(hashVoteIp(HID, '2001:db8:1:2::1', 's')).toBe(hashVoteIp(HID, '2001:db8:1:2:ffff::9', 's'));
  });
});

describe('ipBuckets', () => {
  it('biggest first, 8-hex labels, unknown counted separately', () => {
    const h1 = 'a'.repeat(64), h2 = 'b'.repeat(64);
    const out = ipBuckets([{ ipHash: h1, votes: 2 }, { ipHash: null, votes: 3 }, { ipHash: h2, votes: 9 }]);
    expect(out).toEqual({ buckets: [{ label: 'bbbbbbbb', votes: 9 }, { label: 'aaaaaaaa', votes: 2 }], bucketCount: 2, unknownVotes: 3 });
    expect(JSON.stringify(out)).not.toContain(h1);
  });
});

describe('tally', () => {
  it('rankTally: competition ranks, ties flagged, zero votes unranked', () => {
    const rows = rankTally(new Map([['a', 3], ['b', 3], ['c', 1]]), ['a', 'b', 'c', 'd']);
    expect(rows).toEqual([
      { submissionId: 'a', votes: 3, rank: 1, tied: true },
      { submissionId: 'b', votes: 3, rank: 1, tied: true },
      { submissionId: 'c', votes: 1, rank: 3, tied: false },
      { submissionId: 'd', votes: 0, rank: null, tied: false },
    ]);
  });
  const subs = [{ id: 'a', trackIds: [T1] }, { id: 'b', trackIds: [T2] }, { id: 'c', trackIds: [T1, T2] }];
  it('event scope: overall + per-track views of the same event votes; unknown projects / stray track votes ignored', () => {
    const t = buildTally(
      [{ submissionId: 'a', trackId: null }, { submissionId: 'c', trackId: null }, { submissionId: 'c', trackId: null }, { submissionId: 'gone', trackId: null }, { submissionId: 'a', trackId: T1 }],
      subs, [T1, T2], 'event',
    );
    expect(t.totalVotes).toBe(3);
    expect(t.overall.map((r) => [r.submissionId, r.votes, r.rank])).toEqual([['c', 2, 1], ['a', 1, 2], ['b', 0, null]]);
    expect(t.tracks.find((x) => x.trackId === T1)!.rows.map((r) => [r.submissionId, r.votes])).toEqual([['c', 2], ['a', 1]]);
    expect(t.tracks.find((x) => x.trackId === T2)!.rows.map((r) => [r.submissionId, r.votes])).toEqual([['c', 2], ['b', 0]]);
  });
  it('track scope: votes count only in their track, only while the project is in it; overall sums', () => {
    const t = buildTally(
      [
        { submissionId: 'a', trackId: T1 }, { submissionId: 'c', trackId: T1 }, { submissionId: 'c', trackId: T2 },
        { submissionId: 'a', trackId: T2 }, // a left T2 / never in it: dropped
        { submissionId: 'b', trackId: null }, // event vote in track scope: dropped
      ],
      subs, [T1, T2], 'track',
    );
    expect(t.totalVotes).toBe(3);
    expect(t.tracks.find((x) => x.trackId === T1)!.rows.map((r) => [r.submissionId, r.votes])).toEqual([['a', 1], ['c', 1]]);
    expect(t.tracks.find((x) => x.trackId === T2)!.rows.map((r) => [r.submissionId, r.votes])).toEqual([['c', 1], ['b', 0]]);
    expect(t.overall[0]).toMatchObject({ submissionId: 'c', votes: 2, rank: 1 });
  });
});

describe("People's Choice", () => {
  const prize = (id: string, over: Record<string, unknown> = {}) => ({ id, trackId: null, name: id, rank: null, quantity: 1, kind: 'peoples_choice', sortOrder: 0, ...over });
  const tally = buildTally(
    [{ submissionId: 'a', trackId: null }, { submissionId: 'a', trackId: null }, { submissionId: 'b', trackId: null }],
    [{ id: 'a', trackIds: [T1] }, { id: 'b', trackIds: [T2] }, { id: 'c', trackIds: [T1] }],
    [T1, T2], 'event',
  );
  it('suggests the top-voted project(s); judged prizes get nothing here; unvoted projects never suggested', () => {
    const s = suggestPeoplesChoice([prize('pc'), prize('pc2', { quantity: 3, sortOrder: 1 }), prize('judged', { kind: 'judged' }), prize('t1', { trackId: T1 })] as any, tally);
    expect(s.pc).toEqual(['a']);
    expect(s.pc2).toEqual(['b']); // next slice; c has 0 votes
    expect(s.judged).toBeUndefined();
    expect(s.t1).toEqual(['a']);
  });
  it('cannot be awarded while voting is scheduled or open; judged prizes are unaffected', () => {
    for (const st of ['open', 'scheduled'] as const) {
      expect(() => assertPeoplesChoiceAwardable({ kind: 'peoples_choice' }, st)).toThrow(/Close voting/);
    }
    expect(() => assertPeoplesChoiceAwardable({ kind: 'peoples_choice' }, 'closed')).not.toThrow();
    expect(() => assertPeoplesChoiceAwardable({ kind: 'peoples_choice' }, 'off')).not.toThrow();
    expect(() => assertPeoplesChoiceAwardable({ kind: 'judged' }, 'open')).not.toThrow();
  });
});

describe('serializers', () => {
  it('public shape: status / scope / eligibility / window only, no dates when off', () => {
    expect(publicVoting(null, NOW)).toEqual({ status: 'off', scope: 'event', eligibility: 'checked_in', opensAt: null, closesAt: null });
    const p = publicVoting(v({ opensAt: at(-5), closesAt: at(5), scope: 'track' }), NOW);
    expect(p).toEqual({ status: 'open', scope: 'track', eligibility: 'checked_in', opensAt: at(-5).toISOString(), closesAt: at(5).toISOString() });
    expect(Object.keys(p).some((k) => /vote|count|tally/i.test(k))).toBe(false);
  });
  it('host shape includes the status', () => {
    expect(hostVoting(v({ opensAt: at(-5) }), NOW)).toMatchObject({ enabled: true, status: 'open', opensAt: at(-5).toISOString() });
  });
});
