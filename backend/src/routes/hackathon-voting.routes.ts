/**
 * Hackathon public (People's Choice) voting (plans/hackathon-platform.md §3, §7, §11, PR 7).
 * Mounted at /api/parties before the host router. Rules: lib/hackathon/voting.ts. DB access:
 * lib/hackathon/votingStore.ts. Schema: hackathon-2-voting.sql.
 *
 * Voters (login required to vote; the read works logged out so the gallery can say "Log in"):
 *   GET    /:partyId/hackathon/voting           window + scope + who can vote, and for the caller:
 *                                               eligibility, their votes (project slugs), their
 *                                               own team's project slugs. NEVER any counts.
 *   POST   /:partyId/hackathon/votes            {projectSlug, trackId?}  cast or change a vote
 *   DELETE /:partyId/hackathon/votes?trackId=   retract a vote
 *     Writes need: voting open (server time), the gallery open, a `submitted` project, the
 *     caller eligible per the voting setting, the project not their own team's, and in 'track'
 *     scope a track the project entered. 20 writes / hour / user.
 *
 * Host / co-host with the hackathon tab / super admin:
 *   GET    /:partyId/hackathon/voting/host      settings, status, total votes / voters, votes per
 *                                               ip_hash bucket; per-project tallies + People's
 *                                               Choice suggestions ONLY once voting is closed.
 *   PUT    /:partyId/hackathon/voting           {enabled, scope, eligibility, opensAt, closesAt}
 *     (turning voting on switches an 'after_reveal' gallery to 'after_deadline' and answers
 *     with `notice`; see hostWrite)
 *   POST   /:partyId/hackathon/voting/open      open now
 *   POST   /:partyId/hackathon/voting/close     close now
 *   Host writes hold FOR UPDATE on the hackathon row, then FOR UPDATE on the settings row (so
 *   in-flight votes, which hold FOR SHARE on it, commit before the vote count used by the scope
 *   lock), then update it; votes re-check the window under their FOR SHARE, so a vote can't
 *   land after a close commits. Re-opening a closed vote is refused (409
 *   PEOPLES_CHOICE_AWARDED) while a People's Choice award exists.
 *
 * No emails, no realtime (the host view polls every 60s).
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { optionalAuth, requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { isHackathonHost, requireHackathonHost } from '../lib/hackathon/access.js';
import { isGalleryOpen } from '../lib/hackathon/galleryRules.js';
import { viewerCanSeeEvent } from '../lib/hackathon/gallery.js';
import type { IneligibleReason } from '../lib/hackathon/eligibility.js';
import {
  DEFAULT_VOTING,
  buildTally,
  hashVoteIp,
  hostVoting,
  ipBuckets,
  manualClose,
  manualOpen,
  parseVoteTarget,
  parseVotingSettings,
  publicVoting,
  suggestPeoplesChoice,
  talliesVisible,
  votingStatus,
  type VotingSettings,
} from '../lib/hackathon/voting.js';
import * as store from '../lib/hackathon/votingStore.js';

const router = Router();

const userKey = (req: AuthRequest) => (req.userId ? `u:${req.userId}` : `ip:${ipKeyGenerator(req.ip ?? '')}`);

/** §11: votes 20 / hour / user (casting, changing and retracting all count). */
export const voteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => 'hkv:' + userKey(req as AuthRequest),
  message: { error: { message: 'Too many vote changes. Try again later.', code: 'RATE_LIMITED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

/** The public voting-state read (once per gallery / project page view). */
const readLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => 'hkvr:' + userKey(req as AuthRequest),
  message: { error: 'You\'ve been rate limited. Please wait a few minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

const hostWriteLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => 'hkvh:' + userKey(req as AuthRequest),
  message: { error: { message: 'Too many changes, try again later.', code: 'RATE_LIMITED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

const NO_STORE = 'private, no-store';
const conflict = (message: string, code: string) => new AppError(message, 409, code);
const notFound = (message = 'Not found') => new AppError(message, 404, 'NOT_FOUND');

const INELIGIBLE: Record<IneligibleReason, string> = {
  not_available: 'Voting is not open.',
  login: 'Log in to vote.',
  judge: 'Log in with the email you RSVP\'d with to vote.', // not produced for voters (judges may vote)
  no_rsvp: 'Only people who RSVP\'d to this event can vote. Log in with the email you RSVP\'d with.',
  declined: 'Your RSVP wasn\'t approved, so you can\'t vote.',
  pending_approval: 'Your RSVP is waiting for host approval.',
  waitlisted: 'You\'re on the waitlist, so you can\'t vote yet.',
  not_checked_in: 'Voting is for checked-in attendees. Check in at the event first.',
};

const STATUS_CONFLICT: Record<string, [string, string]> = {
  off: ['Voting is not open.', 'VOTING_NOT_OPEN'],
  scheduled: ['Voting hasn\'t opened yet.', 'VOTING_NOT_OPEN'],
  closed: ['Voting has closed.', 'VOTING_CLOSED'],
};

function assertOpen(v: VotingSettings | null, now = new Date()) {
  const status = votingStatus(v, now);
  if (status !== 'open') {
    const [msg, code] = STATUS_CONFLICT[status];
    throw conflict(msg, code);
  }
}

type VH = NonNullable<Awaited<ReturnType<typeof store.loadVotingHackathon>>>;

/** Published, enabled hackathon the caller can see (non-hosts: event gates + password rule). */
async function loadVisible(partyId: string, req: AuthRequest): Promise<{ h: VH; host: boolean } | null> {
  if (!isUuid(partyId)) throw notFound('Party not found');
  const h = await store.loadVotingHackathon(partyId);
  if (!h || !h.publishedAt || h.disabledAt) return null;
  const host = await isHackathonHost(partyId, req.userId, req.userEmail);
  if (!host && !(await viewerCanSeeEvent(partyId, req.userEmail))) return null;
  return { h, host };
}

/** The caller's voting state (no counts). */
async function voterState(partyId: string, h: VH, req: AuthRequest) {
  const v = h.voting ?? null;
  const pub = publicVoting(v);
  const galleryOpen = isGalleryOpen(h);
  const base = { voting: pub, galleryOpen, tracks: h.tracks.map((t) => ({ id: t.id, name: t.name })) };
  if (!req.userId) {
    return { ...base, me: { loggedIn: false, eligible: false, reason: 'login' as IneligibleReason, message: INELIGIBLE.login, votes: [], ownProjectSlugs: [] } };
  }
  const relevant = pub.status === 'open' || pub.status === 'scheduled' || pub.status === 'closed';
  const [elig, teamIds, votes] = await Promise.all([
    relevant ? store.voterEligibility(partyId, h, v?.eligibility ?? DEFAULT_VOTING.eligibility, req.userEmail) : null,
    store.ownTeamIds(h.id, req.userId, req.userEmail),
    relevant ? store.myVotes(h.id, req.userId) : [],
  ]);
  return {
    ...base,
    me: {
      loggedIn: true,
      eligible: !!elig?.eligible,
      reason: elig ? elig.reason : 'not_available',
      message: elig && !elig.eligible && elig.reason ? INELIGIBLE[elig.reason] : null,
      votes,
      ownProjectSlugs: await store.ownProjectSlugs(h.id, teamIds),
    },
  };
}

// ---------------------------------------------------------------- voters

router.get('/:partyId/hackathon/voting', readLimiter, optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    res.set('Cache-Control', NO_STORE);
    const ctx = await loadVisible(req.params.partyId, req);
    if (!ctx) return res.json({ voting: null, galleryOpen: false, tracks: [], me: null });
    res.json({ ...(await voterState(req.params.partyId, ctx.h, req)), canManage: ctx.host });
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/votes', requireAuth, voteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const ctx = await loadVisible(partyId, req);
    if (!ctx) throw notFound('Voting is not available for this event');
    const { h } = ctx;
    const v = h.voting ?? null;
    assertOpen(v);
    if (!isGalleryOpen(h)) throw conflict('The project gallery isn\'t public yet, so voting hasn\'t started.', 'GALLERY_CLOSED');
    const target = parseVoteTarget((req.body ?? {}) as Record<string, unknown>, v!.scope, true);

    const sub = await store.findSubmissionBySlug(h.id, target.projectSlug);
    if (!sub || sub.status !== 'submitted') throw notFound('Project not found');
    if (target.trackId && !sub.trackIds.includes(target.trackId)) {
      throw new AppError('This project isn\'t in that track.', 400, 'WRONG_TRACK');
    }

    const elig = await store.voterEligibility(partyId, h, v!.eligibility, req.userEmail);
    if (!elig.eligible) {
      throw new AppError(INELIGIBLE[elig.reason ?? 'not_available'], 403, 'NOT_ELIGIBLE', { reason: elig.reason });
    }
    const own = await store.ownTeamIds(h.id, req.userId!, req.userEmail);
    if (own.includes(sub.teamId)) throw new AppError('You can\'t vote for your own team\'s project.', 403, 'OWN_PROJECT');

    const ipHash = hashVoteIp(h.id, req.ip);
    const result = await prisma.$transaction(async (tx) => {
      // Re-check the window under the settings row lock (a close waits for us, or we see it).
      const fresh = await store.lockVotingShared(tx, h.id);
      assertOpen(fresh);
      if (fresh!.scope !== v!.scope) throw conflict('The voting setup just changed. Refresh and try again.', 'VOTING_CHANGED');
      return store.upsertVote(tx, { hackathonId: h.id, trackId: target.trackId, submissionId: sub.id, voterUserId: req.userId!, ipHash });
    }, { timeout: 10000, maxWait: 5000 });

    res.set('Cache-Control', NO_STORE);
    res.status(result.changed ? 200 : 201).json({ changed: result.changed, ...(await voterState(partyId, h, req)) });
  } catch (error) {
    next(error);
  }
});

router.delete('/:partyId/hackathon/votes', requireAuth, voteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const ctx = await loadVisible(partyId, req);
    if (!ctx) throw notFound('Voting is not available for this event');
    const { h } = ctx;
    const v = h.voting ?? null;
    assertOpen(v);
    const target = parseVoteTarget({ trackId: typeof req.query.trackId === 'string' ? req.query.trackId : undefined }, v!.scope, false);
    await prisma.$transaction(async (tx) => {
      const fresh = await store.lockVotingShared(tx, h.id);
      assertOpen(fresh);
      await store.deleteVote(tx, h.id, target.trackId, req.userId!);
    }, { timeout: 10000, maxWait: 5000 });
    res.set('Cache-Control', NO_STORE);
    res.json(await voterState(partyId, h, req));
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- host

async function hostOnly(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    await requireHackathonHost(req.params.partyId, req.userId, req.userEmail);
    next();
  } catch (e) {
    next(e);
  }
}

async function hostHackathon(partyId: string): Promise<VH> {
  const h = await store.loadVotingHackathon(partyId);
  if (!h) throw new AppError('The hackathon app is not enabled for this event', 404, 'HACKATHON_NOT_ENABLED');
  return h;
}

/**
 * The host Voting section. Per-project tallies and People's Choice suggestions only once the
 * window is closed (hidden from the host too while scheduled / open).
 */
export async function hostVotingPayload(h: VH, now = new Date()) {
  const v = h.voting ?? null;
  const settings = hostVoting(v, now);
  const [totals, ipRows] = await Promise.all([store.voteTotals(h.id), store.ipBucketRows(h.id)]);
  const pcPrizes = h.prizes.filter((p) => p.kind === 'peoples_choice');
  let results = null;
  if (talliesVisible(settings.status)) {
    const [subs, votes] = await Promise.all([store.submittedProjects(h.id), store.countedVotes(h.id)]);
    const tally = buildTally(votes, subs, h.tracks.map((t) => t.id), v?.scope ?? 'event');
    const byId = new Map(subs.map((s) => [s.id, s]));
    const named = (rows: typeof tally.overall) => rows.map((r) => ({
      ...r,
      name: byId.get(r.submissionId)?.name ?? '',
      slug: byId.get(r.submissionId)?.slug ?? '',
      teamName: byId.get(r.submissionId)?.teamName ?? null,
    }));
    results = {
      countedVotes: tally.totalVotes,
      overall: named(tally.overall),
      byTrack: tally.tracks.map((t) => ({ trackId: t.trackId, rows: named(t.rows) })),
      suggestions: suggestPeoplesChoice(h.prizes, tally),
    };
  }
  return {
    settings,
    galleryOpen: isGalleryOpen(h, now),
    galleryVisibility: h.galleryVisibility,
    resultsRevealedAt: h.resultsRevealedAt ? h.resultsRevealedAt.toISOString() : null,
    tracks: h.tracks.map((t) => ({ id: t.id, name: t.name })),
    peoplesChoicePrizes: pcPrizes.map((p) => ({ id: p.id, name: p.name, trackId: p.trackId, quantity: p.quantity })),
    totals,
    ip: ipBuckets(ipRows),
    results,
  };
}

async function sendHost(res: Response, partyId: string, notice: string | null = null) {
  res.set('Cache-Control', NO_STORE);
  res.json({ ...(await hostVotingPayload(await hostHackathon(partyId))), notice });
}

export const GALLERY_SWITCH_NOTICE = 'Gallery now opens at the submission deadline so attendees can vote before winners are announced.';

router.get('/:partyId/hackathon/voting/host', requireAuth, hostOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await sendHost(res, req.params.partyId);
  } catch (error) {
    next(error);
  }
});

/**
 * Host write: lock the hackathon row, then the settings row, compute the next settings, save.
 * Returns a notice for the host UI, or null.
 *
 * Gallery auto-switch (owner decision): when this write turns voting ON (enabled false / no row
 * -> true) and the gallery is 'after_reveal', the gallery is switched to 'after_deadline' in
 * the same transaction (the hackathon row is already locked FOR UPDATE; lock order stays
 * hackathons -> hackathon_voting), since votes need a visible gallery and People's Choice is
 * awarded before the reveal. 'hidden' and 'after_deadline' are left alone.
 */
async function hostWrite(partyId: string, next: (current: VotingSettings, voteCount: number, now: Date) => VotingSettings): Promise<string | null> {
  const h = await hostHackathon(partyId);
  return prisma.$transaction(async (tx) => {
    await store.lockHackathonRow(tx, h.id);
    // Wait for in-flight votes (they hold FOR SHARE on this row) before counting, so the scope
    // lock can't be raced by a vote that commits after our count.
    await store.lockVotingForUpdate(tx, h.id);
    const current = (await store.loadVoting(h.id, tx)) ?? DEFAULT_VOTING;
    const voteCount = await tx.hackathonVote.count({ where: { hackathonId: h.id } });
    const now = new Date();
    const updated = next(current, voteCount, now);
    // Re-opening a closed vote (open now, or a PUT that moves closes_at) is allowed and hides
    // the tallies again, unless a People's Choice award already exists (owner decision).
    if (votingStatus(current, now) === 'closed' && votingStatus(updated, now) !== 'closed'
      && (await store.peoplesChoiceAwardCount(tx, h.id)) > 0) {
      throw conflict('Remove the People\'s Choice award before reopening voting.', 'PEOPLES_CHOICE_AWARDED');
    }
    await store.saveVoting(tx, h.id, updated);
    if (updated.enabled && !current.enabled) {
      const row = await tx.hackathon.findUnique({ where: { id: h.id }, select: { galleryVisibility: true } });
      if (row?.galleryVisibility === 'after_reveal') {
        await tx.hackathon.update({ where: { id: h.id }, data: { galleryVisibility: 'after_deadline' } });
        return GALLERY_SWITCH_NOTICE;
      }
    }
    return null;
  }, { timeout: 10000, maxWait: 5000 });
}

router.put('/:partyId/hackathon/voting', requireAuth, hostWriteLimiter, hostOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const notice = await hostWrite(req.params.partyId, (cur, count) => parseVotingSettings(body, cur, count));
    await sendHost(res, req.params.partyId, notice);
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/voting/open', requireAuth, hostWriteLimiter, hostOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const notice = await hostWrite(req.params.partyId, (cur, _count, now) => ({ ...cur, ...manualOpen(cur, now) }));
    await sendHost(res, req.params.partyId, notice);
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/voting/close', requireAuth, hostWriteLimiter, hostOnly, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await hostWrite(req.params.partyId, (cur, _count, now) => {
      if (votingStatus(cur, now) === 'closed') return cur; // idempotent
      return { ...cur, ...manualClose(cur, now) };
    });
    await sendHost(res, req.params.partyId);
  } catch (error) {
    next(error);
  }
});

export default router;
