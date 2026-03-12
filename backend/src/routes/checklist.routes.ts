import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Helper function to check if user can edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

// Default GPP checklist items
const DEFAULT_CHECKLIST_ITEMS = [
  {
    name: 'Create Event',
    dueDate: null,
    isAuto: true,
    autoRule: 'event_created',
    linkTab: null,
    sortOrder: 0,
    isDefault: true,
  },
  {
    name: 'Request Party Kit',
    dueDate: null,
    isAuto: true,
    autoRule: 'party_kit_submitted',
    linkTab: 'gpp',
    sortOrder: 1,
    isDefault: true,
  },
  {
    name: 'Build a Team',
    dueDate: null,
    isAuto: true,
    autoRule: 'team_built',
    linkTab: 'details',
    sortOrder: 2,
    isDefault: true,
  },
  {
    name: 'Find a Venue',
    dueDate: null,
    isAuto: true,
    autoRule: 'venue_added',
    linkTab: 'venue',
    sortOrder: 3,
    isDefault: true,
  },
  {
    name: 'Set Up Budget',
    dueDate: null,
    isAuto: true,
    autoRule: 'budget_submitted',
    linkTab: 'budget',
    sortOrder: 4,
    isDefault: true,
  },
  {
    name: 'Find Partners',
    dueDate: null,
    isAuto: false,
    autoRule: null,
    linkTab: 'sponsors',
    sortOrder: 5,
    isDefault: true,
  },
  {
    name: 'Prepare for the Party',
    dueDate: null,
    isAuto: false,
    autoRule: null,
    linkTab: null,
    sortOrder: 6,
    isDefault: true,
  },
  {
    name: 'Post to Socials',
    dueDate: null,
    isAuto: false,
    autoRule: null,
    linkTab: 'promo',
    sortOrder: 7,
    isDefault: true,
  },
  {
    name: 'Throw the Party',
    dueDate: null,
    isAuto: false,
    autoRule: null,
    linkTab: null,
    sortOrder: 8,
    isDefault: true,
  },
];

const router = Router();

// All checklist routes require authentication
router.use(requireAuth);

// GET /:partyId/checklist - Get items + auto-complete state data
router.get('/:partyId/checklist', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Get all checklist items
    const items = await prisma.checklistItem.findMany({
      where: { partyId },
      orderBy: { sortOrder: 'asc' },
    });

    // Compute auto-complete states
    // 1. party_kit_submitted: party_kits has record for this party
    const partyKit = await prisma.partyKit.findUnique({
      where: { partyId },
      select: { id: true },
    });

    // 2. venue_added: party.venue_name is set OR venues table has an entry with isSelected
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { venueName: true, coHosts: true, userId: true, region: true, user: { select: { email: true, name: true } } },
    });
    const selectedVenue = await prisma.venue.findFirst({
      where: { partyId, isSelected: true },
      select: { id: true },
    });

    // 3. budget_submitted: budget_items has items for this party
    const budgetItemCount = await prisma.budgetItem.count({
      where: { partyId },
    });

    // 4. team_built: has co-hosts beyond PizzaDAO, the host, and their region's underboss
    const coHosts = Array.isArray(party?.coHosts) ? party.coHosts as Array<{ name?: string; email?: string }> : [];

    // Get underboss emails for this party's region
    let underbossEmails: string[] = [];
    if (party?.region) {
      const underbosses = await prisma.underboss.findMany({
        where: {
          isActive: true,
          OR: [
            { region: party.region },
            { regions: { has: party.region } },
          ],
        },
        select: { email: true },
      });
      underbossEmails = underbosses.map(u => u.email.toLowerCase());
    }

    const hostEmail = party?.user?.email?.toLowerCase() || '';
    const hostName = party?.user?.name?.toLowerCase() || '';

    const realCoHosts = coHosts.filter(h => {
      const email = (h.email || '').toLowerCase();
      const name = (h.name || '').toLowerCase();

      // Exclude PizzaDAO
      if (name === 'pizzadao' || email === 'hello@rarepizzas.com') return false;

      // Exclude the host themselves
      if (hostEmail && email === hostEmail) return false;
      if (hostName && name === hostName && !email) return false;

      // Exclude underbosses
      if (email && underbossEmails.includes(email)) return false;

      return true;
    });

    const teamBuilt = realCoHosts.length > 0;

    const autoCompleteStates = {
      event_created: true,
      party_kit_submitted: !!partyKit,
      venue_added: !!(party?.venueName) || !!selectedVenue,
      budget_submitted: budgetItemCount > 0,
      team_built: teamBuilt,
    };

    // Check if defaults have been seeded with current version
    const defaultCount = await prisma.checklistItem.count({
      where: { partyId, isDefault: true },
    });

    res.json({
      items,
      autoCompleteStates,
      seeded: defaultCount === DEFAULT_CHECKLIST_ITEMS.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /:partyId/checklist/seed - Seed default GPP items (idempotent)
router.post('/:partyId/checklist/seed', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Check if already seeded (idempotent)
    const existingDefaults = await prisma.checklistItem.count({
      where: { partyId, isDefault: true },
    });

    if (existingDefaults === DEFAULT_CHECKLIST_ITEMS.length) {
      // Already seeded with current version, return existing items
      const items = await prisma.checklistItem.findMany({
        where: { partyId },
        orderBy: { sortOrder: 'asc' },
      });
      res.json({ items, seeded: true });
      return;
    }

    // Delete stale defaults if any (preserves custom items)
    if (existingDefaults > 0) {
      await prisma.checklistItem.deleteMany({
        where: { partyId, isDefault: true },
      });
    }

    // Seed defaults
    await prisma.checklistItem.createMany({
      data: DEFAULT_CHECKLIST_ITEMS.map(item => ({
        ...item,
        partyId,
      })),
    });

    const items = await prisma.checklistItem.findMany({
      where: { partyId },
      orderBy: { sortOrder: 'asc' },
    });

    res.status(201).json({ items, seeded: true });
  } catch (error) {
    next(error);
  }
});

