/**
 * Public (People's Choice) voting (plans/hackathon-platform.md §3, §11, §16 Q1/Q10, PR 7).
 * Pure rules + serializers here (unit-tested in voting.test.ts); routes in
 * routes/hackathon-voting.routes.ts. Schema: hackathon-2-voting.sql.
 *
 * Rules (owner decisions):
 *   - Login required; votes are keyed by user id. One vote per voter per scope: event-wide
 *     (scope 'event', track_id NULL) or one per track (scope 'track'). The DB enforces it with
 *     the expression unique index hackathon_votes_one_per_scope; writes are INSERT ... ON
 *     CONFLICT on that expression, so a double-click / two tabs can't create two votes.
 *   - A voter may CHANGE (or retract) their vote while the window is open: the row is updated
 *     in place. After close every vote is final.
 *   - Eligibility (host setting): 'checked_in' (default) or 'registered' (approved, confirmed
 *     RSVP), matched by the JWT email against the party's guests with exact lower(email)
 *     (eligibility.ts). Judges, hosts and co-hosts may vote if they qualify like anyone else.
 *   - Window: open while enabled AND opens_at <= now AND (closes_at IS NULL OR now < closes_at)
 *     (server time). Manual open / close only set these timestamps.
 *   - Only projects of an OPEN gallery (galleryRules.isGalleryOpen) with status 'submitted'.
 *   - No voting for your own team's project: the voter is a member of the project's team by
 *     user id, or their email matches a member's account email or RSVP (guest) email.
 *   - Tallies are hidden from EVERYONE (host and super admins included) until the window is
 *     closed. While open/scheduled the host sees only the total vote / voter count and the
 *     ip_hash bucket counts. The public never gets tallies at all: People's Choice winners
 *     reach the public only through the awards reveal (PR 5).
 *   - ip_hash = HMAC-SHA256(normalized IP) under a key derived from the server secret and
 *     domain-separated per hackathon. Stored for abuse review only: hosts see vote counts per
 *     bucket (labelled by a short prefix), never IPs. No auto-blocking.
 *   - People's Choice: if the host adds a prize with kind 'peoples_choice', the vote tally
 *     ranks the candidates and suggests the winner(s) after close; the host still awards it in
 *     Winners & Payouts (it isn't created or awarded automatically, §16 Q10). Such a prize
 *     can't be awarded while voting is scheduled or open.
 */
import { createHmac } from 'crypto';
import { AppError } from '../../middleware/error.js';
import { getJwtSecret } from '../../config/secrets.js';
import { normalizeIp } from '../normalizeIp.js';
import { isUuid } from '../guestToken.js';
import { optDate } from './validate.js';
import type { PrizeLike } from './awards.js';

const bad = (msg: string) => new AppError(msg, 400, 'VALIDATION_ERROR');
const iso = (v: Date | null | undefined): string | null => (v ? v.toISOString() : null);

export const VOTING_SCOPES = ['event', 'track'] as const;
export type VotingScope = (typeof VOTING_SCOPES)[number];
export const VOTING_ELIGIBILITY = ['registered', 'checked_in'] as const;
export type VotingEligibility = (typeof VOTING_ELIGIBILITY)[number];
export type VotingStatus = 'off' | 'scheduled' | 'open' | 'closed';

export interface VotingSettings {
  enabled: boolean;
  scope: string;
  eligibility: string;
  opensAt: Date | null;
  closesAt: Date | null;
}

/** Same as the column defaults (no row = these, with enabled false). */
export const DEFAULT_VOTING: VotingSettings = { enabled: false, scope: 'event', eligibility: 'checked_in', opensAt: null, closesAt: null };

// ---------------------------------------------------------------- window

/**
 * 'closed' once closes_at has passed (even if the host later turned voting off: the tally of a
 * closed vote stays visible to the host); otherwise 'off' while disabled / not set up, 'open'
 * inside the window, 'scheduled' before opens_at (or with no opens_at yet).
 */
