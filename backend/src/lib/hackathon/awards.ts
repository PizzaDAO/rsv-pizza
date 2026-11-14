/**
 * Hackathon awards, reveal and payout tracking (plans/hackathon-platform.md §4, §7, §16 Q4, PR 5).
 * Pure helpers (validation, rules, leaderboard suggestions, serializers), unit-tested in
 * awards.test.ts. Routes: routes/hackathon-awards.routes.ts.
 *
 * Payout tracking is bookkeeping only: no money moves, no tax forms / KYC (§16 Q4).
 *
 * Shapes (explicit allowlists, like serialize.ts):
 *   - host: everything incl. recipient name/email, wallet, reference, notes.
 *   - public winner (after reveal): prize name / amount / track, project name, team name, place.
 *     Never recipient, wallet, payout status, reference, notes, emails or user ids.
 *   - team (own team's awards, after reveal): prize + place + payout status; the recipient also
 *     sees their own wallet, reference and paid date; notes stay host-only.
 */
import { AppError } from '../../middleware/error.js';
import { isUuid } from '../guestToken.js';
import { optDate, optText, intIn } from './validate.js';
import type { LbRow } from './scoring.js';

const bad = (msg: string) => new AppError(msg, 400, 'VALIDATION_ERROR');
const conflict = (msg: string, code: string) => new AppError(msg, 409, code);

