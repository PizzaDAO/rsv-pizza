import { describe, it, expect } from 'vitest';
import {
  computeTrackRecord,
  computeReviewAssist,
  toHostView,
  type HostPartyHistory,
} from './hostTrackRecord.js';

const NOW = new Date('2026-10-29T00:00:00Z');
const d = (s: string) => new Date(s);

function party(over: Partial<HostPartyHistory> & { id: string }): HostPartyHistory {
  const { id, ...rest } = over;
  return {
    partyId: id,
    date: d('2026-05-22T18:00:00Z'),
    cancelledAt: null,
    eventTags: [],
    photoCount: 6,
    rsvpCount: 30,
    payouts: [
      {
        status: 'paid',
        createdAt: d('2026-05-25T00:00:00Z'),
        firstReceiptAt: d('2026-05-24T00:00:00Z'),
        receiptCount: 2,
        duplicateReceiptCount: 0,
      },
    ],
    ...rest,
  };
}

const OLD = d('2026-01-01T00:00:00Z');

describe('computeTrackRecord', () => {
  it('grants fast pass at 2 clean parties with receipts + photos', () => {
    const t = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' })], OLD, NOW);
    expect(t.tier).toBe('fast_pass');
    expect(t.eligibleForFastPass).toBe(true);
    expect(t.partiesHosted).toBe(2);
    expect(t.paidWithoutIssues).toBe(2);
  });

  it('is "building" with only one good party', () => {
    const t = computeTrackRecord([party({ id: 'a' })], OLD, NOW);
    expect(t.tier).toBe('building');
    expect(t.missing).toContain('onTimeReceipts');
    expect(t.missing).toContain('photos');
  });

  it('is "new" with no completed parties; future parties do not count', () => {
    const t = computeTrackRecord([party({ id: 'a', date: d('2026-12-01T00:00:00Z') })], OLD, NOW);
    expect(t.tier).toBe('new');
    expect(t.partiesHosted).toBe(0);
  });

  it('does not count late receipts as on time', () => {
    const late = party({
      id: 'a',
      payouts: [
        { status: 'paid', createdAt: d('2026-07-01T00:00:00Z'), firstReceiptAt: d('2026-07-01T00:00:00Z'), receiptCount: 1, duplicateReceiptCount: 0 },
      ],
    });
    const t = computeTrackRecord([late, party({ id: 'b' })], OLD, NOW);
    expect(t.partiesWithReceipts).toBe(2);
    expect(t.partiesWithOnTimeReceipts).toBe(1);
    expect(t.eligibleForFastPass).toBe(false);
  });

  it('a scam tag, rejection or duplicate receipt flags the host and blocks fast pass', () => {
    const base = [party({ id: 'a' }), party({ id: 'b' })];
    expect(computeTrackRecord([...base, party({ id: 'c', eventTags: ['possible-scam'] })], OLD, NOW).tier).toBe('flagged');
    const rejected = party({
      id: 'c',
      payouts: [{ status: 'rejected', createdAt: NOW, firstReceiptAt: null, receiptCount: 0, duplicateReceiptCount: 0 }],
    });
    expect(computeTrackRecord([...base, rejected], OLD, NOW).eligibleForFastPass).toBe(false);
    const dup = party({
      id: 'c',
      payouts: [{ status: 'paid', createdAt: NOW, firstReceiptAt: NOW, receiptCount: 2, duplicateReceiptCount: 1 }],
    });
    expect(computeTrackRecord([...base, dup], OLD, NOW).issues).toBe(1);
  });

  it('requires a minimum account age', () => {
    const t = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' })], d('2026-10-20T00:00:00Z'), NOW);
    expect(t.missing).toEqual(['accountAge']);
  });

  it('ignores cancelled parties', () => {
    const t = computeTrackRecord([party({ id: 'a', cancelledAt: d('2026-05-01T00:00:00Z') })], OLD, NOW);
    expect(t.partiesHosted).toBe(0);
  });

  it('host view never includes issue details', () => {
    const t = computeTrackRecord([party({ id: 'a', eventTags: ['possible-scam'] })], OLD, NOW);
    expect(t.issueDetails.length).toBe(1);
    expect(toHostView(t)).not.toHaveProperty('issueDetails');
  });
});

describe('computeReviewAssist', () => {
  const clean = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' })], OLD, NOW);
  const base = {
    track: clean,
    accountCreatedAt: OLD,
    rsvpCount: 40,
    otherHostsSharingPayee: 0,
    reusedReceiptCount: 0,
    receiptCount: 3,
    now: NOW,
  };

  it('is low risk for a clean host', () => {
    const r = computeReviewAssist(base);
    expect(r.flags).toEqual([]);
    expect(r.riskLevel).toBe('low');
  });

  it('flags the classic scam shape as high risk', () => {
    const newTrack = computeTrackRecord([], d('2026-10-20T00:00:00Z'), NOW);
    const r = computeReviewAssist({
      ...base,
      track: newTrack,
      accountCreatedAt: d('2026-10-20T00:00:00Z'),
      rsvpCount: 0,
      otherHostsSharingPayee: 2,
      reusedReceiptCount: 1,
    });
    const ids = r.flags.map((f) => f.id);
    expect(ids).toEqual(
      expect.arrayContaining(['new_account', 'first_party', 'no_rsvps', 'shared_payee', 'reused_receipts']),
    );
    expect(r.riskLevel).toBe('high');
  });

  it('flags prior parties without photos, over-cap and missing receipts', () => {
    const noPhotos = computeTrackRecord([party({ id: 'a', photoCount: 0 })], OLD, NOW);
    const r = computeReviewAssist({ ...base, track: noPhotos, receiptCount: 0, requestedUsd: 500, capUsd: 300 });
    const ids = r.flags.map((f) => f.id);
    expect(ids).toEqual(expect.arrayContaining(['no_prior_photos', 'no_receipts', 'over_cap']));
    expect(r.checklist.find((c) => c.id === 'priorPhotos')?.auto).toBe(false);
    expect(r.checklist.find((c) => c.id === 'venueExists')?.auto).toBeNull();
  });
});
