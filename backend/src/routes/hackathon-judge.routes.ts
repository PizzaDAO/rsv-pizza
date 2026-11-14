/**
 * Hackathon judge routes (plans/hackathon-platform.md §6-7, PR 4). Mounted at /api/hackathon-judge.
 *
 *   GET /:partyId/queue                              rubric, judging status, my projects (unscored first)
 *   GET /:partyId/submissions/:submissionId          one project + my score
 *   PUT /:partyId/submissions/:submissionId/score    {scores: {criterionId: 1..max}, privateComment?, teamFeedback?}
 *
 * Authz (every route needs a JWT):
 *   - bad party id, no hackathon, or a disabled hackathon -> 404;
 *   - the caller's email (lower(email) = lower($1)) must match an ACTIVE judge of THIS
 *     hackathon -> otherwise 403 NOT_A_JUDGE (removed judges: 403 JUDGE_REMOVED). A judge of
 *     another hackathon is not a judge here. Hosts are not judges unless added as one.
 *   - a project outside the judge's scope (not submitted, disqualified, withdrawn, draft, other
 *     hackathon, outside the judge's tracks) -> 404, same as a missing id;
 *   - a project of a team the judge is on (by account or RSVP email) -> 403 CONFLICT_OF_INTEREST
 *     (and it's left out of the queue);
 *   - scoring only while judging_status = 'open' -> 409 JUDGING_NOT_OPEN / JUDGING_CLOSED.
 * Blind judging is enforced in the response shape (serialize.judgeSubmission).
 * The queue is polled (60s, visibility-aware); authenticated polls skip the global per-IP
 * limiter (lib/hackathon/pollLimit.ts). Score writes: 300/hr per judge (plans §11).
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { signImagePaths } from '../lib/hackathon/media.js';
import { judgeQueueItem, judgeSubmission, publicCriterion, publicTrack, submissionImagePaths } from '../lib/hackathon/serialize.js';
import { computeTotal, parseScoreInput, readCriterionScores, type CriterionLike } from '../lib/hackathon/scoring.js';
import {
  JUDGE_SUBMISSION_INCLUDE,
  findJudgeByEmail,
  isConflicted,
  judgeScopeWhere,
  judgeTrackIds,
  linkJudgeUser,
} from '../lib/hackathon/judge.js';

const router = Router();

export const judgeScoreLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 300,
  keyGenerator: (req) => (req as AuthRequest).userId || req.ip || 'anon',
  message: { error: { message: 'Too many score saves, try again later.', code: 'RATE_LIMITED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

const notFound = (msg = 'Not found') => new AppError(msg, 404, 'NOT_FOUND');

interface JudgeCtx {
  h: { id: string; blindJudging: boolean; judgingStatus: string };
  criteria: Array<CriterionLike & { name: string; description: string | null; sortOrder: number }>;
  tracks: Array<Record<string, any>>;
  judge: { id: string; name: string | null; trackIds: string[] };
  email: string;
}

async function loadJudgeCtx(req: AuthRequest): Promise<JudgeCtx> {
  const { partyId } = req.params;
  if (!isUuid(partyId)) throw notFound('Event not found');
  const h = await prisma.hackathon.findUnique({
    where: { partyId },
    select: {
      id: true,
      blindJudging: true,
      judgingStatus: true,
      disabledAt: true,
      criteria: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
      tracks: { orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] },
    },
  });
  if (!h || h.disabledAt) throw notFound('This event has no hackathon');
  const email = req.userEmail;
  if (!email || !req.userId) throw new AppError('Log in to judge', 401, 'UNAUTHORIZED');
  const judge = await findJudgeByEmail(h.id, email);
  if (!judge) {
    throw new AppError(`${email} isn't on the judge list for this hackathon. Log in with the email the host added.`, 403, 'NOT_A_JUDGE');
  }
  if (judge.status !== 'active') throw new AppError("You're no longer a judge for this hackathon.", 403, 'JUDGE_REMOVED');
  await linkJudgeUser(judge, req.userId);
  const trackIds = await judgeTrackIds(judge.id);
  return {
    h: { id: h.id, blindJudging: !!h.blindJudging, judgingStatus: h.judgingStatus },
    criteria: h.criteria as JudgeCtx['criteria'],
    tracks: h.tracks,
    judge: { id: judge.id, name: judge.name, trackIds },
    email,
  };
}

/** One in-scope, non-conflicted project, else 404 / 403. */
async function loadScopedSubmission(ctx: JudgeCtx, rawId: string) {
  if (!isUuid(rawId)) throw notFound('Project not found');
  const sub = await prisma.hackathonSubmission.findFirst({
    where: { id: rawId, ...judgeScopeWhere(ctx.h.id, ctx.judge.trackIds) },
    include: JUDGE_SUBMISSION_INCLUDE,
  });
  if (!sub) throw notFound('Project not found');
  if (isConflicted(sub as any, ctx.email)) {
    throw new AppError("You're on this project's team, so you can't judge it.", 403, 'CONFLICT_OF_INTEREST');
  }
  return sub;
}

