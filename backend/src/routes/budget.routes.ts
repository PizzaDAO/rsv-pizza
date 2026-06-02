import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, isSuperAdmin, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { Decimal } from '@prisma/client/runtime/library';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';

const router = Router();

// All budget routes require authentication
router.use(requireAuth);

// Budget item categories
export const BUDGET_CATEGORIES = [
  'pizza',
  'drinks',
  'venue',
  'supplies',
  'entertainment',
  'tips',
  'other',
] as const;

export type BudgetCategory = typeof BUDGET_CATEGORIES[number];

// Budget item status
export const BUDGET_STATUSES = ['pending', 'paid'] as const;
export type BudgetStatus = typeof BUDGET_STATUSES[number];

// GET /api/parties/:partyId/budget - Get budget overview and items
router.get('/:partyId/budget', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to budget tab
    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'budget');
    if (!canAccess) {
      throw new AppError('You do not have access to the budget tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Get party budget settings
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        budgetEnabled: true,
        budgetTotal: true,
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Get all non-deleted budget items. provolone-58931: soft-deleted items are
    // excluded from the working set so they never affect any total/category math.
    const items = await prisma.budgetItem.findMany({
      where: { partyId, deletedAt: null },
      orderBy: [
        { category: 'asc' },
        { createdAt: 'desc' },
      ],
    });

    // provolone-58931: super-admins additionally see soft-deleted items, rendered
    // greyed with a Restore action. They carry deletedAt and are appended AFTER
    // the totals are computed so they never influence spend/category math.
    const deletedItems = (await isSuperAdmin(req.userEmail))
      ? await prisma.budgetItem.findMany({
          where: { partyId, deletedAt: { not: null } },
          orderBy: [
            { category: 'asc' },
            { createdAt: 'desc' },
          ],
        })
      : [];

    // Calculate totals
    const totalSpent = items.reduce((sum, item) => sum + Number(item.cost), 0);
    const totalPaid = items
      .filter(item => item.status === 'paid')
      .reduce((sum, item) => sum + Number(item.cost), 0);
    const totalPending = items
      .filter(item => item.status === 'pending')
      .reduce((sum, item) => sum + Number(item.cost), 0);

    // Calculate category totals
    const categoryTotals = BUDGET_CATEGORIES.reduce((acc, category) => {
      const categoryItems = items.filter(item => item.category === category);
      acc[category] = {
        total: categoryItems.reduce((sum, item) => sum + Number(item.cost), 0),
        paid: categoryItems
          .filter(item => item.status === 'paid')
          .reduce((sum, item) => sum + Number(item.cost), 0),
        pending: categoryItems
          .filter(item => item.status === 'pending')
          .reduce((sum, item) => sum + Number(item.cost), 0),
        count: categoryItems.length,
      };
      return acc;
    }, {} as Record<string, { total: number; paid: number; pending: number; count: number }>);

    res.json({
      budgetEnabled: party.budgetEnabled,
      budgetTotal: party.budgetTotal ? Number(party.budgetTotal) : null,
      totalSpent,
      totalPaid,
      totalPending,
      remaining: party.budgetTotal ? Number(party.budgetTotal) - totalSpent : null,
      categoryTotals,
      items: [...items, ...deletedItems].map(item => ({
        ...item,
        cost: Number(item.cost),
      })),
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/budget/settings - Update budget settings
router.patch('/:partyId/budget/settings', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { budgetEnabled, budgetTotal } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to budget tab
    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'budget');
    if (!canAccess) {
      throw new AppError('You do not have access to the budget tab', 403, 'TAB_ACCESS_DENIED');
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: {
        ...(budgetEnabled !== undefined && { budgetEnabled }),
        ...(budgetTotal !== undefined && {
          budgetTotal: budgetTotal !== null ? new Decimal(budgetTotal) : null,
        }),
      },
      select: {
        budgetEnabled: true,
        budgetTotal: true,
      },
    });

    res.json({
      budgetEnabled: party.budgetEnabled,
      budgetTotal: party.budgetTotal ? Number(party.budgetTotal) : null,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/budget/items - Create budget item
router.post('/:partyId/budget/items', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { name, category, cost, status, pointPerson, notes, receiptUrl } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to budget tab
    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'budget');
    if (!canAccess) {
      throw new AppError('You do not have access to the budget tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    if (!category || !BUDGET_CATEGORIES.includes(category)) {
      throw new AppError(`Category must be one of: ${BUDGET_CATEGORIES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    if (cost === undefined || cost === null || isNaN(Number(cost)) || Number(cost) < 0) {
      throw new AppError('Cost must be a non-negative number', 400, 'VALIDATION_ERROR');
    }

    if (status && !BUDGET_STATUSES.includes(status)) {
      throw new AppError(`Status must be one of: ${BUDGET_STATUSES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const item = await prisma.budgetItem.create({
      data: {
        partyId,
        name: name.trim(),
        category,
        cost: new Decimal(cost),
        status: status || 'pending',
        pointPerson: pointPerson?.trim() || null,
        notes: notes?.trim() || null,
        receiptUrl: receiptUrl?.trim() || null,
      },
    });

    res.status(201).json({
      item: {
        ...item,
        cost: Number(item.cost),
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/budget/items/:itemId - Update budget item
router.patch('/:partyId/budget/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, itemId } = req.params;
    const { name, category, cost, status, pointPerson, notes, receiptUrl } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to budget tab
    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'budget');
    if (!canAccess) {
      throw new AppError('You do not have access to the budget tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Validate category if provided
    if (category !== undefined && !BUDGET_CATEGORIES.includes(category)) {
      throw new AppError(`Category must be one of: ${BUDGET_CATEGORIES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate cost if provided
    if (cost !== undefined && (isNaN(Number(cost)) || Number(cost) < 0)) {
      throw new AppError('Cost must be a non-negative number', 400, 'VALIDATION_ERROR');
    }

    // Validate status if provided
    if (status !== undefined && !BUDGET_STATUSES.includes(status)) {
      throw new AppError(`Status must be one of: ${BUDGET_STATUSES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const item = await prisma.budgetItem.update({
      where: { id: itemId, partyId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(category !== undefined && { category }),
        ...(cost !== undefined && { cost: new Decimal(cost) }),
        ...(status !== undefined && { status }),
        ...(pointPerson !== undefined && { pointPerson: pointPerson?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(receiptUrl !== undefined && { receiptUrl: receiptUrl?.trim() || null }),
      },
    });

    res.json({
      item: {
        ...item,
        cost: Number(item.cost),
      },
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/budget/items/:itemId - Delete budget item
router.delete('/:partyId/budget/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, itemId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to budget tab
    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'budget');
    if (!canAccess) {
      throw new AppError('You do not have access to the budget tab', 403, 'TAB_ACCESS_DENIED');
    }

    // provolone-58931: soft delete so super-admins can still see/restore the item.
    await prisma.budgetItem.update({
      where: { id: itemId, partyId },
      data: { deletedAt: new Date() },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/budget/items/:itemId/restore - Restore a soft-deleted
// budget item (super-admin only). provolone-58931.
router.post('/:partyId/budget/items/:itemId/restore', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, itemId } = req.params;

    if (!(await isSuperAdmin(req.userEmail))) {
      throw new AppError('Forbidden', 403, 'FORBIDDEN');
    }

    await prisma.budgetItem.update({
      where: { id: itemId, partyId },
      data: { deletedAt: null },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/budget/items/:itemId/toggle-status - Toggle item status
router.post('/:partyId/budget/items/:itemId/toggle-status', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, itemId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to budget tab
    const canAccess = await canUserAccessTab(partyId, req.userEmail, req.userId, 'budget');
    if (!canAccess) {
      throw new AppError('You do not have access to the budget tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Get current status. provolone-58931: switched findUnique -> findFirst so we
    // can also exclude soft-deleted items (deletedAt isn't a unique field).
    const existing = await prisma.budgetItem.findFirst({
      where: { id: itemId, partyId, deletedAt: null },
      select: { status: true },
    });

    if (!existing) {
      throw new AppError('Budget item not found', 404, 'NOT_FOUND');
    }

    // Toggle status
    const newStatus = existing.status === 'paid' ? 'pending' : 'paid';

    const item = await prisma.budgetItem.update({
      where: { id: itemId, partyId },
      data: { status: newStatus },
    });

    res.json({
      item: {
        ...item,
        cost: Number(item.cost),
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
