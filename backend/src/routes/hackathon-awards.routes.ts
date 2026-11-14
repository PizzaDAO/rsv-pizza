/**
 * Hackathon winners, reveal and payout tracking (plans/hackathon-platform.md §4, §7, §16 Q4,
 * PR 5). Mounted at /api/parties next to the host router. Host only (requireAuth +
 * canUserEditParty + the 'hackathon' tab; super admins pass), like every host route.
 *
 *   GET    /:partyId/hackathon/awards                       awards + candidates + leaderboard suggestions
 *   POST   /:partyId/hackathon/awards       {prizeId, submissionId, place?}
 *   PATCH  /:partyId/hackathon/awards/:awardId/payout       {status, recipientMemberId, recipientWallet,
 *                                                            payoutReference, paidAt, payoutNotes}
 *   DELETE /:partyId/hackathon/awards/:awardId              409 once a payout is recorded
 *   POST   /:partyId/hackathon/reveal                       needs judging closed + >= 1 award
 *   POST   /:partyId/hackathon/unreveal                     only while no award is paid
 * (CSV: GET /:partyId/hackathon/export.csv?kind=awards in hackathon.routes.ts.)
 *
 * Every write runs in a transaction holding FOR UPDATE on the hackathon row (as the PR 4
 * rubric writes do), so prize quantity checks, award deletes, payout writes, reveal /
 * un-reveal and the judging toggle are serialized: two hosts can't overfill a prize, and
 * "mark paid" can't race "un-reveal".
 *
 * Payout: moving to pending / paid needs a recipient who is a current member of the winning
 * team (409 RECIPIENT_NOT_MEMBER).
 *
 * Award rules (lib/hackathon/awards.ts): only `submitted` projects; a track prize only to a
 * project in that track; at most `quantity` awards per prize; one award per (prize, project).
 * People's Choice prizes (PR 7): once public voting is closed, the vote tally suggests the winner(s)
 * (suggestions + `voting.ranking`); the host still awards them here. They can't be awarded
 * while voting is scheduled or open (409 VOTING_NOT_CLOSED). With voting never set up they are
 * awarded by hand, as before.
 * Tracking only: no money moves, no tax forms / KYC (§16 Q4).
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { requireHackathonHost } from '../lib/hackathon/access.js';
import { HACKATHON_INCLUDE, hostHackathon, publicPrize, publicTrack } from '../lib/hackathon/serialize.js';
import { buildLeaderboard, readCriterionScores, type LbScore } from '../lib/hackathon/scoring.js';
import {
  AWARD_INCLUDE,
  assertAwardable,
  assertCanReveal,
  assertCanUnreveal,
  hasRecordedPayout,
  hostAward,
  parseAwardCreate,
  parsePayout,
  payoutData,
  pickPlace,
  suggestWinners,
} from '../lib/hackathon/awards.js';
import { assertPeoplesChoiceAwardable, buildTally, suggestPeoplesChoice, talliesVisible, votingStatus } from '../lib/hackathon/voting.js';
import { countedVotes, loadVoting } from '../lib/hackathon/votingStore.js';

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
const notFound = (message = 'Not found') => new AppError(message, 404, 'NOT_FOUND');

async function hostOnly(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    await requireHackathonHost(req.params.partyId, req.userId, req.userEmail);
    next();
  } catch (e) {
    next(e);
  }
}

const guard = [requireAuth, writeLimiter, hostOnly];
const readGuard = [requireAuth, hostOnly];

async function getHackathonId(partyId: string): Promise<string> {
  const h = await prisma.hackathon.findUnique({ where: { partyId }, select: { id: true } });
  if (!h) throw new AppError('The hackathon app is not enabled for this event', 404, 'HACKATHON_NOT_ENABLED');
  return h.id;
}

function childId(raw: string): string {
  if (!isUuid(raw)) throw notFound();
  return raw;
}

/** Row-lock the hackathon for the rest of the transaction (see the header). */
async function lockHackathon(tx: any, hackathonId: string) {
  await tx.$queryRaw`SELECT id FROM hackathons WHERE id = ${hackathonId}::uuid FOR UPDATE`;
}

