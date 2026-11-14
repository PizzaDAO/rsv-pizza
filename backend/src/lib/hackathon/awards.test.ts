/**
 * Hackathon PR 5 pure helpers: award rules (quantity, track scope, status), payout state
 * machine, delete guard, reveal rules, leaderboard suggestions, and serializer privacy
 * (public winners / team awards / team feedback), plus CSV escaping of award rows.
 */
import { describe, it, expect } from 'vitest';
import {
  AWARDS_CSV_HEADER,
  assertAwardable,
  assertCanReveal,
  assertCanUnreveal,
  assertKeepsAwardedTracks,
  awardsCsvRows,
  hasRecordedPayout,
  hostAward,
  parseAwardCreate,
  parsePayout,
  payoutData,
  pickPlace,
  publicWinners,
  suggestWinners,
  teamAwards,
  teamFeedback,
  type PrizeLike,
} from './awards.js';
import { toCsv } from './csv.js';
import type { LbRow } from './scoring.js';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';
const T1 = 't1';

const prize = (over: Partial<PrizeLike> = {}): PrizeLike => ({ id: 'p1', trackId: null, name: 'Grand prize', rank: 1, quantity: 1, kind: 'judged', sortOrder: 0, ...over });
const sub = (over: Record<string, any> = {}) => ({ id: 's1', status: 'submitted', trackIds: [T1], ...over });
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (e: any) {
    return `${e.statusCode}:${e.code}`;
  }
  return 'ok';
};

describe('parseAwardCreate', () => {
  it('needs a prize and a project uuid; place optional', () => {
    expect(parseAwardCreate({ prizeId: U1, submissionId: U2 })).toEqual({ prizeId: U1, submissionId: U2 });
    expect(parseAwardCreate({ prizeId: U1, submissionId: U2, place: '2' })).toEqual({ prizeId: U1, submissionId: U2, place: 2 });
    expect(code(() => parseAwardCreate({ prizeId: 'x', submissionId: U2 }))).toBe('400:VALIDATION_ERROR');
    expect(code(() => parseAwardCreate({ prizeId: U1 }))).toBe('400:VALIDATION_ERROR');
    expect(code(() => parseAwardCreate({ prizeId: U1, submissionId: U2, place: 0 }))).toBe('400:VALIDATION_ERROR');
  });
});

describe('assertAwardable', () => {
  it('only submitted projects', () => {
    expect(code(() => assertAwardable(prize(), sub(), []))).toBe('ok');
    for (const status of ['draft', 'withdrawn', 'disqualified']) {
      expect(code(() => assertAwardable(prize(), sub({ status }), []))).toBe('409:NOT_AWARDABLE');
    }
  });
  it('a track prize only goes to a project in that track; overall prizes to any', () => {
    expect(code(() => assertAwardable(prize({ trackId: 'other' }), sub(), []))).toBe('409:WRONG_TRACK');
    expect(code(() => assertAwardable(prize({ trackId: T1 }), sub(), []))).toBe('ok');
    expect(code(() => assertAwardable(prize(), sub({ trackIds: [] }), []))).toBe('ok');
  });
  it('respects quantity and one award per (prize, project)', () => {
    expect(code(() => assertAwardable(prize(), sub(), ['s9']))).toBe('409:PRIZE_FULL');
    expect(code(() => assertAwardable(prize({ quantity: 3 }), sub(), ['s8', 's9']))).toBe('ok');
    expect(code(() => assertAwardable(prize({ quantity: 3 }), sub(), ['s7', 's8', 's9']))).toBe('409:PRIZE_FULL');
    expect(code(() => assertAwardable(prize({ quantity: 3 }), sub(), ['s1']))).toBe('409:ALREADY_AWARDED');
  });
  it("People's Choice can be awarded by hand (voting comes in PR 7)", () => {
    expect(code(() => assertAwardable(prize({ kind: 'peoples_choice' }), sub(), []))).toBe('ok');
  });
});

