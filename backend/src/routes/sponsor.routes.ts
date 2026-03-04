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

// GET /api/parties/:partyId/sponsors - List all sponsors for a party
router.get('/:partyId/sponsors', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { status, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Build query filters
    const where: any = { partyId };

    if (status && typeof status === 'string') {
      where.status = status;
    }

    // Valid sort fields
    const validSortFields = ['createdAt', 'name', 'amount', 'lastContactedAt', 'status'];
    const sortField = validSortFields.includes(sortBy as string) ? sortBy : 'createdAt';
    const order = sortOrder === 'asc' ? 'asc' : 'desc';

    const sponsors = await prisma.sponsor.findMany({
      where,
      orderBy: { [sortField as string]: order },
    });

    res.json({ sponsors });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/sponsors/stats - Get pipeline statistics
router.get('/:partyId/sponsors/stats', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Get party with fundraising goal
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { fundraisingGoal: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Get sponsors for this party
    const sponsors = await prisma.sponsor.findMany({
      where: { partyId },
      select: {
        status: true,
        amount: true,
      },
    });

    // Count by status
    const statusCounts: Record<string, number> = {
      todo: 0,
      asked: 0,
      yes: 0,
      billed: 0,
      paid: 0,
      stuck: 0,
      alum: 0,
      skip: 0,
    };

    let totalConfirmed = 0;

    for (const sponsor of sponsors) {
      statusCounts[sponsor.status] = (statusCounts[sponsor.status] || 0) + 1;

      // Only count amounts for yes, billed, paid statuses
      if (['yes', 'billed', 'paid'].includes(sponsor.status) && sponsor.amount) {
        totalConfirmed += Number(sponsor.amount);
      }
    }

    res.json({
      fundraisingGoal: party.fundraisingGoal ? Number(party.fundraisingGoal) : null,
      totalConfirmed,
      totalSponsors: sponsors.length,
      statusCounts,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/sponsors - Create a new sponsor
router.post('/:partyId/sponsors', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      name,
      website,
      brandTwitter,
      pointPerson,
      contactName,
      contactEmail,
      contactPhone,
      contactTwitter,
      telegram,
      status,
      amount,
      sponsorshipType,
      productService,
      logoUrl,
      notes,
      lastContactedAt,
    } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Validate status if provided
    const validStatuses = ['todo', 'asked', 'yes', 'billed', 'paid', 'stuck', 'alum', 'skip'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate sponsorship type if provided
    const validTypes = ['cash', 'in-kind', 'venue', 'pizza', 'drinks', 'other'];
    if (sponsorshipType && !validTypes.includes(sponsorshipType)) {
      throw new AppError(`Invalid sponsorship type. Must be one of: ${validTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const sponsor = await prisma.sponsor.create({
      data: {
        partyId,
        name: name.trim(),
        website: website?.trim() || null,
        brandTwitter: brandTwitter?.trim() || null,
        pointPerson: pointPerson?.trim() || null,
        contactName: contactName?.trim() || null,
        contactEmail: contactEmail?.trim()?.toLowerCase() || null,
        contactPhone: contactPhone?.trim() || null,
        contactTwitter: contactTwitter?.trim() || null,
        telegram: telegram?.trim() || null,
        status: status || 'todo',
        amount: amount !== undefined && amount !== null && amount !== '' ? amount : null,
        sponsorshipType: sponsorshipType || null,
        productService: productService?.trim() || null,
        logoUrl: logoUrl?.trim() || null,
        notes: notes?.trim() || null,
        lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null,
      },
    });

    res.status(201).json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/sponsors/:sponsorId - Get single sponsor details
router.get('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const sponsor = await prisma.sponsor.findFirst({
      where: { id: sponsorId, partyId },
    });

    if (!sponsor) {
      throw new AppError('Sponsor not found', 404, 'NOT_FOUND');
    }

    res.json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/sponsors/:sponsorId - Update a sponsor
router.patch('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;
    const {
      name,
      website,
      brandTwitter,
      pointPerson,
      contactName,
      contactEmail,
      contactPhone,
      contactTwitter,
      telegram,
      status,
      amount,
      sponsorshipType,
      productService,
      logoUrl,
      notes,
      lastContactedAt,
    } = req.body;

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

    // Validate status if provided
    const validStatuses = ['todo', 'asked', 'yes', 'billed', 'paid', 'stuck', 'alum', 'skip'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Validate sponsorship type if provided
    const validTypes = ['cash', 'in-kind', 'venue', 'pizza', 'drinks', 'other'];
    if (sponsorshipType && !validTypes.includes(sponsorshipType)) {
      throw new AppError(`Invalid sponsorship type. Must be one of: ${validTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const sponsor = await prisma.sponsor.update({
      where: { id: sponsorId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(website !== undefined && { website: website?.trim() || null }),
        ...(brandTwitter !== undefined && { brandTwitter: brandTwitter?.trim() || null }),
        ...(pointPerson !== undefined && { pointPerson: pointPerson?.trim() || null }),
        ...(contactName !== undefined && { contactName: contactName?.trim() || null }),
        ...(contactEmail !== undefined && { contactEmail: contactEmail?.trim()?.toLowerCase() || null }),
        ...(contactPhone !== undefined && { contactPhone: contactPhone?.trim() || null }),
        ...(contactTwitter !== undefined && { contactTwitter: contactTwitter?.trim() || null }),
        ...(telegram !== undefined && { telegram: telegram?.trim() || null }),
        ...(status !== undefined && { status }),
        ...(amount !== undefined && { amount: amount !== null && amount !== '' ? amount : null }),
        ...(sponsorshipType !== undefined && { sponsorshipType: sponsorshipType || null }),
        ...(productService !== undefined && { productService: productService?.trim() || null }),
        ...(logoUrl !== undefined && { logoUrl: logoUrl?.trim() || null }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(lastContactedAt !== undefined && { lastContactedAt: lastContactedAt ? new Date(lastContactedAt) : null }),
      },
    });

    res.json({ sponsor });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/sponsors/:sponsorId - Delete a sponsor
router.delete('/:partyId/sponsors/:sponsorId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, sponsorId } = req.params;

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

    await prisma.sponsor.delete({
      where: { id: sponsorId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