type Row = Record<string, any>;
type Body = Record<string, unknown>;
const has = (b: Body, k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export const PAYOUT_STATUSES = ['unpaid', 'pending', 'paid', 'not_applicable'] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

/** Mirrors the CHECKs on hackathon_awards (hackathon-1-core.sql). */
export const PAYOUT_LIMITS = { wallet: 200, reference: 500, notes: 2000 } as const;

// ---------------------------------------------------------------- input

export interface AwardCreateInput {
  prizeId: string;
  submissionId: string;
  place?: number;
}

export function parseAwardCreate(body: Body): AwardCreateInput {
  if (!isUuid(body.prizeId)) throw bad('Pick a prize');
  if (!isUuid(body.submissionId)) throw bad('Pick a project');
  const out: AwardCreateInput = { prizeId: body.prizeId, submissionId: body.submissionId };
  if (has(body, 'place') && body.place !== null && body.place !== '') out.place = intIn(body.place, 'Place', 1, 1000);
  return out;
}

export interface PayoutInput {
  status?: PayoutStatus;
  /** hackathon_team_members.id of the winning team (null clears). Mapped to a user id by the route. */
  recipientMemberId?: string | null;
  recipientWallet?: string | null;
  payoutReference?: string | null;
  paidAt?: Date | null;
  payoutNotes?: string | null;
}

export function parsePayout(body: Body): PayoutInput {
  const out: PayoutInput = {};
  if (has(body, 'status')) {
    if (typeof body.status !== 'string' || !(PAYOUT_STATUSES as readonly string[]).includes(body.status)) {
      throw bad(`Payout status must be one of: ${PAYOUT_STATUSES.join(', ')}`);
    }
    out.status = body.status as PayoutStatus;
  }
  if (has(body, 'recipientMemberId')) {
    if (body.recipientMemberId === null || body.recipientMemberId === '') out.recipientMemberId = null;
    else if (isUuid(body.recipientMemberId)) out.recipientMemberId = body.recipientMemberId;
    else throw bad('Pick a team member as the recipient');
  }
  if (has(body, 'recipientWallet')) out.recipientWallet = optText(body.recipientWallet, 'Wallet / handle', PAYOUT_LIMITS.wallet);
  if (has(body, 'payoutReference')) out.payoutReference = optText(body.payoutReference, 'Reference / tx hash', PAYOUT_LIMITS.reference);
  if (has(body, 'payoutNotes')) out.payoutNotes = optText(body.payoutNotes, 'Notes', PAYOUT_LIMITS.notes);
  if (has(body, 'paidAt')) out.paidAt = optDate(body.paidAt, 'Paid at');
  if (!Object.keys(out).length) throw bad('Nothing to change');
  return out;
}

/**
 * Payout state machine. Any status can move to any other (hosts fix mistakes), with paid_at
 * kept consistent with the status:
 *   - -> paid: paid_at = the given date, else the current one, else now. Not more than a day
 *     in the future (clock skew).
 *   - -> anything else: paid_at cleared (a date sent with a non-paid status is a 400).
 * Returns the Prisma `data` for the payout columns (the recipient is resolved by the route).
 */
export function payoutData(
  input: PayoutInput,
  current: { payoutStatus: string; paidAt: Date | null },
  now = new Date(),
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const status = input.status ?? (current.payoutStatus as PayoutStatus);
  if (input.status !== undefined) data.payoutStatus = input.status;
  if (status === 'paid') {
    const paidAt = input.paidAt ?? current.paidAt ?? now;
    if (paidAt.getTime() > now.getTime() + 24 * 3600 * 1000) throw bad('Paid at cannot be in the future');
    data.paidAt = paidAt;
  } else {
    if (input.paidAt) throw bad('Set the status to paid to record a paid date');
    data.paidAt = null;
  }
  if (input.recipientWallet !== undefined) data.recipientWallet = input.recipientWallet;
  if (input.payoutReference !== undefined) data.payoutReference = input.payoutReference;
  if (input.payoutNotes !== undefined) data.payoutNotes = input.payoutNotes;
  return data;
}

/** True once money is (or may be) on its way: such an award can't be deleted (409). */
export function hasRecordedPayout(a: { payoutStatus: string; paidAt?: Date | null; payoutReference?: string | null }): boolean {
  return a.payoutStatus === 'paid' || a.payoutStatus === 'pending' || !!a.paidAt || !!a.payoutReference;
}

// ---------------------------------------------------------------- award rules

export interface PrizeLike {
  id: string;
  trackId: string | null;
  name: string;
  rank: number | null;
  quantity: number;
  kind: string;
  sortOrder: number;
}

/**
 * Can `submission` take one more slot of `prize`? Throws 409 with a host-readable message.
 * `awardedSubmissionIds` = projects already holding this prize.
 */
export function assertAwardable(
  prize: PrizeLike,
  submission: { id: string; status: string; trackIds: string[] },
  awardedSubmissionIds: string[],
): void {
  if (submission.status !== 'submitted') {
    const why = submission.status === 'disqualified' ? 'is disqualified' : submission.status === 'withdrawn' ? 'was withdrawn' : "hasn't been submitted";
    throw conflict(`This project ${why}, so it can't win a prize.`, 'NOT_AWARDABLE');
  }
  if (prize.trackId && !submission.trackIds.includes(prize.trackId)) {
    throw conflict("This prize belongs to a track the project didn't enter.", 'WRONG_TRACK');
  }
  if (awardedSubmissionIds.includes(submission.id)) {
    throw conflict('This project already has this prize.', 'ALREADY_AWARDED');
  }
  if (awardedSubmissionIds.length >= prize.quantity) {
    throw conflict(
      prize.quantity === 1
        ? `${prize.name} has already been awarded. Remove that award first.`
        : `All ${prize.quantity} ${prize.name} prizes have been awarded. Remove one first.`,
      'PRIZE_FULL',
    );
  }
}

/** Lowest free place 1..quantity (or the requested one, if free and in range). */
export function pickPlace(prize: Pick<PrizeLike, 'quantity'>, takenPlaces: Array<number | null>, requested?: number): number {
  const taken = new Set(takenPlaces.filter((p): p is number => typeof p === 'number'));
  if (requested !== undefined) {
    if (requested > prize.quantity) throw bad(`Place must be from 1 to ${prize.quantity}`);
    if (taken.has(requested)) throw conflict(`Place ${requested} is already taken for this prize.`, 'PLACE_TAKEN');
    return requested;
  }
  for (let p = 1; p <= prize.quantity; p++) if (!taken.has(p)) return p;
  return prize.quantity;
}

/**
 * Reveal rules (decided for PR 5):
 *   - reveal needs judging closed (scores are final) and at least one award;
 *   - un-reveal only while no award is marked paid (once money went out the results stand);
 *   - judging can't be reopened while results are revealed (un-reveal first).
 */
export function assertCanReveal(h: { judgingStatus: string; resultsRevealedAt: Date | null }, awardCount: number): void {
  if (h.judgingStatus !== 'closed') throw conflict('Close judging before revealing the results.', 'JUDGING_NOT_CLOSED');
  if (awardCount < 1) throw conflict('Award at least one prize before revealing the results.', 'NO_AWARDS');
}

export function assertCanUnreveal(paidCount: number): void {
  if (paidCount > 0) {
    throw conflict(
      `${paidCount} prize${paidCount === 1 ? ' is' : 's are'} marked paid, so the results can't be hidden again.`,
      'PAYOUT_RECORDED',
    );
  }
}

// ---------------------------------------------------------------- suggestions

/**
 * Pre-fill from the leaderboard (the host decides). Per scope (overall, or one track), judged
 * prizes in (rank, sort order) order take the next `quantity` ranked projects of that scope's
 * leaderboard; a project gets at most one suggestion per scope (it can still win a track prize
 * and an overall prize). Unscored projects are never suggested. People's Choice prizes get none
 * (voting comes in PR 7). Ties: leaderboard order; the UI shows the tie.
 */
export function suggestWinners(
  prizes: PrizeLike[],
  board: { overall: LbRow[]; tracks: Array<{ trackId: string; rows: LbRow[] }> },
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const scopes = new Map<string, PrizeLike[]>();
  for (const p of prizes) {
    if (p.kind !== 'judged') continue;
    const key = p.trackId ?? '';
    (scopes.get(key) ?? scopes.set(key, []).get(key)!).push(p);
  }
  for (const [key, list] of scopes) {
    const rows = (key ? board.tracks.find((t) => t.trackId === key)?.rows : board.overall) ?? [];
    const ranked = rows.filter((r) => r.rank !== null).map((r) => r.submissionId);
    const ordered = [...list].sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.sortOrder - b.sortOrder);
    let i = 0;
    for (const p of ordered) {
      out[p.id] = ranked.slice(i, i + p.quantity);
      i += p.quantity;
    }
  }
  return out;
}

