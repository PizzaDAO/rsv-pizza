import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
// marinara-71630: BEST_OF_BONUS is now config-sourced via getBestOfBonus().
// SCORECARD_LEADERBOARD_ITEMS is a non-sensitive public item-key list (stays in source).
import { getBestOfBonus, SCORECARD_LEADERBOARD_ITEMS } from '../lib/scorecardScore.js';

const router = Router();

// All valid scorecard item keys (excluding pizza_chef which is computed)
const SCORECARD_ITEMS = [
  'post',
  'photo',
  'vouch',
  'pizza_selfie',
  'sign_pizza_box',
  'join_telegram',
  'follow_pizzadao',
  'signup_pizzadao',
  // panzerotti-58931: Photo Game challenges
  'photo_box_stack',
  'photo_host',
  'photo_partner',
] as const;

type ScorecardItemKey = typeof SCORECARD_ITEMS[number];

// panzerotti-58931: map each item key to a game category. Used by the frontend
// hub to split items between the "Missions" and "Photo Game" surfaces. No
// schema change — category is derived server-side and attached to responses.
const CATEGORY: Record<ScorecardItemKey, 'mission' | 'photo'> = {
  post: 'mission',
  vouch: 'mission',
  join_telegram: 'mission',
  follow_pizzadao: 'mission',
  signup_pizzadao: 'mission',
  photo: 'photo',
  pizza_selfie: 'photo',
  sign_pizza_box: 'photo',
  photo_box_stack: 'photo',
  photo_host: 'photo',
  photo_partner: 'photo',
};

function categoryFor(itemKey: string): 'mission' | 'photo' | undefined {
  return CATEGORY[itemKey as ScorecardItemKey];
}

// panzerotti-58931: superlative submission keys (separate table, not scorecard items)
const SUPERLATIVE_KEYS = ['super_slices', 'super_cheese_pull', 'super_box_stack'] as const;
type SuperlativeKey = typeof SUPERLATIVE_KEYS[number];

// panzerotti-58931 Phase 2.1: human labels for "Best Of" superlatives. Used on
// the guest scorecard to show which wins a guest earned, and on the admin
// judging queue. Keep in sync with SUPERLATIVE_KEYS.
const SUPERLATIVE_LABELS: Record<string, string> = {
  super_slices: 'Most people with a slice',
  super_cheese_pull: 'Best cheese pull',
  super_box_stack: 'Tallest box stack',
};

function superlativeLabel(key: string): string {
  return SUPERLATIVE_LABELS[key] ?? key;
}

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

// Helper: find the authenticated user's guest record for a party.
// mushroom-31723: rejected guests (approved=false) are excluded so they
// can't view or edit their scorecard.
async function findGuestForUser(partyId: string, userEmail?: string) {
  if (!userEmail) return null;
  return prisma.guest.findFirst({
    where: {
      partyId,
      email: userEmail.toLowerCase(),
      OR: [{ approved: true }, { approved: null }],
    },
    select: { id: true, checkedInAt: true },
  });
}

