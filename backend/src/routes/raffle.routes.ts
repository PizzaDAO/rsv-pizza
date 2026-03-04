import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can edit any party
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  // Otherwise, must be the party owner
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

const router = Router();

// GET /api/parties/:partyId/raffles - List all raffles for a party (public)
router.get('/:partyId/raffles', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify party exists
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const raffles = await prisma.raffle.findMany({
      where: { partyId },
      include: {
        prizes: {
          orderBy: { createdAt: 'asc' },
        },
        entries: {
          include: {
            guest: { select: { id: true, name: true } },
          },
        },
        winners: {
          include: {
            guest: { select: { id: true, name: true } },
            prize: { select: { id: true, name: true } },
          },
        },
        _count: {
          select: { entries: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ raffles });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/raffles - Create a new raffle (host only)
router.post('/:partyId/raffles', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { name, description, entriesPerGuest = 1 } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    const raffle = await prisma.raffle.create({
      data: {
        partyId,
        name: name.trim(),
        description: description?.trim() || null,
        entriesPerGuest: Math.max(1, parseInt(entriesPerGuest, 10) || 1),
        status: 'draft',
      },
      include: {
        prizes: true,
        entries: true,
        winners: true,
        _count: { select: { entries: true } },
      },
    });

    res.status(201).json({ raffle });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/raffles/:raffleId - Get single raffle details (public)
router.get('/:partyId/raffles/:raffleId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId } = req.params;

    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, partyId },
      include: {
        prizes: {
          orderBy: { createdAt: 'asc' },
        },
        entries: {
          include: {
            guest: { select: { id: true, name: true } },
          },
        },
        winners: {
          include: {
            guest: { select: { id: true, name: true } },
            prize: { select: { id: true, name: true } },
          },
        },
        _count: { select: { entries: true } },
      },
    });

    if (!raffle) {
      throw new AppError('Raffle not found', 404, 'NOT_FOUND');
    }

    res.json({ raffle });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/raffles/:raffleId - Update a raffle (host only)
router.patch('/:partyId/raffles/:raffleId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId } = req.params;
    const { name, description, status, entriesPerGuest } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if raffle exists
    const existingRaffle = await prisma.raffle.findFirst({
      where: { id: raffleId, partyId },
    });

    if (!existingRaffle) {
      throw new AppError('Raffle not found', 404, 'NOT_FOUND');
    }

    // Validate status transitions
    const validStatuses = ['draft', 'open', 'closed', 'drawn'];
    if (status !== undefined && !validStatuses.includes(status)) {
      throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
    }

    const raffle = await prisma.raffle.update({
      where: { id: raffleId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(status !== undefined && { status }),
        ...(entriesPerGuest !== undefined && { entriesPerGuest: Math.max(1, parseInt(entriesPerGuest, 10) || 1) }),
      },
      include: {
        prizes: true,
        entries: {
          include: {
            guest: { select: { id: true, name: true } },
          },
        },
        winners: {
          include: {
            guest: { select: { id: true, name: true } },
            prize: { select: { id: true, name: true } },
          },
        },
        _count: { select: { entries: true } },
      },
    });

    res.json({ raffle });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/raffles/:raffleId - Delete a raffle (host only)
router.delete('/:partyId/raffles/:raffleId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId } = req.params;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    await prisma.raffle.delete({
      where: { id: raffleId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/raffles/:raffleId/prizes - Add a prize to a raffle (host only)
router.post('/:partyId/raffles/:raffleId/prizes', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId } = req.params;
    const { name, description, imageUrl, quantity = 1 } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if raffle exists
    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, partyId },
    });

    if (!raffle) {
      throw new AppError('Raffle not found', 404, 'NOT_FOUND');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Prize name is required', 400, 'VALIDATION_ERROR');
    }

    const prize = await prisma.rafflePrize.create({
      data: {
        raffleId,
        name: name.trim(),
        description: description?.trim() || null,
        imageUrl: imageUrl || null,
        quantity: Math.max(1, parseInt(quantity, 10) || 1),
      },
    });

    res.status(201).json({ prize });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/raffles/:raffleId/prizes/:prizeId - Update a prize (host only)
router.patch('/:partyId/raffles/:raffleId/prizes/:prizeId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId, prizeId } = req.params;
    const { name, description, imageUrl, quantity } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if prize exists
    const existingPrize = await prisma.rafflePrize.findFirst({
      where: { id: prizeId, raffleId },
    });

    if (!existingPrize) {
      throw new AppError('Prize not found', 404, 'NOT_FOUND');
    }

    const prize = await prisma.rafflePrize.update({
      where: { id: prizeId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(imageUrl !== undefined && { imageUrl: imageUrl || null }),
        ...(quantity !== undefined && { quantity: Math.max(1, parseInt(quantity, 10) || 1) }),
      },
    });

    res.json({ prize });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/raffles/:raffleId/prizes/:prizeId - Delete a prize (host only)
router.delete('/:partyId/raffles/:raffleId/prizes/:prizeId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId, prizeId } = req.params;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    await prisma.rafflePrize.delete({
      where: { id: prizeId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/raffles/:raffleId/enter - Guest enters the raffle (public)
router.post('/:partyId/raffles/:raffleId/enter', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId } = req.params;
    const { guestId } = req.body;

    if (!guestId) {
      throw new AppError('Guest ID is required', 400, 'VALIDATION_ERROR');
    }

    // Get raffle with current entry count
    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, partyId },
    });

    if (!raffle) {
      throw new AppError('Raffle not found', 404, 'NOT_FOUND');
    }

    if (raffle.status !== 'open') {
      throw new AppError('Raffle is not open for entries', 400, 'RAFFLE_NOT_OPEN');
    }

    // Verify guest belongs to this party
    const guest = await prisma.guest.findFirst({
      where: { id: guestId, partyId },
    });

    if (!guest) {
      throw new AppError('Guest not found for this party', 404, 'GUEST_NOT_FOUND');
    }

    // Check if guest has already entered (for single entry raffles)
    const existingEntry = await prisma.raffleEntry.findFirst({
      where: { raffleId, guestId },
    });

    if (existingEntry) {
      throw new AppError('You have already entered this raffle', 400, 'ALREADY_ENTERED');
    }

    // Create entry
    const entry = await prisma.raffleEntry.create({
      data: {
        raffleId,
        guestId,
      },
      include: {
        guest: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ entry });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/raffles/:raffleId/entries/:entryId - Remove entry (host only)
router.delete('/:partyId/raffles/:raffleId/entries/:entryId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, entryId } = req.params;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    await prisma.raffleEntry.delete({
      where: { id: entryId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/raffles/:raffleId/draw - Draw winners (host only)
router.post('/:partyId/raffles/:raffleId/draw', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, raffleId } = req.params;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Get raffle with prizes and entries
    const raffle = await prisma.raffle.findFirst({
      where: { id: raffleId, partyId },
      include: {
        prizes: true,
        entries: {
          include: {
            guest: { select: { id: true, name: true } },
          },
        },
        winners: true,
      },
    });

    if (!raffle) {
      throw new AppError('Raffle not found', 404, 'NOT_FOUND');
    }

    if (raffle.status === 'drawn') {
      throw new AppError('Raffle has already been drawn', 400, 'ALREADY_DRAWN');
    }

    if (raffle.entries.length === 0) {
      throw new AppError('No entries to draw from', 400, 'NO_ENTRIES');
    }

    if (raffle.prizes.length === 0) {
      throw new AppError('No prizes to award', 400, 'NO_PRIZES');
    }

    // Fisher-Yates shuffle for random selection
    const shuffledEntries = [...raffle.entries];
    for (let i = shuffledEntries.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffledEntries[i], shuffledEntries[j]] = [shuffledEntries[j], shuffledEntries[i]];
    }

    // Track which guests have won to avoid duplicates (one prize per guest)
    const winnersSet = new Set<string>();
    const newWinners: { prizeId: string; guestId: string }[] = [];

    // For each prize, select winners
    for (const prize of raffle.prizes) {
      for (let q = 0; q < prize.quantity; q++) {
        // Find next available winner who hasn't won yet
        const winner = shuffledEntries.find(entry => !winnersSet.has(entry.guestId));
        if (winner) {
          winnersSet.add(winner.guestId);
          newWinners.push({
            prizeId: prize.id,
            guestId: winner.guestId,
          });
        }
      }
    }

    // Create winner records
    await prisma.raffleWinner.createMany({
      data: newWinners.map(w => ({
        raffleId,
        prizeId: w.prizeId,
        guestId: w.guestId,
      })),
    });

    // Update raffle status to drawn
    const updatedRaffle = await prisma.raffle.update({
      where: { id: raffleId },
      data: { status: 'drawn' },
      include: {
        prizes: true,
        entries: {
          include: {
            guest: { select: { id: true, name: true } },
          },
        },
        winners: {
          include: {
            guest: { select: { id: true, name: true } },
            prize: { select: { id: true, name: true } },
          },
        },
        _count: { select: { entries: true } },
      },
    });

    res.json({ raffle: updatedRaffle });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/raffles/:raffleId/winners/:winnerId/claim - Mark prize as claimed (host only)
router.post('/:partyId/raffles/:raffleId/winners/:winnerId/claim', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, winnerId } = req.params;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const winner = await prisma.raffleWinner.update({
      where: { id: winnerId },
      data: { claimedAt: new Date() },
      include: {
        guest: { select: { id: true, name: true } },
        prize: { select: { id: true, name: true } },
      },
    });

    res.json({ winner });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/raffles/:raffleId/winners/:winnerId/claim - Unmark prize as claimed (host only)
router.delete('/:partyId/raffles/:raffleId/winners/:winnerId/claim', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, winnerId } = req.params;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const winner = await prisma.raffleWinner.update({
      where: { id: winnerId },
      data: { claimedAt: null },
      include: {
        guest: { select: { id: true, name: true } },
        prize: { select: { id: true, name: true } },
      },
    });

    res.json({ winner });
  } catch (error) {
    next(error);
  }
});

export default router;
