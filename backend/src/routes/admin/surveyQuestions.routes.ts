/**
 * Admin CRUD for the post-event survey question set (pugliese-58297).
 *
 * Two routers are exported:
 *  - `surveyQuestionsAdminRouter` → mounted at `/api/admin/survey-questions`
 *  - `surveyQuestionSetsAdminRouter` → mounted at `/api/admin/survey-question-sets`
 *
 * Auth: requireAuth + isFullAdmin (admin OR super_admin). Mirrors the gate
 * pattern used elsewhere under `/api/admin/*`. Both routers register BEFORE
 * the generic `/api/admin` catch-all in index.ts so they aren't shadowed.
 *
 * Every write endpoint calls `loadQuestionSet(setId, { refresh: true })`
 * BEFORE returning so the admin's next call (and the public flow) sees the
 * change immediately, not after the 60s TTL.
 */
import { Router, Response, NextFunction } from 'express';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/database.js';
import { requireAuth, AuthRequest, isFullAdmin } from '../../middleware/auth.js';
import { AppError } from '../../middleware/error.js';
import { loadQuestionSet, SurveyQuestionType } from '../../lib/surveyQuestions.js';

const VALID_TYPES: SurveyQuestionType[] = ['rating', 'yesno', 'multiple', 'text'];
const ID_PATTERN = /^[a-z][a-z0-9_]*$/; // lowercase snake_case

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

function normalizeSetId(raw: unknown): string {
  if (typeof raw === 'string' && raw.length > 0) return raw;
  return 'default';
}

function sanitizeOptions(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((x): x is string => typeof x === 'string')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function validateTypeShape(
  type: SurveyQuestionType,
  body: {
    scale?: unknown;
    multi?: unknown;
    allowOther?: unknown;
    options?: unknown;
  }
): { scale: number | null; multi: boolean; allowOther: boolean; options: string[] } {
  let scale: number | null = null;
  let multi = false;
  let allowOther = false;
  let options: string[] = [];

  if (type === 'rating') {
    const n = Number(body.scale);
    if (!Number.isInteger(n) || n < 2 || n > 10) {
      throw new AppError('Rating scale must be an integer between 2 and 10', 400, 'VALIDATION_ERROR');
    }
    scale = n;
  } else if (type === 'multiple') {
    options = sanitizeOptions(body.options);
    if (options.length === 0) {
      throw new AppError('Multiple-choice question requires at least one option', 400, 'VALIDATION_ERROR');
    }
    multi = body.multi === true;
    allowOther = body.allowOther === true;
  }
  // yesno + text take no extra fields.

  return { scale, multi, allowOther, options };
}

// Serialize a Prisma SurveyQuestion row to the API shape (camelCase + omit null
// scale / empty options, matching the frontend SurveyQuestion interface).
function serializeQuestion(q: {
  id: string;
  position: number;
  type: string;
  text: string;
  scale: number | null;
  multi: boolean;
  allowOther: boolean;
  options: Prisma.JsonValue;
  active: boolean;
}) {
  const out: Record<string, unknown> = {
    id: q.id,
    position: q.position,
    type: q.type,
    text: q.text,
    multi: q.multi,
    allowOther: q.allowOther,
    active: q.active,
    options: Array.isArray(q.options) ? q.options : [],
  };
  if (q.scale !== null && q.scale !== undefined) out.scale = q.scale;
  return out;
}

// ===========================================================================
// /api/admin/survey-questions
// ===========================================================================
const questionsRouter = Router();
questionsRouter.use(requireAuth);
questionsRouter.use(requireFullAdmin);

// GET /api/admin/survey-questions?set=default
//   Returns ALL questions (including inactive) ordered by position.
questionsRouter.get(
  '/',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const setId = normalizeSetId(req.query.set);

      const set = await prisma.surveyQuestionSet.findUnique({
        where: { id: setId },
      });
      if (!set) {
        throw new AppError('Question set not found', 404, 'NOT_FOUND');
      }

      const rows = await prisma.surveyQuestion.findMany({
        where: { questionSet: setId },
        orderBy: { position: 'asc' },
      });

      res.json({
        questionSet: setId,
        version: set.version,
        questions: rows.map(serializeQuestion),
      });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/admin/survey-questions
//   Body: { questionSet?, id, type, text, scale?, multi?, allowOther?, options?, active?, position? }
//   Position auto-assigned to next slot if not provided.
questionsRouter.post(
  '/',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body ?? {};
      const setId = normalizeSetId(body.questionSet ?? body.set);

      const set = await prisma.surveyQuestionSet.findUnique({
        where: { id: setId },
      });
      if (!set) {
        throw new AppError('Question set not found', 404, 'NOT_FOUND');
      }

      const id = typeof body.id === 'string' ? body.id.trim() : '';
      if (!id || !ID_PATTERN.test(id)) {
        throw new AppError(
          'Question id must be lowercase snake_case (a-z, 0-9, _) starting with a letter',
          400,
          'VALIDATION_ERROR'
        );
      }

      if (!VALID_TYPES.includes(body.type)) {
        throw new AppError('Invalid question type', 400, 'VALIDATION_ERROR');
      }
      const type = body.type as SurveyQuestionType;

      const text = typeof body.text === 'string' ? body.text.trim() : '';
      if (!text) {
        throw new AppError('Question text is required', 400, 'VALIDATION_ERROR');
      }

      const shape = validateTypeShape(type, body);

      // Auto-assign next position if not supplied.
      let position: number;
      if (typeof body.position === 'number' && Number.isInteger(body.position) && body.position > 0) {
        position = body.position;
      } else {
        const last = await prisma.surveyQuestion.findFirst({
          where: { questionSet: setId },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        position = (last?.position ?? 0) + 1;
      }

      const active = body.active === undefined ? true : !!body.active;

      const created = await prisma.surveyQuestion.create({
        data: {
          id,
          questionSet: setId,
          position,
          type,
          text,
          scale: shape.scale,
          multi: shape.multi,
          allowOther: shape.allowOther,
          options: shape.options,
          active,
        },
      });

      // Refresh cache so the public + admin flows see the change immediately.
      await loadQuestionSet(setId, { refresh: true });

      res.status(201).json({ question: serializeQuestion(created) });
    } catch (err) {
      // Translate unique-constraint violations into 400s.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        return next(
          new AppError(
            'A question with that id or position already exists in this set',
            400,
            'DUPLICATE'
          )
        );
      }
      next(err);
    }
  }
);

