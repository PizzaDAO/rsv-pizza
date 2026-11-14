/**
 * Hackathon host setup (plans/hackathon-platform.md §7, PR 2). Mounted at /api/parties before
 * partyRoutes (like raffle). Every route: requireAuth + host check (canUserEditParty AND the
 * 'hackathon' tab for restricted co-hosts; super admins pass) + a per-user write rate limit.
 * Every write answers with the full host shape (serialize.hostHackathon) so the UI just replaces
 * its state.
 *
 * Delete rules follow the PR 1 FKs (nothing silently deletes participant data):
 *   - track with prizes or project entries -> 409 (prizes.track_id is NO ACTION)
 *   - prize with awards -> 409; criterion once any score exists -> 409
 *   - judge with scores -> soft remove (status 'removed') instead of delete
 *   - hackathon: DELETE = soft disable (disabled_at); ?hard=true only while no submission exists
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { requireHackathonHost } from '../lib/hackathon/access.js';
import { HACKATHON_INCLUDE, hostHackathon } from '../lib/hackathon/serialize.js';
import { hackathonDefaults } from '../lib/hackathon/defaults.js';
import {
  LIMITS,
  parseCriterion,
  parseJudge,
  parsePrize,
  parseSettings,
  parseTrack,
} from '../lib/hackathon/validate.js';

const router = Router();

const writeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => (req as AuthRequest).userId || req.ip || 'anon',
  message: { error: { message: 'Too many changes, try again later.', code: 'RATE_LIMITED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

const conflict = (message: string, code: string) => new AppError(message, 409, code);

/** Host gate for every route below (runs after requireAuth). */
async function hostOnly(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    await requireHackathonHost(req.params.partyId, req.userId, req.userEmail);
    next();
  } catch (e) {
    next(e);
  }
}

const guard = [requireAuth, writeLimiter, hostOnly];

async function getHackathon(partyId: string) {
  const h = await prisma.hackathon.findUnique({ where: { partyId }, select: { id: true } });
  if (!h) throw new AppError('The hackathon app is not enabled for this event', 404, 'HACKATHON_NOT_ENABLED');
  return h;
}

async function respond(res: Response, partyId: string, status = 200, extra: Record<string, unknown> = {}) {
  const h = await prisma.hackathon.findUnique({ where: { partyId }, include: HACKATHON_INCLUDE });
  res.set('Cache-Control', 'private, no-store');
  res.status(status).json({ hackathon: h ? hostHackathon(h) : null, canManage: true, ...extra });
}

function childId(raw: string): string {
  if (!isUuid(raw)) throw new AppError('Not found', 404, 'NOT_FOUND');
  return raw;
}

/** Prisma FK violation (P2003) -> 409 with a host-readable message (race backstop for the prechecks). */
function mapFk(e: any, message: string, code: string): never {
  if (e?.code === 'P2003') throw conflict(message, code);
  throw e;
}

async function nextSort(model: 'hackathonTrack' | 'hackathonPrize' | 'hackathonCriterion', hackathonId: string) {
  const agg = await (prisma[model] as any).aggregate({ where: { hackathonId }, _max: { sortOrder: true } });
  return (agg._max.sortOrder ?? -1) + 1;
}

async function assertCap(model: 'hackathonTrack' | 'hackathonPrize' | 'hackathonCriterion' | 'hackathonJudge', hackathonId: string, cap: number, label: string) {
  const n = await (prisma[model] as any).count({ where: { hackathonId } });
  if (n >= cap) throw new AppError(`You can add at most ${cap} ${label}`, 400, 'LIMIT_REACHED');
}

/** All ids must be tracks of this hackathon (composite FKs would reject them anyway). */
async function assertTracks(hackathonId: string, trackIds: string[]) {
  if (!trackIds.length) return;
  const n = await prisma.hackathonTrack.count({ where: { hackathonId, id: { in: trackIds } } });
  if (n !== trackIds.length) throw new AppError('Unknown track', 400, 'VALIDATION_ERROR');
}

// ---------------------------------------------------------------- enable / disable / settings

// POST /:partyId/hackathon/enable - create the row with defaults, or re-enable a disabled one.
router.post('/:partyId/hackathon/enable', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const existing = await prisma.hackathon.findUnique({ where: { partyId }, select: { id: true, disabledAt: true } });
    if (existing) {
      if (existing.disabledAt) await prisma.hackathon.update({ where: { partyId }, data: { disabledAt: null } });
      return respond(res, partyId);
    }
    const party = await prisma.party.findUnique({ where: { id: partyId }, select: { date: true, endTime: true, duration: true } });
    if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');
    try {
      await prisma.hackathon.create({ data: { partyId, ...hackathonDefaults(party) } });
    } catch (e: any) {
      if (e?.code !== 'P2002') throw e; // concurrent enable: the row exists now, fine
    }
    return respond(res, partyId, 201);
  } catch (error) {
    next(error);
  }
});

