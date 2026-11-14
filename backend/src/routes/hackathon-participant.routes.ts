/**
 * Hackathon participant routes (plans/hackathon-platform.md §6-7, §11, PR 3): eligibility, teams,
 * submissions and project images. Mounted at /api/parties before the host router.
 *
 *   GET    /:partyId/hackathon/me                                  eligibility + my team + my project
 *   POST   /:partyId/hackathon/teams                  {name}       create (caller = captain)
 *   POST   /:partyId/hackathon/teams/join             {code}       join by invite code
 *   POST   /:partyId/hackathon/teams/:teamId/leave
 *   PATCH  /:partyId/hackathon/teams/:teamId          {name}       rename (captain / host)
 *   DELETE /:partyId/hackathon/teams/:teamId/members/:memberId     remove (captain / host)
 *   POST   /:partyId/hackathon/teams/:teamId/regenerate-code       (captain / host)
 *   PUT    /:partyId/hackathon/teams/:teamId/submission            upsert draft (member / host)
 *   POST   /:partyId/hackathon/teams/:teamId/submission/submit
 *   POST   /:partyId/hackathon/teams/:teamId/submission/withdraw
 *   POST   /:partyId/hackathon/teams/:teamId/submission/upload-url {mimeType, fileSize, kind}
 *   POST   /:partyId/hackathon/teams/:teamId/submission/images     {path, kind}   attach
 *   DELETE /:partyId/hackathon/teams/:teamId/submission/images     {path}         remove
 *
 * Authz:
 *   - Every route except /me needs a JWT. Non-hosts only reach a published, non-disabled
 *     hackathon (404 otherwise).
 *   - create / join: checkEligibility (approved, confirmed guest of the party; checked in when
 *     eligibility = checked_in; never an active judge), before the deadline.
 *   - team routes: the team must belong to THIS hackathon (404 otherwise, also for a team the
 *     caller isn't on, so ids from another team / party reveal nothing). Hosts (canUserEditParty
 *     + hackathon tab) may act on any team at any time; participants only before the deadline.
 *   - team size: joins lock the team row (SELECT ... FOR UPDATE) and count inside the same
 *     transaction, so two concurrent joins can't overshoot team_max_size; submit needs
 *     team_min_size members. One team per person: UNIQUE (hackathon_id, user_id).
 * Deadlines use server time against submission_deadline; hosts extend it in Setup.
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { optionalAuth, requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { isHackathonHost } from '../lib/hackathon/access.js';
import { checkEligibility } from '../lib/hackathon/eligibility.js';
import { generateInviteCode, normalizeInviteCode, pickSlug, slugify } from '../lib/hackathon/ids.js';
import { normalizeProjectUrl } from '../lib/hackathon/urls.js';
import { parseSubmission, parseTeamName } from '../lib/hackathon/validate.js';
import {
  MAX_SCREENSHOTS,
  createImageUploadUrl,
  finalizeImage,
  isFinalPathFor,
  isTmpPathFor,
  removeImages,
  signImagePaths,
  validateImageRequest,
} from '../lib/hackathon/media.js';
import { TEAM_INCLUDE, hostTeam, myTeam, submissionImagePaths } from '../lib/hackathon/serialize.js';

const router = Router();

const limiterOpts = {
  windowMs: 60 * 60 * 1000,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
} as const;
const byUser = (req: any) => (req as AuthRequest).userId || req.ip || 'anon';

// plans §11: team create/join 10/hr, submission writes 60/hr, upload-url 30/hr per user and per IP.
export const teamJoinLimiter = rateLimit({
  ...limiterOpts,
  max: 10,
  keyGenerator: byUser,
  message: { error: { message: 'Too many team changes, try again later.', code: 'RATE_LIMITED' } },
});
export const teamWriteLimiter = rateLimit({
  ...limiterOpts,
  max: 60,
  keyGenerator: byUser,
  message: { error: { message: 'Too many changes, try again later.', code: 'RATE_LIMITED' } },
});
export const uploadUserLimiter = rateLimit({
  ...limiterOpts,
  max: 30,
  keyGenerator: byUser,
  message: { error: { message: 'Too many uploads, try again later.', code: 'RATE_LIMITED' } },
});
export const uploadIpLimiter = rateLimit({
  ...limiterOpts,
  max: 30,
  keyGenerator: (req) => req.ip || 'anon',
  message: { error: { message: 'Too many uploads, try again later.', code: 'RATE_LIMITED' } },
});

const notFound = (msg = 'Not found') => new AppError(msg, 404, 'NOT_FOUND');
const conflict = (msg: string, code: string) => new AppError(msg, 409, code);
const forbidden = (msg: string, code = 'FORBIDDEN') => new AppError(msg, 403, code);

const H_SELECT = {
  id: true,
  partyId: true,
  publishedAt: true,
  disabledAt: true,
  eligibility: true,
  submissionsOpenAt: true,
  submissionDeadline: true,
  teamMinSize: true,
  teamMaxSize: true,
  maxTracksPerSubmission: true,
} as const;
type H = { id: string; partyId: string; publishedAt: Date | null; disabledAt: Date | null; eligibility: string; submissionsOpenAt: Date | null; submissionDeadline: Date | null; teamMinSize: number; teamMaxSize: number; maxTracksPerSubmission: number };

export function deadlinePassed(h: Pick<H, 'submissionDeadline'>, now = new Date()): boolean {
  return !!h.submissionDeadline && now.getTime() > h.submissionDeadline.getTime();
}

const isLive = (h: H) => !!h.publishedAt && !h.disabledAt;

interface Ctx {
  h: H;
  isHost: boolean;
}

/** Hackathon + host flag. Non-hosts only see a live (published, enabled) hackathon. */
async function loadCtx(req: AuthRequest): Promise<Ctx> {
  const { partyId } = req.params;
  if (!isUuid(partyId)) throw notFound('Party not found');
  const h = (await prisma.hackathon.findUnique({ where: { partyId }, select: H_SELECT })) as H | null;
  if (!h) throw notFound('Hackathon not found');
  const isHost = await isHackathonHost(partyId, req.userId, req.userEmail);
  if (!isHost && !isLive(h)) throw notFound('Hackathon not found');
  return { h, isHost };
}