// ---------------------------------------------------------------- serializers

/** Prisma include for an award with what every shape needs. */
export const AWARD_INCLUDE = {
  prize: { select: { id: true, name: true, trackId: true, amountText: true, amountValue: true, currency: true, rank: true, kind: true, sortOrder: true } },
  submission: { select: { id: true, name: true, slug: true, tagline: true, status: true, team: { select: { id: true, name: true } } } },
  recipient: { select: { id: true, name: true, email: true } },
};

const amount = (p: Row): string | null => {
  if (p?.amountText) return p.amountText;
  if (p?.amountValue !== null && p?.amountValue !== undefined) return `${Number(String(p.amountValue)).toLocaleString('en-US')}${p.currency ? ` ${p.currency}` : ''}`;
  return null;
};

export function hostAward(a: Row) {
  return {
    id: a.id as string,
    prizeId: a.prizeId as string,
    submissionId: a.submissionId as string,
    place: (a.place ?? null) as number | null,
    awardedAt: iso(a.awardedAt),
    projectName: (a.submission?.name ?? null) as string | null,
    projectStatus: (a.submission?.status ?? null) as string | null,
    teamId: (a.submission?.team?.id ?? null) as string | null,
    teamName: (a.submission?.team?.name ?? null) as string | null,
    payoutStatus: a.payoutStatus as PayoutStatus,
    recipient: a.recipient ? { name: (a.recipient.name ?? null) as string | null, email: (a.recipient.email ?? null) as string | null } : null,
    /** The member row of the recipient on the winning team (for the picker), if still on it. */
    recipientMemberId: (a.recipientMemberId ?? null) as string | null,
    recipientWallet: (a.recipientWallet ?? null) as string | null,
    payoutReference: (a.payoutReference ?? null) as string | null,
    paidAt: iso(a.paidAt),
    payoutNotes: (a.payoutNotes ?? null) as string | null,
    updatedAt: iso(a.updatedAt),
  };
}

