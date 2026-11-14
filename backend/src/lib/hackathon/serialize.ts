/**
 * Hackathon response shapes (plans/hackathon-platform.md §7). Every response goes through one of
 * these builders, which copy fields by explicit allowlist, so a new DB column never leaks by
 * default. PR 2 has two shapes: host (full setup incl. judge emails) and public (published info
 * only: no emails, user ids, judges, judging config or drafts).
 */

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