function assertBeforeDeadline(ctx: Ctx, what = 'make changes') {
  if (!ctx.isHost && deadlinePassed(ctx.h)) {
    throw conflict(`The submission deadline has passed, so you can no longer ${what}.`, 'DEADLINE_PASSED');
  }
}

interface TeamCtx extends Ctx {
  teamId: string;
  member: { id: string; role: string } | null;
}

/**
 * The team must belong to this hackathon, and the caller must be on it (or be a host).
 * Anything else is a 404 so team ids from elsewhere reveal nothing.
 */
async function loadTeamCtx(req: AuthRequest, opts: { captain?: boolean } = {}): Promise<TeamCtx> {
  const ctx = await loadCtx(req);
  const { teamId } = req.params;
  if (!isUuid(teamId)) throw notFound('Team not found');
  const team = await prisma.hackathonTeam.findFirst({ where: { id: teamId, hackathonId: ctx.h.id }, select: { id: true } });
  if (!team) throw notFound('Team not found');
  const member = req.userId
    ? await prisma.hackathonTeamMember.findFirst({
        where: { teamId, hackathonId: ctx.h.id, userId: req.userId },
        select: { id: true, role: true },
      })
    : null;
  if (!member && !ctx.isHost) throw notFound('Team not found');
  if (opts.captain && !ctx.isHost && member?.role !== 'captain') {
    throw forbidden('Only the team captain can do that', 'NOT_CAPTAIN');
  }
  return { ...ctx, teamId, member };
}

async function teamPayload(hackathonId: string, teamId: string, viewer: { userId?: string; isMember: boolean }) {
  const t = await prisma.hackathonTeam.findFirst({ where: { id: teamId, hackathonId }, include: TEAM_INCLUDE });
  if (!t) return null;
  const urls = await signImagePaths(submissionImagePaths((t as any).submissions?.[0]));
  return viewer.isMember ? myTeam(t, viewer.userId, urls) : hostTeam(t, urls);
}

async function sendTeam(res: Response, tc: TeamCtx, userId: string | undefined, status = 200) {
  res.set('Cache-Control', 'private, no-store');
  res.status(status).json({ team: await teamPayload(tc.h.id, tc.teamId, { userId, isMember: !!tc.member }) });
}

