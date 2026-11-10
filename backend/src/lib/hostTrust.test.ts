import { describe, it, expect } from 'vitest';
import { computeHostTrust, hostFacingTier, underbossChip, median, type HostTrustParty, type HostTrustInput } from './hostTrust.js';
import { defaultHostTrustConfig, HOST_TRUST_SETTINGS } from './hostTrustSettings.js';
import { FAST_PASS_THRESHOLDS, REVIEW_THRESHOLDS, computeTrackRecord } from './hostTrackRecord.js';
import { validateRegistry, checkSettingChange, resolveRaw, isLoosening } from './appSettings.js';

const NOW = new Date('2026-06-01T12:00:00Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);
const HOST = 'host@example.com';
const cfg = () => defaultHostTrustConfig();

function verifiedParty(id: string, ageDays = 60, extra: Partial<HostTrustParty> = {}): HostTrustParty {
  const date = daysAgo(ageDays);
  return {
    partyId: id, date, cancelledAt: null, eventTags: [], photoCount: 5, rolePhotoCount: 2, rsvpCount: 30,
    receiptCount: 2, firstReceiptAt: new Date(date.getTime() + 2 * DAY), hasDuplicateReceipts: false,
    payouts: [{ status: 'paid', reviewedBy: 'admin@example.com', paidWithProof: true }],
    checkedInCount: 0, bulkCheckin: false, reportedAttendance: null, fakeRiskHigh: false, underbossOk: true,
    reusedReceiptCount: 0, ...extra,
  };
}

function input(history: HostTrustParty[], over: Partial<HostTrustInput> = {}): HostTrustInput {
  return {
    history, accountCreatedAt: daysAgo(400), hostEmail: HOST, otherHostsSharingPayee: 0, member: 'not_checked', ...over,
  };
}

const three = () => [verifiedParty('a', 60), verifiedParty('b', 90), verifiedParty('c', 120)];

describe('defaults lock today behaviour (Q1)', () => {
  it('matches the committed Fast Pass and review constants', () => {
    const c = cfg();
    expect(c.gates.minVerifiedParties).toBe(FAST_PASS_THRESHOLDS.minVerifiedParties);
    expect(c.gates.minRsvps).toBe(FAST_PASS_THRESHOLDS.minRsvps);
    expect(c.gates.minAccountAgeDays).toBe(FAST_PASS_THRESHOLDS.minAccountAgeDays);
    expect(c.gates.receiptDeadlineDays).toBe(FAST_PASS_THRESHOLDS.receiptDeadlineDays);
    expect(c.review.newAccountDays).toBe(REVIEW_THRESHOLDS.newAccountDays);
    expect(c.review.lowRsvpCount).toBe(REVIEW_THRESHOLDS.lowRsvpCount);
    expect(c.fakeBlockParties).toBe(2);
    expect(c.reportEnabled).toBe(false);
  });

  it('agrees with today Fast Pass on a clean 3-party host and on a 1-party host', () => {
    const h3 = three();
    expect(computeHostTrust(input(h3), cfg(), NOW).tier).toBe('trusted');
    expect(computeTrackRecord(h3, daysAgo(400), NOW, HOST).tier).toBe('fast_pass');
    const h1 = [verifiedParty('a')];
    expect(computeHostTrust(input(h1), cfg(), NOW).tier).toBe('building');
    expect(computeTrackRecord(h1, daysAgo(400), NOW, HOST).tier).toBe('building');
  });
});

describe('calibration (Fast Pass parity)', () => {
  it('a minimal qualifying Fast Pass host is trusted under defaults', () => {
    // exactly 2 verified parties, account just past 45 days, no underboss/check-in/turnout data
    const two = [
      verifiedParty('a', 20, { underbossOk: false, photoCount: 1 }),
      verifiedParty('b', 30, { underbossOk: false, photoCount: 1 }),
    ];
    const acct = daysAgo(46);
    const r = computeHostTrust(input(two, { accountCreatedAt: acct }), cfg(), NOW);
    expect(computeTrackRecord(two, acct, NOW, HOST).tier).toBe('fast_pass');
    expect(r.tier).toBe('trusted');
    expect(r.score).toBeGreaterThanOrEqual(cfg().gates.trustedMinScore);
  });
});

describe('registry', () => {
  it('is internally consistent', () => {
    expect(validateRegistry(HOST_TRUST_SETTINGS)).toEqual([]);
  });
});

describe('blockers', () => {
  const base = () => three();
  it.each([
    ['scam_tag', () => input([...base(), verifiedParty('s', 30, { eventTags: ['possible-scam'] })])],
    ['reused_receipts', () => input([...base(), verifiedParty('r', 30, { reusedReceiptCount: 1 })])],
    ['shared_payee', () => input(base(), { otherHostsSharingPayee: 1 })],
    ['rejected_payout', () => input([...base(), verifiedParty('x', 30, { payouts: [{ status: 'rejected', reviewedBy: 'a@example.com', paidWithProof: false }] })])],
    ['fake_risk', () => input([...base(), verifiedParty('f1', 30, { fakeRiskHigh: true }), verifiedParty('f2', 31, { fakeRiskHigh: true })])],
    ['pizzadao_restricted', () => input(base(), { member: { matched: true, ambiguous: false, restricted: true, fraudRejected: false } })],
    ['pizzadao_fraud_rejected', () => input(base(), { member: { matched: true, ambiguous: false, restricted: false, fraudRejected: true } })],
  ])('%s gives restricted', (id, mk) => {
    const r = computeHostTrust(mk(), cfg(), NOW);
    expect(r.tier).toBe('restricted');
    expect(r.blockers).toContain(id);
  });

  it('one high fake-risk party is a penalty, not a block', () => {
    const r = computeHostTrust(input([...three(), verifiedParty('f1', 30, { fakeRiskHigh: true })]), cfg(), NOW);
    expect(r.blockers).not.toContain('fake_risk');
    expect(r.reasons.find((x) => x.signal === 'fake_risk')!.points).toBeLessThan(0);
  });
});

describe('gates', () => {
  it('a young account is not trusted even with a high score', () => {
    const r = computeHostTrust(input(three(), { accountCreatedAt: daysAgo(10) }), cfg(), NOW);
    expect(r.tier).toBe('building');
    expect(r.gates.find((g) => g.id === 'accountAge')!.met).toBe(false);
  });

  it('needs verified parties regardless of the rest of the score', () => {
    const parties = [1, 2, 3, 4].map((i) => verifiedParty(`u${i}`, 30 + i, { payouts: [] }));
    const r = computeHostTrust(input(parties), cfg(), NOW);
    expect(r.verifiedParties).toBe(0);
    expect(r.tier).toBe('building');
  });

  it('needs the score gate too', () => {
    const c = cfg();
    c.gates.trustedMinScore = 100;
    const r = computeHostTrust(input([verifiedParty('a'), verifiedParty('b')]), c, NOW);
    expect(r.gates.find((g) => g.id === 'score')!.met).toBe(false);
    expect(r.tier).toBe('building');
  });

  it('old verified parties count half', () => {
    const mk = (id: string) => verifiedParty(id, 24 * 31 + 400); // well past 24 months
    const r = computeHostTrust(input([mk('a'), mk('b'), mk('c')]), cfg(), NOW);
    expect(r.verifiedPartiesRaw).toBe(3);
    expect(r.verifiedParties).toBe(1); // floor(1.5)
    expect(r.tier).toBe('building');
  });
});

describe('score', () => {
  it('caps each signal and clamps to 0-100', () => {
    const many = Array.from({ length: 30 }, (_, i) => verifiedParty(`p${i}`, 30 + i));
    const r = computeHostTrust(input(many), cfg(), NOW);
    expect(r.reasons.find((x) => x.signal === 'verified_parties')!.points).toBe(cfg().weights.verified_parties.cap);
    expect(r.score).toBeLessThanOrEqual(100);
    expect(r.score).toBeGreaterThanOrEqual(0);
  });

  it('a host with nothing scores zero and is new', () => {
    const r = computeHostTrust(input([], { accountCreatedAt: daysAgo(3) }), cfg(), NOW);
    expect(r.score).toBe(0);
    expect(r.tier).toBe('new');
  });

  it('no photos on completed parties is a strong penalty', () => {
    const r = computeHostTrust(input([verifiedParty('a', 60, { photoCount: 0 })]), cfg(), NOW);
    expect(r.reasons.find((x) => x.signal === 'no_prior_photos')!.points).toBe(-30);
  });
});

describe('turnout', () => {
  const party = (id: string, checked: number, extra: Partial<HostTrustParty> = {}) =>
    verifiedParty(id, 60, { rsvpCount: 40, checkedInCount: checked, ...extra });

  it('is neutral with no check-ins', () => {
    const r = computeHostTrust(input([party('a', 0), party('b', 0)]), cfg(), NOW);
    expect(r.medianTurnout).toBeNull();
    expect(r.turnoutParties).toBe(0);
    expect(r.reasons.some((x) => x.signal === 'turnout' || x.signal === 'poor_turnout')).toBe(false);
  });

  it('excludes bulk check-ins', () => {
    const r = computeHostTrust(input([party('a', 40, { bulkCheckin: true }), party('b', 40, { bulkCheckin: true })]), cfg(), NOW);
    expect(r.turnoutParties).toBe(0);
  });

  it('rewards good and penalises poor median turnout, but only with enough parties', () => {
    const good = computeHostTrust(input([party('a', 30), party('b', 28)]), cfg(), NOW);
    expect(good.reasons.some((x) => x.signal === 'turnout' && x.points > 0)).toBe(true);
    const poor = computeHostTrust(input([party('a', 2), party('b', 3)]), cfg(), NOW);
    expect(poor.reasons.some((x) => x.signal === 'poor_turnout' && x.points < 0)).toBe(true);
    const one = computeHostTrust(input([party('a', 30)]), cfg(), NOW);
    expect(one.medianTurnout).toBeNull();
  });

  it('median helper', () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });
});