describe('assertKeepsAwardedTracks', () => {
  it('every awarded track must stay; other tracks can change; overall prizes (null) pin nothing', () => {
    expect(code(() => assertKeepsAwardedTracks(['t1'], ['t1', 't2']))).toBe('ok');
    expect(code(() => assertKeepsAwardedTracks(['t1'], ['t2']))).toBe('409:HAS_AWARDS');
    expect(code(() => assertKeepsAwardedTracks(['t1', 't2'], ['t1']))).toBe('409:HAS_AWARDS');
    expect(code(() => assertKeepsAwardedTracks([null, undefined], []))).toBe('ok');
    expect(code(() => assertKeepsAwardedTracks([], []))).toBe('ok');
  });
});

describe('pickPlace', () => {
  it('lowest free place, or the requested one if free and in range', () => {
    expect(pickPlace({ quantity: 3 }, [])).toBe(1);
    expect(pickPlace({ quantity: 3 }, [1, 3])).toBe(2);
    expect(pickPlace({ quantity: 3 }, [1], 3)).toBe(3);
    expect(code(() => pickPlace({ quantity: 3 }, [3], 3))).toBe('409:PLACE_TAKEN');
    expect(code(() => pickPlace({ quantity: 1 }, [], 2))).toBe('400:VALIDATION_ERROR');
  });
});

describe('payout', () => {
  const now = new Date('2027-03-07T12:00:00Z');
  const unpaid = { payoutStatus: 'unpaid', paidAt: null };

  it('parsePayout validates status, recipient, lengths', () => {
    expect(parsePayout({ status: 'paid' })).toEqual({ status: 'paid' });
    expect(code(() => parsePayout({ status: 'sent' }))).toBe('400:VALIDATION_ERROR');
    expect(code(() => parsePayout({}))).toBe('400:VALIDATION_ERROR');
    expect(code(() => parsePayout({ recipientMemberId: 'nope' }))).toBe('400:VALIDATION_ERROR');
    expect(parsePayout({ recipientMemberId: null })).toEqual({ recipientMemberId: null });
    expect(parsePayout({ recipientWallet: '  0xabc  ' })).toEqual({ recipientWallet: '0xabc' });
    expect(code(() => parsePayout({ recipientWallet: 'x'.repeat(201) }))).toBe('400:VALIDATION_ERROR');
    expect(code(() => parsePayout({ payoutReference: 'x'.repeat(501) }))).toBe('400:VALIDATION_ERROR');
    expect(code(() => parsePayout({ payoutNotes: 'x'.repeat(2001) }))).toBe('400:VALIDATION_ERROR');
    expect(code(() => parsePayout({ payoutNotes: 'a\u0000b' }))).toBe('400:VALIDATION_ERROR');
  });

  it('-> paid stamps paid_at (given, kept, or now); not in the future', () => {
    expect(payoutData({ status: 'paid' }, unpaid, now)).toEqual({ payoutStatus: 'paid', paidAt: now });
    const given = new Date('2027-03-06T00:00:00Z');
    expect(payoutData({ status: 'paid', paidAt: given }, unpaid, now).paidAt).toEqual(given);
    // Editing the reference on a paid award keeps its paid date.
    expect(payoutData({ payoutReference: '0xdead' }, { payoutStatus: 'paid', paidAt: given }, now)).toEqual({ paidAt: given, payoutReference: '0xdead' });
    expect(code(() => payoutData({ status: 'paid', paidAt: new Date('2027-03-20T00:00:00Z') }, unpaid, now))).toBe('400:VALIDATION_ERROR');
  });

  it('any other status clears paid_at; a paid date without paid is a 400', () => {
    for (const status of ['unpaid', 'pending', 'not_applicable'] as const) {
      expect(payoutData({ status }, { payoutStatus: 'paid', paidAt: now }, now)).toEqual({ payoutStatus: status, paidAt: null });
    }
    expect(code(() => payoutData({ status: 'pending', paidAt: now }, unpaid, now))).toBe('400:VALIDATION_ERROR');
  });

  it('every transition between the four statuses is allowed', () => {
    const all = ['unpaid', 'pending', 'paid', 'not_applicable'] as const;
    for (const from of all) for (const to of all) {
      expect(payoutData({ status: to }, { payoutStatus: from, paidAt: from === 'paid' ? now : null }, now).payoutStatus).toBe(to);
    }
  });

  it('a recorded payout (pending / paid / paid date / reference) blocks delete', () => {
    expect(hasRecordedPayout({ payoutStatus: 'unpaid' })).toBe(false);
    expect(hasRecordedPayout({ payoutStatus: 'not_applicable' })).toBe(false);
    expect(hasRecordedPayout({ payoutStatus: 'pending' })).toBe(true);
    expect(hasRecordedPayout({ payoutStatus: 'paid' })).toBe(true);
    expect(hasRecordedPayout({ payoutStatus: 'unpaid', payoutReference: '0x1' })).toBe(true);
    expect(hasRecordedPayout({ payoutStatus: 'unpaid', paidAt: now })).toBe(true);
  });
});