/** Row-lock the team for the rest of the transaction (serializes joins / leaves). */
async function lockTeam(tx: any, teamId: string) {
  await tx.$queryRaw`SELECT id FROM hackathon_teams WHERE id = ${teamId}::uuid FOR UPDATE`;
}

const isUniqueOn = (e: any, field: string) =>
  e?.code === 'P2002' && JSON.stringify(e?.meta?.target ?? '').includes(field);

// ---------------------------------------------------------------- me

router.get('/:partyId/hackathon/me', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    if (!isUuid(partyId)) throw notFound('Party not found');
    res.set('Cache-Control', 'private, no-store');
    const h = (await prisma.hackathon.findUnique({ where: { partyId }, select: H_SELECT })) as H | null;
    const now = new Date();
    const base = {
      serverTime: now.toISOString(),
      deadlinePassed: h ? deadlinePassed(h, now) : false,
    };
    if (!req.userId || !req.userEmail) {
      return res.json({ ...base, loggedIn: false, eligibility: { eligible: false, reason: h && isLive(h) ? 'login' : 'not_available' }, isJudge: false, canManage: false, team: null });
    }
    const isHost = await isHackathonHost(partyId, req.userId, req.userEmail);
    if (!h || (!isHost && !isLive(h))) {
      return res.json({ ...base, loggedIn: true, eligibility: { eligible: false, reason: 'not_available' }, isJudge: false, canManage: isHost, team: null });
    }
    const [elig, member] = await Promise.all([
      checkEligibility(partyId, h, req.userEmail),
      prisma.hackathonTeamMember.findFirst({ where: { hackathonId: h.id, userId: req.userId }, select: { teamId: true } }),
    ]);
    const team = member ? await teamPayload(h.id, member.teamId, { userId: req.userId, isMember: true }) : null;
    res.json({
      ...base,
      loggedIn: true,
      eligibility: { eligible: elig.eligible, reason: elig.reason },
      isJudge: elig.isJudge,
      canManage: isHost,
      team,
    });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- create / join

async function requireEligible(req: AuthRequest, ctx: Ctx) {
  const elig = await checkEligibility(ctx.h.partyId, ctx.h, req.userEmail);
  if (!elig.eligible) {
    const msg: Record<string, string> = {
      not_available: 'This hackathon is not open.',
      login: 'Log in to join the hackathon.',
      judge: "Judges can't join teams.",
      no_rsvp: 'RSVP to this event with the email you logged in with to join the hackathon.',
      declined: "Your RSVP wasn't approved, so you can't join the hackathon.",
      pending_approval: 'Your RSVP is waiting for host approval.',
      waitlisted: "You're on the waitlist. You can join once you're off it.",
      not_checked_in: 'Check in at the event to join the hackathon.',
    };
    throw forbidden(msg[elig.reason ?? 'not_available'] ?? 'Not eligible', 'NOT_ELIGIBLE');
  }
  return elig;
}

router.post('/:partyId/hackathon/teams', requireAuth, teamJoinLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadCtx(req);
    if (!isLive(ctx.h)) throw conflict('Publish the hackathon before teams can form.', 'NOT_PUBLISHED');
    assertBeforeDeadline({ ...ctx, isHost: false }, 'create a team');
    const elig = await requireEligible(req, ctx);
    const name = parseTeamName((req.body ?? {}).name);
    const existing = await prisma.hackathonTeamMember.findFirst({ where: { hackathonId: ctx.h.id, userId: req.userId! }, select: { id: true } });
    if (existing) throw conflict("You're already on a team for this hackathon.", 'ALREADY_ON_TEAM');

    let teamId: string | null = null;
    for (let attempt = 0; attempt < 3 && !teamId; attempt++) {
      try {
        teamId = await prisma.$transaction(async (tx) => {
          const t = await tx.hackathonTeam.create({
            data: { hackathonId: ctx.h.id, name, inviteCode: generateInviteCode(), createdByUserId: req.userId! },
            select: { id: true },
          });
          await tx.hackathonTeamMember.create({
            data: { teamId: t.id, hackathonId: ctx.h.id, userId: req.userId!, guestId: elig.guestId, role: 'captain' },
          });
          return t.id;
        });
      } catch (e: any) {
        if (isUniqueOn(e, 'invite_code')) continue; // 50-bit collision: retry with a new code
        if (e?.code === 'P2002') throw conflict("You're already on a team for this hackathon.", 'ALREADY_ON_TEAM');
        throw e;
      }
    }
    if (!teamId) throw new AppError('Could not create the team. Please try again.', 500, 'TEAM_CREATE_FAILED');
    res.set('Cache-Control', 'private, no-store');
    res.status(201).json({ team: await teamPayload(ctx.h.id, teamId, { userId: req.userId, isMember: true }) });
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/teams/join', requireAuth, teamJoinLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadCtx(req);
    if (!isLive(ctx.h)) throw conflict('This hackathon is not open.', 'NOT_PUBLISHED');
    assertBeforeDeadline({ ...ctx, isHost: false }, 'join a team');
    const elig = await requireEligible(req, ctx);
    const code = normalizeInviteCode((req.body ?? {}).code);
    // Never reveal anything about a team on a failed join (same message for bad shape / no match).
    const invalid = () => new AppError("That invite code didn't work. Check the link with your captain.", 404, 'INVALID_CODE');
    if (!code) throw invalid();
    const team = await prisma.hackathonTeam.findFirst({ where: { inviteCode: code, hackathonId: ctx.h.id }, select: { id: true } });
    if (!team) throw invalid();

    await prisma.$transaction(async (tx) => {
      await lockTeam(tx, team.id);
      const mine = await tx.hackathonTeamMember.findFirst({ where: { hackathonId: ctx.h.id, userId: req.userId! }, select: { teamId: true } });
      if (mine) {
        throw conflict(mine.teamId === team.id ? "You're already on this team." : "You're already on a team for this hackathon. Leave it first.", 'ALREADY_ON_TEAM');
      }
      const count = await tx.hackathonTeamMember.count({ where: { teamId: team.id } });
      if (count >= ctx.h.teamMaxSize) throw conflict(`This team is full (${ctx.h.teamMaxSize} max).`, 'TEAM_FULL');
      await tx.hackathonTeamMember.create({
        data: { teamId: team.id, hackathonId: ctx.h.id, userId: req.userId!, guestId: elig.guestId, role: 'member' },
      });
    }).catch((e: any) => {
      if (e?.code === 'P2002') throw conflict("You're already on a team for this hackathon.", 'ALREADY_ON_TEAM');
      throw e;
    });
    res.set('Cache-Control', 'private, no-store');
    res.status(201).json({ team: await teamPayload(ctx.h.id, team.id, { userId: req.userId, isMember: true }) });
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- leave / remove / rename / code

/**
 * Remove one member inside a locked transaction. The captain role passes to the longest-standing
 * member. The last member leaving deletes the team and a draft/withdrawn project; a submitted or
 * disqualified project blocks it (withdraw first / ask the host).
 */
async function removeMember(hackathonId: string, teamId: string, memberId: string): Promise<{ teamDeleted: boolean }> {
  let removedPaths: string[] = [];
  const out = await prisma.$transaction(async (tx) => {
    await lockTeam(tx, teamId);
    const members = await tx.hackathonTeamMember.findMany({
      where: { teamId, hackathonId },
      orderBy: { joinedAt: 'asc' },
      select: { id: true, role: true },
    });
    const target = members.find((m) => m.id === memberId);
    if (!target) throw notFound('Member not found');
    const others = members.filter((m) => m.id !== memberId);
    if (!others.length) {
      const sub = await tx.hackathonSubmission.findFirst({ where: { teamId, hackathonId }, select: { id: true, status: true, coverPath: true, screenshotPaths: true } });
      if (sub?.status === 'submitted') throw conflict('Withdraw your project before the last member leaves the team.', 'TEAM_HAS_SUBMISSION');
      if (sub?.status === 'disqualified') throw conflict("This team's project was disqualified. Ask the host before leaving.", 'TEAM_HAS_SUBMISSION');
      if (sub) {
        removedPaths = submissionImagePaths(sub);
        await tx.hackathonSubmission.delete({ where: { id: sub.id } });
      }
      await tx.hackathonTeam.delete({ where: { id: teamId } });
      return { teamDeleted: true };
    }
    await tx.hackathonTeamMember.delete({ where: { id: memberId } });
    if (target.role === 'captain') {
      await tx.hackathonTeamMember.update({ where: { id: others[0].id }, data: { role: 'captain' } });
    }
    return { teamDeleted: false };
  });
  await removeImages(removedPaths);
  return out;
}

router.post('/:partyId/hackathon/teams/:teamId/leave', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req);
    if (!tc.member) throw notFound('Team not found'); // a host who isn't on the team uses remove
    assertBeforeDeadline({ ...tc, isHost: false }, 'leave your team');
    await removeMember(tc.h.id, tc.teamId, tc.member.id);
    res.set('Cache-Control', 'private, no-store');
    res.json({ team: null });
  } catch (error) {
    next(error);
  }
});

