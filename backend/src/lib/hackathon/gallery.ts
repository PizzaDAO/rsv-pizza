/**
 * Public project gallery, project pages and the TV display (plans/hackathon-platform.md §7-8,
 * §16 Q9, PR 6). Pure rules + explicit-allowlist serializers (unit-tested in gallery.test.ts)
 * plus the loaders the gallery and display routes share.
 *
 * Gallery visibility (hackathons.gallery_visibility, host setting in Setup). The gallery is
 * OPEN when the hackathon is published, not disabled, and:
 *   - 'hidden'         never;
 *   - 'after_deadline' once submission_deadline has passed (server time), or once results are
 *                      revealed (no deadline set = waits for the reveal);
 *   - 'after_reveal'   once results_revealed_at is set (the default).
 * Projects stay public after the reveal (§16 Q9); un-revealing an 'after_reveal' gallery hides it
 * again, which is the host's call.
 *
 * Who sees what:
 *   - public (anyone who can see the event, helpers/eventVisibility.ts + password rule from the
 *     hackathon public read): the gallery and project pages only while OPEN, and only
 *     `submitted` projects. Never drafts, disqualified or withdrawn projects.
 *   - team member: additionally their OWN project page at any status (preview), never other
 *     teams' projects before the gallery opens.
 *   - host / co-host with the hackathon tab / admin: a preview of the gallery at any time (still
 *     only `submitted` projects, i.e. what the public will see) and any project page.
 * Never: emails, user / guest / member ids, invite codes, scores, comments, judges, payout data,
 * disqualification reasons. Team members are shown by display name + avatar only, and only when
 * hackathon_team_members.show_on_gallery is true and they have a real name (no email fallback).
 * Winner badges only after results_revealed_at.
 */
import { prisma } from '../../config/database.js';
import { isEventHiddenFrom } from '../../helpers/eventVisibility.js';
import { findGuestsByEmail } from './eligibility.js';
import { isFinalPathFor } from './media.js';
import { normalizeProjectUrl } from './urls.js';
import { signImagePathsCached } from './signedUrlCache.js';
import { AWARD_INCLUDE, publicWinners } from './awards.js';

type Row = Record<string, any>;
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : v ? String(v) : null);

export const GALLERY_MAX_PROJECTS = 500;
export const DISPLAY_MAX_PROJECTS = 60;

// ---------------------------------------------------------------- rules (pure, in galleryRules.ts)

export { isGalleryOpen, galleryOpensAfter, type GalleryRuleFields } from './galleryRules.js';
import { isGalleryOpen, galleryOpensAfter } from './galleryRules.js';

/** Only these statuses ever reach a public shape. */
export const PUBLIC_STATUS = 'submitted';

// ---------------------------------------------------------------- serializers

/** Prisma select for gallery submissions (no emails selected at all). */
export const GALLERY_SUBMISSION_SELECT = {
  id: true,
  hackathonId: true,
  name: true,
  slug: true,
  tagline: true,
  description: true,
  repoUrl: true,
  demoVideoUrl: true,
  deckUrl: true,
  liveUrl: true,
  coverPath: true,
  screenshotPaths: true,
  status: true,
  submittedAt: true,
  tableNumber: true,
  tracks: { select: { trackId: true } },
  team: {
    select: {
      name: true,
      members: {
        orderBy: { joinedAt: 'asc' as const },
        select: {
          role: true,
          showOnGallery: true,
          user: { select: { name: true, profilePictureUrl: true } },
          guest: { select: { name: true } },
        },
      },
    },
  },
};

export interface ProjectAward {
  prizeName: string;
  prizeAmount: string | null;
  trackName: string | null;
  place: number | null;
  /** prize quantity > 1 (show the place) */
  multi: boolean;
}

/** Winner rows for the display + badges (only `submitted` projects; prize order, then place). */
export interface GalleryWinner extends ProjectAward {
  projectSlug: string;
  projectName: string;
  projectTagline: string | null;
  teamName: string | null;
  cover: string | null;
}