// POST /:partyId/checklist/items - Create custom item
router.post('/:partyId/checklist/items', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { name, dueDate } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Get the highest sort_order to append at end
    const maxSort = await prisma.checklistItem.aggregate({
      where: { partyId },
      _max: { sortOrder: true },
    });

    const item = await prisma.checklistItem.create({
      data: {
        partyId,
        name: name.trim(),
        dueDate: dueDate ? new Date(dueDate) : null,
        isAuto: false,
        isDefault: false,
        sortOrder: (maxSort._max.sortOrder ?? -1) + 1,
      },
    });

    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});

// PATCH /:partyId/checklist/items/:itemId - Update item
router.patch('/:partyId/checklist/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, itemId } = req.params;
    const { name, dueDate, sortOrder } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const item = await prisma.checklistItem.update({
      where: { id: itemId, partyId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(dueDate !== undefined && { dueDate: dueDate ? new Date(dueDate) : null }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

// DELETE /:partyId/checklist/items/:itemId - Delete custom item (not defaults)
router.delete('/:partyId/checklist/items/:itemId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, itemId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Check if it's a default item
    const existing = await prisma.checklistItem.findUnique({
      where: { id: itemId, partyId },
      select: { isDefault: true },
    });

    if (!existing) {
      throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
    }

    if (existing.isDefault) {
      throw new AppError('Cannot delete default checklist items', 400, 'VALIDATION_ERROR');
    }

    await prisma.checklistItem.delete({
      where: { id: itemId, partyId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /:partyId/checklist/items/:itemId/toggle - Toggle manual completion
router.post('/:partyId/checklist/items/:itemId/toggle', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, itemId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Get current state
    const existing = await prisma.checklistItem.findUnique({
      where: { id: itemId, partyId },
      select: { completed: true, isAuto: true },
    });

    if (!existing) {
      throw new AppError('Checklist item not found', 404, 'NOT_FOUND');
    }

    // Cannot toggle auto items manually
    if (existing.isAuto) {
      throw new AppError('Cannot toggle auto-complete items manually', 400, 'VALIDATION_ERROR');
    }

    // Toggle completion
    const newCompleted = !existing.completed;

    const item = await prisma.checklistItem.update({
      where: { id: itemId, partyId },
      data: {
        completed: newCompleted,
        completedAt: newCompleted ? new Date() : null,
      },
    });

    res.json({ item });
  } catch (error) {
    next(error);
  }
});

export default router;