function assertOpen(status: string) {
  if (status === 'open') return;
  throw status === 'closed'
    ? new AppError('Judging is closed, so scores can no longer be changed.', 409, 'JUDGING_CLOSED')
    : new AppError("Judging hasn't opened yet. The host opens it when demos start.", 409, 'JUDGING_NOT_OPEN');
}

function totalFor(score: Record<string, any> | null, criteria: CriterionLike[]): number | null {
  return score ? computeTotal(readCriterionScores(score.criterionScores), criteria) : null;
}

async function sendDetail(res: Response, ctx: JudgeCtx, sub: Record<string, any>) {
  const myScore = await prisma.hackathonScore.findFirst({ where: { judgeId: ctx.judge.id, submissionId: sub.id, hackathonId: ctx.h.id } });
  const urls = await signImagePaths(submissionImagePaths(sub));
  res.set('Cache-Control', 'private, no-store');
  res.json({
    judgingStatus: ctx.h.judgingStatus,
    blindJudging: ctx.h.blindJudging,
    submission: judgeSubmission(sub, { blind: ctx.h.blindJudging, urls, myScore, myTotal: totalFor(myScore, ctx.criteria) }),
  });
}

// GET /:partyId/queue
router.get('/:partyId/queue', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadJudgeCtx(req);
    const [subs, scores] = await Promise.all([
      prisma.hackathonSubmission.findMany({
        where: judgeScopeWhere(ctx.h.id, ctx.judge.trackIds),
        include: JUDGE_SUBMISSION_INCLUDE,
        orderBy: { submittedAt: 'asc' },
        take: 2000,
      }),
      prisma.hackathonScore.findMany({ where: { judgeId: ctx.judge.id, hackathonId: ctx.h.id } }),
    ]);
    const mine = new Map(scores.map((s) => [s.submissionId, s]));
    const visible = subs.filter((s) => !isConflicted(s as any, ctx.email));
    // Covers only (screenshots are signed per project in the detail read).
    const urls = await signImagePaths(visible.map((s) => s.coverPath).filter((p): p is string => !!p));
    const queue = visible
      .map((s) => {
        const myScore = mine.get(s.id) ?? null;
        return judgeQueueItem(s, { blind: ctx.h.blindJudging, urls, myScore, myTotal: totalFor(myScore, ctx.criteria) });
      })
      .sort((a, b) => Number(a.scored) - Number(b.scored)
        || String(a.tableNumber ?? '￿').localeCompare(String(b.tableNumber ?? '￿'), undefined, { numeric: true })
        || a.name.localeCompare(b.name));
    const inScope = ctx.judge.trackIds.length ? ctx.tracks.filter((t) => ctx.judge.trackIds.includes(t.id)) : ctx.tracks;
    res.set('Cache-Control', 'private, no-store');
    res.json({
      judge: { name: ctx.judge.name, trackIds: ctx.judge.trackIds },
      judgingStatus: ctx.h.judgingStatus,
      blindJudging: ctx.h.blindJudging,
      criteria: ctx.criteria.map(publicCriterion),
      tracks: inScope.map(publicTrack),
      queue,
      progress: { scored: queue.filter((q) => q.scored).length, total: queue.length },
    });
  } catch (error) {
    next(error);
  }
});