export function votingStatus(v: VotingSettings | null | undefined, now = new Date()): VotingStatus {
  if (!v) return 'off';
  if (v.closesAt && now.getTime() >= v.closesAt.getTime()) return 'closed';
  if (!v.enabled) return 'off';
  if (v.opensAt && now.getTime() >= v.opensAt.getTime()) return 'open';
  return 'scheduled';
}

/** Tallies (per project) are visible only once the window is closed. */
export const talliesVisible = (status: VotingStatus) => status === 'closed';

/** "Open now": opens_at = now; a past closes_at is cleared (re-opening a closed vote). */
export function manualOpen(v: VotingSettings, now = new Date()): Pick<VotingSettings, 'enabled' | 'opensAt' | 'closesAt'> {
  return { enabled: true, opensAt: now, closesAt: v.closesAt && v.closesAt.getTime() > now.getTime() ? v.closesAt : null };
}

/** "Close now": closes_at = now; an opens_at that isn't before now is cleared (window CHECK). */
export function manualClose(v: VotingSettings, now = new Date()): Pick<VotingSettings, 'opensAt' | 'closesAt'> {
  return { opensAt: v.opensAt && v.opensAt.getTime() < now.getTime() ? v.opensAt : null, closesAt: now };
}

// ---------------------------------------------------------------- input