router.delete('/:partyId/hackathon/teams/:teamId/members/:memberId', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req, { captain: true });
    const { memberId } = req.params;
    if (!isUuid(memberId)) throw notFound('Member not found');
    if (tc.member?.id === memberId) throw new AppError('Use "Leave team" to remove yourself.', 400, 'USE_LEAVE');
    assertBeforeDeadline(tc, 'change your team');
    const { teamDeleted } = await removeMember(tc.h.id, tc.teamId, memberId);
    if (teamDeleted) {
      res.set('Cache-Control', 'private, no-store');
      return res.json({ team: null });
    }
    await sendTeam(res, tc, req.userId);
  } catch (error) {
    next(error);
  }
});

router.patch('/:partyId/hackathon/teams/:teamId', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req, { captain: true });
    assertBeforeDeadline(tc, 'rename your team');
    const name = parseTeamName((req.body ?? {}).name);
    await prisma.hackathonTeam.updateMany({ where: { id: tc.teamId, hackathonId: tc.h.id }, data: { name } });
    await sendTeam(res, tc, req.userId);
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/teams/:teamId/regenerate-code', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req, { captain: true });
    for (let attempt = 0; ; attempt++) {
      try {
        await prisma.hackathonTeam.updateMany({ where: { id: tc.teamId, hackathonId: tc.h.id }, data: { inviteCode: generateInviteCode() } });
        break;
      } catch (e: any) {
        if (!isUniqueOn(e, 'invite_code') || attempt >= 2) throw e;
      }
    }
    await sendTeam(res, tc, req.userId);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- submission

