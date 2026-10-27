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
  /** Who reviewed the payout (admin email), null if nobody did. */
  reviewedBy: string | null;
  /** status='paid' AND real proof of send (mirrors PAID_HAS_PROOF_WHERE). */
  paidWithProof: boolean;
}

/** Minimal guest shape for counting real RSVPs. */
export interface RsvpGuest {
  email: string | null;
  status: string;
  approved: boolean | null;
}

/**
 * Real RSVPs: CONFIRMED and not declined by the host, de-duplicated by email
 * (guests without an email each count once).
 */
export function countRealRsvps(guests: RsvpGuest[]): number {
  const seen = new Set<string>();
  let noEmail = 0;
  for (const g of guests) {
    if (g.status !== 'CONFIRMED' || g.approved === false) continue;
    const e = typeof g.email === 'string' ? g.email.trim().toLowerCase() : '';
    if (e) seen.add(e);
    else noEmail++;
  }
  return seen.size + noEmail;
}

export interface HostPartyHistory {
  partyId: string;
  date: Date | null;
  cancelledAt: Date | null;
  eventTags: string[];
  /** Any approved, non-deleted photo (review aid: did a prior event leave photos). */
  photoCount: number;
  /** Host-designated payout-role photos (required for a VERIFIED party). */
  rolePhotoCount: number;
  /** Real RSVPs (see countRealRsvps). */
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
  /** Lowercased emails of everyone who reviewed a qualifying payout of a verified party. */
  verifiedReviewers: string[];
}

/** Host-safe projection: no counts or tiers that reveal flags. */
export interface HostTrackView {
  partiesHosted: number;
  verifiedParties: number;
  accountAgeDays: number;
  tier: Exclude<TrackTier, 'flagged'>;
  eligibleForFastPass: boolean;
  missing: Array<Exclude<MissingRequirement, 'issues'>>;
  /** Neutral: a flagged host who otherwise meets the thresholds. */
  underReview: boolean;
}

export function toHostView(t: TrackRecord): HostTrackView {
  const missing = t.missing.filter((m): m is Exclude<MissingRequirement, 'issues'> => m !== 'issues');
  return {
    partiesHosted: t.partiesHosted,
    verifiedParties: t.verifiedParties,
    accountAgeDays: t.accountAgeDays,
    // A flagged host sees the same card as anyone still building a record.
    tier: t.tier === 'flagged' ? 'building' : t.tier,
    eligibleForFastPass: t.eligibleForFastPass,
    missing,
    underReview: t.tier === 'flagged' && missing.length === 0,
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

/** Payouts that count as proof for a party: paid, with proof, reviewed by someone other than the host. */
function qualifyingPayouts(p: HostPartyHistory, hostEmail: string | null) {
  const host = hostEmail?.trim().toLowerCase() ?? null;
  return p.payouts.filter(
    (po) =>
      po.status === 'paid' &&
      po.paidWithProof &&
      !!po.reviewedBy &&
      po.reviewedBy.trim().toLowerCase() !== host,
  );
}

/**
 * Fully verified party: happened, not scam-tagged, a paid-with-proof event
 * payout reviewed by an admin other than the host (and none rejected),
 * on-time non-duplicate receipts, host-designated photos, enough real RSVPs.
 */
export function isVerifiedParty(p: HostPartyHistory, now: Date, hostEmail: string | null = null): boolean {
  if (!isCompletedParty(p, now) || isScamTagged(p.eventTags)) return false;
  if (p.payouts.some((po) => po.status === 'rejected')) return false;
  if (qualifyingPayouts(p, hostEmail).length === 0) return false;
  return receiptsOnTime(p) && p.rolePhotoCount > 0 && p.rsvpCount >= FAST_PASS_THRESHOLDS.minRsvps;
}

export function computeTrackRecord(
  history: HostPartyHistory[],
  accountCreatedAt: Date,
  now: Date = new Date(),
  hostEmail: string | null = null,
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

  const verified = history.filter((p) => isVerifiedParty(p, now, hostEmail));
  const verifiedParties = verified.length;
  const verifiedReviewers = Array.from(
    new Set(
      verified.flatMap((p) => qualifyingPayouts(p, hostEmail).map((po) => po.reviewedBy!.trim().toLowerCase())),
    ),
  );
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
    verifiedReviewers,
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

// ============================================
// Approval decision (shared by the review and approve routes)
// ============================================

/** Flags that can never be waved through: scam history and reuse/duplication of identity or receipts. */
export const HARD_BLOCK_FLAG_IDS = ['prior_issues', 'reused_receipts', 'shared_payee'] as const;

export interface ApprovalDecisionInput {
  track: TrackRecord;
  review: ReviewAssist;
  eligibleForFastPass: boolean;
  /** Effective cap from reimbursementCapUsd ONLY (underboss-validated), or null. */
  capUsd: number | null;
  amountUsd: number | null;
  selfInterested: boolean;
  actorEmail: string;
  actorIsFullAdmin: boolean;
  note?: string | null;
}

export type ApprovalDecision =
  | { ok: true; basis: 'fast_pass' | 'manual_review'; requiresNote: boolean }
  | { ok: false; status: number; code: string; message: string; requiresNote: boolean };

export function decideApproval(i: ApprovalDecisionInput): ApprovalDecision {
  const fail = (status: number, code: string, message: string, requiresNote = false): ApprovalDecision => ({
    ok: false, status, code, message, requiresNote,
  });
  if (i.selfInterested) {
    return fail(403, 'SELF_APPROVAL', 'You host, co-host or are paid on this party, so you cannot pre-approve it.');
  }
  const flags = i.review.flags;
  if (flags.some((f) => (HARD_BLOCK_FLAG_IDS as readonly string[]).includes(f.id) && f.severity === 'high')) {
    return fail(409, 'HIGH_RISK', 'Scam history, reused receipts or a shared payee are open; resolve them first.');
  }
  if (i.capUsd == null) {
    return fail(400, 'CAP_REQUIRED', 'Set the party reimbursement cap (underboss-validated) before pre-approving a budget.');
  }
  if (i.amountUsd != null && i.amountUsd > i.capUsd) {
    return fail(400, 'OVER_CAP', `Amount exceeds the party reimbursement cap (US$${i.capUsd}).`);
  }

  const softHigh = flags.some((f) => f.severity === 'high');
  const actor = i.actorEmail.trim().toLowerCase();
  const reviewedItAll =
    i.track.verifiedParties > 0 && i.track.verifiedReviewers.length === 1 && i.track.verifiedReviewers[0] === actor;
  const needsManual = !i.eligibleForFastPass || softHigh || reviewedItAll;

  if (!needsManual) return { ok: true, basis: 'fast_pass', requiresNote: false };

  if (softHigh && !i.actorIsFullAdmin) {
    return fail(409, 'HIGH_RISK', 'High-risk flags are open; only a full admin can override them with a note.', true);
  }
  if (!i.note?.trim()) {
    return fail(400, 'NOTE_REQUIRED', 'A manual review note is required.', true);
  }
  return { ok: true, basis: 'manual_review', requiresNote: true };
}
