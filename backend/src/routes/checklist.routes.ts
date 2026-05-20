import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';

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

    // Verify co-host has access to checklist tab
    const canAccessTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'checklist');
    if (!canAccessTab) {
      throw new AppError('You do not have access to the checklist tab', 403, 'TAB_ACCESS_DENIED');
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

    // 2. venue_added: party.address is set (picking a venue or filling the location autocomplete both write address)
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { address: true, addressIsCityDefault: true, venueName: true, coHosts: true, userId: true, region: true, selectedPizzerias: true, underbossStatus: true, user: { select: { email: true, name: true } } },
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

    const pizzeriasSelected = Array.isArray(party?.selectedPizzerias) && (party!.selectedPizzerias as unknown[]).length > 0;

    const autoCompleteStates = {
      event_created: true,
      party_kit_submitted: !!partyKit,
      venue_added: !!party?.address && !party.addressIsCityDefault,
      budget_submitted: budgetItemCount > 0,
      team_built: teamBuilt,
      pizzerias_selected: pizzeriasSelected,
      underboss_reviewed: !!party?.underbossStatus && party.underbossStatus !== 'pending',
    };

    // Check if defaults have been seeded — compare against checklist_defaults count
    const defaultCount = await prisma.checklistItem.count({
      where: { partyId, isDefault: true },
    });
    const templateCount = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count FROM checklist_defaults
    `;
    const expectedCount = Number(templateCount[0]?.count ?? 0);

    res.json({
      items,
      autoCompleteStates,
      seeded: defaultCount >= expectedCount && expectedCount > 0,
    });
  } catch (error) {
    next(error);
  }
});

// POST /:partyId/checklist/seed - Seed default GPP items from checklist_defaults table
router.post('/:partyId/checklist/seed', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify co-host has access to checklist tab
    const canAccessTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'checklist');
    if (!canAccessTab) {
      throw new AppError('You do not have access to the checklist tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Read template from checklist_defaults
    const defaults = await prisma.$queryRaw<Array<{
      name: string;
      due_date: Date | null;
      is_auto: boolean;
      auto_rule: string | null;
      link_tab: string | null;
      sort_order: number;
    }>>`
      SELECT name, due_date, is_auto, auto_rule, link_tab, sort_order
      FROM checklist_defaults
      ORDER BY sort_order ASC
    `;

    if (defaults.length === 0) {
      const items = await prisma.checklistItem.findMany({
        where: { partyId },
        orderBy: { sortOrder: 'asc' },
      });
      res.json({ items, seeded: true });
      return;
    }

    // Check if already seeded (idempotent)
    const existingDefaults = await prisma.checklistItem.count({
      where: { partyId, isDefault: true },
    });

    if (existingDefaults >= defaults.length) {
      const items = await prisma.checklistItem.findMany({
        where: { partyId },
        orderBy: { sortOrder: 'asc' },
      });
      res.json({ items, seeded: true });
      return;
    }

    // Seed defaults transactionally with row-by-row ON CONFLICT DO NOTHING.
    // The partial unique index `checklist_items_party_default_name_unique`
    // on (party_id, name) WHERE is_default = true guarantees that concurrent
    // seeders cannot both insert the same default row.
    try {
      await prisma.$transaction(async (tx) => {
        // Delete stale defaults if any (preserves custom items).
        // Only triggers when an earlier partial seed exists (count > 0 but < expected).
        if (existingDefaults > 0 && existingDefaults < defaults.length) {
          await tx.checklistItem.deleteMany({
            where: { partyId, isDefault: true },
          });
        }

        for (const d of defaults) {
          await tx.$executeRaw`
            INSERT INTO checklist_items
              (id, party_id, name, due_date, is_auto, auto_rule, link_tab, sort_order, is_default, created_at, updated_at)
            VALUES
              (gen_random_uuid(), ${partyId}::uuid, ${d.name}, ${d.due_date}, ${d.is_auto},
               ${d.auto_rule}, ${d.link_tab}, ${d.sort_order}, true, now(), now())
            ON CONFLICT ON CONSTRAINT checklist_items_party_default_name_unique DO NOTHING
          `;
        }
      });
    } catch (err: any) {
      // P2002 = unique violation; another concurrent seeder won. Fall through to re-fetch.
      if (err?.code !== 'P2002') throw err;
    }

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

    // Verify co-host has access to checklist tab
    const canAccessTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'checklist');
    if (!canAccessTab) {
      throw new AppError('You do not have access to the checklist tab', 403, 'TAB_ACCESS_DENIED');
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

    // Verify co-host has access to checklist tab
    const canAccessTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'checklist');
    if (!canAccessTab) {
      throw new AppError('You do not have access to the checklist tab', 403, 'TAB_ACCESS_DENIED');
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

    // Verify co-host has access to checklist tab
    const canAccessTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'checklist');
    if (!canAccessTab) {
      throw new AppError('You do not have access to the checklist tab', 403, 'TAB_ACCESS_DENIED');
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

    // Verify co-host has access to checklist tab
    const canAccessTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'checklist');
    if (!canAccessTab) {
      throw new AppError('You do not have access to the checklist tab', 403, 'TAB_ACCESS_DENIED');
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
