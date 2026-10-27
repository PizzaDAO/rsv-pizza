/**
 * Host fast pass: track record + review-assist red flags.
 *
 * Pure functions, no DB access. The caller (services/hostFastPass.service.ts)
 * loads history and passes it in. This module only SPEEDS and FOCUSES admin
 * review. It never approves or pays anything.
 *
 * Trust is earned only from ADMIN-REVIEWED evidence: a party counts toward the
 * Fast Pass only if it has an admin-reviewed, paid event payout, receipts that
 * were not marked duplicate/ineligible, host-designated payout photos, and a
 * real-looking RSVP count. Pending payouts and default-approved photos never
 * qualify.
 *
 * SECURITY: the thresholds are intentionally visible to hosts (a goal to aim
 * at). Red-flag details are returned to admins ONLY. Never expose
 * `ReviewAssist` or `issueDetails` on a host-facing route.
 */

export const FAST_PASS_THRESHOLDS = {
  /** Parties that must each be fully "verified" (see isVerifiedParty). */
  minVerifiedParties: 2,
  /** A verified party must have at least this many RSVPs. */
  minRsvps: 10,
  /** Account must be at least this old (days). */
  minAccountAgeDays: 45,
  /** Receipts count as on time if first uploaded within N days of the party. */
  receiptDeadlineDays: 14,
} as const;

/** New-host heuristics (admin review assist only). */
export const REVIEW_THRESHOLDS = {
  newAccountDays: 30,
  lowRsvpCount: 5,
} as const;

export interface HostPayoutHistory {
  status: string; // pending | approved | queued | paid | rejected | ...
  /** An admin reviewed this payout (reviewedBy set). */
  adminReviewed: boolean;
}

export interface HostPartyHistory {
  partyId: string;
  date: Date | null;
  cancelledAt: Date | null;
  eventTags: string[];
  /** Host-designated payout-role photos (not merely default-approved uploads). */
  photoCount: number;
  rsvpCount: number;
  /** Receipts NOT marked duplicate or ineligible. */
  receiptCount: number;
  /** First upload time among those receipts. */
  firstReceiptAt: Date | null;
  /** Any receipt on the party was admin-marked duplicate. */
  hasDuplicateReceipts: boolean;
  payouts: HostPayoutHistory[];
}

export type TrackTier = 'fast_pass' | 'building' | 'new' | 'flagged';
export type MissingRequirement = 'verifiedParties' | 'accountAge' | 'issues';

export interface TrackRecord {
  partiesHosted: number;
  /** Completed parties with photos (admin review aid; not an eligibility input). */
  partiesWithPhotos: number;
  verifiedParties: number;
  /** Hard issues only: rejected payouts, scam tags. Duplicates are NOT hard. */
  issues: number;
  /** Internal detail. Never send to hosts. */
  issueDetails: string[];
  /** Parties (not receipts) with admin-marked duplicate receipts. */
  partiesWithDuplicateReceipts: number;
  accountAgeDays: number;
  tier: TrackTier;
  eligibleForFastPass: boolean;
  missing: MissingRequirement[];
}

/** Host-safe projection: no counts or tiers that reveal flags. */
export interface HostTrackView {
  partiesHosted: number;
  verifiedParties: number;
  accountAgeDays: number;
  tier: Exclude<TrackTier, 'flagged'>;
  eligibleForFastPass: boolean;
  missing: Array<Exclude<MissingRequirement, 'issues'>>;
}

