/**
 * Host fast pass: track record + review-assist red flags.
 *
 * Pure functions, no DB access. The caller (services/hostFastPass.service.ts)
 * loads history and passes it in. This module only SPEEDS and FOCUSES admin
 * review. It never approves or pays anything.
 *
 * SECURITY: the fast-pass trust thresholds below are intentionally visible to
 * hosts (they are a goal to aim at). The red-flag details (shared payee, reused
 * receipts, ...) are returned to admins ONLY. Never expose `ReviewAssist` on a
 * host-facing route (it would be an evasion roadmap).
 */

// ============================================
// Thresholds
// ============================================

export const FAST_PASS_THRESHOLDS = {
  /** Completed past parties that must each have on-time receipts. */
  minPartiesWithOnTimeReceipts: 2,
  /** Completed past parties that must have event photos submitted. */
  minPartiesWithPhotos: 2,
  /** Account must be at least this old (days). */
  minAccountAgeDays: 45,
  /** Receipts count as on time if first uploaded within N days of the party. */
  receiptDeadlineDays: 14,
  /** Max allowed issues (rejected payouts, duplicate receipts, scam flags). */
  maxIssues: 0,
} as const;

/** New-host heuristics (admin review assist only). */
export const REVIEW_THRESHOLDS = {
  newAccountDays: 30,
  lowRsvpCount: 5,
} as const;

// ============================================
// Types
// ============================================

export interface HostPayoutHistory {
  status: string; // pending | approved | queued | paid | rejected | ...
  createdAt: Date;
  /** First receipt upload time for this payout, null if none. */
  firstReceiptAt: Date | null;
  receiptCount: number;
  duplicateReceiptCount: number;
}

export interface HostPartyHistory {
  partyId: string;
  date: Date | null;
  cancelledAt: Date | null;
  eventTags: string[];
  /** Approved, non-deleted photos on the party. */
  photoCount: number;
  rsvpCount: number;
  payouts: HostPayoutHistory[];
}

export type TrackTier = 'fast_pass' | 'building' | 'new' | 'flagged';

export type MissingRequirement = 'onTimeReceipts' | 'photos' | 'accountAge' | 'issues';

export interface TrackRecord {
  partiesHosted: number;
  partiesWithReceipts: number;
  partiesWithOnTimeReceipts: number;
  partiesWithPhotos: number;
  paidWithoutIssues: number;
  issues: number;
  /** Internal detail. Strip before sending to hosts (see toHostView). */
  issueDetails: string[];
  accountAgeDays: number;
  tier: TrackTier;
  eligibleForFastPass: boolean;
  missing: MissingRequirement[];
}

/** Host-safe projection: no issue details, no flag internals. */
export type HostTrackView = Omit<TrackRecord, 'issueDetails'>;

export function toHostView(t: TrackRecord): HostTrackView {
  const { issueDetails: _omit, ...rest } = t;
  return rest;
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
  if (!p.date) return false;
  const deadline = p.date.getTime() + FAST_PASS_THRESHOLDS.receiptDeadlineDays * DAY_MS;
  return p.payouts.some(
    (po) => po.receiptCount > 0 && po.firstReceiptAt != null && po.firstReceiptAt.getTime() <= deadline,
  );
}