// Helper: seed default scorecard items for a guest
async function seedScorecardItems(guestId: string, partyId: string) {
  const existingItems = await prisma.guestScorecardItem.findMany({
    where: { guestId, partyId },
  });

  if (existingItems.length === 0) {
    // First time: seed all items
    const items = SCORECARD_ITEMS.map((key) => ({
      guestId,
      partyId,
      itemKey: key,
      completed: false,
      metadata: {},
    }));
    await prisma.guestScorecardItem.createMany({ data: items });
  } else {
    // Backfill any missing items (e.g. new items added after initial seed)
    const existingKeys = new Set(existingItems.map((i) => i.itemKey));
    const missing = SCORECARD_ITEMS.filter((key) => !existingKeys.has(key));
    if (missing.length > 0) {
      await prisma.guestScorecardItem.createMany({
        data: missing.map((key) => ({
          guestId,
          partyId,
          itemKey: key,
          completed: false,
          metadata: {},
        })),
      });
    }
  }

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

    // panzerotti-58931 Phase 2.1: the calling guest's judged "Best Of" wins.
    const winnerRows = await prisma.superlativeSubmission.findMany({
      where: { guestId: guest.id, partyId: party.id, status: 'winner' },
      select: { superlativeKey: true },
    });
    const bestOfWins = winnerRows.map((r) => ({
      superlativeKey: r.superlativeKey,
      label: superlativeLabel(r.superlativeKey),
    }));

    res.json({
      items: items.map((item) => ({ ...item, category: categoryFor(item.itemKey) })),
      pizzaChefScore: completedCount,
      totalItems: SCORECARD_ITEMS.length,
      bestOfWins,
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
      item: { ...item, category: categoryFor(item.itemKey) },
      pizzaChefScore: completedCount,
      totalItems: SCORECARD_ITEMS.length,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/scorecard/:inviteCode/leaderboard — checked-in guests ranked by
// completed-item count. panzerotti-58931.
router.get('/:inviteCode/leaderboard', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Checked-in guests with their completed-item count. Rejected guests
    // (approved=false) are excluded to mirror findGuestForUser.
    const guests = await prisma.guest.findMany({
      where: {
        partyId: party.id,
        checkedInAt: { not: null },
        OR: [{ approved: true }, { approved: null }],
      },
      select: {
        id: true,
        name: true,
        email: true,
        // panzerotti-58931: de-duped item set — exclude generic photo /
        // pizza_selfie (they overlap engagement's approved-photo count on the
        // unified board). Mirrors SCORECARD_LEADERBOARD_ITEMS so This-Party and
        // the worldwide board agree on per-guest points.
        scorecardItems: {
          where: {
            completed: true,
            itemKey: { in: SCORECARD_LEADERBOARD_ITEMS as unknown as string[] },
          },
          select: { id: true },
        },
        // panzerotti-58931 Phase 2.1: Best Of wins add BEST_OF_BONUS each.
        superlativeSubmissions: {
          where: { status: 'winner' },
          select: { id: true },
        },
      },
    });

    const callerEmail = req.userEmail?.toLowerCase();

    // Resolve the Best Of bonus from app_config (cached 60s). Placeholder used
    // if the private.scoring_weights row is briefly absent.
    const bestOfBonus = await getBestOfBonus();

    const privacyName = (raw: string | null | undefined): string => {
      const trimmed = (raw || '').trim();
      if (!trimmed) return 'Guest';
      const parts = trimmed.split(/\s+/);
      const first = parts[0];
      const lastInitial = parts.length > 1 ? parts[parts.length - 1][0] : '';
      return lastInitial ? `${first} ${lastInitial.toUpperCase()}.` : first;
    };

    const leaderboard = guests
      .map((g) => ({
        guestId: g.id,
        name: privacyName(g.name),
        score: g.scorecardItems.length + g.superlativeSubmissions.length * bestOfBonus,
        isCurrentUser: !!callerEmail && g.email?.toLowerCase() === callerEmail,
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.name.localeCompare(b.name);
      });

    res.json({ leaderboard });
  } catch (error) {
    next(error);
  }
});

// POST /api/scorecard/:inviteCode/superlative — submit a superlative entry for
// later judging. Worth 0 points until judged (Phase 2). panzerotti-58931.
router.post('/:inviteCode/superlative', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { superlativeKey, photoUrl, numericValue } = req.body;

    if (!superlativeKey || !SUPERLATIVE_KEYS.includes(superlativeKey as SuperlativeKey)) {
      throw new AppError(
        `Invalid superlativeKey. Must be one of: ${SUPERLATIVE_KEYS.join(', ')}`,
        400,
        'VALIDATION_ERROR'
      );
    }

    if (!photoUrl || typeof photoUrl !== 'string') {
      throw new AppError('photoUrl is required', 400, 'VALIDATION_ERROR');
    }

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    const guest = await findGuestForUser(party.id, req.userEmail);
    if (!guest) {
      throw new AppError('You must be an RSVPd guest to submit a superlative', 403, 'NOT_A_GUEST');
    }

    if (!guest.checkedInAt) {
      throw new AppError('You must be checked in to submit a superlative', 403, 'NOT_CHECKED_IN');
    }

    let numeric: number | null = null;
    if (numericValue !== undefined && numericValue !== null && numericValue !== '') {
      const parsed = Number(numericValue);
      numeric = Number.isFinite(parsed) ? Math.trunc(parsed) : null;
    }

    // UPSERT one row per (guestId, partyId, superlativeKey). Re-submit replaces
    // the prior entry and resets status to 'pending'.
    const row = await prisma.superlativeSubmission.upsert({
      where: {
        guestId_partyId_superlativeKey: {
          guestId: guest.id,
          partyId: party.id,
          superlativeKey,
        },
      },
      create: {
        guestId: guest.id,
        partyId: party.id,
        superlativeKey,
        photoUrl,
        numericValue: numeric,
        status: 'pending',
      },
      update: {
        photoUrl,
        numericValue: numeric,
        status: 'pending',
        judgedBy: null,
        judgedAt: null,
      },
    });

    res.json({ submission: row });
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
