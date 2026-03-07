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

// All venue routes require authentication
router.use(requireAuth);

// GET /api/parties/:partyId/venues - List all venues for a party
router.get('/:partyId/venues', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const venues = await prisma.venue.findMany({
      where: { partyId },
      orderBy: [
        { isSelected: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        photos: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ venues });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/venues - Create a new venue
router.post('/:partyId/venues', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      name, address, website, capacity, cost, organization,
      pointPerson, contactName, contactEmail, contactPhone,
      status, notes, pros, cons
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    const venue = await prisma.venue.create({
      data: {
        partyId,
        name: name.trim(),
        address: address?.trim() || null,
        website: website?.trim() || null,
        capacity: capacity ? parseInt(capacity, 10) : null,
        cost: cost ? parseFloat(cost) : null,
        organization: organization?.trim() || null,
        pointPerson: pointPerson?.trim() || null,
        contactName: contactName?.trim() || null,
        contactEmail: contactEmail?.trim() || null,
        contactPhone: contactPhone?.trim() || null,
        status: status || 'researching',
        notes: notes?.trim() || null,
        pros: pros?.trim() || null,
        cons: cons?.trim() || null,
      },
    });

    res.status(201).json({ venue });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/venues/:venueId - Update a venue
router.patch('/:partyId/venues/:venueId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId } = req.params;
    const {
      name, address, website, capacity, cost, organization,
      pointPerson, contactName, contactEmail, contactPhone,
      status, notes, pros, cons
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify venue belongs to party
    const existingVenue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!existingVenue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    const venue = await prisma.venue.update({
      where: { id: venueId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(address !== undefined && { address: address?.trim() || null }),
        ...(website !== undefined && { website: website?.trim() || null }),
        ...(capacity !== undefined && { capacity: capacity ? parseInt(capacity, 10) : null }),
        ...(cost !== undefined && { cost: cost ? parseFloat(cost) : null }),
        ...(organization !== undefined && { organization: organization?.trim() || null }),
        ...(pointPerson !== undefined && { pointPerson: pointPerson?.trim() || null }),
        ...(contactName !== undefined && { contactName: contactName?.trim() || null }),
        ...(contactEmail !== undefined && { contactEmail: contactEmail?.trim() || null }),
        ...(contactPhone !== undefined && { contactPhone: contactPhone?.trim() || null }),
        ...(status !== undefined && { status: status || 'researching' }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        ...(pros !== undefined && { pros: pros?.trim() || null }),
        ...(cons !== undefined && { cons: cons?.trim() || null }),
      },
      include: {
        photos: {
          orderBy: { sortOrder: 'asc' },
        },
      },
    });

    res.json({ venue });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/venues/:venueId - Delete a venue
router.delete('/:partyId/venues/:venueId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify venue belongs to party
    const existingVenue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!existingVenue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    await prisma.venue.delete({
      where: { id: venueId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/venues/:venueId/select - Select a venue as the event location
router.patch('/:partyId/venues/:venueId/select', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify venue belongs to party
    const existingVenue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!existingVenue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    // Use a transaction to:
    // 1. Deselect all other venues for this party
    // 2. Select this venue
    // 3. Copy venue name and address to party
    const [, venue, party] = await prisma.$transaction([
      // Deselect all venues for this party
      prisma.venue.updateMany({
        where: { partyId },
        data: { isSelected: false },
      }),
      // Select this venue
      prisma.venue.update({
        where: { id: venueId },
        data: { isSelected: true },
      }),
      // Update party with venue name and address
      prisma.party.update({
        where: { id: partyId },
        data: {
          venueName: existingVenue.name,
          address: existingVenue.address,
        },
      }),
    ]);

    res.json({ venue, party });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/venues/:venueId/deselect - Deselect a venue
router.patch('/:partyId/venues/:venueId/deselect', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Verify venue belongs to party
    const existingVenue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!existingVenue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    // Deselect the venue
    const venue = await prisma.venue.update({
      where: { id: venueId },
      data: { isSelected: false },
    });

    res.json({ venue });
  } catch (error) {
    next(error);
  }
});

export default router;