async function loadSubmission(hackathonId: string, teamId: string) {
  return prisma.hackathonSubmission.findFirst({
    where: { teamId, hackathonId },
    select: { id: true, name: true, slug: true, status: true, coverPath: true, screenshotPaths: true, submittedAt: true },
  });
}

function assertEditable(tc: TeamCtx, status: string | undefined) {
  if (!tc.isHost && status === 'disqualified') {
    throw forbidden('This project was disqualified. Contact the host.', 'DISQUALIFIED');
  }
}

/** Next free slug for this hackathon (UNIQUE (hackathon_id, slug); the format CHECK always holds). */
async function freeSlug(hackathonId: string, name: string, exceptId?: string): Promise<string> {
  const base = slugify(name);
  const rows = await prisma.hackathonSubmission.findMany({
    where: { hackathonId, slug: { startsWith: base }, ...(exceptId ? { NOT: { id: exceptId } } : {}) },
    select: { slug: true },
    take: 500,
  });
  return pickSlug(base, new Set(rows.map((r) => r.slug)));
}

async function assertTrackChoice(h: H, trackIds: string[]) {
  if (trackIds.length > h.maxTracksPerSubmission) {
    throw new AppError(
      h.maxTracksPerSubmission === 1 ? 'Pick one track.' : `Pick at most ${h.maxTracksPerSubmission} tracks.`,
      400,
      'TOO_MANY_TRACKS',
    );
  }
  if (!trackIds.length) return;
  const n = await prisma.hackathonTrack.count({ where: { hackathonId: h.id, id: { in: trackIds } } });
  if (n !== trackIds.length) throw new AppError('Unknown track', 400, 'VALIDATION_ERROR');
}

