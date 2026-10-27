import { describe, it, expect } from 'vitest';
import {
  computeTrackRecord,
  computeReviewAssist,
  toHostView,
  type HostPartyHistory,
} from './hostTrackRecord.js';

const NOW = new Date('2026-10-29T00:00:00Z');
const d = (s: string) => new Date(s);
const OLD = d('2026-01-01T00:00:00Z');

function party(over: Partial<HostPartyHistory> & { id: string }): HostPartyHistory {
  const { id, ...rest } = over;
  return {
    partyId: id,
    date: d('2026-05-22T18:00:00Z'),
    cancelledAt: null,
    eventTags: [],
    photoCount: 3,
    rsvpCount: 30,
    receiptCount: 2,
    firstReceiptAt: d('2026-05-24T00:00:00Z'),
    hasDuplicateReceipts: false,
    payouts: [{ status: 'paid', adminReviewed: true }],
    ...rest,
  };
}

describe('computeTrackRecord', () => {
  it('grants fast pass at 2 verified parties', () => {
    const t = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' })], OLD, NOW);
    expect(t.tier).toBe('fast_pass');
    expect(t.verifiedParties).toBe(2);
  });

  it('pending or unreviewed payouts do not qualify', () => {
    const pending = party({ id: 'a', payouts: [{ status: 'pending', adminReviewed: false }] });
    const unreviewed = party({ id: 'b', payouts: [{ status: 'paid', adminReviewed: false }] });
    const t = computeTrackRecord([pending, unreviewed, party({ id: 'c' })], OLD, NOW);
    expect(t.verifiedParties).toBe(1);
    expect(t.eligibleForFastPass).toBe(false);
  });

  it('needs photos, minimum RSVPs and non-duplicate on-time receipts', () => {
    const base = [party({ id: 'a' })];
    for (const bad of [
      party({ id: 'b', photoCount: 0 }),
      party({ id: 'b', rsvpCount: 9 }),
      party({ id: 'b', receiptCount: 0 }),
      party({ id: 'b', firstReceiptAt: d('2026-07-01T00:00:00Z') }),
    ]) {
      expect(computeTrackRecord([...base, bad], OLD, NOW).verifiedParties).toBe(1);
    }
  });

  it('future and cancelled parties do not count', () => {
    const t = computeTrackRecord(
      [party({ id: 'a', date: d('2026-12-01T00:00:00Z') }), party({ id: 'b', cancelledAt: NOW })],
      OLD,
      NOW,
    );
    expect(t.tier).toBe('new');
    expect(t.partiesHosted).toBe(0);
  });

  it('scam tag or rejection flags the host and blocks fast pass', () => {
    const base = [party({ id: 'a' }), party({ id: 'b' })];
    expect(computeTrackRecord([...base, party({ id: 'c', eventTags: ['possible-scam'] })], OLD, NOW).tier).toBe('flagged');
    const rejected = party({ id: 'c', payouts: [{ status: 'rejected', adminReviewed: true }] });
    expect(computeTrackRecord([...base, rejected], OLD, NOW).eligibleForFastPass).toBe(false);
  });

  it('duplicate receipts are counted once per party and never flag the host', () => {
    const dup = party({ id: 'c', hasDuplicateReceipts: true });
    const t = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' }), dup], OLD, NOW);
    expect(t.partiesWithDuplicateReceipts).toBe(1);
    expect(t.issues).toBe(0);
    expect(t.tier).toBe('fast_pass');
  });

  it('requires a minimum account age', () => {
    const t = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' })], d('2026-10-20T00:00:00Z'), NOW);
    expect(t.missing).toEqual(['accountAge']);
  });

  it('host view hides flags: flagged maps to building, no issue counts', () => {
    const t = computeTrackRecord([party({ id: 'a', eventTags: ['possible-scam'] })], OLD, NOW);
    const v = toHostView(t);
    expect(t.tier).toBe('flagged');
    expect(v.tier).toBe('building');
    expect(v.missing).not.toContain('issues');
    for (const k of ['issues', 'issueDetails', 'paidWithoutIssues', 'partiesWithDuplicateReceipts']) {
      expect(v).not.toHaveProperty(k);
    }
  });
});

describe('computeReviewAssist', () => {
  const clean = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' })], OLD, NOW);
  const base = {
    track: clean,
    accountCreatedAt: OLD,
    partyDate: d('2026-11-20T00:00:00Z'),
    rsvpCount: 40,
    otherHostsSharingPayee: 0,
    reusedReceiptCount: 0,
    receiptCount: 3,
    now: NOW,
  };

  it('is low risk for a clean host', () => {
    expect(computeReviewAssist(base).riskLevel).toBe('low');
  });

  it('flags the classic scam shape as high risk', () => {
    const newTrack = computeTrackRecord([], d('2026-10-20T00:00:00Z'), NOW);
    const r = computeReviewAssist({
      ...base,
      track: newTrack,
      accountCreatedAt: d('2026-10-20T00:00:00Z'),
      partyDate: d('2026-10-01T00:00:00Z'),
      rsvpCount: 0,
      otherHostsSharingPayee: 2,
      reusedReceiptCount: 1,
    });
    expect(r.flags.map((f) => f.id)).toEqual(
      expect.arrayContaining(['new_account', 'first_party', 'no_rsvps', 'shared_payee', 'reused_receipts']),
    );
    expect(r.riskLevel).toBe('high');
  });

  it('no RSVPs on a future party is medium, so pre-approval ahead of the event works', () => {
    const r = computeReviewAssist({ ...base, rsvpCount: 0, receiptCount: 0 });
    expect(r.flags.find((f) => f.id === 'no_rsvps')?.severity).toBe('medium');
    expect(r.riskLevel).toBe('medium');
  });

  it('duplicate receipts history is at most medium', () => {
    const t = computeTrackRecord([party({ id: 'a', hasDuplicateReceipts: true })], OLD, NOW);
    const r = computeReviewAssist({ ...base, track: t });
    expect(r.flags.find((f) => f.id === 'duplicate_receipts')?.severity).toBe('medium');
    expect(r.riskLevel).not.toBe('high');
  });

  it('flags prior parties without photos and over-cap', () => {
    const t = computeTrackRecord([party({ id: 'a', photoCount: 0 })], OLD, NOW);
    const r = computeReviewAssist({ ...base, track: t, requestedUsd: 500, capUsd: 300 });
    expect(r.flags.map((f) => f.id)).toEqual(expect.arrayContaining(['no_prior_photos', 'over_cap']));
    expect(r.checklist.find((c) => c.id === 'venueExists')?.auto).toBeNull();
  });
});
