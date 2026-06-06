import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// montanara-58497: per-account saved filter views for /payments + /underboss.
// Owner key = req.userEmail (lowercased). No FK to User — views are keyed by
// email string. `params` is the page's serialized URL query string.
const router = Router();

const SCOPES = new Set(['payments', 'underboss']);

// GET /api/saved-views?scope=payments|underboss
router.get('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userEmail = req.userEmail!.toLowerCase();
    const scope = String(req.query.scope || '');
    if (!SCOPES.has(scope)) {
      throw new AppError('Invalid scope', 400, 'INVALID_SCOPE');
    }

    const views = await prisma.savedFilterView.findMany({
      where: { userEmail, scope },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, params: true, updatedAt: true },
    });

    res.json({ views });
  } catch (e) {
    next(e);
  }
});

// POST /api/saved-views  body { scope, name, params }
router.post('/', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userEmail = req.userEmail!.toLowerCase();
    const { scope, name, params } = req.body || {};

    if (!SCOPES.has(scope)) {
      throw new AppError('Invalid scope', 400, 'INVALID_SCOPE');
    }
    const trimmedName = typeof name === 'string' ? name.trim() : '';
    if (!trimmedName || trimmedName.length > 80) {
      throw new AppError('Name must be 1–80 characters', 400, 'INVALID_NAME');
    }
    const paramsStr = typeof params === 'string' ? params : '';
    if (paramsStr.length > 2000) {
      throw new AppError('Params too long', 400, 'INVALID_PARAMS');
    }

    const view = await prisma.savedFilterView.upsert({
      where: { userEmail_scope_name: { userEmail, scope, name: trimmedName } },
      create: { userEmail, scope, name: trimmedName, params: paramsStr },
      update: { params: paramsStr },
      select: { id: true, name: true, params: true, updatedAt: true },
    });

    res.json(view);
  } catch (e) {
    next(e);
  }
});

// DELETE /api/saved-views/:id
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userEmail = req.userEmail!.toLowerCase();
    const { id } = req.params;

    const existing = await prisma.savedFilterView.findUnique({ where: { id } });
    if (!existing || existing.userEmail !== userEmail) {
      throw new AppError('Not found', 404, 'NOT_FOUND');
    }

    await prisma.savedFilterView.delete({ where: { id } });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