/** Only image paths that really belong to this submission get signed. */
export function projectImagePaths(s: Row): string[] {
  const own = (p: unknown): p is string => isFinalPathFor(p, s.hackathonId, s.id);
  return [s.coverPath, ...(s.screenshotPaths ?? [])].filter(own);
}

function safeLink(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null;
  try {
    return normalizeProjectUrl(v, 'link'); // stored values are validated on write; re-check anyway
  } catch {
    return null;
  }
}

export function publicMembers(s: Row): Array<{ name: string; avatarUrl: string | null }> {
  const out: Array<{ name: string; avatarUrl: string | null }> = [];
  for (const m of s.team?.members ?? []) {
    if (m.showOnGallery === false) continue;
    const name = String(m.user?.name || m.guest?.name || '').trim();
    if (!name || name.includes('@')) continue; // never an email, never an email-derived name
    const avatar = m.user?.profilePictureUrl;
    out.push({ name, avatarUrl: typeof avatar === 'string' && /^https:\/\//i.test(avatar) ? avatar : null });
  }
  return out;
}

export function projectCard(s: Row, urls: Record<string, string>, awards: ProjectAward[]) {
  const cover = s.coverPath && isFinalPathFor(s.coverPath, s.hackathonId, s.id) ? urls[s.coverPath] ?? null : null;
  return {
    slug: s.slug as string,
    name: s.name as string,
    tagline: (s.tagline ?? null) as string | null,
    trackIds: (s.tracks ?? []).map((t: Row) => t.trackId) as string[],
    cover,
    teamName: (s.team?.name ?? null) as string | null,
    tableNumber: (s.tableNumber ?? null) as string | null,
    awards,
  };
}

export function projectDetail(s: Row, urls: Record<string, string>, awards: ProjectAward[], preview: boolean) {
  const own = (p: unknown): p is string => isFinalPathFor(p, s.hackathonId, s.id);
  return {
    ...projectCard(s, urls, awards),
    description: (s.description ?? null) as string | null,
    links: {
      repoUrl: safeLink(s.repoUrl),
      demoVideoUrl: safeLink(s.demoVideoUrl),
      deckUrl: safeLink(s.deckUrl),
      liveUrl: safeLink(s.liveUrl),
    },
    screenshots: ((s.screenshotPaths ?? []) as unknown[]).filter(own).map((p) => urls[p] ?? null).filter((u): u is string => !!u),
    members: publicMembers(s),
    submittedAt: iso(s.submittedAt),
    /** Only for previews (host, own team): the public only ever sees `submitted`. */
    status: preview ? (s.status as string) : undefined,
  };
}

/**
 * Winner badges + the display's winners list are built from PR 5's public winners serializer
 * (awards.publicWinners: only `submitted` projects, prize order then place, no recipient /
 * payout data), keyed by project slug. `quantities` (prizeId -> quantity) says whether a place
 * is worth showing.
 */
export type PublicWinner = ReturnType<typeof publicWinners>[number];

function toAward(w: PublicWinner, quantities: Map<string, number>): ProjectAward {
  return { prizeName: w.prizeName, prizeAmount: w.prizeAmount, trackName: w.trackName, place: w.place, multi: (quantities.get(w.prizeId) ?? 1) > 1 };
}

/** projectSlug -> awards (prize order, then place). */
export function awardsBySlug(winners: PublicWinner[], quantities: Map<string, number>): Map<string, ProjectAward[]> {
  const out = new Map<string, ProjectAward[]>();
  for (const w of winners) {
    if (!w.projectSlug) continue;
    out.set(w.projectSlug, [...(out.get(w.projectSlug) ?? []), toAward(w, quantities)]);
  }
  return out;
}

export function galleryWinners(winners: PublicWinner[], quantities: Map<string, number>, coverBySlug: Map<string, string | null>): GalleryWinner[] {
  return winners
    .filter((w) => !!w.projectSlug)
    .map((w) => ({
      ...toAward(w, quantities),
      projectSlug: w.projectSlug as string,
      projectName: w.projectName,
      projectTagline: w.projectTagline,
      teamName: w.teamName,
      cover: coverBySlug.get(w.projectSlug as string) ?? null,
    }));
}

/** projectSlug -> position of its best award in the (already ordered) winners list. */
export function awardRank(winners: PublicWinner[]): Map<string, number> {
  const out = new Map<string, number>();
  winners.forEach((w, i) => { if (w.projectSlug && !out.has(w.projectSlug)) out.set(w.projectSlug, i); });
  return out;
}

/** Winners first (best prize first), then name. */
export function sortProjects<T extends { name: string; slug: string }>(items: T[], rank: Map<string, number>): T[] {
  const r = (slug: string) => rank.get(slug) ?? Number.POSITIVE_INFINITY;
  return [...items].sort((a, b) => r(a.slug) - r(b.slug) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------- display config

export const HACKATHON_DISPLAY_MODES = ['auto', 'countdown', 'gallery', 'winners'] as const;
export type HackathonDisplayMode = (typeof HACKATHON_DISPLAY_MODES)[number];

/**
 * contentConfig for a `hackathon` display. Unknown keys are dropped, except the `_`-prefixed
 * screen metadata DisplayForm stores for every type (_physicalWidth, _physicalHeight,
 * _resolution, short strings). Throws a message string on bad input.
 */
export function parseHackathonDisplayConfig(raw: unknown): { mode: HackathonDisplayMode; showQr: boolean } & Record<string, unknown> {
  const c = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const mode = c.mode === undefined || c.mode === null || c.mode === '' ? 'auto' : c.mode;
  if (typeof mode !== 'string' || !(HACKATHON_DISPLAY_MODES as readonly string[]).includes(mode)) {
    throw new Error(`Hackathon display mode must be one of: ${HACKATHON_DISPLAY_MODES.join(', ')}`);
  }
  if (c.showQr !== undefined && typeof c.showQr !== 'boolean') throw new Error('showQr must be true or false');
  const out: { mode: HackathonDisplayMode; showQr: boolean } & Record<string, unknown> = { mode: mode as HackathonDisplayMode, showQr: c.showQr !== false };
  for (const k of ['_physicalWidth', '_physicalHeight', '_resolution']) {
    const v = c[k];
    if (typeof v === 'string' && v.length <= 40) out[k] = v;
    else if (typeof v === 'number' && Number.isFinite(v)) out[k] = v;
  }
  return out;
}

/** The mode a display actually shows right now. */
export function resolveDisplayMode(mode: HackathonDisplayMode, s: { galleryOpen: boolean; revealed: boolean; projectCount: number; winnerCount: number }): 'countdown' | 'gallery' | 'winners' {
  if (mode !== 'auto') return mode;
  if (s.revealed && s.winnerCount > 0) return 'winners';
  if (s.galleryOpen && s.projectCount > 0) return 'gallery';
  return 'countdown';
}

// ---------------------------------------------------------------- loaders

/**
 * Non-host viewer: the event-page gates (pre-launch GPP27 / side) + password protection. Used by
 * the hackathon public read (routes/hackathon-public.routes.ts) and the gallery. A password
 * event needs a logged-in, non-declined guest (exact case-insensitive email match); the password
 * itself is only checked client-side, so there's no unlock proof to accept here.
 */
export async function viewerCanSeeEvent(partyId: string, viewerEmail: string | undefined): Promise<boolean> {
  return (await viewerEventAccess(partyId, viewerEmail)) === 'ok';
}

/**
 * Same check with the reason: 'password' = a password event this viewer isn't a (logged-in,
 * non-declined) guest of, so the UI can say "log in with the email you RSVP'd with". A
 * pre-launch hidden or missing event is just 'hidden' (says nothing about the event).
 */
export async function viewerEventAccess(partyId: string, viewerEmail: string | undefined): Promise<'ok' | 'hidden' | 'password'> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { eventType: true, eventTags: true, date: true, region: true, city: true, password: true },
  });
  if (!party) return 'hidden';
  if (await isEventHiddenFrom(party, viewerEmail)) return 'hidden';
  if (party.password) {
    if (!viewerEmail) return 'password';
    const guests = await findGuestsByEmail(partyId, viewerEmail);
    return guests.some((g) => g.approved !== false) ? 'ok' : 'password';
  }
  return 'ok';
}

/** Hackathon row with what the gallery needs (tracks + prizes for names / order). */
export async function loadGalleryHackathon(partyId: string) {
  return prisma.hackathon.findUnique({
    where: { partyId },
    include: {
      tracks: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
      prizes: { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }] },
    },
  });
}