// PATCH /api/admin/survey-questions/:id?set=default
//   Partial update of any field. type changes re-validate the shape.
questionsRouter.patch(
  '/:id',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const setId = normalizeSetId(req.query.set);
      const { id } = req.params;
      const body = req.body ?? {};

      const existing = await prisma.surveyQuestion.findUnique({
        where: { questionSet_id: { questionSet: setId, id } },
      });
      if (!existing) {
        throw new AppError('Question not found', 404, 'NOT_FOUND');
      }

      const data: Prisma.SurveyQuestionUpdateInput = {};

      if (body.text !== undefined) {
        const text = typeof body.text === 'string' ? body.text.trim() : '';
        if (!text) throw new AppError('Question text cannot be empty', 400, 'VALIDATION_ERROR');
        data.text = text;
      }

      if (body.active !== undefined) {
        data.active = !!body.active;
      }

      // Type-aware fields. If the type itself is changing, validate the new
      // shape against the new type using whatever scale/options/etc the client
      // sent (or, fall back to the existing row's values).
      const targetType: SurveyQuestionType =
        body.type !== undefined && VALID_TYPES.includes(body.type)
          ? (body.type as SurveyQuestionType)
          : (existing.type as SurveyQuestionType);

      if (body.type !== undefined) {
        if (!VALID_TYPES.includes(body.type)) {
          throw new AppError('Invalid question type', 400, 'VALIDATION_ERROR');
        }
        data.type = body.type;
      }

      const typeFieldsTouched =
        body.type !== undefined ||
        body.scale !== undefined ||
        body.multi !== undefined ||
        body.allowOther !== undefined ||
        body.options !== undefined;

      if (typeFieldsTouched) {
        const merged = {
          scale: body.scale !== undefined ? body.scale : existing.scale,
          multi: body.multi !== undefined ? body.multi : existing.multi,
          allowOther:
            body.allowOther !== undefined ? body.allowOther : existing.allowOther,
          options:
            body.options !== undefined
              ? body.options
              : (existing.options as Prisma.JsonValue),
        };
        const shape = validateTypeShape(targetType, merged);
        data.scale = shape.scale;
        data.multi = shape.multi;
        data.allowOther = shape.allowOther;
        data.options = shape.options;
      }

      const updated = await prisma.surveyQuestion.update({
        where: { questionSet_id: { questionSet: setId, id } },
        data,
      });

      await loadQuestionSet(setId, { refresh: true });

      res.json({ question: serializeQuestion(updated) });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/admin/survey-questions/reorder
//   Body: { set?: 'default', orderedIds: string[] }
//   Rewrites `position` to match the array order, in one transaction.
//   Because of the unique (question_set, position) constraint we have to push
//   rows into a temporary high range first to dodge transient collisions.
questionsRouter.post(
  '/reorder',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const body = req.body ?? {};
      const setId = normalizeSetId(body.set ?? body.questionSet);
      const orderedIds = Array.isArray(body.orderedIds) ? body.orderedIds : [];

      if (orderedIds.length === 0 || !orderedIds.every((x: unknown) => typeof x === 'string')) {
        throw new AppError('orderedIds must be a non-empty array of strings', 400, 'VALIDATION_ERROR');
      }

      const existing = await prisma.surveyQuestion.findMany({
        where: { questionSet: setId },
        select: { id: true },
      });
      const existingIds = new Set(existing.map((q) => q.id));

      if (orderedIds.length !== existing.length) {
        throw new AppError(
          'orderedIds must contain every question id in the set exactly once',
          400,
          'VALIDATION_ERROR'
        );
      }
      const seen = new Set<string>();
      for (const id of orderedIds) {
        if (seen.has(id) || !existingIds.has(id)) {
          throw new AppError(
            'orderedIds must contain every question id in the set exactly once',
            400,
            'VALIDATION_ERROR'
          );
        }
        seen.add(id);
      }

      // Two-pass update inside a transaction to dodge the (set, position) unique
      // constraint during the swap.
      const OFFSET = 10_000;
      await prisma.$transaction(async (tx) => {
        for (let i = 0; i < orderedIds.length; i += 1) {
          await tx.surveyQuestion.update({
            where: { questionSet_id: { questionSet: setId, id: orderedIds[i] } },
            data: { position: OFFSET + i + 1 },
          });
        }
        for (let i = 0; i < orderedIds.length; i += 1) {
          await tx.surveyQuestion.update({
            where: { questionSet_id: { questionSet: setId, id: orderedIds[i] } },
            data: { position: i + 1 },
          });
        }
      });

      await loadQuestionSet(setId, { refresh: true });

      res.json({ success: true });
    } catch (err) {
      next(err);
    }
  }
);