describe('reported attendance can only subtract', () => {
  it('implausible reports lower the score; honest ones add nothing', () => {
    const honest = computeHostTrust(input([verifiedParty('a', 60, { reportedAttendance: 30 })]), cfg(), NOW);
    const inflated = computeHostTrust(input([verifiedParty('a', 60, { reportedAttendance: 500, photoCount: 1 })]), cfg(), NOW);
    expect(inflated.score).toBeLessThan(honest.score);
    expect(honest.reasons.some((x) => x.signal === 'reported_attendance')).toBe(false);
  });
});

describe('PizzaDAO check (Q5)', () => {
  it('unavailable removes trusted for a thin record (exactly the minimum)', () => {
    const two = [verifiedParty('a'), verifiedParty('b')];
    const r = computeHostTrust(input(two, { member: null }), cfg(), NOW);
    expect(r.pizzadao).toBe('unavailable');
    expect(r.tier).toBe('building');
    expect(r.blockers).toEqual([]);
  });

  it('unavailable does not remove trusted for a deeper record', () => {
    const r = computeHostTrust(input(three(), { member: null }), cfg(), NOW);
    expect(r.tier).toBe('trusted');
  });

  it('unknown restricted (disavow off) never blocks', () => {
    const r = computeHostTrust(input(three(), { member: { matched: true, ambiguous: false, restricted: null, fraudRejected: false } }), cfg(), NOW);
    expect(r.tier).toBe('trusted');
  });

  it('ambiguous matches keep blockers', () => {
    const r = computeHostTrust(input(three(), { member: { matched: true, ambiguous: true, restricted: true, fraudRejected: false } }), cfg(), NOW);
    expect(r.pizzadao).toBe('ambiguous');
    expect(r.tier).toBe('restricted');
  });

  it('a clean PizzaDAO match cannot lift a host without verified parties', () => {
    const r = computeHostTrust(input([], { member: { matched: true, ambiguous: false, restricted: false, fraudRejected: false } }), cfg(), NOW);
    expect(r.tier).not.toBe('trusted');
  });
});

