import { describe, it, expect } from 'vitest';
import {
  countRealRsvps,
  decideApproval,
  computeTrackRecord,
  computeReviewAssist,
  toHostView,
  type HostPartyHistory,
} from './hostTrackRecord.js';

const NOW = new Date('2026-10-29T00:00:00Z');
const d = (s: string) => new Date(s);
const OLD = d('2026-01-01T00:00:00Z');
const PAID_OK = { status: 'paid', reviewedBy: 'ops@pizzadao.xyz', paidWithProof: true };

function party(over: Partial<HostPartyHistory> & { id: string }): HostPartyHistory {
  const { id, ...rest } = over;
  return {
    partyId: id,
    date: d('2026-05-22T18:00:00Z'),
    cancelledAt: null,
    eventTags: [],
    photoCount: 3,
    rolePhotoCount: 3,
    rsvpCount: 30,
    receiptCount: 2,
    firstReceiptAt: d('2026-05-24T00:00:00Z'),
    hasDuplicateReceipts: false,
    payouts: [PAID_OK],
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
    const pending = party({ id: 'a', payouts: [{ status: 'pending', reviewedBy: null, paidWithProof: false }] });
    const unreviewed = party({ id: 'b', payouts: [{ status: 'paid', reviewedBy: null, paidWithProof: true }] });
    const t = computeTrackRecord([pending, unreviewed, party({ id: 'c' })], OLD, NOW);
    expect(t.verifiedParties).toBe(1);
    expect(t.eligibleForFastPass).toBe(false);
  });

  it('needs photos, minimum RSVPs and non-duplicate on-time receipts', () => {
    const base = [party({ id: 'a' })];
    for (const bad of [
      party({ id: 'b', rolePhotoCount: 0 }),
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
    const rejected = party({ id: 'c', payouts: [{ status: 'rejected', reviewedBy: 'ops@pizzadao.xyz', paidWithProof: false }] });
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
    const t = computeTrackRecord([party({ id: 'a', photoCount: 0, rolePhotoCount: 0 })], OLD, NOW);
    const r = computeReviewAssist({ ...base, track: t, requestedUsd: 500, capUsd: 300 });
    expect(r.flags.map((f) => f.id)).toEqual(expect.arrayContaining(['no_prior_photos', 'over_cap']));
    expect(r.checklist.find((c) => c.id === 'venueExists')?.auto).toBeNull();
  });
});

describe('verification hardening', () => {
  it('paid without proof, or reviewed by the host themself, does not qualify', () => {
    const noProof = party({ id: 'a', payouts: [{ status: 'paid', reviewedBy: 'ops@pizzadao.xyz', paidWithProof: false }] });
    const selfReviewed = party({ id: 'b', payouts: [{ status: 'paid', reviewedBy: 'Host@X.com', paidWithProof: true }] });
    const t = computeTrackRecord([noProof, selfReviewed, party({ id: 'c' })], OLD, NOW, 'host@x.com');
    expect(t.verifiedParties).toBe(1);
  });

  it('prior parties with ordinary photos (no payout role) are not "no_prior_photos"', () => {
    const t = computeTrackRecord([party({ id: 'a', photoCount: 8, rolePhotoCount: 0 })], OLD, NOW);
    expect(t.verifiedParties).toBe(0);
    const r = computeReviewAssist({
      track: t, accountCreatedAt: OLD, partyDate: d('2026-12-01'), rsvpCount: 20,
      otherHostsSharingPayee: 0, reusedReceiptCount: 0, receiptCount: 1, now: NOW,
    });
    expect(r.flags.map((f) => f.id)).not.toContain('no_prior_photos');
  });

  it('counts only CONFIRMED, non-declined, distinct-email RSVPs', () => {
    expect(
      countRealRsvps([
        { email: 'a@x.com', status: 'CONFIRMED', approved: null },
        { email: 'A@x.com ', status: 'CONFIRMED', approved: true },
        { email: 'b@x.com', status: 'CONFIRMED', approved: false },
        { email: 'c@x.com', status: 'CANCELLED', approved: null },
        { email: null, status: 'CONFIRMED', approved: null },
        { email: null, status: 'CONFIRMED', approved: null },
      ]),
    ).toBe(3);
  });

  it('host view: flagged host who meets thresholds gets a neutral underReview', () => {
    const t = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' }), party({ id: 'c', eventTags: ['possible-scam'] })], OLD, NOW);
    const v = toHostView(t);
    expect(v.underReview).toBe(true);
    expect(v.tier).toBe('building');
  });
});

describe('decideApproval', () => {
  const eligibleTrack = computeTrackRecord([party({ id: 'a' }), party({ id: 'b' })], OLD, NOW);
  const lowReview = { flags: [], checklist: [], riskLevel: 'low' as const };
  const base = {
    track: eligibleTrack, review: lowReview, eligibleForFastPass: true, capUsd: 300, amountUsd: 200,
    selfInterested: false, actorEmail: 'other@pizzadao.xyz', actorIsFullAdmin: false, note: undefined as string | undefined,
  };
  const flag = (id: string, severity: 'high' | 'medium' | 'low') => ({
    flags: [{ id, severity, detail: '' }], checklist: [], riskLevel: severity,
  });

  it('fast pass when eligible and clean', () => {
    expect(decideApproval(base)).toMatchObject({ ok: true, basis: 'fast_pass' });
  });
  it('scam / reuse / shared payee hard-block even for a full admin with a note', () => {
    for (const id of ['prior_issues', 'reused_receipts', 'shared_payee']) {
      const r = decideApproval({ ...base, review: flag(id, 'high'), actorIsFullAdmin: true, note: 'ok' });
      expect(r).toMatchObject({ ok: false, code: 'HIGH_RISK' });
    }
  });
  it('soft high flags: full admin + note => manual_review; others blocked', () => {
    const review = flag('no_prior_photos', 'high');
    expect(decideApproval({ ...base, review, actorIsFullAdmin: false, note: 'x' })).toMatchObject({ ok: false, code: 'HIGH_RISK' });
    expect(decideApproval({ ...base, review, actorIsFullAdmin: true })).toMatchObject({ ok: false, code: 'NOTE_REQUIRED' });
    expect(decideApproval({ ...base, review, actorIsFullAdmin: true, note: 'vouched' })).toMatchObject({ ok: true, basis: 'manual_review' });
  });
  it('rejects fast_pass basis when the approver reviewed every verified payout', () => {
    expect(decideApproval({ ...base, actorEmail: 'OPS@pizzadao.xyz' })).toMatchObject({ ok: false, code: 'NOTE_REQUIRED' });
    expect(decideApproval({ ...base, actorEmail: 'ops@pizzadao.xyz', note: 'n' })).toMatchObject({ ok: true, basis: 'manual_review' });
  });
  it('requires a cap and stays under it; blocks self', () => {
    expect(decideApproval({ ...base, capUsd: null })).toMatchObject({ code: 'CAP_REQUIRED' });
    expect(decideApproval({ ...base, amountUsd: 301 })).toMatchObject({ code: 'OVER_CAP' });
    expect(decideApproval({ ...base, selfInterested: true })).toMatchObject({ code: 'SELF_APPROVAL' });
  });
});