router.put('/:partyId/hackathon/teams/:teamId/submission', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req);
    assertBeforeDeadline(tc, 'edit your project');
    const existing = await loadSubmission(tc.h.id, tc.teamId);
    assertEditable(tc, existing?.status);
    const { data, trackIds } = parseSubmission((req.body ?? {}) as Record<string, unknown>, !existing, normalizeProjectUrl);
    if (trackIds) await assertTrackChoice(tc.h, trackIds);

    const setTracks = (tx: any, submissionId: string) =>
      trackIds === undefined
        ? Promise.resolve()
        : tx.hackathonSubmissionTrack.deleteMany({ where: { submissionId } }).then(() =>
            trackIds.length
              ? tx.hackathonSubmissionTrack.createMany({ data: trackIds.map((trackId) => ({ submissionId, trackId, hackathonId: tc.h.id })) })
              : undefined,
          );

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        if (!existing) {
          const slug = await freeSlug(tc.h.id, data.name as string);
          await prisma.$transaction(async (tx) => {
            const s = await tx.hackathonSubmission.create({
              data: { ...(data as any), slug, hackathonId: tc.h.id, teamId: tc.teamId, status: 'draft' },
              select: { id: true },
            });
            await setTracks(tx, s.id);
          });
        } else {
          // The slug follows the name until the project is first submitted, then stays put
          // (the gallery link, PR 6, must not break).
          const renamed = typeof data.name === 'string' && data.name !== existing.name;
          const slug = renamed && !existing.submittedAt ? await freeSlug(tc.h.id, data.name as string, existing.id) : undefined;
          await prisma.$transaction(async (tx) => {
            await tx.hackathonSubmission.update({ where: { id: existing.id }, data: { ...(data as any), ...(slug ? { slug } : {}) } });
            await setTracks(tx, existing.id);
          });
        }
        break;
      } catch (e: any) {
        if (isUniqueOn(e, 'team_id')) throw conflict('Your team already has a project. Reload the page.', 'SUBMISSION_EXISTS');
        if (isUniqueOn(e, 'slug') && attempt < 2) continue; // concurrent same-name create
        throw e;
      }
    }
    await sendTeam(res, tc, req.userId, existing ? 200 : 201);
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/teams/:teamId/submission/submit', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req);
    assertBeforeDeadline(tc, 'submit');
    if (!tc.isHost && tc.h.submissionsOpenAt && Date.now() < tc.h.submissionsOpenAt.getTime()) {
      throw conflict('Submissions are not open yet.', 'NOT_OPEN_YET');
    }
    const sub = await loadSubmission(tc.h.id, tc.teamId);
    if (!sub) throw new AppError('Save your project first.', 400, 'NO_SUBMISSION');
    assertEditable(tc, sub.status);
    if (sub.status === 'disqualified') throw conflict('Restore the project before submitting it.', 'DISQUALIFIED');
    if (sub.status !== 'submitted') {
      const [members, tracks, picked] = await Promise.all([
        prisma.hackathonTeamMember.count({ where: { teamId: tc.teamId } }),
        prisma.hackathonTrack.count({ where: { hackathonId: tc.h.id } }),
        prisma.hackathonSubmissionTrack.count({ where: { submissionId: sub.id } }),
      ]);
      if (members < tc.h.teamMinSize) {
        throw conflict(`Your team needs at least ${tc.h.teamMinSize} members to submit.`, 'TEAM_TOO_SMALL');
      }
      if (tracks > 0 && picked === 0) throw new AppError('Pick a track before submitting.', 400, 'TRACK_REQUIRED');
      await prisma.hackathonSubmission.update({ where: { id: sub.id }, data: { status: 'submitted', submittedAt: new Date() } });
    }
    await sendTeam(res, tc, req.userId);
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/teams/:teamId/submission/withdraw', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req);
    assertBeforeDeadline(tc, 'withdraw');
    const sub = await loadSubmission(tc.h.id, tc.teamId);
    if (!sub) throw notFound('No project yet');
    assertEditable(tc, sub.status);
    if (sub.status !== 'submitted') throw conflict('Only a submitted project can be withdrawn.', 'NOT_SUBMITTED');
    await prisma.hackathonSubmission.update({ where: { id: sub.id }, data: { status: 'withdrawn' } });
    await sendTeam(res, tc, req.userId);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- images

