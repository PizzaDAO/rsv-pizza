/**
 * Host trust tier + score (plans/trusted-hosts.md sections 1.1 and 1.2). Pure: no DB, no clock, no I/O.
 *
 * Layers:
 *  1. Blockers (any one gives `restricted`).
 *  2. Gates for `trusted` (verified parties after decay, account age, score, PizzaDAO-check rule).
 *  3. A 0-100 score: each signal has its own points and cap, penalties subtract, the sum is clamped.
 *
 * Report-only for now: nothing here approves, pays, or changes a budget. Details in `reasons` are
 * admin-only and never go to hosts or underbosses. Use hostFacingTier / underbossChip for those.
 */
import {
  isCompletedParty,
  isScamTagged,
  isVerifiedParty,
  qualifyingPayouts,
  receiptsOnTime,
  type HostPartyHistory,
} from './hostTrackRecord.js';
import type { HostTrustConfig } from './hostTrustSettings.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30.44 * DAY_MS;

export type TrustTier = 'restricted' | 'new' | 'building' | 'trusted';

/** Per-party evidence on top of the Fast Pass history (loaded by the service). */
export interface HostTrustParty extends HostPartyHistory {
  /** Guests with a check-in. */
  checkedInCount: number;
  /** Check-ins look bulk-entered (fake-detection check-in heuristics). Such parties are excluded from turnout. */
  bulkCheckin: boolean;
  /** Host-entered attendance estimate. Can only lower the score. */
  reportedAttendance: number | null;
  /** Fake-event detection put this party in the high tier. null = not scored (does not count either way). */
  fakeRiskHigh: boolean | null;
  /** Underboss approved or listed the party. */
  underbossOk: boolean;
  /** Receipts on this party that match a file already used on another party. */
  reusedReceiptCount: number;
}

/**
 * What PizzaDAO told us about the host, when the (later) cross-app check exists.
 * 'not_checked' = that check is not switched on yet: the Q5 rule does not apply.
 * null = the check was attempted and failed: unknown, which is not a block and not a pass.
 */
export type MemberSignals =
  | 'not_checked'
  | null
  | {
      matched: boolean;
      ambiguous: boolean;
      /** null = unknown (disavow off). Unknown never blocks. */
      restricted: boolean | null;
      fraudRejected: boolean;
    };

export interface TrustOverride {
  tier: 'trusted' | 'restricted';
  expiresAt: Date | null;
  revokedAt: Date | null;
}

export interface HostTrustInput {
  history: HostTrustParty[];
  accountCreatedAt: Date;
  hostEmail: string | null;
  /** Other host accounts using this host's payout wallet. */
  otherHostsSharingPayee: number;
  member: MemberSignals;
  overrides?: TrustOverride[];
}

export interface TrustReason {
  signal: string;
  /** Signed points after the per-signal cap. */
  points: number;
  /** Admin-only, generic text. No names or ids. */
  detail: string;
}

export interface TrustGate {
  id: 'verifiedParties' | 'accountAge' | 'score' | 'pizzadaoCheck';
  met: boolean;
  have: number | null;
  need: number | null;
}

export interface HostTrustResult {
  tier: TrustTier;
  score: number;
  reasons: TrustReason[];
  gates: TrustGate[];
  blockers: string[];
  /** Verified parties after decay (old ones count half), floored. */
  verifiedParties: number;
  verifiedPartiesRaw: number;
  completedParties: number;
  accountAgeDays: number;
  /** Median check-in ratio and how many parties it is based on. null when below minParties. */
  medianTurnout: number | null;
  turnoutParties: number;
  pizzadao: 'not_checked' | 'unavailable' | 'ok' | 'ambiguous';
  overrideApplied: 'trusted' | 'restricted' | null;
  overrideSuspended: boolean;
}

function capped(count: number, rule: { points: number; cap: number }): number {
  return Math.max(0, Math.min(rule.cap, count * rule.points));
}

export function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function activeOverride(overrides: TrustOverride[] | undefined, now: Date): TrustOverride | null {
  const live = (overrides ?? []).filter(
    (o) => !o.revokedAt && (!o.expiresAt || o.expiresAt.getTime() > now.getTime()),
  );
  // A restricted override always wins over a trusted one.
  return live.find((o) => o.tier === 'restricted') ?? live.find((o) => o.tier === 'trusted') ?? null;
}