// ===========================================================================
// /api/admin/survey-question-sets/:setId
// ===========================================================================
const setsRouter = Router();
setsRouter.use(requireAuth);
setsRouter.use(requireFullAdmin);

// PATCH /api/admin/survey-question-sets/:setId
//   Body: { version?: number }
setsRouter.patch(
  '/:setId',
  async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { setId } = req.params;
      const body = req.body ?? {};

      const existing = await prisma.surveyQuestionSet.findUnique({
        where: { id: setId },
      });
      if (!existing) {
        throw new AppError('Question set not found', 404, 'NOT_FOUND');
      }

      const data: Prisma.SurveyQuestionSetUpdateInput = {
        updatedAt: new Date(),
      };

      if (body.version !== undefined) {
        const n = Number(body.version);
        if (!Number.isInteger(n) || n < 1) {
          throw new AppError('Version must be a positive integer', 400, 'VALIDATION_ERROR');
        }
        data.version = n;
      }

      const updated = await prisma.surveyQuestionSet.update({
        where: { id: setId },
        data,
      });

      await loadQuestionSet(setId, { refresh: true });

      res.json({
        questionSet: {
          id: updated.id,
          version: updated.version,
          updatedAt: updated.updatedAt,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

export {
  questionsRouter as surveyQuestionsAdminRouter,
  setsRouter as surveyQuestionSetsAdminRouter,
};