/** Public winners list. Only awards whose project is still `submitted`. */
export function publicWinners(awards: Row[], tracks: Array<{ id: string; name: string }>) {
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  return awards
    .filter((a) => a.submission?.status === 'submitted')
    .sort((x, y) => (x.prize?.sortOrder ?? 0) - (y.prize?.sortOrder ?? 0) || (x.place ?? 0) - (y.place ?? 0))
    .map((a) => ({
      prizeId: a.prizeId as string,
      prizeName: (a.prize?.name ?? '') as string,
      prizeAmount: amount(a.prize),
      prizeKind: (a.prize?.kind ?? 'judged') as string,
      trackId: (a.prize?.trackId ?? null) as string | null,
      trackName: a.prize?.trackId ? trackName.get(a.prize.trackId) ?? null : null,
      place: (a.place ?? null) as number | null,
      projectName: (a.submission?.name ?? '') as string,
      projectTagline: (a.submission?.tagline ?? null) as string | null,
      teamName: (a.submission?.team?.name ?? null) as string | null,
    }));
}

/** The caller's team's own awards (after reveal). Wallet / reference / paid date: recipient only. */
export function teamAwards(awards: Row[], viewerUserId: string | undefined) {
  return awards.map((a) => {
    const mine = !!viewerUserId && a.recipientUserId === viewerUserId;
    return {
      prizeName: (a.prize?.name ?? '') as string,
      prizeAmount: amount(a.prize),
      place: (a.place ?? null) as number | null,
      payoutStatus: a.payoutStatus as PayoutStatus,
      isRecipient: mine,
      recipientName: (a.recipient?.name ?? null) as string | null,
      recipientWallet: mine ? ((a.recipientWallet ?? null) as string | null) : null,
      payoutReference: mine ? ((a.payoutReference ?? null) as string | null) : null,
      paidAt: mine ? iso(a.paidAt) : null,
    };
  });
}

/** Judge feedback for a team: text only (no judge identity, scores, dates or private comments). */
export function teamFeedback(scores: Array<{ teamFeedback?: string | null }>): string[] {
  return scores.map((s) => (typeof s.teamFeedback === 'string' ? s.teamFeedback.trim() : '')).filter((t) => !!t);
}

export const PAYOUT_LABEL: Record<PayoutStatus, string> = {
  unpaid: 'Unpaid',
  pending: 'Pending',
  paid: 'Paid',
  not_applicable: 'Not applicable',
};

/** Rows for the awards / payouts CSV (host only; formula escaping is in csv.ts). */
export function awardsCsvRows(awards: ReturnType<typeof hostAward>[], prizes: Row[], tracks: Array<{ id: string; name: string }>) {
  const prizeById = new Map(prizes.map((p) => [p.id, p]));
  const trackName = new Map(tracks.map((t) => [t.id, t.name]));
  return awards.map((a) => {
    const p = prizeById.get(a.prizeId);
    return [
      p?.name ?? '', p?.trackId ? trackName.get(p.trackId) ?? '' : 'Overall', p ? amount(p) : '', a.place,
      a.projectName, a.teamName, a.recipient?.name ?? '', a.recipient?.email ?? '', a.recipientWallet,
      PAYOUT_LABEL[a.payoutStatus] ?? a.payoutStatus, a.payoutReference, a.paidAt, a.payoutNotes, a.awardedAt,
    ];
  });
}

export const AWARDS_CSV_HEADER = [
  'Prize', 'Track', 'Amount', 'Place', 'Project', 'Team', 'Recipient', 'Recipient email', 'Wallet / handle',
  'Payout status', 'Reference / tx hash', 'Paid at', 'Notes', 'Awarded at',
];