/** Submitted projects with tracks + team members (the award candidates). */
const CANDIDATE_INCLUDE = {
  tracks: { select: { trackId: true } },
  team: {
    select: {
      id: true,
      name: true,
      members: {
        orderBy: { joinedAt: 'asc' as const },
        select: { id: true, role: true, userId: true, user: { select: { name: true, email: true } } },
      },
    },
  },
};

const memberName = (m: any): string => String(m.user?.name || '').trim() || String(m.user?.email || '').split('@')[0] || 'Member';

/** Everything the Winners & Payouts section needs, in one shape (every write answers with it). */
async function awardsPayload(hackathonId: string) {
  const [h, awards, subs, scores, voting] = await Promise.all([
    prisma.hackathon.findUnique({ where: { id: hackathonId }, include: HACKATHON_INCLUDE }),
    prisma.hackathonAward.findMany({ where: { hackathonId }, include: AWARD_INCLUDE, orderBy: [{ awardedAt: 'asc' }], take: 1000 }),
    prisma.hackathonSubmission.findMany({
      where: { hackathonId, status: 'submitted' },
      include: CANDIDATE_INCLUDE,
      orderBy: { submittedAt: 'asc' },
      take: 2000,
    }),
    prisma.hackathonScore.findMany({
      where: { hackathonId },
      select: { judgeId: true, submissionId: true, criterionScores: true },
      take: 50000,
    }),
    loadVoting(hackathonId),
  ]);
  if (!h) throw new AppError('The hackathon app is not enabled for this event', 404, 'HACKATHON_NOT_ENABLED');

  // Leaderboard (same math as GET /leaderboard): active judges' scores on submitted projects.
  const active = new Set((h.judges as any[]).filter((j) => j.status === 'active').map((j) => j.id));
  const subIds = new Set(subs.map((s) => s.id));
  const bySub = new Map<string, LbScore[]>();
  for (const s of scores) {
    if (!subIds.has(s.submissionId)) continue;
    (bySub.get(s.submissionId) ?? bySub.set(s.submissionId, []).get(s.submissionId)!).push({
      judgeId: s.judgeId,
      criterionScores: readCriterionScores(s.criterionScores),
      counted: active.has(s.judgeId),
    });
  }
  const board = buildLeaderboard(
    subs.map((s) => ({ id: s.id, trackIds: s.tracks.map((t) => t.trackId) })),
    bySub,
    h.criteria,
    h.tracks.map((t) => t.id),
  );
  const slim = (rows: typeof board.overall) => rows.map((r) => ({ submissionId: r.submissionId, rank: r.rank, tied: r.tied, average: r.average, scoreCount: r.scoreCount }));

  // People's Choice (PR 7): ranked by the vote tally, only once voting is closed (tallies are
  // hidden from the host too until then).
  const vStatus = votingStatus(voting);
  const hasPc = (h.prizes as any[]).some((p) => p.kind === 'peoples_choice');
  let voteRanking: { overall: unknown[]; byTrack: unknown[] } | null = null;
  let pcSuggestions: Record<string, string[]> = {};
  if (hasPc && talliesVisible(vStatus)) {
    const tally = buildTally(
      await countedVotes(hackathonId),
      subs.map((s) => ({ id: s.id, trackIds: s.tracks.map((t) => t.trackId) })),
      h.tracks.map((t) => t.id),
      voting?.scope ?? 'event',
    );
    pcSuggestions = suggestPeoplesChoice(h.prizes as any, tally);
    voteRanking = { overall: tally.overall, byTrack: tally.tracks.map((t) => ({ trackId: t.trackId, rows: t.rows })) };
  }

  const membersBySub = new Map(subs.map((s) => [s.id, s.team?.members ?? []]));
  const rows = awards.map((a) => {
    const member = (membersBySub.get(a.submissionId) ?? []).find((m) => !!a.recipientUserId && m.userId === a.recipientUserId);
    return hostAward({ ...a, recipientMemberId: member?.id ?? null });
  });

  return {
    judgingStatus: h.judgingStatus,
    resultsRevealedAt: h.resultsRevealedAt ? h.resultsRevealedAt.toISOString() : null,
    tracks: h.tracks.map(publicTrack),
    prizes: h.prizes.map(publicPrize),
    awards: rows,
    candidates: subs.map((s) => ({
      id: s.id,
      name: s.name,
      tagline: s.tagline ?? null,
      teamName: s.team?.name ?? null,
      trackIds: s.tracks.map((t) => t.trackId),
      members: (s.team?.members ?? []).map((m) => ({ id: m.id, name: memberName(m), email: m.user?.email ?? null, role: m.role })),
    })),
    suggestions: { ...suggestWinners(h.prizes as any, board), ...pcSuggestions },
    voting: { status: vStatus, ranking: voteRanking },
    ranking: { overall: slim(board.overall), byTrack: board.tracks.map((t) => ({ trackId: t.trackId, rows: slim(t.rows) })) },
  };
}

