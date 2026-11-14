/**
 * Hackathon host setup (plans/hackathon-platform.md §7, PR 2). Mounted at /api/parties before
 * partyRoutes (like raffle). Every route: requireAuth + host check (canUserEditParty AND the
 * 'hackathon' tab for restricted co-hosts; super admins pass) + a per-user write rate limit.
 * Every write answers with the full host shape (serialize.hostHackathon) so the UI just replaces
 * its state.
 *
 * PR 3 adds the host Teams & Submissions routes at the bottom: GET /submissions (every team,
 * member emails, drafts, signed image URLs), PATCH /submissions/:id (disqualify / restore /
 * table number) and GET /export.csv (formula-injection-safe). Participant routes live in
 * hackathon-participant.routes.ts.
 *
 * PR 4 adds POST /judging {status: open|closed} and GET /leaderboard (host only: rankings,
 * every judge's scores + private comments, judge progress). Judge routes live in
 * hackathon-judge.routes.ts. PR 5: reopening judging while results are revealed -> 409;
 * disqualifying an awarded project -> 409; an awarded prize can't change track or drop below its
 * awarded count; GET /export.csv?kind=awards. Awards / reveal routes: hackathon-awards.routes.ts.
 * Rubric after scoring starts: no add / delete / max-score change
 * (409 RUBRIC_LOCKED); weight changes re-total every score (lib/hackathon/scoring.ts).
 *
 * Delete rules follow the PR 1 FKs (nothing silently deletes participant data):
 *   - track with prizes or project entries -> 409 (prizes.track_id is NO ACTION)
 *   - prize with awards -> 409; criterion once any score exists -> 409
 *   - judge with scores -> soft remove (status 'removed') instead of delete
 *   - hackathon: DELETE = soft disable (disabled_at); ?hard=true only while no submission exists
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { requireHackathonHost } from '../lib/hackathon/access.js';
import { HACKATHON_INCLUDE, TEAM_INCLUDE, hostHackathon, hostTeam, publicCriterion, publicTrack, submissionImagePaths } from '../lib/hackathon/serialize.js';
import { buildLeaderboard, computeTotal, readCriterionScores, type LbScore } from '../lib/hackathon/scoring.js';
import { JUDGE_SUBMISSION_INCLUDE, isConflicted } from '../lib/hackathon/judge.js';
import { hackathonDefaults } from '../lib/hackathon/defaults.js';
import { signImagePaths } from '../lib/hackathon/media.js';
import { toCsv } from '../lib/hackathon/csv.js';
import { AWARD_INCLUDE, AWARDS_CSV_HEADER, awardsCsvRows, hostAward } from '../lib/hackathon/awards.js';
import {
  LIMITS,
  parseCriterion,
  parseJudge,
  parseModeration,
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

/** Active judges whose only scoped track is `trackId` (names or emails, for the 409 message). */
async function judgesScopedOnlyTo(hackathonId: string, trackId: string): Promise<string[]> {
  const judges = await prisma.hackathonJudge.findMany({
    where: { hackathonId, status: 'active', tracks: { some: { trackId } } },
    select: { name: true, email: true, tracks: { select: { trackId: true } } },
  });
  return judges.filter((j) => j.tracks.length === 1).map((j) => j.name || j.email);
}

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
    // A judge scoped to only this track would silently widen to ALL tracks once its
    // hackathon_judge_tracks row cascades away (no rows = all tracks). Make the host decide.
    const onlyTrackJudges = await judgesScopedOnlyTo(h.id, id);
    if (onlyTrackJudges.length) {
      throw conflict(
        `${onlyTrackJudges.join(', ')} only judge${onlyTrackJudges.length === 1 ? 's' : ''} this track. Change their tracks in Judging first.`,
        'TRACK_HAS_JUDGES',
      );
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
    // PR 5: once awarded, a prize can't move tracks or drop below its awarded count.
    if ('trackId' in data || data.quantity !== undefined) {
      const [cur, awarded] = await Promise.all([
        prisma.hackathonPrize.findFirst({ where: { id, hackathonId: h.id }, select: { trackId: true } }),
        prisma.hackathonAward.count({ where: { prizeId: id } }),
      ]);
      if (cur && awarded > 0) {
        if ('trackId' in data && (data.trackId ?? null) !== (cur.trackId ?? null)) {
          throw conflict('This prize has been awarded, so its track can no longer change. Remove the awards first.', 'PRIZE_AWARDED');
        }
        if (data.quantity !== undefined && (data.quantity as number) < awarded) {
          throw conflict(`This prize has been awarded ${awarded} time(s), so its quantity can't go below ${awarded}.`, 'PRIZE_AWARDED');
        }
      }
    }
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

/**
 * Rubric writes vs score writes. A rubric change that depends on "has anyone scored yet?" takes
 * FOR UPDATE on the hackathon row; the judge score write takes FOR SHARE on the same row and
 * re-reads the rubric under it (hackathon-judge.routes.ts). So a first score and a criterion
 * add / max-score change / delete are serialized: whichever commits second sees the other.
 */
async function lockHackathon(tx: any, hackathonId: string) {
  await tx.$queryRaw`SELECT id FROM hackathons WHERE id = ${hackathonId}::uuid FOR UPDATE`;
}

/**
 * Recompute hackathon_scores.total from criterion_scores with the current weights, inside the
 * caller's transaction. One UPDATE ... FROM (VALUES ...) per 500 rows; raw so updated_at (the
 * judge's "scored at") isn't bumped by a host weight edit.
 */
async function retotalScores(tx: any, hackathonId: string) {
  const criteria = await tx.hackathonCriterion.findMany({ where: { hackathonId }, select: { id: true, weight: true, maxScore: true } });
  const scores = await tx.hackathonScore.findMany({ where: { hackathonId }, select: { id: true, criterionScores: true, total: true } });
  const changed = (scores as Array<{ id: string; criterionScores: unknown; total: unknown }>)
    .map((s) => ({ id: s.id, total: computeTotal(readCriterionScores(s.criterionScores), criteria), old: Number(String(s.total)) }))
    .filter((s): s is { id: string; total: number; old: number } => s.total !== null && s.total !== s.old);
  for (let i = 0; i < changed.length; i += 500) {
    const rows = Prisma.join(changed.slice(i, i + 500).map((c) => Prisma.sql`(${c.id}::uuid, ${c.total}::numeric)`));
    await tx.$executeRaw(Prisma.sql`UPDATE hackathon_scores AS s SET total = v.total FROM (VALUES ${rows}) AS v(id, total) WHERE s.id = v.id AND s.hackathon_id = ${hackathonId}::uuid`);
  }
}

const hasScores = async (tx: any, hackathonId: string) => (await tx.hackathonScore.count({ where: { hackathonId } })) > 0;

router.post('/:partyId/hackathon/criteria', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    const data = parseCriterion(req.body ?? {}, false);
    await assertCap('hackathonCriterion', h.id, LIMITS.criteria, 'criteria');
    if (data.sortOrder === undefined) data.sortOrder = await nextSort('hackathonCriterion', h.id);
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, h.id);
      // Adding a criterion after scoring started would leave every existing score incomplete.
      if (await hasScores(tx, h.id)) {
        throw conflict('Judges have started scoring, so criteria can no longer be added. You can still change weights.', 'RUBRIC_LOCKED');
      }
      await tx.hackathonCriterion.create({ data: { ...(data as any), hackathonId: h.id } });
    });
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
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, h.id);
      const current = await tx.hackathonCriterion.findFirst({ where: { id, hackathonId: h.id }, select: { id: true, weight: true, maxScore: true } });
      if (!current) throw new AppError('Criterion not found', 404, 'NOT_FOUND');
      const scored = await hasScores(tx, h.id);
      // Rubric rules once scoring started (lib/hackathon/scoring.ts): max score is locked
      // (existing scores were given on the old scale); weight changes re-total every score in
      // this same transaction, so stored totals never disagree with the weights.
      if (scored && data.maxScore !== undefined && data.maxScore !== current.maxScore) {
        throw conflict('Judges have started scoring, so the max score can no longer change. You can still change the weight.', 'RUBRIC_LOCKED');
      }
      await tx.hackathonCriterion.updateMany({ where: { id, hackathonId: h.id }, data });
      if (scored && data.weight !== undefined && data.weight !== current.weight) await retotalScores(tx, h.id);
    }, { timeout: 20_000 });
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
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, h.id);
      const c = await tx.hackathonCriterion.findFirst({ where: { id, hackathonId: h.id }, select: { id: true } });
      if (!c) throw new AppError('Criterion not found', 404, 'NOT_FOUND');
      if (await hasScores(tx, h.id)) throw conflict('Judges have started scoring, so rubric criteria can no longer be deleted.', 'RUBRIC_LOCKED');
      await tx.hackathonCriterion.delete({ where: { id } });
    });
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