type Kind = 'cover' | 'screenshot';
const parseKind = (v: unknown): Kind => (v === 'cover' ? 'cover' : 'screenshot');

router.post(
  '/:partyId/hackathon/teams/:teamId/submission/upload-url',
  requireAuth,
  uploadIpLimiter,
  uploadUserLimiter,
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const tc = await loadTeamCtx(req);
      assertBeforeDeadline(tc, 'add images');
      const body = (req.body ?? {}) as Record<string, unknown>;
      const ext = validateImageRequest(body.mimeType, body.fileSize);
      const sub = await loadSubmission(tc.h.id, tc.teamId);
      if (!sub) throw new AppError('Save your project before adding images.', 400, 'NO_SUBMISSION');
      assertEditable(tc, sub.status);
      if (parseKind(body.kind) === 'screenshot' && sub.screenshotPaths.length >= MAX_SCREENSHOTS) {
        throw new AppError(`You can add up to ${MAX_SCREENSHOTS} screenshots.`, 400, 'LIMIT_REACHED');
      }
      const out = await createImageUploadUrl(tc.h.id, sub.id, ext);
      res.set('Cache-Control', 'no-store');
      res.json(out);
    } catch (error) {
      next(error);
    }
  },
);

router.post('/:partyId/hackathon/teams/:teamId/submission/images', requireAuth, uploadUserLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req);
    assertBeforeDeadline(tc, 'add images');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = parseKind(body.kind);
    const sub = await loadSubmission(tc.h.id, tc.teamId);
    if (!sub) throw new AppError('Save your project before adding images.', 400, 'NO_SUBMISSION');
    assertEditable(tc, sub.status);
    if (!isTmpPathFor(body.path, tc.h.id, sub.id)) throw new AppError('Invalid upload', 400, 'BAD_PATH');
    if (kind === 'screenshot' && sub.screenshotPaths.length >= MAX_SCREENSHOTS) {
      await removeImages([body.path]);
      throw new AppError(`You can add up to ${MAX_SCREENSHOTS} screenshots.`, 400, 'LIMIT_REACHED');
    }
    const finalPath = await finalizeImage(body.path, tc.h.id, sub.id);
    if (kind === 'cover') {
      await prisma.hackathonSubmission.update({ where: { id: sub.id }, data: { coverPath: finalPath } });
      if (sub.coverPath) await removeImages([sub.coverPath]);
    } else {
      // Conditional append: the cap holds under concurrent attaches (DB CHECK backs it up).
      const n = await prisma.$executeRaw`
        UPDATE hackathon_submissions
           SET screenshot_paths = array_append(screenshot_paths, ${finalPath}), updated_at = now()
         WHERE id = ${sub.id}::uuid AND cardinality(screenshot_paths) < ${MAX_SCREENSHOTS}`;
      if (!n) {
        await removeImages([finalPath]);
        throw new AppError(`You can add up to ${MAX_SCREENSHOTS} screenshots.`, 400, 'LIMIT_REACHED');
      }
    }
    await sendTeam(res, tc, req.userId);
  } catch (error) {
    next(error);
  }
});

router.delete('/:partyId/hackathon/teams/:teamId/submission/images', requireAuth, teamWriteLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const tc = await loadTeamCtx(req);
    assertBeforeDeadline(tc, 'remove images');
    const path = (req.body ?? {}).path;
    const sub = await loadSubmission(tc.h.id, tc.teamId);
    if (!sub) throw notFound('No project yet');
    assertEditable(tc, sub.status);
    if (!isFinalPathFor(path, tc.h.id, sub.id)) throw notFound('Image not found');
    if (sub.coverPath === path) {
      await prisma.hackathonSubmission.update({ where: { id: sub.id }, data: { coverPath: null } });
    } else if (sub.screenshotPaths.includes(path)) {
      await prisma.$executeRaw`
        UPDATE hackathon_submissions
           SET screenshot_paths = array_remove(screenshot_paths, ${path}), updated_at = now()
         WHERE id = ${sub.id}::uuid`;
    } else {
      throw notFound('Image not found');
    }
    await removeImages([path]);
    await sendTeam(res, tc, req.userId);
  } catch (error) {
    next(error);
  }
});

export default router;
