// panzerotti-58527: public token-based HOST survey routes.
//
//   GET  /api/host-survey/:token  — render payload (event + questions + prior answers)
//   POST /api/host-survey/:token  — submit / resubmit answers (idempotent)
//
// Mirrors the public guest survey router (survey.routes.ts) but for hosts. The
// question set is built per-party via buildHostSurveyQuestions so the synthetic
// `guests_attended` question is shown + accepted iff the party has no estimated
// attendance. On submit, if guests_attended was asked + answered and the party
// still has no estimatedAttendance, we write it back (never clobber a non-null
// value); the raw answer is also stored in `answers`.

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import {
  buildHostSurveyQuestions,
  validateHostSurveyAnswers,
  GUESTS_ATTENDED_ID,
} from '../lib/hostSurveyQuestions.js';

const router = Router();

// GET /api/host-survey/:token
router.get('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;

    const response = await prisma.hostSurveyResponse.findUnique({
      where: { token },
      select: {
        answers: true,
        questionSetVersion: true,
        party: {
          select: {
            name: true,
            customUrl: true,
            inviteCode: true,
            eventImageUrl: true,
            estimatedAttendance: true,
            user: { select: { name: true } },
          },
        },
      },
    });

    if (!response || !response.party) {
      throw new AppError('Host survey not found', 404, 'NOT_FOUND');
    }

    const party = response.party;
    const set = await buildHostSurveyQuestions(party);
    const firstName = (party.user?.name || '').trim().split(/\s+/)[0] || '';

    res.json({
      eventName: party.name,
      eventSlug: party.customUrl || party.inviteCode,
      firstName,
      eventImageUrl: party.eventImageUrl,
      questionSet: set.questions,
      questionSetVersion: set.version,
      alreadySubmitted: !!response.answers,
      answers: response.answers ?? null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/host-survey/:token
router.post('/:token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.params;

    const response = await prisma.hostSurveyResponse.findUnique({
      where: { token },
      select: {
        id: true,
        partyId: true,
        party: { select: { id: true, estimatedAttendance: true } },
      },
    });

    if (!response || !response.party) {
      throw new AppError('Host survey not found', 404, 'NOT_FOUND');
    }

    const set = await buildHostSurveyQuestions(response.party);
    const answers = validateHostSurveyAnswers(
      (req.body as { answers?: unknown })?.answers,
      set.questions
    );

    const now = new Date();

    await prisma.hostSurveyResponse.update({
      where: { id: response.id },
      data: {
        answers,
        submittedAt: now,
        questionSetVersion: set.version,
        updatedAt: now,
      },
    });

    // Write-back: if guests_attended was asked AND answered AND the party still
    // has no estimatedAttendance, persist it. Never clobber a non-null value.
    const guestsAsked = set.questions.some((q) => q.id === GUESTS_ATTENDED_ID);
    const guestsAnswered = answers[GUESTS_ATTENDED_ID];
    if (
      guestsAsked &&
      typeof guestsAnswered === 'string' &&
      (response.party.estimatedAttendance === null ||
        response.party.estimatedAttendance === undefined)
    ) {
      const n = Number(guestsAnswered);
      if (Number.isInteger(n) && n >= 0) {
        await prisma.party.update({
          where: { id: response.party.id },
          data: { estimatedAttendance: n },
        });
      }
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export { router as hostSurveyPublicRouter };
