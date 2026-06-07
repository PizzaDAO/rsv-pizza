/**
 * gnocchi-58507: admin-only "Survey Responses" feed for /underboss.
 *
 * Returns ALL post-event survey responses across every event, one row per
 * respondent (newest first, capped at 5000), plus per-rating-question averages
 * computed over the returned page and the active question set for column /
 * detail rendering. The frontend builds region + text filters and the CSV
 * export client-side from this single payload — no extra endpoints.
 *
 * Auth: requireAuth + isFullAdmin (admin OR super_admin). Mirrors the gate
 * pattern in surveyQuestions.routes.ts; mounted BEFORE the generic /api/admin
 * catch-all in index.ts so it isn't shadowed.
 */
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../../config/database.js';
import { requireAuth, AuthRequest, isFullAdmin } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { loadQuestionSet } from '../../lib/surveyQuestions.js';

async function requireFullAdmin(
  req: AuthRequest,
  _res: Response,
  next: NextFunction
) {
  try {
    if (!(await isFullAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }
    next();
  } catch (err) {
    next(err);
  }
}

const router = Router();
router.use(requireAuth);
router.use(requireFullAdmin);

const CAP = 5000;

// GET /api/admin/survey-responses
//   All survey responses (one row per respondent), newest first, capped.
router.get('/', async (_req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.surveyResponse.findMany({
      orderBy: { submittedAt: 'desc' },
      take: CAP + 1,
      include: {
        party: {
          select: {
            name: true,
            customUrl: true,
            inviteCode: true,
            region: true,
            endTime: true,
          },
        },
        guest: { select: { name: true } },
      },
    });

    const truncated = rows.length > CAP;
    const page = rows.slice(0, CAP);

    const set = await loadQuestionSet();

    // Per-rating-question averages over the returned page.
    const ratings: Record<string, { average: number | null; count: number }> = {};
    for (const q of set.questions) {
      if (q.type !== 'rating') continue;
      let sum = 0;
      let count = 0;
      for (const r of page) {
        const answers = (r.answers ?? {}) as Record<string, unknown>;
        const v = answers[q.id];
        if (typeof v === 'number') {
          sum += v;
          count += 1;
        }
      }
      ratings[q.id] = {
        average: count > 0 ? Math.round((sum / count) * 100) / 100 : null,
        count,
      };
    }

    res.json({
      questionSet: set.questions,
      questionSetVersion: set.version,
      truncated,
      summary: {
        responseCount: page.length,
        ratings,
      },
      responses: page.map((r) => ({
        id: r.id,
        submittedAt: r.submittedAt,
        updatedAt: r.updatedAt,
        questionSetVersion: r.questionSetVersion,
        email: r.email,
        guestName: r.guest?.name ?? '',
        event: {
          name: r.party?.name ?? '',
          slug: r.party?.customUrl || r.party?.inviteCode || '',
          region: r.party?.region ?? null,
        },
        answers: r.answers ?? {},
      })),
    });
  } catch (err) {
    next(err);
  }
});

export { router as surveyResponsesAdminRouter };