async function send(res: Response, hackathonId: string, status = 200) {
  res.set('Cache-Control', 'private, no-store');
  res.status(status).json(await awardsPayload(hackathonId));
}

async function sendHost(res: Response, partyId: string) {
  const h = await prisma.hackathon.findUnique({ where: { partyId }, include: HACKATHON_INCLUDE });
  res.set('Cache-Control', 'private, no-store');
  res.json({ hackathon: h ? hostHackathon(h) : null, canManage: true });
}

// ---------------------------------------------------------------- awards

router.get('/:partyId/hackathon/awards', ...readGuard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    await send(res, await getHackathonId(req.params.partyId));
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/awards', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const hackathonId = await getHackathonId(req.params.partyId);
    const input = parseAwardCreate((req.body ?? {}) as Record<string, unknown>);
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, hackathonId);
      const [prize, sub, existing] = await Promise.all([
        tx.hackathonPrize.findFirst({
          where: { id: input.prizeId, hackathonId },
          select: { id: true, trackId: true, name: true, rank: true, quantity: true, kind: true, sortOrder: true },
        }),
        tx.hackathonSubmission.findFirst({
          where: { id: input.submissionId, hackathonId },
          select: { id: true, status: true, tracks: { select: { trackId: true } }, team: { select: { members: { where: { role: 'captain' }, select: { userId: true } } } } },
        }),
        tx.hackathonAward.findMany({ where: { prizeId: input.prizeId, hackathonId }, select: { submissionId: true, place: true } }),
      ]);
      if (!prize) throw notFound('Prize not found');
      if (!sub) throw notFound('Project not found');
      if (prize.kind === 'peoples_choice') {
        assertPeoplesChoiceAwardable(prize, votingStatus(await tx.hackathonVoting.findUnique({ where: { hackathonId } })));
      }
      assertAwardable(prize, { id: sub.id, status: sub.status, trackIds: sub.tracks.map((t: any) => t.trackId) }, existing.map((a: any) => a.submissionId));
      const place = pickPlace(prize, existing.map((a: any) => a.place), input.place);
      await tx.hackathonAward.create({
        data: {
          hackathonId,
          prizeId: prize.id,
          submissionId: sub.id,
          place,
          awardedBy: req.userId ?? null,
          // Default payout recipient: the team captain (the host can change it).
          recipientUserId: sub.team?.members?.[0]?.userId ?? null,
        },
      }).catch((e: any) => {
        if (e?.code === 'P2002') throw conflict('This project already has this prize.', 'ALREADY_AWARDED');
        throw e;
      });
    });
    await send(res, hackathonId, 201);
  } catch (error) {
    next(error);
  }
});