describe('reveal rules', () => {
  it('reveal needs judging closed and >= 1 award', () => {
    expect(code(() => assertCanReveal({ judgingStatus: 'open', resultsRevealedAt: null }, 2))).toBe('409:JUDGING_NOT_CLOSED');
    expect(code(() => assertCanReveal({ judgingStatus: 'not_started', resultsRevealedAt: null }, 2))).toBe('409:JUDGING_NOT_CLOSED');
    expect(code(() => assertCanReveal({ judgingStatus: 'closed', resultsRevealedAt: null }, 0))).toBe('409:NO_AWARDS');
    expect(code(() => assertCanReveal({ judgingStatus: 'closed', resultsRevealedAt: null }, 1))).toBe('ok');
  });
  it('un-reveal only while nothing is paid', () => {
    expect(code(() => assertCanUnreveal(0))).toBe('ok');
    expect(code(() => assertCanUnreveal(1))).toBe('409:PAYOUT_RECORDED');
  });
});

describe('suggestWinners', () => {
  const row = (submissionId: string, rank: number | null): LbRow => ({ submissionId, rank, tied: false, average: rank === null ? null : 100 - rank, scoreCount: rank === null ? 0 : 1, min: null, max: null, criterionAverages: {} });
  const board = {
    overall: [row('a', 1), row('b', 2), row('c', 3), row('d', null)],
    tracks: [{ trackId: T1, rows: [row('b', 1), row('c', 2)] }],
  };
  it('per scope, prizes by rank take the next `quantity` ranked projects', () => {
    const s = suggestWinners([
      prize({ id: 'second', rank: 2, sortOrder: 0 }),
      prize({ id: 'first', rank: 1, sortOrder: 1 }),
      prize({ id: 'hm', rank: 3, quantity: 3, sortOrder: 2 }),
      prize({ id: 'track', trackId: T1 }),
      prize({ id: 'pc', kind: 'peoples_choice' }),
    ], board);
    expect(s.first).toEqual(['a']);
    expect(s.second).toEqual(['b']);
    expect(s.hm).toEqual(['c']); // unscored d is never suggested
    expect(s.track).toEqual(['b']); // a project can win a track prize AND an overall one
    expect(s.pc).toBeUndefined();
  });
  it('no leaderboard rows for a track: empty suggestion', () => {
    expect(suggestWinners([prize({ id: 'x', trackId: 'nope' })], board).x).toEqual([]);
  });
});

// ---------------------------------------------------------------- serializers

const award = (over: Record<string, any> = {}) => ({
  id: 'a1', hackathonId: 'h', prizeId: 'p1', submissionId: 's1', place: 1, awardedAt: new Date('2027-03-07T00:00:00Z'), awardedBy: 'u-host',
  payoutStatus: 'paid', recipientUserId: 'u-alice', recipientWallet: '0xALICE', payoutReference: '0xTX', paidAt: new Date('2027-03-08T00:00:00Z'),
  payoutNotes: 'sent via multisig', updatedAt: new Date(),
  prize: { id: 'p1', name: 'Grand prize', trackId: T1, amountText: '$5,000', amountValue: null, currency: null, rank: 1, kind: 'judged', sortOrder: 0 },
  submission: { id: 's1', name: 'Slice Router', slug: 'slice-router', tagline: 'Split bills', status: 'submitted', team: { id: 'team1', name: 'Crust Coders' } },
  recipient: { id: 'u-alice', name: 'Alice', email: 'alice@secret.example' },
  ...over,
});

