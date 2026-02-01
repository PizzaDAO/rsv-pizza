import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can edit any party
  if (isSuperAdmin(userEmail)) {
    return true;
  }

  // Otherwise, must be the party owner
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

const router = Router();

// GET /api/parties/:partyId/sponsors - List all sponsors for a party (public if sponsors enabled)
router.get('/:partyId/sponsors', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Get party to check if sponsors are enabled
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, sponsorsEnabled: true, sponsorSectionTitle: true, userId: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // For public access, only return visible sponsors if sponsors are enabled
    const isHost = await canUserEditParty(partyId, req.userId, req.userEmail);

    // Build query - hosts see all, public only sees visible
    const where: any = { partyId };
    if (!isHost) {
      if (!party.sponsorsEnabled) {
        // Return empty if sponsors not enabled for public
        return res.json({
          sponsors: [],
          sponsorsEnabled: false,
          sponsorSectionTitle: null,
        });
      }
      where.visible = true;
    }

    const sponsors = await prisma.sponsor.findMany({
      where,
      orderBy: [
        { displayOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    res.json({
      sponsors,
      sponsorsEnabled: party.sponsorsEnabled,
      sponsorSectionTitle: party.sponsorSectionTitle,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/sponsors - Create a new sponsor (host only)
router.post('/:partyId/sponsors', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { name, tier, logoUrl, websiteUrl, description, visible } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Validate required fields
    if (!name || !name.trim()) {
      throw new AppError('Sponsor name is required', 400, 'VALIDATION_ERROR');
    }

    // Validate tier if provided
    const validTiers = ['gold', 'silver', 'bronze', 'partner'];
    if (tier && !validTiers.includes(tier)) {
      throw new AppError(`Invalid tier. Must be one of: ${validTiers.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Get the next display order
    const maxOrderSponsor = await prisma.sponsor.findFirst({
      where: { partyId },
      orderBy: { displayOrder: 'desc' },
      select: { displayOrder: true },
    });
    const nextOrder = (maxOrderSponsor?.displayOrder ?? -1) + 1;

    const sponsor = await prisma.sponsor.create({
      data: {
        partyId,
        name: name.trim(),
        tier: tier || 'partner',
        logoUrl: logoUrl?.trim() || null,
        websiteUrl: websiteUrl?.trim() || null,
        description: description?.trim() || null,
        displayOrder: nextOrder,
        visible: visible !== false,
      },
    });

    res.status(201).json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/sponsors/:sponsorId - Get single sponsor details
router.get('/:partyId/sponsors/:sponsorId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

    // Get party to check existence
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, sponsorsEnabled: true, userId: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const sponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!sponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    // Check visibility for non-hosts
    const isHost = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!isHost && (!party.sponsorsEnabled || !sponsor.visible)) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    res.json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/sponsors/:sponsorId - Update sponsor (host only)
router.patch('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;
    const { name, tier, logoUrl, websiteUrl, description, displayOrder, visible } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if sponsor exists
    const existingSponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!existingSponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    // Validate tier if provided
    const validTiers = ['gold', 'silver', 'bronze', 'partner'];
    if (tier !== undefined && !validTiers.includes(tier)) {
      throw new AppError(`Invalid tier. Must be one of: ${validTiers.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const sponsor = await prisma.sponsor.update({
      where: { id: sponsorId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(tier !== undefined && { tier }),
        ...(logoUrl !== undefined && { logoUrl: logoUrl?.trim() || null }),
        ...(websiteUrl !== undefined && { websiteUrl: websiteUrl?.trim() || null }),
        ...(description !== undefined && { description: description?.trim() || null }),
        ...(displayOrder !== undefined && { displayOrder }),
        ...(visible !== undefined && { visible }),
      },
    });

    res.json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/sponsors/:sponsorId - Delete a sponsor (host only)
router.delete('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Get the sponsor first
    const sponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!sponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    await prisma.sponsor.delete({
      where: { id: sponsorId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/sponsors/reorder - Reorder sponsors (host only)
router.post('/:partyId/sponsors/reorder', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { sponsorIds } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Validate sponsorIds is an array
    if (!Array.isArray(sponsorIds)) {
      throw new AppError('sponsorIds must be an array', 400, 'VALIDATION_ERROR');
    }

    // Update display order for each sponsor
    await Promise.all(
      sponsorIds.map((sponsorId: string, index: number) =>
        prisma.sponsor.updateMany({
          where: { id: sponsorId, partyId },
          data: { displayOrder: index },
        })
      )
    );

    // Return updated sponsors
    const sponsors = await prisma.sponsor.findMany({
      where: { partyId },
      orderBy: [
        { displayOrder: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    res.json({ sponsors });
  } catch (error) {
    next(error);
  }
});

export default router;