describe('overrides', () => {
  const live = { expiresAt: new Date(NOW.getTime() + DAY), revokedAt: null };
  it('a trusted override lifts a building host', () => {
    const r = computeHostTrust(input([verifiedParty('a')], { overrides: [{ tier: 'trusted', ...live }] }), cfg(), NOW);
    expect(r.tier).toBe('trusted');
    expect(r.overrideApplied).toBe('trusted');
  });
  it('a trusted override is suspended by a blocker', () => {
    const r = computeHostTrust(input(three(), { otherHostsSharingPayee: 1, overrides: [{ tier: 'trusted', ...live }] }), cfg(), NOW);
    expect(r.tier).toBe('restricted');
    expect(r.overrideSuspended).toBe(true);
  });
  it('a restricted override always applies, and wins over trusted', () => {
    const r = computeHostTrust(input(three(), { overrides: [{ tier: 'trusted', ...live }, { tier: 'restricted', ...live }] }), cfg(), NOW);
    expect(r.tier).toBe('restricted');
    expect(r.overrideApplied).toBe('restricted');
  });
  it('expired or revoked overrides are ignored', () => {
    const r = computeHostTrust(input([verifiedParty('a')], {
      overrides: [{ tier: 'trusted', expiresAt: daysAgo(1), revokedAt: null }, { tier: 'trusted', expiresAt: null, revokedAt: daysAgo(1) }],
    }), cfg(), NOW);
    expect(r.tier).toBe('building');
  });
});

