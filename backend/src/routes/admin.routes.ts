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

// GET /api/admin/gpp-nft — Get current GPP NFT settings
router.get('/gpp-nft', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    // Get a sample GPP event to read current settings
    const sample = await prisma.party.findFirst({
      where: { eventType: 'gpp' },
      select: { nftEnabled: true, nftChain: true },
      orderBy: { createdAt: 'desc' },
    });

    res.json({
      nftEnabled: sample?.nftEnabled ?? false,
      nftChain: sample?.nftChain ?? 'base',
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/gpp-nft — Bulk update NFT settings for all GPP events
router.patch('/gpp-nft', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Only super admins can update GPP NFT settings', 403, 'FORBIDDEN');
    }

    const { nftEnabled, nftChain } = req.body;

    if (typeof nftEnabled !== 'boolean') {
      throw new AppError('nftEnabled must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const result = await prisma.party.updateMany({
      where: { eventType: 'gpp' },
      data: {
        nftEnabled,
        ...(nftChain && { nftChain }),
      },
    });

    res.json({
      success: true,
      updatedCount: result.count,
      nftEnabled,
      nftChain: nftChain || 'base',
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/admin/checklist-defaults — Get default checklist items (from any GPP event)
router.get('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    // Find a GPP event that has been seeded and return its default items
    const items = await prisma.checklistItem.findMany({
      where: {
        isDefault: true,
        party: { eventType: 'gpp' },
      },
      distinct: ['name'],
      orderBy: { sortOrder: 'asc' },
      select: {
        name: true,
        dueDate: true,
        sortOrder: true,
        isAuto: true,
        autoRule: true,
        linkTab: true,
      },
    });

    res.json({ items });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/checklist-defaults — Bulk update default checklist items across all GPP events
router.patch('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Only super admins can update checklist defaults', 403, 'FORBIDDEN');
    }

    const { items } = req.body;

    if (!Array.isArray(items)) {
      throw new AppError('items must be an array', 400, 'VALIDATION_ERROR');
    }

    // Update each default item by name across all GPP events
    let totalUpdated = 0;
    for (const item of items) {
      if (!item.name) continue;

      const result = await prisma.checklistItem.updateMany({
        where: {
          name: item.name,
          isDefault: true,
          party: { eventType: 'gpp' },
        },
        data: {
          ...(item.dueDate !== undefined && { dueDate: item.dueDate ? new Date(item.dueDate) : null }),
          ...(item.sortOrder !== undefined && { sortOrder: item.sortOrder }),
          ...(item.newName && { name: item.newName }),
        },
      });
      totalUpdated += result.count;
    }

    res.json({ success: true, totalUpdated });
  } catch (error) {
    next(error);
  }
});

// POST /api/admin/checklist-defaults — Add a new default checklist item to all GPP events
router.post('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Only super admins can add checklist items', 403, 'FORBIDDEN');
    }

    const { name, dueDate } = req.body;

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Get all GPP event IDs
    const gppParties = await prisma.party.findMany({
      where: { eventType: 'gpp' },
      select: { id: true },
    });

    if (gppParties.length === 0) {
      return res.json({ success: true, createdCount: 0 });
    }

    // Get max sortOrder across all GPP checklist items
    const maxSort = await prisma.checklistItem.aggregate({
      where: { party: { eventType: 'gpp' } },
      _max: { sortOrder: true },
    });
    const nextSort = (maxSort._max.sortOrder ?? -1) + 1;

    // Create the item for every GPP event
    const result = await prisma.checklistItem.createMany({
      data: gppParties.map(p => ({
        partyId: p.id,
        name: name.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        isAuto: false,
        isDefault: true,
        sortOrder: nextSort,
      })),
    });

    res.status(201).json({ success: true, createdCount: result.count });
  } catch (error) {
    next(error);
  }
});

export default router;
