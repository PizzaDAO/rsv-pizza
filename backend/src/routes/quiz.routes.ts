import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { AppError } from '../middleware/error.js';

// Host routes (authenticated, party edit permission required)
export const quizHostRouter = Router();

// All host routes require auth
quizHostRouter.use(requireAuth);

// GET /api/parties/:partyId/quiz/questions
quizHostRouter.get('/:partyId/quiz/questions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const questions = await prisma.quizQuestion.findMany({
      where: { partyId },
      include: {
        sponsor: { select: { id: true, name: true, logoUrl: true } },
        _count: { select: { answers: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ questions });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/quiz/questions
quizHostRouter.post('/:partyId/quiz/questions', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const { question, options, correctIndex, explanation, sponsorId } = req.body;

    if (!question || !Array.isArray(options) || options.length < 2 || correctIndex === undefined) {
      throw new AppError('Question, options (min 2), and correctIndex are required', 400, 'VALIDATION_ERROR');
    }

    if (correctIndex < 0 || correctIndex >= options.length) {
      throw new AppError('correctIndex must be a valid option index', 400, 'VALIDATION_ERROR');
    }

    // Get max sort order
    const maxSort = await prisma.quizQuestion.aggregate({
      where: { partyId },
      _max: { sortOrder: true },
    });

    const quizQuestion = await prisma.quizQuestion.create({
      data: {
        partyId,
        sponsorId: sponsorId || null,
        question: question.trim(),
        options,
        correctIndex,
        explanation: explanation?.trim() || null,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
      include: {
        sponsor: { select: { id: true, name: true, logoUrl: true } },
      },
    });

    res.status(201).json({ question: quizQuestion });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/quiz/questions/:questionId
quizHostRouter.patch('/:partyId/quiz/questions/:questionId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, questionId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const { question, options, correctIndex, explanation, sponsorId } = req.body;

    const updateData: any = {};
    if (question !== undefined) updateData.question = question.trim();
    if (options !== undefined) updateData.options = options;
    if (correctIndex !== undefined) updateData.correctIndex = correctIndex;
    if (explanation !== undefined) updateData.explanation = explanation?.trim() || null;
    if (sponsorId !== undefined) updateData.sponsorId = sponsorId || null;

    const quizQuestion = await prisma.quizQuestion.update({
      where: { id: questionId, partyId },
      data: updateData,
      include: {
        sponsor: { select: { id: true, name: true, logoUrl: true } },
      },
    });

    res.json({ question: quizQuestion });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/quiz/questions/:questionId
quizHostRouter.delete('/:partyId/quiz/questions/:questionId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, questionId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    await prisma.quizQuestion.delete({
      where: { id: questionId, partyId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/quiz/questions/reorder
quizHostRouter.patch('/:partyId/quiz/questions/reorder', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const { order } = req.body;
    if (!Array.isArray(order)) {
      throw new AppError('order must be an array of question IDs', 400, 'VALIDATION_ERROR');
    }

    await Promise.all(
      order.map((questionId: string, index: number) =>
        prisma.quizQuestion.update({
          where: { id: questionId, partyId },
          data: { sortOrder: index },
        })
      )
    );

    const questions = await prisma.quizQuestion.findMany({
      where: { partyId },
      include: {
        sponsor: { select: { id: true, name: true, logoUrl: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ questions });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/quiz/stats
quizHostRouter.get('/:partyId/quiz/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const questions = await prisma.quizQuestion.findMany({
      where: { partyId },
      include: {
        sponsor: { select: { id: true, name: true } },
        answers: {
          select: { isCorrect: true },
        },
      },
      orderBy: { sortOrder: 'asc' },
    });

    const stats = questions.map((q) => ({
      questionId: q.id,
      question: q.question,
      sponsorName: q.sponsor?.name || null,
      totalAnswers: q.answers.length,
      correctAnswers: q.answers.filter((a) => a.isCorrect).length,
      correctPercentage:
        q.answers.length > 0
          ? Math.round((q.answers.filter((a) => a.isCorrect).length / q.answers.length) * 100)
          : 0,
    }));

    res.json({ stats });
  } catch (error) {
    next(error);
  }
});

// Public routes (no auth required)
export const quizPublicRouter = Router();

// GET /api/events/:slug/quiz - Get quiz questions (without correctIndex)
quizPublicRouter.get('/:slug/quiz', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: { id: true, quizEnabled: true },
    });
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: { id: true, quizEnabled: true },
      });
    }
    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (!party.quizEnabled) {
      return res.json({ questions: [], quizEnabled: false });
    }

    const questions = await prisma.quizQuestion.findMany({
      where: { partyId: party.id },
      select: {
        id: true,
        question: true,
        options: true,
        explanation: false, // Hidden until after answering
        sortOrder: true,
        sponsor: { select: { id: true, name: true, logoUrl: true, website: true, brandTwitter: true } },
      },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({
      quizEnabled: true,
      questions: questions.map((q) => ({
        id: q.id,
        question: q.question,
        options: q.options,
        sortOrder: q.sortOrder,
        sponsor: q.sponsor
          ? { id: q.sponsor.id, name: q.sponsor.name, logoUrl: q.sponsor.logoUrl, website: q.sponsor.website, brandTwitter: q.sponsor.brandTwitter }
          : null,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/events/:slug/quiz/check - Check answers without persisting (no guestId needed)
quizPublicRouter.post('/:slug/quiz/check', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { answers } = req.body;

    if (!Array.isArray(answers) || answers.length === 0) {
      throw new AppError('answers array is required', 400, 'VALIDATION_ERROR');
    }

    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: { id: true, quizEnabled: true },
    });
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: { id: true, quizEnabled: true },
      });
    }
    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }
    if (!party.quizEnabled) {
      throw new AppError('Quiz is not enabled for this event', 400, 'QUIZ_NOT_ENABLED');
    }

    const questions = await prisma.quizQuestion.findMany({
      where: { partyId: party.id },
      select: { id: true, correctIndex: true, explanation: true },
    });
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    const results = answers.map((answer: { questionId: string; selectedIndex: number }) => {
      const q = questionMap.get(answer.questionId);
      if (!q) return null;
      return {
        questionId: answer.questionId,
        selectedIndex: answer.selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect: answer.selectedIndex === q.correctIndex,
        explanation: q.explanation,
      };
    }).filter(Boolean);

    const totalCorrect = results.filter((r: any) => r.isCorrect).length;

    res.json({
      results,
      totalCorrect,
      totalQuestions: results.length,
      allCorrect: totalCorrect === results.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/events/:slug/quiz/answers - Submit answers, returns results
quizPublicRouter.post('/:slug/quiz/answers', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const { guestId, answers } = req.body;
    // answers: [{ questionId, selectedIndex }]

    if (!guestId || !Array.isArray(answers) || answers.length === 0) {
      throw new AppError('guestId and answers array are required', 400, 'VALIDATION_ERROR');
    }

    // Find party
    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: { id: true, quizEnabled: true },
    });
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: { id: true, quizEnabled: true },
      });
    }
    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    if (!party.quizEnabled) {
      throw new AppError('Quiz is not enabled for this event', 400, 'QUIZ_NOT_ENABLED');
    }

    // Verify guest exists for this party
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, partyId: party.id },
    });
    if (!guest) {
      throw new AppError('Guest not found for this event', 404, 'GUEST_NOT_FOUND');
    }

    // Get all questions for this party to validate and score
    const questions = await prisma.quizQuestion.findMany({
      where: { partyId: party.id },
      select: { id: true, correctIndex: true, explanation: true, question: true, options: true },
    });
    const questionMap = new Map(questions.map((q) => [q.id, q]));

    // Process answers
    const results: Array<{
      questionId: string;
      selectedIndex: number;
      correctIndex: number;
      isCorrect: boolean;
      explanation: string | null;
    }> = [];

    for (const answer of answers) {
      const q = questionMap.get(answer.questionId);
      if (!q) continue;

      const isCorrect = answer.selectedIndex === q.correctIndex;

      // Upsert answer (in case guest re-submits)
      await prisma.quizAnswer.upsert({
        where: {
          questionId_guestId: {
            questionId: answer.questionId,
            guestId,
          },
        },
        update: {
          selectedIndex: answer.selectedIndex,
          isCorrect,
        },
        create: {
          questionId: answer.questionId,
          guestId,
          selectedIndex: answer.selectedIndex,
          isCorrect,
        },
      });

      results.push({
        questionId: answer.questionId,
        selectedIndex: answer.selectedIndex,
        correctIndex: q.correctIndex,
        isCorrect,
        explanation: q.explanation,
      });
    }

    const totalCorrect = results.filter((r) => r.isCorrect).length;

    res.json({
      results,
      totalCorrect,
      totalQuestions: results.length,
      score: results.length > 0 ? Math.round((totalCorrect / results.length) * 100) : 0,
    });
  } catch (error) {
    next(error);
  }
});
