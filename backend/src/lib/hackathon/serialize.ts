/**
 * Hackathon response shapes (plans/hackathon-platform.md §7). Every response goes through one of
 * these builders, which copy fields by explicit allowlist, so a new DB column never leaks by
 * default. PR 2 has two shapes: host (full setup incl. judge emails) and public (published info
 * only: no emails, user ids, judges, judging config or drafts).
 */

import { isGalleryOpen } from './galleryRules.js';

type Row = Record<string, any>;

const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(String(v)));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);
const bySort = (a: Row, b: Row) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''));

/** Prisma include used by every hackathon read. */
export const HACKATHON_INCLUDE = {
  tracks: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  prizes: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  criteria: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
  judges: {
    orderBy: { createdAt: 'asc' as const },
    include: { tracks: { select: { trackId: true } } },
  },
};

function publicTrack(t: Row) {
  return { id: t.id, name: t.name, description: t.description ?? null, sponsorName: t.sponsorName ?? null, sortOrder: t.sortOrder ?? 0 };
}

function publicPrize(p: Row) {
  return {
    id: p.id,
    trackId: p.trackId ?? null,
    name: p.name,
    description: p.description ?? null,
    rank: p.rank ?? null,
    amountText: p.amountText ?? null,
    amountValue: num(p.amountValue),
    currency: p.currency ?? null,
    quantity: p.quantity ?? 1,
    kind: p.kind ?? 'judged',
    sortOrder: p.sortOrder ?? 0,
  };
}

function publicCriterion(c: Row) {
  return { id: c.id, name: c.name, description: c.description ?? null, weight: c.weight ?? 1, maxScore: c.maxScore ?? 5, sortOrder: c.sortOrder ?? 0 };
}

/** True when the event page may show the hackathon. */
export function isPubliclyVisible(h: Row | null | undefined): boolean {
  return !!h && !!h.publishedAt && !h.disabledAt;
}

/** Event-page shape. Only call when isPubliclyVisible(h). */
export function publicHackathon(h: Row) {
  return {
    rules: h.rules ?? null,
    submissionsOpenAt: iso(h.submissionsOpenAt),
    submissionDeadline: iso(h.submissionDeadline),
    teamMinSize: h.teamMinSize,
    teamMaxSize: h.teamMaxSize,
    maxTracksPerSubmission: h.maxTracksPerSubmission,
    eligibility: h.eligibility,
    publishedAt: iso(h.publishedAt),
    /** PR 6: the public gallery (/:slug/projects) is open (lib/hackathon/galleryRules.ts). */
    galleryOpen: isGalleryOpen(h as any),
    tracks: [...(h.tracks ?? [])].sort(bySort).map(publicTrack),
    prizes: [...(h.prizes ?? [])].sort(bySort).map(publicPrize),
    criteria: [...(h.criteria ?? [])].sort(bySort).map(publicCriterion),
  };
}

function hostJudge(j: Row) {
  return {
    id: j.id,
    email: j.email,
    name: j.name ?? null,
    status: j.status,
    // Empty = judges every track.
    trackIds: (j.tracks ?? []).map((t: Row) => t.trackId),
    linked: !!j.userId,
    createdAt: iso(j.createdAt),
  };
}

/** Host / co-host (hackathon tab) / admin shape. */
export function hostHackathon(h: Row) {
  return {
    id: h.id,
    partyId: h.partyId,
    enabled: !h.disabledAt,
    disabledAt: iso(h.disabledAt),
    rules: h.rules ?? null,
    submissionsOpenAt: iso(h.submissionsOpenAt),
    submissionDeadline: iso(h.submissionDeadline),
    teamMinSize: h.teamMinSize,
    teamMaxSize: h.teamMaxSize,
    maxTracksPerSubmission: h.maxTracksPerSubmission,
    eligibility: h.eligibility,
    blindJudging: !!h.blindJudging,
    judgingStatus: h.judgingStatus,
    galleryVisibility: h.galleryVisibility,
    galleryOpen: isGalleryOpen(h as any),
    publishedAt: iso(h.publishedAt),
    resultsRevealedAt: iso(h.resultsRevealedAt),
    createdAt: iso(h.createdAt),
    updatedAt: iso(h.updatedAt),
    tracks: [...(h.tracks ?? [])].sort(bySort).map(publicTrack),
    prizes: [...(h.prizes ?? [])].sort(bySort).map(publicPrize),
    criteria: [...(h.criteria ?? [])].sort(bySort).map(publicCriterion),
    judges: (h.judges ?? []).map(hostJudge),
  };
}