type LoadedHackathon = NonNullable<Awaited<ReturnType<typeof loadGalleryHackathon>>>;

const publicTrack = (t: Row) => ({ id: t.id as string, name: t.name as string, description: (t.description ?? null) as string | null, sponsorName: (t.sponsorName ?? null) as string | null });

/** PR 5's award rows (AWARD_INCLUDE) for these projects; only queried after the reveal. */
async function loadWinners(h: LoadedHackathon, submissionIds: string[]): Promise<PublicWinner[]> {
  if (!h.resultsRevealedAt || !submissionIds.length) return [];
  const awards = await prisma.hackathonAward.findMany({
    where: { hackathonId: h.id, submissionId: { in: submissionIds } },
    include: AWARD_INCLUDE,
    take: 1000,
  });
  return publicWinners(awards, h.tracks);
}

const quantitiesOf = (h: LoadedHackathon) => new Map(h.prizes.map((p) => [p.id, p.quantity ?? 1]));

/**
 * Submitted projects as cards (+ winners after the reveal). Images are signed only for the
 * projects returned, and only paths under that project's own storage prefix.
 */
export async function buildGallery(h: LoadedHackathon, opts: { limit?: number; withWinners?: boolean; signCovers?: boolean } = {}) {
  const subs = await prisma.hackathonSubmission.findMany({
    where: { hackathonId: h.id, status: PUBLIC_STATUS },
    select: GALLERY_SUBMISSION_SELECT,
    orderBy: [{ submittedAt: 'asc' }, { name: 'asc' }],
    take: GALLERY_MAX_PROJECTS,
  });
  const visible = subs.filter((s) => s.status === PUBLIC_STATUS); // belt and braces
  const winners = await loadWinners(h, visible.map((s) => s.id));
  const bySlug = new Map(visible.map((s) => [s.slug, s as Row]));
  // Winners first, then name; cut to the limit BEFORE signing so only shown covers are signed.
  const ordered = sortProjects(visible, awardRank(winners)).slice(0, opts.limit ?? GALLERY_MAX_PROJECTS);
  const withWinners = !!opts.withWinners && !!h.resultsRevealedAt;
  const winnerSubs = withWinners ? winners.map((w) => bySlug.get(w.projectSlug as string)).filter((s): s is Row => !!s) : [];
  const shown = [...new Set([...ordered, ...winnerSubs])];
  // signCovers: false = nothing is shown with an image (e.g. TV winners while the gallery is
  // closed), so nothing is signed.
  const urls = opts.signCovers === false ? {} : await signImagePathsCached(
    [...new Set(shown.filter((s) => s.coverPath && isFinalPathFor(s.coverPath, s.hackathonId, s.id)).map((s) => s.coverPath as string))],
  );
  const quantities = quantitiesOf(h);
  const badges = awardsBySlug(winners, quantities);
  const coverBySlug = new Map(shown.map((s) => [s.slug as string, projectCard(s, urls, []).cover]));
  return {
    tracks: h.tracks.map(publicTrack),
    projects: ordered.map((s) => projectCard(s, urls, badges.get(s.slug) ?? [])),
    winners: withWinners ? galleryWinners(winners, quantities, coverBySlug) : [],
  };
}