// ---------------------------------------------------------------- teams & submissions (PR 3)
// Reads skip the write limiter (the host list polls every 30s).
const readGuard = [requireAuth, hostOnly];

async function loadHostTeams(hackathonId: string) {
  const teams = await prisma.hackathonTeam.findMany({
    where: { hackathonId },
    include: TEAM_INCLUDE,
    orderBy: { createdAt: 'asc' },
    take: 2000,
  });
  return teams;
}

// GET /:partyId/hackathon/submissions - every team (incl. without a project), members with
// emails, projects in every status (drafts too) with signed image URLs.
router.get('/:partyId/hackathon/submissions', ...readGuard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    const teams = await loadHostTeams(h.id);
    const urls = await signImagePaths(teams.flatMap((t: any) => submissionImagePaths(t.submissions?.[0])));
    const rows = teams.map((t) => hostTeam(t, urls));
    const counts = { teams: rows.length, draft: 0, submitted: 0, withdrawn: 0, disqualified: 0 } as Record<string, number>;
    for (const r of rows) if (r.submission) counts[r.submission.status] = (counts[r.submission.status] ?? 0) + 1;
    res.set('Cache-Control', 'private, no-store');
    res.json({ teams: rows, counts });
  } catch (error) {
    next(error);
  }
});

// PATCH /:partyId/hackathon/submissions/:submissionId - {action: 'disqualify', reason} |
// {action: 'restore'} | {tableNumber}. Restore returns to 'submitted' if it was ever submitted.
router.patch('/:partyId/hackathon/submissions/:submissionId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const id = childId(req.params.submissionId);
    const h = await getHackathon(partyId);
    const sub = await prisma.hackathonSubmission.findFirst({ where: { id, hackathonId: h.id }, select: { id: true, status: true, submittedAt: true } });
    if (!sub) throw new AppError('Project not found', 404, 'NOT_FOUND');
    const m = parseModeration((req.body ?? {}) as Record<string, unknown>);
    const data: Record<string, unknown> = {};
    // Restore must return the exact pre-disqualification status without a new column. The
    // status machine makes that derivable: draft never has submittedAt; submitted always does;
    // withdrawn also does, so withdrawn projects can't be disqualified (they're out of judging
    // anyway). Hence restore = submittedAt ? 'submitted' : 'draft' is exact.
    if (m.action === 'disqualify') {
      if (sub.status === 'withdrawn') {
        throw conflict("A withdrawn project isn't judged, so there's nothing to disqualify.", 'WITHDRAWN');
      }
      // PR 5: a winner must lose its awards first (awards.submission_id is RESTRICT, and the
      // public winners list would otherwise silently drop it).
      if ((await prisma.hackathonAward.count({ where: { submissionId: sub.id } })) > 0) {
        throw conflict('This project has won a prize. Remove its awards in Winners & Payouts before disqualifying it.', 'HAS_AWARDS');
      }
      data.status = 'disqualified';
      data.disqualifiedReason = m.reason;
    } else if (m.action === 'restore') {
      if (sub.status !== 'disqualified') throw conflict('Only a disqualified project can be restored.', 'NOT_DISQUALIFIED');
      data.status = sub.submittedAt ? 'submitted' : 'draft';
      data.disqualifiedReason = null;
    }
    if (m.tableNumber !== undefined) data.tableNumber = m.tableNumber;
    await prisma.hackathonSubmission.update({ where: { id: sub.id }, data });
    const team = await prisma.hackathonTeam.findFirst({ where: { hackathonId: h.id, submissions: { some: { id: sub.id } } }, include: TEAM_INCLUDE });
    const urls = await signImagePaths(submissionImagePaths((team as any)?.submissions?.[0]));
    res.set('Cache-Control', 'private, no-store');
    res.json({ team: team ? hostTeam(team, urls) : null });
  } catch (error) {
    next(error);
  }
});