export { publicTrack, publicPrize, publicCriterion, hostJudge };

// ---------------------------------------------------------------- teams + submissions (PR 3)
//
// Two viewers, two shapes, both explicit allowlists:
//   - team member (own team): members as name + avatar + role (no emails, user or guest ids),
//     the invite code, and the full submission incl. drafts with signed image URLs.
//   - host: everything above plus member emails + guest ids, for the moderation list / CSV.
// The public gets nothing yet: publicHackathon above never includes teams or submissions, and
// the gallery (PR 6) gets its own shape.

/** Prisma include for a team with members and its (single) submission. */
export const TEAM_INCLUDE = {
  members: {
    orderBy: { joinedAt: 'asc' as const },
    include: {
      user: { select: { name: true, email: true, profilePictureUrl: true } },
      guest: { select: { name: true, email: true } },
    },
  },
  submissions: { include: { tracks: { select: { trackId: true } } } },
};

function displayName(m: Row): string {
  const n = String(m.user?.name || m.guest?.name || '').trim();
  if (n) return n;
  const email = String(m.user?.email || m.guest?.email || '');
  return email.split('@')[0] || 'Member';
}

function teamMember(m: Row, viewerUserId: string | undefined) {
  return {
    id: m.id,
    name: displayName(m),
    avatarUrl: m.user?.profilePictureUrl ?? null,
    role: m.role === 'captain' ? 'captain' : 'member',
    isMe: !!viewerUserId && m.userId === viewerUserId,
    joinedAt: iso(m.joinedAt),
  };
}

function hostMember(m: Row) {
  return {
    ...teamMember(m, undefined),
    email: m.user?.email ?? m.guest?.email ?? null,
    guestId: m.guestId ?? null,
  };
}

/** Every image path a submission references (for one batched signing call). */
export function submissionImagePaths(s: Row | null | undefined): string[] {
  if (!s) return [];
  return [s.coverPath, ...(s.screenshotPaths ?? [])].filter((p): p is string => typeof p === 'string' && !!p);
}

export function teamSubmission(s: Row, urls: Record<string, string>) {
  const img = (path: string) => ({ path, url: urls[path] ?? null });
  return {
    id: s.id,
    name: s.name,
    slug: s.slug,
    tagline: s.tagline ?? null,
    description: s.description ?? null,
    repoUrl: s.repoUrl ?? null,
    demoVideoUrl: s.demoVideoUrl ?? null,
    deckUrl: s.deckUrl ?? null,
    liveUrl: s.liveUrl ?? null,
    trackIds: (s.tracks ?? []).map((t: Row) => t.trackId) as string[],
    cover: s.coverPath ? img(s.coverPath) : null,
    screenshots: (s.screenshotPaths ?? []).map(img),
    status: s.status,
    submittedAt: iso(s.submittedAt),
    disqualifiedReason: s.status === 'disqualified' ? s.disqualifiedReason ?? null : null,
    tableNumber: s.tableNumber ?? null,
    createdAt: iso(s.createdAt),
    updatedAt: iso(s.updatedAt),
  };
}

/** The caller's own team. */
export function myTeam(t: Row, viewerUserId: string | undefined, urls: Record<string, string>) {
  const sub = (t.submissions ?? [])[0];
  return {
    id: t.id,
    name: t.name,
    inviteCode: t.inviteCode,
    memberCount: (t.members ?? []).length,
    members: (t.members ?? []).map((m: Row) => teamMember(m, viewerUserId)) as Array<ReturnType<typeof teamMember>>,
    submission: sub ? teamSubmission(sub, urls) : null,
  };
}