export async function loadProject(h: LoadedHackathon, projectSlug: string) {
  return prisma.hackathonSubmission.findUnique({
    where: { hackathonId_slug: { hackathonId: h.id, slug: projectSlug } },
    select: { ...GALLERY_SUBMISSION_SELECT, teamId: true },
  });
}

export async function buildProject(h: LoadedHackathon, s: Row, preview: boolean) {
  const urls = await signImagePathsCached(projectImagePaths(s));
  const winners = s.status === PUBLIC_STATUS ? await loadWinners(h, [s.id]) : [];
  return projectDetail(s, urls, awardsBySlug(winners, quantitiesOf(h)).get(s.slug) ?? [], preview);
}

export function galleryMeta(h: LoadedHackathon, now = new Date()) {
  return {
    galleryOpen: isGalleryOpen(h, now),
    galleryVisibility: h.galleryVisibility,
    opensAfter: galleryOpensAfter(h),
    submissionDeadline: iso(h.submissionDeadline),
    resultsRevealedAt: iso(h.resultsRevealedAt),
  };
}

/**
 * The `hackathon` block of a TV display (display.routes.ts). Public-serializer data only:
 *   - null when the hackathon isn't published / is disabled, or the event is pre-launch hidden;
 *   - schedule (countdown) whenever published;
 *   - projects only while the gallery is open; winners only after the reveal (winners are
 *     public on the event page after the reveal whatever the gallery setting, PR 5). Winner
 *     covers only when the gallery is open too.
 *   - a password-protected event shows projects / winners only on a display that has its own
 *     password (the host chose who sees that screen); otherwise countdown only.
 */