export function computeHostTrust(input: HostTrustInput, config: HostTrustConfig, now: Date): HostTrustResult {
  const g = config.gates;
  const w = config.weights;
  const completed = input.history.filter((p) => isCompletedParty(p, now));
  const accountAgeDays = Math.max(0, Math.floor((now.getTime() - input.accountCreatedAt.getTime()) / DAY_MS));

  // ---- verified parties, with decay
  const verifyT = { minRsvps: g.minRsvps, receiptDeadlineDays: g.receiptDeadlineDays };
  const verified = input.history.filter((p) => isVerifiedParty(p, now, input.hostEmail, verifyT));
  const decayMs = g.decayMonths * MONTH_MS;
  const verifiedWeighted = verified.reduce(
    (sum, p) => sum + (p.date && now.getTime() - p.date.getTime() > decayMs ? 0.5 : 1),
    0,
  );
  const verifiedParties = Math.floor(verifiedWeighted);

  // ---- positive signals
  const reasons: TrustReason[] = [];
  const add = (signal: string, points: number, detail: string) => {
    if (points !== 0) reasons.push({ signal, points, detail });
  };

  add('verified_parties', capped(verifiedWeighted, w.verified_parties), `${verified.length} verified part${verified.length === 1 ? 'y' : 'ies'} (${verifiedParties} after decay)`);
  add('parties_hosted', capped(completed.length, w.parties_hosted), `${completed.length} completed part${completed.length === 1 ? 'y' : 'ies'}`);

  const cleanPayoutParties = completed.filter(
    (p) => qualifyingPayouts(p, input.hostEmail).length > 0 && !p.payouts.some((po) => po.status === 'rejected'),
  ).length;
  add('clean_payouts', capped(cleanPayoutParties, w.clean_payouts), `${cleanPayoutParties} part${cleanPayoutParties === 1 ? 'y' : 'ies'} with a reviewed, paid-with-proof payout`);

  const onTime = completed.filter((p) => receiptsOnTime(p, verifyT)).length;
  add('receipts_on_time', capped(onTime, w.receipts_on_time), `${onTime} part${onTime === 1 ? 'y' : 'ies'} with receipts on time`);

  const withRolePhotos = completed.filter((p) => p.rolePhotoCount > 0).length;
  add('proof_photos', capped(withRolePhotos, w.proof_photos), `${withRolePhotos} part${withRolePhotos === 1 ? 'y' : 'ies'} with payout-role photos`);

  const ubOk = completed.filter((p) => p.underbossOk).length;
  add('underboss_ok', capped(ubOk, w.underboss_ok), `${ubOk} part${ubOk === 1 ? 'y' : 'ies'} approved by an underboss`);

  const ageUnits = Math.floor(accountAgeDays / 30);
  add('account_age', capped(ageUnits, w.account_age), `Account is ${accountAgeDays} day(s) old`);

  // ---- turnout: only parties with real, non-bulk check-ins and some RSVPs; no check-ins is neutral
  const ratios = completed
    .filter((p) => p.checkedInCount > 0 && !p.bulkCheckin && p.rsvpCount > 0)
    .map((p) => Math.min(1, p.checkedInCount / p.rsvpCount));
  const turnoutParties = ratios.length;
  const med = turnoutParties >= config.turnout.minParties ? median(ratios) : null;
  if (med != null) {
    if (med >= config.turnout.goodRatio) {
      add('turnout', capped(1, w.turnout), `Median turnout ${Math.round(med * 100)}% over ${turnoutParties} parties`);
    } else if (med <= config.turnout.poorRatio) {
      add('poor_turnout', -capped(1, w.poor_turnout), `Median turnout ${Math.round(med * 100)}% over ${turnoutParties} parties`);
    }
  }

  // ---- penalties
  const partiesWithPhotos = completed.filter((p) => p.photoCount > 0).length;
  if (completed.length > 0 && partiesWithPhotos === 0) {
    add('no_prior_photos', -capped(1, w.no_prior_photos), `${completed.length} completed part${completed.length === 1 ? 'y' : 'ies'}, none with photos`);
  }
  const dupParties = input.history.filter((p) => p.hasDuplicateReceipts).length;
  add('duplicate_receipts', -capped(dupParties, w.duplicate_receipts), `${dupParties} part${dupParties === 1 ? 'y' : 'ies'} with receipts marked duplicate`);

  const fakeHigh = completed.filter((p) => p.fakeRiskHigh === true).length;
  add('fake_risk', -capped(fakeHigh, w.fake_risk), `${fakeHigh} part${fakeHigh === 1 ? 'y' : 'ies'} scored high fake-event risk`);

  const implausible = completed.filter(
    (p) =>
      p.reportedAttendance != null &&
      p.reportedAttendance >= 20 &&
      p.reportedAttendance > 3 * Math.max(p.rsvpCount, 1) &&
      p.photoCount < 3,
  ).length;
  add('reported_attendance', -capped(implausible, w.reported_attendance), `${implausible} part${implausible === 1 ? 'y' : 'ies'} with reported attendance far above RSVPs and few photos`);

  const raw = reasons.reduce((s, r) => s + r.points, 0);
  const score = Math.max(0, Math.min(100, Math.round(raw)));

  // ---- blockers
  const blockers: string[] = [];
  if (input.history.some((p) => isScamTagged(p.eventTags))) blockers.push('scam_tag');
  if (input.history.some((p) => p.reusedReceiptCount > 0)) blockers.push('reused_receipts');
  if (input.otherHostsSharingPayee > 0) blockers.push('shared_payee');
  // Same hard rule as today's Fast Pass: any rejected event payout.
  if (input.history.some((p) => p.payouts.some((po) => po.status === 'rejected'))) blockers.push('rejected_payout');
  if (fakeHigh >= config.fakeBlockParties) blockers.push('fake_risk');

  let pizzadao: HostTrustResult['pizzadao'] = 'not_checked';
  if (input.member === null) pizzadao = 'unavailable';
  else if (input.member !== 'not_checked') {
    pizzadao = input.member.ambiguous ? 'ambiguous' : 'ok';
    if (input.member.restricted === true) blockers.push('pizzadao_restricted');
    if (input.member.fraudRejected) blockers.push('pizzadao_fraud_rejected');
  }

  // ---- gates
  const thin = verifiedParties < g.minVerifiedParties + 1;
  const pizzadaoGateMet = !(pizzadao === 'unavailable' && thin);
  const gates: TrustGate[] = [
    { id: 'verifiedParties', met: verifiedParties >= g.minVerifiedParties, have: verifiedParties, need: g.minVerifiedParties },
    { id: 'accountAge', met: accountAgeDays >= g.minAccountAgeDays, have: accountAgeDays, need: g.minAccountAgeDays },
    { id: 'score', met: score >= g.trustedMinScore, have: score, need: g.trustedMinScore },
    { id: 'pizzadaoCheck', met: pizzadaoGateMet, have: null, need: null },
  ];
  const gatesMet = gates.every((x) => x.met);

  // ---- tier
  const override = activeOverride(input.overrides, now);
  let tier: TrustTier;
  let overrideApplied: HostTrustResult['overrideApplied'] = null;
  let overrideSuspended = false;

  if (override?.tier === 'restricted') {
    tier = 'restricted';
    overrideApplied = 'restricted';
  } else if (blockers.length > 0) {
    tier = 'restricted';
    overrideSuspended = override?.tier === 'trusted';
  } else if (override?.tier === 'trusted') {
    tier = 'trusted';
    overrideApplied = 'trusted';
  } else if (gatesMet) {
    tier = 'trusted';
  } else if (completed.length === 0 && score <= g.newMaxScore) {
    tier = 'new';
  } else {
    tier = 'building';
  }

  return {
    tier,
    score,
    reasons,
    gates,
    blockers,
    verifiedParties,
    verifiedPartiesRaw: verified.length,
    completedParties: completed.length,
    accountAgeDays,
    medianTurnout: med,
    turnoutParties,
    pizzadao,
    overrideApplied,
    overrideSuspended,
  };
}

// ------------------------------------------------------------------ audience views

/** What a host sees: a restricted host looks exactly like one still building. */
export function hostFacingTier(t: TrustTier): Exclude<TrustTier, 'restricted'> {
  return t === 'restricted' ? 'building' : t;
}

/** What an underboss sees: a chip only, no reasons. Restricted reads as "needs admin review". */
export function underbossChip(t: TrustTier): 'trusted' | 'building' | 'new' | 'needs_admin_review' {
  return t === 'restricted' ? 'needs_admin_review' : t;
}
