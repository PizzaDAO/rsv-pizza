import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isAdmin, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// GET /api/admin/me — Check if current user is admin + role
router.get('/me', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const email = req.userEmail?.toLowerCase();
    if (!email) {
      return res.json({ isAdmin: false });
    }

    const admin = await prisma.admin.findUnique({ where: { email } });
    if (!admin) {
      return res.json({ isAdmin: false });
    }

    res.json({
      isAdmin: true,
      role: admin.role,
      email: admin.email,
      name: admin.name,
      id: admin.id,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/list — List all admins (any admin can view)
router.get('/list', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Admin access required', 403, 'FORBIDDEN');
    }

    const admins = await prisma.admin.findMany({
      orderBy: [{ role: 'asc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        email: true,
        role: true,
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

// POST /api/admin/add — Add admin (super_admin only)
router.post('/add', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { email, name, role } = req.body;

    if (!email) {
      throw new AppError('Email is required', 400, 'VALIDATION_ERROR');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const adminRole = role === 'super_admin' ? 'super_admin' : 'admin';

    const existing = await prisma.admin.findUnique({ where: { email: normalizedEmail } });
    if (existing) {
      throw new AppError('Admin with this email already exists', 400, 'DUPLICATE');
    }

    const admin = await prisma.admin.create({
      data: {
        email: normalizedEmail,
        role: adminRole,
        name: name?.trim() || null,
        createdBy: req.userEmail || null,
      },
      select: {
        id: true,
        email: true,
        role: true,
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

// DELETE /api/admin/:id — Remove admin (super_admin only, can't remove self)
router.delete('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;

    const admin = await prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw new AppError('Admin not found', 404, 'NOT_FOUND');
    }

    if (admin.email === req.userEmail?.toLowerCase()) {
      throw new AppError('Cannot remove yourself', 400, 'SELF_REMOVAL');
    }

    await prisma.admin.delete({ where: { id } });

    res.json({ success: true, message: 'Admin removed' });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/:id — Update admin role/name (super_admin only, can't downgrade self)
router.patch('/:id', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Super admin access required', 403, 'FORBIDDEN');
    }

    const { id } = req.params;
    const { name, role } = req.body;

    const admin = await prisma.admin.findUnique({ where: { id } });
    if (!admin) {
      throw new AppError('Admin not found', 404, 'NOT_FOUND');
    }

    if (admin.email === req.userEmail?.toLowerCase() && role && role !== 'super_admin') {
      throw new AppError('Cannot downgrade your own role', 400, 'SELF_DOWNGRADE');
    }

    const updated = await prisma.admin.update({
      where: { id },
      data: {
        ...(name !== undefined && { name: name?.trim() || null }),
        ...(role !== undefined && ['super_admin', 'admin'].includes(role) && { role }),
      },
      select: {
        id: true,
        email: true,
        role: true,
        name: true,
        createdBy: true,
        createdAt: true,
      },
    });

    res.json({ admin: updated });
  } catch (error) {
    next(error);
  }
});

export default router;
