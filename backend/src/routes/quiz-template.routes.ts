import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// All routes require admin auth
router.use(requireAuth);

// GET /api/sponsor-users/:id/quiz-templates
router.get('/:id/quiz-templates', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    const templates = await prisma.quizQuestionTemplate.findMany({
      where: { sponsorUserId: id },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

// POST /api/sponsor-users/:id/quiz-templates
router.post('/:id/quiz-templates', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { question, options, correctIndex, explanation } = req.body;

    if (!question || !Array.isArray(options) || options.length < 2 || correctIndex === undefined) {
      throw new AppError('Question, options (min 2), and correctIndex are required', 400, 'VALIDATION_ERROR');
    }

    if (correctIndex < 0 || correctIndex >= options.length) {
      throw new AppError('correctIndex must be a valid option index', 400, 'VALIDATION_ERROR');
    }

    // Verify sponsor user exists
    const sponsorUser = await prisma.sponsorUser.findUnique({ where: { id } });
    if (!sponsorUser) {
      throw new AppError('Sponsor user not found', 404, 'NOT_FOUND');
    }

    // Get max sort order
    const maxSort = await prisma.quizQuestionTemplate.aggregate({
      where: { sponsorUserId: id },
      _max: { sortOrder: true },
    });

    const template = await prisma.quizQuestionTemplate.create({
      data: {
        sponsorUserId: id,
        question: question.trim(),
        options,
        correctIndex,
        explanation: explanation?.trim() || null,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    res.status(201).json({ template });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/sponsor-users/:id/quiz-templates/:templateId
router.patch('/:id/quiz-templates/:templateId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { templateId } = req.params;
    const { question, options, correctIndex, explanation } = req.body;

    const updateData: any = {};
    if (question !== undefined) updateData.question = question.trim();
    if (options !== undefined) updateData.options = options;
    if (correctIndex !== undefined) updateData.correctIndex = correctIndex;
    if (explanation !== undefined) updateData.explanation = explanation?.trim() || null;

    // Validate correctIndex against options
    const finalOptions = options ?? (await prisma.quizQuestionTemplate.findUnique({ where: { id: templateId }, select: { options: true } }))?.options;
    if (updateData.correctIndex !== undefined && Array.isArray(finalOptions)) {
      if (updateData.correctIndex < 0 || updateData.correctIndex >= (finalOptions as any[]).length) {
        throw new AppError('correctIndex must be a valid option index', 400, 'VALIDATION_ERROR');
      }
    }

    const template = await prisma.quizQuestionTemplate.update({
      where: { id: templateId },
      data: updateData,
    });

    res.json({ template });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/sponsor-users/:id/quiz-templates/:templateId
router.delete('/:id/quiz-templates/:templateId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { templateId } = req.params;

    await prisma.quizQuestionTemplate.delete({
      where: { id: templateId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/sponsor-users/:id/quiz-templates/reorder
router.patch('/:id/quiz-templates/reorder', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { order } = req.body; // Array of template IDs in desired order

    if (!Array.isArray(order)) {
      throw new AppError('order must be an array of template IDs', 400, 'VALIDATION_ERROR');
    }

    // Update sort orders
    await Promise.all(
      order.map((templateId: string, index: number) =>
        prisma.quizQuestionTemplate.update({
          where: { id: templateId },
          data: { sortOrder: index },
        })
      )
    );

    const templates = await prisma.quizQuestionTemplate.findMany({
      where: { sponsorUserId: id },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ templates });
  } catch (error) {
    next(error);
  }
});

export default router;