const has = (b: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(b, k) && b[k] !== undefined;

/**
 * PUT body -> the next settings (merged onto `current`). Throws 400. The scope can't change
 * once any vote exists (`voteCount`), since the votes would mean something else (409).
 */
export function parseVotingSettings(body: Record<string, unknown>, current: VotingSettings, voteCount: number): VotingSettings {
  const next: VotingSettings = { ...current };
  if (has(body, 'enabled')) {
    if (typeof body.enabled !== 'boolean') throw bad('enabled must be true or false');
    next.enabled = body.enabled;
  }
  if (has(body, 'scope')) {
    if (typeof body.scope !== 'string' || !(VOTING_SCOPES as readonly string[]).includes(body.scope)) {
      throw bad(`Voting scope must be one of: ${VOTING_SCOPES.join(', ')}`);
    }
    if (body.scope !== current.scope && voteCount > 0) {
      throw new AppError(
        `${voteCount} vote${voteCount === 1 ? ' has' : 's have'} already been cast, so the voting scope can't change.`,
        409,
        'VOTING_SCOPE_LOCKED',
      );
    }
    next.scope = body.scope;
  }
  if (has(body, 'eligibility')) {
    if (typeof body.eligibility !== 'string' || !(VOTING_ELIGIBILITY as readonly string[]).includes(body.eligibility)) {
      throw bad(`Who can vote must be one of: ${VOTING_ELIGIBILITY.join(', ')}`);
    }
    next.eligibility = body.eligibility;
  }
  if (has(body, 'opensAt')) next.opensAt = optDate(body.opensAt, 'Voting opens');
  if (has(body, 'closesAt')) next.closesAt = optDate(body.closesAt, 'Voting closes');
  if (next.opensAt && next.closesAt && next.closesAt.getTime() <= next.opensAt.getTime()) {
    throw bad('Voting must close after it opens');
  }
  return next;
}

export interface VoteInput {
  projectSlug: string;
  trackId: string | null;
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/** POST / DELETE body. trackId is required in 'track' scope and rejected in 'event' scope. */
export function parseVoteTarget(body: Record<string, unknown>, scope: string, needSlug: boolean): VoteInput {
  let projectSlug = '';
  if (needSlug) {
    if (typeof body.projectSlug !== 'string' || body.projectSlug.length > 120 || !SLUG_RE.test(body.projectSlug)) throw bad('Pick a project');
    projectSlug = body.projectSlug;
  }
  const raw = body.trackId;
  if (scope === 'track') {
    if (!isUuid(raw)) throw bad('Pick the track you are voting in');
    return { projectSlug, trackId: raw };
  }
  if (raw !== undefined && raw !== null && raw !== '') throw bad('This hackathon has one vote for the whole event, not per track');
  return { projectSlug, trackId: null };
}

// ---------------------------------------------------------------- self-vote

export interface MemberIdentity {
  userId: string;
  userEmail: string | null;
  guestEmail: string | null;
}

const low = (e: string | null | undefined) => (typeof e === 'string' ? e.trim().toLowerCase() : '');

/** True when the voter belongs to this team (by user id, or account / RSVP email). */
export function isOwnTeam(members: MemberIdentity[], voter: { userId: string; email: string | null | undefined }): boolean {
  const email = low(voter.email);
  return members.some((m) => m.userId === voter.userId || (!!email && (low(m.userEmail) === email || low(m.guestEmail) === email)));
}

// ---------------------------------------------------------------- ip hash

const IP_HASH_DOMAIN = 'hackathon-vote-ip:v1';

/**
 * 64-hex HMAC-SHA256 of the normalized client IP (IPv6 reduced to its /64), keyed by a
 * domain-separated derivation of the server secret and salted with the hackathon id, so the
 * same IP is unlinkable across hackathons. Never store or return the raw IP.
 */
export function hashVoteIp(hackathonId: string, ip: string | undefined, secret = getJwtSecret()): string {
  const key = createHmac('sha256', secret).update(IP_HASH_DOMAIN).digest();
  return createHmac('sha256', key).update(`${hackathonId}\0${normalizeIp(ip)}`).digest('hex');
}

/**
 * Abuse review: votes per ip_hash bucket, biggest first. Buckets are labelled by an 8-hex
 * prefix (enough to tell them apart, useless to recover an IP). Venue Wi-Fi puts many honest
 * voters behind one IP, so this is a signal for the host, not a block.
 */
export function ipBuckets(rows: Array<{ ipHash: string | null; votes: number }>, limit = 20) {
  const known = rows.filter((r) => !!r.ipHash).sort((a, b) => b.votes - a.votes);
  return {
    buckets: known.slice(0, limit).map((r) => ({ label: (r.ipHash as string).slice(0, 8), votes: r.votes })),
    bucketCount: known.length,
    unknownVotes: rows.filter((r) => !r.ipHash).reduce((n, r) => n + r.votes, 0),
  };
}

// ---------------------------------------------------------------- tally

export interface TallyRow {
  submissionId: string;
  votes: number;
  /** Competition rank among projects with >= 1 vote (1, 1, 3, ...); null with 0 votes. */
  rank: number | null;
  tied: boolean;
}

export interface Tally {
  /** Event scope: the event votes. Track scope: each project's votes summed over its tracks. */
  overall: TallyRow[];
  /** Per track: track-scope votes in that track; event scope: event votes of that track's projects. */
  tracks: Array<{ trackId: string; rows: TallyRow[] }>;
  totalVotes: number;
}

export function rankTally(counts: Map<string, number>, submissionIds: string[]): TallyRow[] {
  const rows = submissionIds.map((id) => ({ submissionId: id, votes: counts.get(id) ?? 0 }));
  rows.sort((a, b) => b.votes - a.votes);
  const freq = new Map<number, number>();
  for (const r of rows) freq.set(r.votes, (freq.get(r.votes) ?? 0) + 1);
  let rank = 0;
  let prev = -1;
  return rows.map((r, i) => {
    if (r.votes !== prev) { rank = i + 1; prev = r.votes; }
    return { ...r, rank: r.votes > 0 ? rank : null, tied: r.votes > 0 && (freq.get(r.votes) ?? 0) > 1 };
  });
}

/**
 * Tally of counted votes (the caller passes only votes for currently `submitted` projects and
 * drops self-votes). `subs` are the submitted projects with their current tracks.
 */
export function buildTally(
  votes: Array<{ submissionId: string; trackId: string | null }>,
  subs: Array<{ id: string; trackIds: string[] }>,
  trackIds: string[],
  scope: string,
): Tally {
  const subIds = new Set(subs.map((s) => s.id));
  const inTrack = new Map(subs.map((s) => [s.id, new Set(s.trackIds)]));
  const overall = new Map<string, number>();
  const perTrack = new Map<string, Map<string, number>>(trackIds.map((t) => [t, new Map()]));
  let total = 0;
  for (const v of votes) {
    if (!subIds.has(v.submissionId)) continue;
    if (scope === 'track') {
      // A vote counts only in its scope's track, and only while the project is still in it.
      if (!v.trackId || !inTrack.get(v.submissionId)?.has(v.trackId)) continue;
      const m = perTrack.get(v.trackId);
      if (!m) continue;
      m.set(v.submissionId, (m.get(v.submissionId) ?? 0) + 1);
    } else {
      if (v.trackId) continue; // stale per-track vote from a scope that can no longer exist
      for (const t of inTrack.get(v.submissionId) ?? []) {
        const m = perTrack.get(t);
        if (m) m.set(v.submissionId, (m.get(v.submissionId) ?? 0) + 1);
      }
    }
    overall.set(v.submissionId, (overall.get(v.submissionId) ?? 0) + 1);
    total++;
  }
  return {
    overall: rankTally(overall, subs.map((s) => s.id)),
    tracks: trackIds.map((t) => ({ trackId: t, rows: rankTally(perTrack.get(t)!, subs.filter((s) => s.trackIds.includes(t)).map((s) => s.id)) })),
    totalVotes: total,
  };
}

/**
 * People's Choice suggestions (the host decides): per scope (overall, or one track), the
 * peoples_choice prizes in (rank, sort order) order take the next `quantity` projects with at
 * least one vote. Same slicing as awards.suggestWinners for judged prizes. Ties keep tally
 * order; the UI shows the tie.
 */
export function suggestPeoplesChoice(prizes: PrizeLike[], tally: Tally): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  const scopes = new Map<string, PrizeLike[]>();
  for (const p of prizes) {
    if (p.kind !== 'peoples_choice') continue;
    const key = p.trackId ?? '';
    (scopes.get(key) ?? scopes.set(key, []).get(key)!).push(p);
  }
  for (const [key, list] of scopes) {
    const rows = (key ? tally.tracks.find((t) => t.trackId === key)?.rows : tally.overall) ?? [];
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

/** A People's Choice prize can't be awarded while voting is scheduled or open (409). */
export function assertPeoplesChoiceAwardable(prize: { kind: string }, status: VotingStatus): void {
  if (prize.kind !== 'peoples_choice') return;
  if (status === 'open' || status === 'scheduled') {
    throw new AppError('Voting decides this prize. Close voting before awarding it.', 409, 'VOTING_NOT_CLOSED');
  }
}

// ---------------------------------------------------------------- serializers

/** What anyone who can see the gallery may know about the vote (never counts). */
export function publicVoting(v: VotingSettings | null, now = new Date()) {
  const status = votingStatus(v, now);
  return {
    status,
    scope: (v?.scope ?? DEFAULT_VOTING.scope) as VotingScope,
    eligibility: (v?.eligibility ?? DEFAULT_VOTING.eligibility) as VotingEligibility,
    opensAt: status === 'off' ? null : iso(v?.opensAt),
    closesAt: status === 'off' ? null : iso(v?.closesAt),
  };
}

/** Host settings form shape. */
export function hostVoting(v: VotingSettings | null, now = new Date()) {
  const s = v ?? DEFAULT_VOTING;
  return {
    enabled: s.enabled,
    scope: s.scope as VotingScope,
    eligibility: s.eligibility as VotingEligibility,
    opensAt: iso(s.opensAt),
    closesAt: iso(s.closesAt),
    status: votingStatus(v, now),
  };
}
