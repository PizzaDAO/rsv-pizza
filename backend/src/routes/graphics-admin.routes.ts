import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// GET /api/graphics-admin/list — List all graphics admins (any admin can view)
router.get('/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const admins = await prisma.graphicsAdmin.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        createdBy: true,
        createdAt: true,
      },
    });

    res.json({ admins });
  } catch (error) {
    next(error);
  }
});

// POST /api/graphics-admin/add — Add a graphics admin (any admin can add)
router.post('/add', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { email, name } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.trim().toLowerCase();

    const existing = await prisma.graphicsAdmin.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new AppError('Graphics admin with this email already exists', 400, 'DUPLICATE');
    }

    const admin = await prisma.graphicsAdmin.create({
      data: {
        email: normalizedEmail,
        name: name?.trim() || null,
        createdBy: req.userEmail || null,
      },
      select: {
        id: true,
        email: true,
        name: true,
        createdBy: true,
        createdAt: true,
      },
    });

    res.status(201).json({ admin });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/graphics-admin/:id — Remove a graphics admin (any admin can remove)
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    const admin = await prisma.graphicsAdmin.findUnique({ where: { id } });
    if (!admin) {
      throw new AppError('Graphics admin not found', 404, 'NOT_FOUND');
    }

    await prisma.graphicsAdmin.delete({ where: { id } });

    res.json({ success: true, message: 'Graphics admin removed' });
  } catch (error) {
    next(error);
  }
});

export default router;