/** Host moderation list row. */
export function hostTeam(t: Row, urls: Record<string, string>) {
  const sub = (t.submissions ?? [])[0];
  return {
    id: t.id,
    name: t.name,
    inviteCode: t.inviteCode,
    createdAt: iso(t.createdAt),
    memberCount: (t.members ?? []).length,
    members: (t.members ?? []).map(hostMember) as Array<ReturnType<typeof hostMember>>,
    submission: sub ? teamSubmission(sub, urls) : null,
  };
}

// ---------------------------------------------------------------- judging (PR 4)
//
// Judge shapes (explicit allowlists). Never: member emails, user / guest ids, other judges'
// scores or comments, the team invite code, drafts or disqualified projects (the queue query
// only loads `submitted`).
//
// Blind judging (hackathons.blind_judging, plans §3.3): the server leaves out
//   - team name, member names and avatars: for as long as the hackathon is blind (they're
//     never needed to score, and showing them after a score would un-blind re-edits);
//   - repo / demo video / deck / live links: until THIS judge has saved a score for the project.
// Project name, tagline, description and screenshots stay (the host UI explains that blinding
// is best-effort).

export interface JudgeViewCtx {
  blind: boolean;
  urls: Record<string, string>;
  /** This judge's own score row for the project, if any. */
  myScore: Row | null;
  /** Current-rubric total for myScore (recomputed so weight edits show immediately). */
  myTotal: number | null;
}

function judgeTeam(s: Row, blind: boolean) {
  if (blind || !s.team) return null;
  return {
    name: s.team.name as string,
    members: (s.team.members ?? []).map((m: Row) => ({ name: displayName(m), avatarUrl: m.user?.profilePictureUrl ?? null })) as Array<{ name: string; avatarUrl: string | null }>,
  };
}

export function judgeQueueItem(s: Row, ctx: JudgeViewCtx) {
  const team = judgeTeam(s, ctx.blind);
  return {
    id: s.id as string,
    name: s.name as string,
    tagline: (s.tagline ?? null) as string | null,
    trackIds: (s.tracks ?? []).map((t: Row) => t.trackId) as string[],
    tableNumber: (s.tableNumber ?? null) as string | null,
    cover: s.coverPath ? { path: s.coverPath as string, url: ctx.urls[s.coverPath] ?? null } : null,
    teamName: team?.name ?? null,
    scored: !!ctx.myScore,
    myTotal: ctx.myScore ? ctx.myTotal : null,
    scoredAt: ctx.myScore ? iso(ctx.myScore.updatedAt) : null,
  };
}

export function judgeSubmission(s: Row, ctx: JudgeViewCtx) {
  const img = (path: string) => ({ path, url: ctx.urls[path] ?? null });
  const linksLocked = ctx.blind && !ctx.myScore;
  return {
    ...judgeQueueItem(s, ctx),
    description: (s.description ?? null) as string | null,
    screenshots: (s.screenshotPaths ?? []).map(img) as Array<{ path: string; url: string | null }>,
    linksLocked,
    links: linksLocked
      ? null
      : { repoUrl: s.repoUrl ?? null, demoVideoUrl: s.demoVideoUrl ?? null, deckUrl: s.deckUrl ?? null, liveUrl: s.liveUrl ?? null },
    team: judgeTeam(s, ctx.blind),
    myScore: ctx.myScore
      ? {
          criterionScores: (ctx.myScore.criterionScores ?? {}) as Record<string, number>,
          total: ctx.myTotal,
          privateComment: (ctx.myScore.privateComment ?? null) as string | null,
          teamFeedback: (ctx.myScore.teamFeedback ?? null) as string | null,
          updatedAt: iso(ctx.myScore.updatedAt),
        }
      : null,
  };
}