// GET /:partyId/hackathon/export.csv?kind=projects|members - host CSV (formula-injection safe).
router.get('/:partyId/hackathon/export.csv', ...readGuard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    if (req.query.kind === 'awards') {
      // PR 5: awards + payout tracking (host only; wallet / reference / notes included).
      const [awards, prizes, tracks] = await Promise.all([
        prisma.hackathonAward.findMany({ where: { hackathonId: h.id }, include: AWARD_INCLUDE, orderBy: { awardedAt: 'asc' }, take: 1000 }),
        prisma.hackathonPrize.findMany({ where: { hackathonId: h.id } }),
        prisma.hackathonTrack.findMany({ where: { hackathonId: h.id }, select: { id: true, name: true } }),
      ]);
      const sorted = [...awards].sort((a: any, b: any) => (a.prize?.sortOrder ?? 0) - (b.prize?.sortOrder ?? 0) || (a.place ?? 0) - (b.place ?? 0));
      res.set('Cache-Control', 'private, no-store');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="hackathon-awards.csv"');
      return res.send(toCsv(AWARDS_CSV_HEADER, awardsCsvRows(sorted.map(hostAward), prizes, tracks)));
    }
    const kind = req.query.kind === 'members' ? 'members' : 'projects';
    const [teams, tracks] = await Promise.all([
      loadHostTeams(h.id),
      prisma.hackathonTrack.findMany({ where: { hackathonId: h.id }, select: { id: true, name: true } }),
    ]);
    const trackName = new Map(tracks.map((t) => [t.id, t.name]));
    const rows = teams.map((t) => hostTeam(t, {}));
    let csv: string;
    if (kind === 'members') {
      csv = toCsv(
        ['Team', 'Member', 'Email', 'Role', 'Joined at', 'Project', 'Project status'],
        rows.flatMap((t) => t.members.map((m) => [t.name, m.name, m.email, m.role, m.joinedAt, t.submission?.name ?? '', t.submission?.status ?? ''])),
      );
    } else {
      csv = toCsv(
        ['Project', 'Status', 'Team', 'Members', 'Member emails', 'Tracks', 'Tagline', 'Repo', 'Demo video', 'Deck', 'Live app', 'Table', 'Submitted at', 'Updated at', 'Disqualified reason', 'Description'],
        rows.map((t) => {
          const s = t.submission;
          return [
            s?.name ?? '', s?.status ?? 'no project', t.name,
            t.members.map((m) => m.name), t.members.map((m) => m.email ?? ''),
            (s?.trackIds ?? []).map((id: string) => trackName.get(id) ?? id),
            s?.tagline, s?.repoUrl, s?.demoVideoUrl, s?.deckUrl, s?.liveUrl, s?.tableNumber,
            s?.submittedAt, s?.updatedAt, s?.disqualifiedReason, s?.description,
          ];
        }),
      );
    }
    res.set('Cache-Control', 'private, no-store');
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="hackathon-${kind}.csv"`);
    res.send(csv);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- judging (PR 4)

// POST /:partyId/hackathon/judging {status: 'open' | 'closed'} - judges score only while open.
// Closed -> open again is allowed (the host can reopen to fix a mistake).
router.post('/:partyId/hackathon/judging', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const h = await getHackathon(partyId);
    const status = (req.body ?? {}).status;
    if (status !== 'open' && status !== 'closed') throw new AppError('status must be open or closed', 400, 'VALIDATION_ERROR');
    // PR 5: reveal needs judging closed, so judging can't reopen while results are public.
    // Same hackathon-row lock as reveal (hackathon-awards.routes.ts), so the two serialize.
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, h.id);
      if (status === 'open') {
        const cur = await tx.hackathon.findUnique({ where: { id: h.id }, select: { resultsRevealedAt: true } });
        if (cur?.resultsRevealedAt) throw conflict('Results are revealed. Hide the results before reopening judging.', 'RESULTS_REVEALED');
      }
      await tx.hackathon.update({ where: { id: h.id }, data: { judgingStatus: status } });
    });
    return respond(res, partyId);
  } catch (error) {
    next(error);
  }
});

// GET /:partyId/hackathon/leaderboard - host only. Submitted projects ranked overall and per
// track (mean of judge totals recomputed from criterion_scores with the current rubric),
// per-criterion means, every individual score with private comments + team feedback, and a
// judge progress table. Removed judges' scores are listed but not averaged.
router.get('/:partyId/hackathon/leaderboard', ...readGuard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const hk = await getHackathon(partyId);
    const [h, subs, scores] = await Promise.all([
      prisma.hackathon.findUnique({ where: { id: hk.id }, include: HACKATHON_INCLUDE }),
      prisma.hackathonSubmission.findMany({
        where: { hackathonId: hk.id, status: 'submitted' },
        include: JUDGE_SUBMISSION_INCLUDE,
        orderBy: { submittedAt: 'asc' },
        take: 2000,
      }),
      prisma.hackathonScore.findMany({ where: { hackathonId: hk.id }, take: 50000 }),
    ]);
    if (!h) throw new AppError('The hackathon app is not enabled for this event', 404, 'HACKATHON_NOT_ENABLED');
    const criteria = h.criteria;
    const judges = h.judges as Array<Record<string, any>>;
    const judgeById = new Map(judges.map((j) => [j.id, j]));
    const subIds = new Set(subs.map((s) => s.id));

    const scoresBySub = new Map<string, LbScore[]>();
    const detailBySub = new Map<string, unknown[]>();
    for (const s of scores) {
      if (!subIds.has(s.submissionId)) continue; // drafts / withdrawn / disqualified: not ranked
      const j = judgeById.get(s.judgeId);
      const counted = j?.status === 'active';
      const cs = readCriterionScores(s.criterionScores);
      (scoresBySub.get(s.submissionId) ?? scoresBySub.set(s.submissionId, []).get(s.submissionId)!).push({ judgeId: s.judgeId, criterionScores: cs, counted });
      (detailBySub.get(s.submissionId) ?? detailBySub.set(s.submissionId, []).get(s.submissionId)!).push({
        judgeId: s.judgeId,
        judgeName: j?.name ?? null,
        judgeEmail: j?.email ?? null,
        counted,
        total: computeTotal(cs, criteria),
        criterionScores: cs,
        privateComment: s.privateComment ?? null,
        teamFeedback: s.teamFeedback ?? null,
        updatedAt: s.updatedAt?.toISOString?.() ?? null,
      });
    }

    const lbSubs = subs.map((s) => ({ id: s.id, trackIds: s.tracks.map((t) => t.trackId) }));
    const board = buildLeaderboard(lbSubs, scoresBySub, criteria, h.tracks.map((t) => t.id));
    const projects: Record<string, unknown> = {};
    for (const s of subs) {
      projects[s.id] = {
        id: s.id,
        name: s.name,
        tagline: s.tagline ?? null,
        teamName: s.team?.name ?? null,
        trackIds: s.tracks.map((t) => t.trackId),
        tableNumber: s.tableNumber ?? null,
        scores: detailBySub.get(s.id) ?? [],
      };
    }

    const judgeProgress = judges.map((j) => {
      const tracks: string[] = (j.tracks ?? []).map((t: Record<string, any>) => t.trackId);
      const assigned = subs.filter((s) =>
        (!tracks.length || s.tracks.some((t) => tracks.includes(t.trackId))) && !isConflicted(s as any, j.email));
      // Only scores on projects in the judge's CURRENT assignment (a track change or a new
      // conflict must not make "scored" exceed "assigned").
      const assignedIds = new Set(assigned.map((s) => s.id));
      const mine = scores.filter((x) => x.judgeId === j.id && assignedIds.has(x.submissionId));
      const last = mine.reduce<Date | null>((acc, x) => (!acc || x.updatedAt > acc ? x.updatedAt : acc), null);
      return {
        id: j.id,
        name: j.name ?? null,
        email: j.email,
        status: j.status,
        trackIds: tracks,
        linked: !!j.userId,
        assigned: assigned.length,
        scored: mine.length,
        lastScoredAt: last ? last.toISOString() : null,
      };
    });

    res.set('Cache-Control', 'private, no-store');
    res.json({
      judgingStatus: h.judgingStatus,
      blindJudging: !!h.blindJudging,
      criteria: criteria.map(publicCriterion),
      tracks: h.tracks.map(publicTrack),
      overall: board.overall,
      byTrack: board.tracks,
      projects,
      judges: judgeProgress,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