// DELETE /:partyId/hackathon - soft disable (hidden everywhere, setup kept).
// ?hard=true deletes the row and its setup, only while no project exists.
router.delete('/:partyId/hackathon', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    if (req.query.hard === 'true') {
      await prisma.$transaction(async (tx) => {
        const subs = await tx.hackathonSubmission.count({ where: { hackathonId: h.id } });
        if (subs > 0) {
          throw conflict(`This hackathon has ${subs} project(s), so it can only be disabled, not deleted.`, 'HACKATHON_HAS_SUBMISSIONS');
        }
        await tx.hackathon.delete({ where: { id: h.id } });
      }).catch((e) => mapFk(e, 'This hackathon has projects, so it can only be disabled, not deleted.', 'HACKATHON_HAS_SUBMISSIONS'));
      return respond(res, partyId);
    }
    await prisma.hackathon.update({ where: { id: h.id }, data: { disabledAt: new Date() } });
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

// PUT /:partyId/hackathon - settings (rules, schedule, team size, eligibility, blind, gallery, publish).
router.put('/:partyId/hackathon', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const current = await prisma.hackathon.findUnique({
      where: { partyId },
      select: { id: true, teamMinSize: true, teamMaxSize: true, submissionsOpenAt: true, submissionDeadline: true, publishedAt: true },
    });
    if (!current) throw new AppError('The hackathon app is not enabled for this event', 404, 'HACKATHON_NOT_ENABLED');
    const data = parseSettings((req.body ?? {}) as Record<string, unknown>, current);
    if (Object.keys(data).length) await prisma.hackathon.update({ where: { id: current.id }, data });
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- tracks

router.post('/:partyId/hackathon/tracks', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    const data = parseTrack(req.body ?? {}, false);
    await assertCap('hackathonTrack', h.id, LIMITS.tracks, 'tracks');
    if (data.sortOrder === undefined) data.sortOrder = await nextSort('hackathonTrack', h.id);
    await prisma.hackathonTrack.create({ data: { ...(data as any), hackathonId: h.id } });
    return respond(res, partyId, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/:partyId/hackathon/tracks/:trackId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.trackId);
    const h = await getHackathon(partyId);
    const data = parseTrack(req.body ?? {}, true);
    const r = await prisma.hackathonTrack.updateMany({ where: { id, hackathonId: h.id }, data });
    if (!r.count) throw new AppError('Track not found', 404, 'NOT_FOUND');
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

router.delete('/:partyId/hackathon/tracks/:trackId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.trackId);
    const h = await getHackathon(partyId);
    const track = await prisma.hackathonTrack.findFirst({ where: { id, hackathonId: h.id }, select: { id: true } });
    if (!track) throw new AppError('Track not found', 404, 'NOT_FOUND');
    const [prizes, entries] = await Promise.all([
      prisma.hackathonPrize.count({ where: { trackId: id } }),
      prisma.hackathonSubmissionTrack.count({ where: { trackId: id } }),
    ]);
    if (prizes > 0) {
      throw conflict(`This track has ${prizes} prize(s). Delete them or move them to another track first.`, 'TRACK_HAS_PRIZES');
    }
    if (entries > 0) {
      throw conflict(`${entries} project(s) entered this track, so it can't be deleted.`, 'TRACK_HAS_SUBMISSIONS');
    }
    await prisma.hackathonTrack.delete({ where: { id } })
      .catch((e) => mapFk(e, 'This track has prizes or projects. Remove them first.', 'TRACK_IN_USE'));
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- prizes

router.post('/:partyId/hackathon/prizes', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    const data = parsePrize(req.body ?? {}, false);
    if (data.trackId) await assertTracks(h.id, [data.trackId as string]);
    await assertCap('hackathonPrize', h.id, LIMITS.prizes, 'prizes');
    if (data.sortOrder === undefined) data.sortOrder = await nextSort('hackathonPrize', h.id);
    await prisma.hackathonPrize.create({ data: { ...(data as any), hackathonId: h.id } });
    return respond(res, partyId, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/:partyId/hackathon/prizes/:prizeId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.prizeId);
    const h = await getHackathon(partyId);
    const data = parsePrize(req.body ?? {}, true);
    if (data.trackId) await assertTracks(h.id, [data.trackId as string]);
    const r = await prisma.hackathonPrize.updateMany({ where: { id, hackathonId: h.id }, data });
    if (!r.count) throw new AppError('Prize not found', 404, 'NOT_FOUND');
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

router.delete('/:partyId/hackathon/prizes/:prizeId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.prizeId);
    const h = await getHackathon(partyId);
    const prize = await prisma.hackathonPrize.findFirst({ where: { id, hackathonId: h.id }, select: { id: true } });
    if (!prize) throw new AppError('Prize not found', 404, 'NOT_FOUND');
    const awards = await prisma.hackathonAward.count({ where: { prizeId: id } });
    if (awards > 0) throw conflict('This prize has been awarded. Remove the award first.', 'PRIZE_AWARDED');
    await prisma.hackathonPrize.delete({ where: { id } })
      .catch((e) => mapFk(e, 'This prize has been awarded. Remove the award first.', 'PRIZE_AWARDED'));
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- rubric criteria

router.post('/:partyId/hackathon/criteria', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    const data = parseCriterion(req.body ?? {}, false);
    await assertCap('hackathonCriterion', h.id, LIMITS.criteria, 'criteria');
    if (data.sortOrder === undefined) data.sortOrder = await nextSort('hackathonCriterion', h.id);
    await prisma.hackathonCriterion.create({ data: { ...(data as any), hackathonId: h.id } });
    return respond(res, partyId, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/:partyId/hackathon/criteria/:criterionId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.criterionId);
    const h = await getHackathon(partyId);
    const data = parseCriterion(req.body ?? {}, true);
    const r = await prisma.hackathonCriterion.updateMany({ where: { id, hackathonId: h.id }, data });
    if (!r.count) throw new AppError('Criterion not found', 404, 'NOT_FOUND');
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

router.delete('/:partyId/hackathon/criteria/:criterionId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.criterionId);
    const h = await getHackathon(partyId);
    const c = await prisma.hackathonCriterion.findFirst({ where: { id, hackathonId: h.id }, select: { id: true } });
    if (!c) throw new AppError('Criterion not found', 404, 'NOT_FOUND');
    const scores = await prisma.hackathonScore.count({ where: { hackathonId: h.id } });
    if (scores > 0) throw conflict('Judges have started scoring, so rubric criteria can no longer be deleted.', 'RUBRIC_LOCKED');
    await prisma.hackathonCriterion.delete({ where: { id } });
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- judges

async function setJudgeTracks(hackathonId: string, judgeId: string, trackIds: string[]) {
  await prisma.$transaction([
    prisma.hackathonJudgeTrack.deleteMany({ where: { judgeId } }),
    ...(trackIds.length
      ? [prisma.hackathonJudgeTrack.createMany({ data: trackIds.map((trackId) => ({ judgeId, trackId, hackathonId })) })]
      : []),
  ]);
}

router.post('/:partyId/hackathon/judges', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    const { data, trackIds } = parseJudge(req.body ?? {}, false);
    if (trackIds) await assertTracks(h.id, trackIds);
    const email = data.email as string;
    const existing = await prisma.hackathonJudge.findUnique({
      where: { hackathonId_email: { hackathonId: h.id, email } },
      select: { id: true, status: true },
    });
    let judgeId: string;
    if (existing) {
      if (existing.status === 'active') throw conflict(`${email} is already a judge`, 'JUDGE_EXISTS');
      // Re-adding a removed judge reactivates them (their scores are kept).
      await prisma.hackathonJudge.update({ where: { id: existing.id }, data: { status: 'active', ...('name' in data ? { name: data.name as string | null } : {}) } });
      judgeId = existing.id;
    } else {
      await assertCap('hackathonJudge', h.id, LIMITS.judges, 'judges');
      const j = await prisma.hackathonJudge
        .create({ data: { hackathonId: h.id, email, name: (data.name as string | null) ?? null, invitedBy: req.userId ?? null } })
        .catch((e: any) => {
          if (e?.code === 'P2002') throw conflict(`${email} is already a judge`, 'JUDGE_EXISTS');
          throw e;
        });
      judgeId = j.id;
    }
    if (trackIds) await setJudgeTracks(h.id, judgeId, trackIds);
    return respond(res, partyId, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/:partyId/hackathon/judges/:judgeId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.judgeId);
    const h = await getHackathon(partyId);
    const { data, trackIds } = parseJudge(req.body ?? {}, true);
    const judge = await prisma.hackathonJudge.findFirst({ where: { id, hackathonId: h.id }, select: { id: true } });
    if (!judge) throw new AppError('Judge not found', 404, 'NOT_FOUND');
    if (trackIds) await assertTracks(h.id, trackIds);
    if (Object.keys(data).length) await prisma.hackathonJudge.update({ where: { id }, data });
    if (trackIds) await setJudgeTracks(h.id, id, trackIds);
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

// DELETE a judge: hard delete while they have no scores, else soft remove (scores stay for the record).
router.delete('/:partyId/hackathon/judges/:judgeId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.judgeId);
    const h = await getHackathon(partyId);
    const judge = await prisma.hackathonJudge.findFirst({ where: { id, hackathonId: h.id }, select: { id: true } });
    if (!judge) throw new AppError('Judge not found', 404, 'NOT_FOUND');
    const scores = await prisma.hackathonScore.count({ where: { judgeId: id } });
    if (scores > 0) {
      await prisma.hackathonJudge.update({ where: { id }, data: { status: 'removed' } });
      return respond(res, partyId, 200, { softRemoved: true });
    }
    await prisma.hackathonJudge.delete({ where: { id } }).catch(async (e: any) => {
      if (e?.code !== 'P2003') throw e;
      await prisma.hackathonJudge.update({ where: { id }, data: { status: 'removed' } });
    });
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

export default router;