export function computeTrackRecord(
  history: HostPartyHistory[],
  accountCreatedAt: Date,
  now: Date = new Date(),
): TrackRecord {
  const completed = history.filter((p) => isCompletedParty(p, now));
  const issueDetails: string[] = [];

  let partiesWithReceipts = 0;
  let partiesWithOnTimeReceipts = 0;
  let partiesWithPhotos = 0;
  let paidWithoutIssues = 0;

  for (const p of history) {
    if (isScamTagged(p.eventTags)) issueDetails.push(`party ${p.partyId}: flagged possible scam`);
    for (const po of p.payouts) {
      if (po.status === 'rejected') issueDetails.push(`party ${p.partyId}: payout rejected`);
      if (po.duplicateReceiptCount > 0) {
        issueDetails.push(`party ${p.partyId}: ${po.duplicateReceiptCount} duplicate receipt(s)`);
      }
    }
  }

  for (const p of completed) {
    if (p.payouts.some((po) => po.receiptCount > 0)) partiesWithReceipts++;
    if (receiptsOnTime(p)) partiesWithOnTimeReceipts++;
    if (p.photoCount > 0) partiesWithPhotos++;
    const paid = p.payouts.filter((po) => po.status === 'paid');
    const clean =
      paid.length > 0 &&
      paid.every((po) => po.duplicateReceiptCount === 0) &&
      !p.payouts.some((po) => po.status === 'rejected') &&
      !isScamTagged(p.eventTags);
    if (clean) paidWithoutIssues++;
  }

  const accountAgeDays = Math.max(0, Math.floor((now.getTime() - accountCreatedAt.getTime()) / DAY_MS));
  const T = FAST_PASS_THRESHOLDS;
  const issues = issueDetails.length;

  const missing: MissingRequirement[] = [];
  if (partiesWithOnTimeReceipts < T.minPartiesWithOnTimeReceipts) missing.push('onTimeReceipts');
  if (partiesWithPhotos < T.minPartiesWithPhotos) missing.push('photos');
  if (accountAgeDays < T.minAccountAgeDays) missing.push('accountAge');
  if (issues > T.maxIssues) missing.push('issues');

  const eligibleForFastPass = missing.length === 0;
  let tier: TrackTier;
  if (issues > 0) tier = 'flagged';
  else if (eligibleForFastPass) tier = 'fast_pass';
  else if (completed.length === 0) tier = 'new';
  else tier = 'building';

  return {
    partiesHosted: completed.length,
    partiesWithReceipts,
    partiesWithOnTimeReceipts,
    partiesWithPhotos,
    paidWithoutIssues,
    issues,
    issueDetails,
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
  /** RSVPs on the party under review. */
  rsvpCount: number;
  /** Distinct OTHER user ids that used the same payout wallet/bank payee. */
  otherHostsSharingPayee: number;
  /** Receipts on this party matching a receipt from another party. */
  reusedReceiptCount: number;
  receiptCount: number;
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
  if (input.otherHostsSharingPayee > 0) {
    flags.push({
      id: 'shared_payee',
      severity: 'high',
      detail: `Payout wallet/bank details also used by ${input.otherHostsSharingPayee} other host account(s)`,
    });
  }
  if (input.rsvpCount === 0) {
    flags.push({ id: 'no_rsvps', severity: 'high', detail: 'Party has no RSVPs' });
  } else if (input.rsvpCount < REVIEW_THRESHOLDS.lowRsvpCount) {
    flags.push({ id: 'low_rsvps', severity: 'medium', detail: `Only ${input.rsvpCount} RSVP(s)` });
  }
  if (input.reusedReceiptCount > 0) {
    flags.push({
      id: 'reused_receipts',
      severity: 'high',
      detail: `${input.reusedReceiptCount} receipt(s) match one already submitted on another party`,
    });
  }
  if (input.receiptCount === 0) {
    flags.push({ id: 'no_receipts', severity: 'medium', detail: 'No receipts uploaded yet' });
  }
  if (input.requestedUsd != null && input.capUsd != null && input.requestedUsd > input.capUsd) {
    flags.push({
      id: 'over_cap',
      severity: 'medium',
      detail: `Requested $${input.requestedUsd.toFixed(2)} exceeds cap $${input.capUsd.toFixed(2)}`,
    });
  }

  const has = (id: string) => flags.some((f) => f.id === id);
  const checklist: ChecklistItem[] = [
    { id: 'accountEstablished', auto: !has('new_account') },
    { id: 'priorPhotos', auto: t.partiesHosted === 0 ? null : !has('no_prior_photos') },
    { id: 'noPriorIssues', auto: !has('prior_issues') },
    { id: 'uniquePayee', auto: !has('shared_payee') },
    { id: 'realRsvps', auto: !(has('no_rsvps') || has('low_rsvps')) },
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
