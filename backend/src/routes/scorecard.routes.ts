import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// All valid scorecard item keys (excluding pizza_chef which is computed)
const SCORECARD_ITEMS = [
  'post',
  'photo',
  'vouch',
  'pizza_selfie',
  'follow_pizzadao',
  'signup_pizzadao',
] as const;

type ScorecardItemKey = typeof SCORECARD_ITEMS[number];

// Helper: find party by inviteCode or customUrl
async function findPartyByCode(inviteCode: string) {
  let party = await prisma.party.findUnique({
    where: { inviteCode },
    select: { id: true },
  });

  if (!party) {
    party = await prisma.party.findUnique({
      where: { customUrl: inviteCode },
      select: { id: true },
    });
  }

  // Alias fallback
  if (!party) {
    const alias = await prisma.slugAlias.findUnique({
      where: { oldSlug: inviteCode },
      select: { partyId: true },
    });
    if (alias) {
      party = await prisma.party.findUnique({
        where: { id: alias.partyId },
        select: { id: true },
      });
    }
  }

  return party;
}

// Helper: find the authenticated user's guest record for a party
async function findGuestForUser(partyId: string, userEmail?: string) {
  if (!userEmail) return null;
  return prisma.guest.findFirst({
    where: {
      partyId,
      email: userEmail.toLowerCase(),
    },
    select: { id: true, checkedInAt: true },
  });
}

// Helper: seed default scorecard items for a guest
async function seedScorecardItems(guestId: string, partyId: string) {
  const existingItems = await prisma.guestScorecardItem.findMany({
    where: { guestId, partyId },
  });

  if (existingItems.length > 0) return existingItems;

  const items = SCORECARD_ITEMS.map((key) => ({
    guestId,
    partyId,
    itemKey: key,
    completed: false,
    metadata: {},
  }));

  await prisma.guestScorecardItem.createMany({ data: items });

  return prisma.guestScorecardItem.findMany({
    where: { guestId, partyId },
    orderBy: { createdAt: 'asc' },
  });
}

// GET /api/scorecard/:inviteCode — Returns scorecard state for the authenticated guest
router.get('/:inviteCode', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    const guest = await findGuestForUser(party.id, req.userEmail);
    if (!guest) {
      throw new AppError('You must be an RSVPd guest to view your scorecard', 403, 'NOT_A_GUEST');
    }

    // Seed items if none exist
    const items = await seedScorecardItems(guest.id, party.id);

    // Compute Pizza Chef score (number of completed items)
    const completedCount = items.filter((item) => item.completed).length;

    res.json({
      items,
      pizzaChefScore: completedCount,
      totalItems: SCORECARD_ITEMS.length,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/scorecard/:inviteCode/complete — Marks an item complete
router.post('/:inviteCode/complete', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { itemKey, proofUrl, proofType } = req.body;

    if (!itemKey || !SCORECARD_ITEMS.includes(itemKey as ScorecardItemKey)) {
      throw new AppError(
        `Invalid itemKey. Must be one of: ${SCORECARD_ITEMS.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    const guest = await findGuestForUser(party.id, req.userEmail);
    if (!guest) {
      throw new AppError('You must be an RSVPd guest to update your scorecard', 403, 'NOT_A_GUEST');
    }

    if (!guest.checkedInAt) {
      throw new AppError('You must be checked in to complete scorecard items', 403, 'NOT_CHECKED_IN');
    }

    // Seed items if needed
    await seedScorecardItems(guest.id, party.id);

    // Upsert the item as completed
    const item = await prisma.guestScorecardItem.update({
      where: {
        guestId_partyId_itemKey: {
          guestId: guest.id,
          partyId: party.id,
          itemKey,
        },
      },
      data: {
        completed: true,
        completedAt: new Date(),
        proofUrl: proofUrl || null,
        proofType: proofType || 'self_report',
      },
    });

    // Recalculate Pizza Chef score
    const allItems = await prisma.guestScorecardItem.findMany({
      where: { guestId: guest.id, partyId: party.id },
    });
    const completedCount = allItems.filter((i) => i.completed).length;

    res.json({
      item,
      pizzaChefScore: completedCount,
      totalItems: SCORECARD_ITEMS.length,
    });
  } catch (error) {
    next(error);
  }
});

export default router;

// Export helper for auto-completion from other routes
export async function autoCompleteScorecardItem(
  guestId: string,
  partyId: string,
  itemKey: string,
  proofUrl?: string,
  proofType?: string
) {
  try {
    // Only complete if item key is valid
    if (!SCORECARD_ITEMS.includes(itemKey as ScorecardItemKey)) return;

    // Ensure items are seeded
    const existing = await prisma.guestScorecardItem.findUnique({
      where: {
        guestId_partyId_itemKey: {
          guestId,
          partyId,
          itemKey,
        },
      },
    });

    if (!existing) {
      // Seed all items first
      await seedScorecardItems(guestId, partyId);
    }

    // Mark as complete (skip if already completed)
    await prisma.guestScorecardItem.update({
      where: {
        guestId_partyId_itemKey: {
          guestId,
          partyId,
          itemKey,
        },
      },
      data: {
        completed: true,
        completedAt: new Date(),
        proofUrl: proofUrl || null,
        proofType: proofType || 'auto',
      },
    });
  } catch (error) {
    // Silently fail — auto-completion should not break the main flow
    console.error(`[scorecard] auto-complete failed for ${itemKey}:`, error);
  }
}