// GET /:partyId/submissions/:submissionId
router.get('/:partyId/submissions/:submissionId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadJudgeCtx(req);
    const sub = await loadScopedSubmission(ctx, req.params.submissionId);
    await sendDetail(res, ctx, sub);
  } catch (error) {
    next(error);
  }
});

// PUT /:partyId/submissions/:submissionId/score - create or replace my score.
router.put('/:partyId/submissions/:submissionId/score', requireAuth, judgeScoreLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const ctx = await loadJudgeCtx(req);
    const sub = await loadScopedSubmission(ctx, req.params.submissionId);
    assertOpen(ctx.h.judgingStatus);
    const body = (req.body ?? {}) as Record<string, unknown>;
    // Fail fast on a malformed body before taking any lock (re-validated under the lock below).
    parseScoreInput(body, ctx.criteria);
    await prisma.$transaction(async (tx: any) => {
      // Everything the write depends on is re-checked here under row locks, so it can't race:
      //   - hackathons FOR SHARE: "close judging" and rubric edits (which take FOR UPDATE on
      //     the same row, hackathon.routes.ts lockHackathon) wait for this write, and a write
      //     that starts after them sees the new status / rubric;
      //   - the judge row FOR SHARE: a concurrent removal waits; a removed judge can't write;
      //   - the submission row FOR SHARE: a concurrent disqualify / withdraw waits; a project
      //     that is no longer `submitted` (or left the judge's tracks) is a 404.
      const hk = await tx.$queryRaw`SELECT judging_status FROM hackathons WHERE id = ${ctx.h.id}::uuid FOR SHARE`;
      assertOpen(Array.isArray(hk) && hk[0] ? hk[0].judging_status : 'closed');
      const jr = await tx.$queryRaw`SELECT status FROM hackathon_judges WHERE id = ${ctx.judge.id}::uuid AND hackathon_id = ${ctx.h.id}::uuid FOR SHARE`;
      if (!Array.isArray(jr) || jr[0]?.status !== 'active') throw new AppError("You're no longer a judge for this hackathon.", 403, 'JUDGE_REMOVED');
      const sr = await tx.$queryRaw`SELECT status FROM hackathon_submissions WHERE id = ${sub.id}::uuid AND hackathon_id = ${ctx.h.id}::uuid FOR SHARE`;
      if (!Array.isArray(sr) || sr[0]?.status !== 'submitted') throw notFound('Project not found');
      const inScope = await tx.hackathonSubmission.findFirst({
        where: { id: sub.id, ...judgeScopeWhere(ctx.h.id, await judgeTrackIds(ctx.judge.id, tx)) },
        select: { id: true },
      });
      if (!inScope) throw notFound('Project not found');
      const criteria = await tx.hackathonCriterion.findMany({
        where: { hackathonId: ctx.h.id },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      });
      const input = parseScoreInput(body, criteria);
      const data = {
        criterionScores: input.criterionScores,
        total: input.total,
        privateComment: input.privateComment,
        teamFeedback: input.teamFeedback,
      };
      await tx.hackathonScore.upsert({
        where: { judgeId_submissionId: { judgeId: ctx.judge.id, submissionId: sub.id } },
        create: { ...data, hackathonId: ctx.h.id, judgeId: ctx.judge.id, submissionId: sub.id },
        update: data,
      });
    });
    await sendDetail(res, ctx, sub);
  } catch (error) {
    next(error);
  }
});

export default router;