router.patch('/:partyId/hackathon/awards/:awardId/payout', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const hackathonId = await getHackathonId(req.params.partyId);
    const id = childId(req.params.awardId);
    const input = parsePayout((req.body ?? {}) as Record<string, unknown>);
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, hackathonId);
      const award = await tx.hackathonAward.findFirst({
        where: { id, hackathonId },
        select: { id: true, payoutStatus: true, paidAt: true, recipientUserId: true, submission: { select: { teamId: true } } },
      });
      if (!award) throw notFound('Award not found');
      const data = payoutData(input, award);
      if (input.recipientMemberId !== undefined) {
        if (input.recipientMemberId === null) {
          data.recipientUserId = null;
        } else {
          // The recipient must be a current member of the winning team.
          const m = await tx.hackathonTeamMember.findFirst({
            where: { id: input.recipientMemberId, hackathonId, teamId: award.submission?.teamId ?? '' },
            select: { userId: true },
          });
          if (!m) throw new AppError('The recipient must be a member of the winning team', 400, 'VALIDATION_ERROR');
          data.recipientUserId = m.userId;
        }
      }
      // Moving to pending / paid needs a recipient who is still on the winning team (a member
      // who left keeps their user id on the award, but money shouldn't go out to them unseen).
      if ((input.status === 'pending' || input.status === 'paid') && input.status !== award.payoutStatus) {
        const recipientUserId = 'recipientUserId' in data ? (data.recipientUserId as string | null) : award.recipientUserId;
        const onTeam = recipientUserId
          ? await tx.hackathonTeamMember.count({ where: { hackathonId, teamId: award.submission?.teamId ?? '', userId: recipientUserId } })
          : 0;
        if (!onTeam) {
          throw conflict(
            recipientUserId
              ? 'The recipient is no longer on the winning team. Pick a current team member before marking the payout pending or paid.'
              : 'Pick a recipient from the winning team before marking the payout pending or paid.',
            'RECIPIENT_NOT_MEMBER',
          );
        }
      }
      await tx.hackathonAward.update({ where: { id: award.id }, data });
    });
    await send(res, hackathonId);
  } catch (error) {
    next(error);
  }
});

router.delete('/:partyId/hackathon/awards/:awardId', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const hackathonId = await getHackathonId(req.params.partyId);
    const id = childId(req.params.awardId);
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, hackathonId);
      const award = await tx.hackathonAward.findFirst({
        where: { id, hackathonId },
        select: { id: true, payoutStatus: true, paidAt: true, payoutReference: true },
      });
      if (!award) throw notFound('Award not found');
      if (hasRecordedPayout(award)) {
        throw conflict(
          'This award has a recorded payout (pending or paid, a paid date or a reference), so it can\'t be removed. Set the payout back to unpaid and clear the reference first.',
          'PAYOUT_RECORDED',
        );
      }
      await tx.hackathonAward.delete({ where: { id: award.id } });
    });
    await send(res, hackathonId);
  } catch (error) {
    next(error);
  }
});

// ---------------------------------------------------------------- reveal

router.post('/:partyId/hackathon/reveal', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const hackathonId = await getHackathonId(partyId);
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, hackathonId);
      const h = await tx.hackathon.findUnique({ where: { id: hackathonId }, select: { judgingStatus: true, resultsRevealedAt: true } });
      if (h.resultsRevealedAt) return; // already revealed: idempotent
      const awards = await tx.hackathonAward.count({ where: { hackathonId, submission: { status: 'submitted' } } });
      assertCanReveal(h, awards);
      await tx.hackathon.update({ where: { id: hackathonId }, data: { resultsRevealedAt: new Date() } });
    });
    await sendHost(res, partyId);
  } catch (error) {
    next(error);
  }
});

router.post('/:partyId/hackathon/unreveal', ...guard, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const hackathonId = await getHackathonId(partyId);
    await prisma.$transaction(async (tx: any) => {
      await lockHackathon(tx, hackathonId);
      const paid = await tx.hackathonAward.count({ where: { hackathonId, payoutStatus: 'paid' } });
      assertCanUnreveal(paid);
      await tx.hackathon.update({ where: { id: hackathonId }, data: { resultsRevealedAt: null } });
    });
    await sendHost(res, partyId);
  } catch (error) {
    next(error);
  }
});

export default router;