describe('publicWinners', () => {
  it('allowlisted fields only; never recipient, wallet, payout, notes, emails or ids', () => {
    const [w] = publicWinners([award()], [{ id: T1, name: 'DeFi' }]);
    expect(Object.keys(w).sort()).toEqual(['place', 'prizeAmount', 'prizeId', 'prizeKind', 'prizeName', 'projectName', 'projectSlug', 'projectTagline', 'teamName', 'trackId', 'trackName']);
    expect(w).toMatchObject({ prizeName: 'Grand prize', prizeAmount: '$5,000', trackName: 'DeFi', projectName: 'Slice Router', teamName: 'Crust Coders', place: 1 });
    const json = JSON.stringify(publicWinners([award()], []));
    for (const secret of ['0xALICE', '0xTX', 'multisig', 'alice@secret', 'u-alice', 'u-host', 'paid']) expect(json).not.toContain(secret);
  });
  it('drops awards whose project is no longer submitted; sorted by prize then place', () => {
    const list = publicWinners([
      award({ id: 'x', place: 2, submission: { ...award().submission, name: 'Second' } }),
      award({ id: 'y', place: 1 }),
      award({ id: 'z', submission: { ...award().submission, status: 'disqualified', name: 'DQ' } }),
    ], []);
    expect(list.map((w) => w.projectName)).toEqual(['Slice Router', 'Second']);
  });
});

describe('teamAwards / teamFeedback', () => {
  it('payout details only for the recipient; notes never', () => {
    const [mine] = teamAwards([award()], 'u-alice');
    expect(mine).toMatchObject({ isRecipient: true, recipientWallet: '0xALICE', payoutReference: '0xTX', payoutStatus: 'paid' });
    const [theirs] = teamAwards([award()], 'u-bob');
    expect(theirs).toMatchObject({ isRecipient: false, recipientWallet: null, payoutReference: null, paidAt: null, payoutStatus: 'paid', recipientName: 'Alice' });
    expect(JSON.stringify([mine, theirs])).not.toContain('multisig');
    expect(JSON.stringify([mine, theirs])).not.toContain('alice@secret');
    expect(teamAwards([award()], undefined)[0].isRecipient).toBe(false);
  });
  it('feedback is text only, blanks dropped', () => {
    expect(teamFeedback([{ teamFeedback: ' Great demo ' }, { teamFeedback: '' }, { teamFeedback: null }, {}])).toEqual(['Great demo']);
  });
});

describe('host award + CSV', () => {
  it('host shape carries payout fields and the recipient', () => {
    const h = hostAward({ ...award(), recipientMemberId: 'm1' });
    expect(h).toMatchObject({ payoutStatus: 'paid', recipientWallet: '0xALICE', payoutReference: '0xTX', payoutNotes: 'sent via multisig', recipient: { name: 'Alice', email: 'alice@secret.example' }, recipientMemberId: 'm1', teamName: 'Crust Coders' });
    expect(Object.keys(h)).not.toContain('recipientUserId');
  });
  it('CSV rows escape formula leads and quotes in participant / host text', () => {
    const a = hostAward(award({
      recipientWallet: '=HYPERLINK("http://evil")',
      payoutNotes: '+1 "quoted", with comma',
      submission: { ...award().submission, name: '@SUM(A1)', team: { id: 't', name: '-Team' } },
    }));
    const csv = toCsv(AWARDS_CSV_HEADER, awardsCsvRows([a], [award().prize], [{ id: T1, name: 'DeFi' }]));
    const line = csv.split('\r\n')[1];
    expect(line).toContain(`'@SUM(A1)`);
    expect(line).toContain(`'-Team`);
    expect(line).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(line).toContain(`"'+1 ""quoted"", with comma"`);
    expect(line.startsWith('Grand prize,DeFi,"$5,000",1,')).toBe(true);
    expect(line).toContain(',Paid,');
  });
});
