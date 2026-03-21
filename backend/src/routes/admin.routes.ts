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

// ============================================
// Checklist Defaults — using dedicated table
// ============================================

// Raw-SQL admin check helpers (bypass Prisma UUID deserialization bug)
async function rawIsAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const result = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM admins WHERE email = ${email.toLowerCase()} LIMIT 1
  `;
  return result.length > 0;
}

async function rawIsSuperAdmin(email?: string): Promise<boolean> {
  if (!email) return false;
  const result = await prisma.$queryRaw<Array<{ role: string }>>`
    SELECT role FROM admins WHERE email = ${email.toLowerCase()} LIMIT 1
  `;
  return result[0]?.role === 'super_admin';
}

// GET /api/admin/checklist-defaults — Read from checklist_defaults table
router.get('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!(await rawIsAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    const items = await prisma.$queryRaw<Array<{
      name: string;
      due_date: Date | null;
      sort_order: number;
      is_auto: boolean;
      auto_rule: string | null;
      link_tab: string | null;
    }>>`
      SELECT name, due_date, sort_order, is_auto, auto_rule, link_tab
      FROM checklist_defaults
      ORDER BY sort_order ASC
    `;

    // Map to camelCase to match existing frontend interface
    const mapped = items.map(i => ({
      name: i.name,
      dueDate: i.due_date ? i.due_date.toISOString().split('T')[0] : null,
      sortOrder: i.sort_order,
      isAuto: i.is_auto,
      autoRule: i.auto_rule,
      linkTab: i.link_tab,
    }));

    res.json({ items: mapped });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/admin/checklist-defaults — Update defaults + propagate to all GPP events
router.patch('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response) => {
  if (!(await rawIsSuperAdmin(req.userEmail))) {
    return res.status(403).json({ error: { message: 'Only super admins can update checklist defaults', code: 'FORBIDDEN' } });
  }

  const { items } = req.body;
  if (!Array.isArray(items)) {
    return res.status(400).json({ error: { message: 'items must be an array', code: 'VALIDATION_ERROR' } });
  }

  try {
    let totalUpdated = 0;
    for (const item of items) {
      if (!item.name) continue;
      const dueDate = item.dueDate !== undefined
        ? (item.dueDate ? new Date(item.dueDate) : null)
        : undefined;

      if (dueDate === undefined) continue;

      // 1. Update the checklist_defaults row
      await prisma.$executeRaw`
        UPDATE checklist_defaults
        SET due_date = ${dueDate}::date, updated_at = NOW()
        WHERE name = ${item.name}
      `;

      // 2. Propagate to all GPP events' checklist_items
      const result = await prisma.$executeRaw`
        UPDATE checklist_items ci
        SET due_date = ${dueDate}::date, updated_at = NOW()
        FROM parties p
        WHERE ci.party_id = p.id
          AND p.event_type = 'gpp'
          AND ci.is_default = true
          AND ci.name = ${item.name}
      `;
      totalUpdated += result;
    }

    res.json({ success: true, totalUpdated });
  } catch (error: any) {
    res.status(500).json({ error: { message: 'Update failed: ' + error.message } });
  }
});

// POST /api/admin/checklist-defaults — Add new item to defaults + all GPP events
router.post('/checklist-defaults', requireAuth, async (req: AuthRequest, res: Response) => {
  if (!(await rawIsSuperAdmin(req.userEmail))) {
    return res.status(403).json({ error: { message: 'Only super admins can add checklist items', code: 'FORBIDDEN' } });
  }

  const { name, dueDate } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: { message: 'Name is required', code: 'VALIDATION_ERROR' } });
  }

  try {
    const trimmedName = name.trim();
    const parsedDate = dueDate ? new Date(dueDate) : null;

    // Get next sort_order from checklist_defaults
    const maxResult = await prisma.$queryRaw<Array<{ max_sort: number | null }>>`
      SELECT MAX(sort_order) as max_sort FROM checklist_defaults
    `;
    const nextSort = (maxResult[0]?.max_sort ?? -1) + 1;

    // 1. Insert into checklist_defaults
    await prisma.$executeRaw`
      INSERT INTO checklist_defaults (name, due_date, is_auto, sort_order)
      VALUES (${trimmedName}, ${parsedDate}::date, false, ${nextSort})
    `;

    // 2. Insert into all GPP events' checklist_items
    const result = await prisma.$executeRaw`
      INSERT INTO checklist_items (id, party_id, name, due_date, is_auto, is_default, sort_order, created_at, updated_at)
      SELECT gen_random_uuid(), p.id, ${trimmedName}, ${parsedDate}::date, false, true, ${nextSort}, NOW(), NOW()
      FROM parties p
      WHERE p.event_type = 'gpp'
    `;

    res.status(201).json({ success: true, createdCount: result });
  } catch (error: any) {
    if (error.message?.includes('unique') || error.message?.includes('duplicate')) {
      return res.status(400).json({ error: { message: 'An item with that name already exists', code: 'DUPLICATE' } });
    }
    res.status(500).json({ error: { message: 'Failed to add item: ' + error.message } });
  }
});

export default router;