export function toHostView(t: TrackRecord): HostTrackView {
  return {
    partiesHosted: t.partiesHosted,
    verifiedParties: t.verifiedParties,
    accountAgeDays: t.accountAgeDays,
    // A flagged host sees the same card as anyone still building a record.
    tier: t.tier === 'flagged' ? 'building' : t.tier,
    eligibleForFastPass: t.eligibleForFastPass,
    missing: t.missing.filter((m): m is Exclude<MissingRequirement, 'issues'> => m !== 'issues'),
  };
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function isScamTagged(tags: string[] | null | undefined): boolean {
  return Array.isArray(tags) && tags.some((t) => t?.trim().toLowerCase() === 'possible-scam');
}

/** A party is "hosted" once it happened (past date) and was not cancelled. */
export function isCompletedParty(p: HostPartyHistory, now: Date): boolean {
  return !!p.date && p.date.getTime() < now.getTime() && !p.cancelledAt;
}

function receiptsOnTime(p: HostPartyHistory): boolean {
  if (!p.date || p.receiptCount === 0 || !p.firstReceiptAt) return false;
  return p.firstReceiptAt.getTime() <= p.date.getTime() + FAST_PASS_THRESHOLDS.receiptDeadlineDays * DAY_MS;
}

/**
 * Fully verified party: happened, not scam-tagged, an admin-reviewed PAID event
 * payout (and none rejected), on-time non-duplicate receipts, host-designated
 * photos, and enough RSVPs.
 */
export function isVerifiedParty(p: HostPartyHistory, now: Date): boolean {
  if (!isCompletedParty(p, now) || isScamTagged(p.eventTags)) return false;
  if (p.payouts.some((po) => po.status === 'rejected')) return false;
  if (!p.payouts.some((po) => po.status === 'paid' && po.adminReviewed)) return false;
  return receiptsOnTime(p) && p.photoCount > 0 && p.rsvpCount >= FAST_PASS_THRESHOLDS.minRsvps;
}

export function computeTrackRecord(
  history: HostPartyHistory[],
  accountCreatedAt: Date,
  now: Date = new Date(),
): TrackRecord {
  const completed = history.filter((p) => isCompletedParty(p, now));
  const issueDetails: string[] = [];
  let partiesWithDuplicateReceipts = 0;

  for (const p of history) {
    if (isScamTagged(p.eventTags)) issueDetails.push(`party ${p.partyId}: flagged possible scam`);
    if (p.payouts.some((po) => po.status === 'rejected')) {
      issueDetails.push(`party ${p.partyId}: payout rejected`);
    }
    if (p.hasDuplicateReceipts) partiesWithDuplicateReceipts++;
  }

  const verifiedParties = history.filter((p) => isVerifiedParty(p, now)).length;
  const partiesWithPhotos = completed.filter((p) => p.photoCount > 0).length;
  const accountAgeDays = Math.max(0, Math.floor((now.getTime() - accountCreatedAt.getTime()) / DAY_MS));
  const T = FAST_PASS_THRESHOLDS;
  const issues = issueDetails.length;

  const missing: MissingRequirement[] = [];
  if (verifiedParties < T.minVerifiedParties) missing.push('verifiedParties');
  if (accountAgeDays < T.minAccountAgeDays) missing.push('accountAge');
  if (issues > 0) missing.push('issues');

  const eligibleForFastPass = missing.length === 0;
  let tier: TrackTier;
  if (issues > 0) tier = 'flagged';
  else if (eligibleForFastPass) tier = 'fast_pass';
  else if (completed.length === 0) tier = 'new';
  else tier = 'building';

  return {
    partiesHosted: completed.length,
    partiesWithPhotos,
    verifiedParties,
    issues,
    issueDetails,
    partiesWithDuplicateReceipts,
    accountAgeDays,
    tier,
    eligibleForFastPass,
    missing,
  };
}

// ============================================
// Review assist (admin only)
// ============================================

export type FlagSeverity = 'high' | 'medium' | 'low';

export interface ReviewFlag {
  id: string;
  severity: FlagSeverity;
  detail: string;
}

export interface ReviewInput {
  track: TrackRecord;
  accountCreatedAt: Date;
  /** Date of the party under review (future-dated parties are expected to have few RSVPs). */
  partyDate: Date | null;
  rsvpCount: number;
  /** Distinct OTHER user ids that used the same payout wallet address. */
  otherHostsSharingPayee: number;
  /** Receipts on this party matching a receipt from another party. */
  reusedReceiptCount: number;
  receiptCount: number;
  /** Sum of the party's pending/approved/queued/paid event payouts. */
  requestedUsd?: number | null;
  capUsd?: number | null;
  now?: Date;
}

export interface ChecklistItem {
  id: string;
  /** true = passes automatically, false = fails, null = needs a human look. */
  auto: boolean | null;
}

export interface ReviewAssist {
  flags: ReviewFlag[];
  checklist: ChecklistItem[];
  riskLevel: 'high' | 'medium' | 'low';
}

export function computeReviewAssist(input: ReviewInput): ReviewAssist {
  const now = input.now ?? new Date();
  const flags: ReviewFlag[] = [];
  const t = input.track;
  const ageDays = Math.floor((now.getTime() - input.accountCreatedAt.getTime()) / DAY_MS);
  const future = !!input.partyDate && input.partyDate.getTime() > now.getTime();

  if (ageDays < REVIEW_THRESHOLDS.newAccountDays) {
    flags.push({ id: 'new_account', severity: 'medium', detail: `Account is ${ageDays} day(s) old` });
  }
  if (t.partiesHosted === 0) {
    flags.push({ id: 'first_party', severity: 'low', detail: 'No completed prior parties' });
  } else if (t.partiesWithPhotos === 0) {
    flags.push({
      id: 'no_prior_photos',
      severity: 'high',
      detail: `${t.partiesHosted} prior part${t.partiesHosted === 1 ? 'y' : 'ies'}, none with event photos`,
    });
  }
  if (t.issues > 0) {
    flags.push({ id: 'prior_issues', severity: 'high', detail: t.issueDetails.slice(0, 5).join('; ') });
  }
  if (t.partiesWithDuplicateReceipts > 0) {
    // Admin marks duplicates as a routine exclusion; informational, never blocking.
    flags.push({
      id: 'duplicate_receipts',
      severity: 'medium',
      detail: `${t.partiesWithDuplicateReceipts} prior part${t.partiesWithDuplicateReceipts === 1 ? 'y' : 'ies'} had receipts marked duplicate`,
    });
  }
  if (input.otherHostsSharingPayee > 0) {
    flags.push({
      id: 'shared_payee',
      severity: 'high',
      detail: `Payout wallet address also used by ${input.otherHostsSharingPayee} other host account(s)`,
    });
  }
  if (input.rsvpCount === 0) {
    flags.push({
      id: 'no_rsvps',
      severity: future ? 'medium' : 'high',
      detail: future ? 'No RSVPs yet (party is in the future)' : 'Party has no RSVPs',
    });
  } else if (input.rsvpCount < REVIEW_THRESHOLDS.lowRsvpCount) {
    flags.push({ id: 'low_rsvps', severity: 'medium', detail: `Only ${input.rsvpCount} RSVP(s)` });
  }
  if (input.reusedReceiptCount > 0) {
    flags.push({
      id: 'reused_receipts',
      severity: 'high',
      detail: `${input.reusedReceiptCount} receipt(s) match a file already submitted on another party`,
    });
  }
  if (input.receiptCount === 0) {
    flags.push({
      id: 'no_receipts',
      severity: future ? 'low' : 'medium',
      detail: 'No receipts uploaded yet',
    });
  }
  if (input.requestedUsd != null && input.capUsd != null && input.requestedUsd > input.capUsd) {
    flags.push({
      id: 'over_cap',
      severity: 'medium',
      detail: `Payouts total US$${input.requestedUsd.toFixed(2)}, above the US$${input.capUsd.toFixed(2)} cap`,
    });
  }

  const has = (id: string) => flags.some((f) => f.id === id);
  const checklist: ChecklistItem[] = [
    { id: 'accountEstablished', auto: !has('new_account') },
    { id: 'priorPhotos', auto: t.partiesHosted === 0 ? null : !has('no_prior_photos') },
    { id: 'noPriorIssues', auto: !has('prior_issues') },
    { id: 'uniquePayee', auto: !has('shared_payee') },
    { id: 'realRsvps', auto: future && input.rsvpCount === 0 ? null : !(has('no_rsvps') || has('low_rsvps')) },
    { id: 'receiptsOriginal', auto: input.receiptCount === 0 ? null : !has('reused_receipts') },
    { id: 'receiptsMatchAmount', auto: null },
    { id: 'venueExists', auto: null },
  ];

  const riskLevel = flags.some((f) => f.severity === 'high')
    ? 'high'
    : flags.some((f) => f.severity === 'medium')
      ? 'medium'
      : 'low';

  return { flags, checklist, riskLevel };
}