describe('audience views (Q3)', () => {
  it('hosts see restricted as building; underbosses see "needs admin review"', () => {
    expect(hostFacingTier('restricted')).toBe('building');
    expect(hostFacingTier('trusted')).toBe('trusted');
    expect(underbossChip('restricted')).toBe('needs_admin_review');
    expect(underbossChip('new')).toBe('new');
  });
});

describe('stricter-only settings', () => {
  const def = (k: string) => HOST_TRUST_SETTINGS.find((d) => d.key === `host_trust.${k}`)!;

  it('cannot go looser than the shipped default', () => {
    const d = def('min_verified_parties');
    expect(checkSettingChange(d, 3, 1, 'because').ok).toBe(false);
    const d2 = def('w.verified_parties.points');
    expect(checkSettingChange(d2, 10, d2.default + 1, 'x').ok).toBe(false);
  });

  it('tightening needs no note; loosening back toward the default needs one', () => {
    const d = def('min_verified_parties');
    expect(checkSettingChange(d, 2, 4)).toEqual({ ok: true, loosening: false });
    expect(checkSettingChange(d, 4, 3)).toMatchObject({ ok: false, code: 'NOTE_REQUIRED' });
    expect(checkSettingChange(d, 4, 3, 'ok')).toEqual({ ok: true, loosening: true });
  });

  it('rejects non-integers and out of range', () => {
    const d = def('min_verified_parties');
    expect(checkSettingChange(d, 2, 2.5)).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    expect(checkSettingChange(d, 2, 999)).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    expect(checkSettingChange(d, 2, '3' as unknown)).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
  });

  it('new_max_score: raising it is stricter, lowering needs a note, failure value is strict', () => {
    const d = def('new_max_score');
    expect(d.looserWhen).toBe('lower');
    expect(checkSettingChange(d, 20, 30)).toEqual({ ok: true, loosening: false });
    expect(checkSettingChange(d, 30, 25)).toMatchObject({ ok: false, code: 'NOTE_REQUIRED' });
    expect(checkSettingChange(d, 20, 10, 'x')).toMatchObject({ ok: false, code: 'OUT_OF_RANGE' });
    expect(d.failure).toBeGreaterThan(d.default);
  });

  it('the report switch is free to flip', () => {
    const d = def('report_enabled');
    expect(checkSettingChange(d, 0, 1)).toEqual({ ok: true, loosening: false });
    expect(isLoosening(d, 0, 1)).toBe(false);
  });

  it('missing row = default, bad row = strict failure value', () => {
    const d = def('min_verified_parties');
    expect(resolveRaw(d, undefined)).toEqual({ value: 2, source: 'default' });
    expect(resolveRaw(d, '5')).toEqual({ value: 5, source: 'stored' });
    expect(resolveRaw(d, '"x"')).toEqual({ value: d.failure, source: 'failure' });
    expect(resolveRaw(d, '1')).toEqual({ value: d.failure, source: 'failure' }); // below the bound
    expect(resolveRaw(d, '{bad')).toEqual({ value: d.failure, source: 'failure' });
    expect(d.failure).toBeGreaterThan(d.default);
  });
});