export async function buildDisplayHackathon(partyId: string, opts: { displayHasPassword: boolean }, now = new Date()) {
  const h = await loadGalleryHackathon(partyId);
  if (!h || !h.publishedAt || h.disabledAt) return null;
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { eventType: true, eventTags: true, date: true, region: true, city: true, password: true },
  });
  if (!party || (await isEventHiddenFrom(party, undefined))) return null;
  const unlocked = !party.password || opts.displayHasPassword;
  const meta = galleryMeta(h, now);
  if (!unlocked) {
    // Password event on a display without its own password: what an anonymous viewer of the
    // event page gets (GET /hackathon -> null), except the countdown target, so the TV can
    // still count down. No tracks, no projects, no winners.
    return {
      locked: true,
      submissionsOpenAt: iso(h.submissionsOpenAt),
      submissionDeadline: meta.submissionDeadline,
      resultsRevealedAt: null,
      galleryOpen: false,
      tracks: [],
      projects: [],
      winners: [],
    };
  }
  const galleryOpen = meta.galleryOpen;
  const revealed = !!h.resultsRevealedAt;
  let projects: ReturnType<typeof projectCard>[] = [];
  let winners: GalleryWinner[] = [];
  if (galleryOpen) {
    const g = await buildGallery(h, { limit: DISPLAY_MAX_PROJECTS, withWinners: revealed });
    projects = g.projects;
    winners = g.winners;
  } else if (revealed) {
    // Gallery closed but results revealed: winners only (public on the event page anyway), no
    // project grid and no covers, so nothing is signed.
    winners = (await buildGallery(h, { limit: 0, withWinners: true, signCovers: false })).winners;
  }
  return {
    locked: false,
    submissionsOpenAt: iso(h.submissionsOpenAt),
    submissionDeadline: meta.submissionDeadline,
    resultsRevealedAt: revealed ? meta.resultsRevealedAt : null,
    galleryOpen,
    tracks: h.tracks.map((t) => ({ id: t.id, name: t.name })),
    projects,
    winners,
  };
}
