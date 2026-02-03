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

// Valid kit tiers
const VALID_TIERS = ['basic', 'large', 'deluxe'];

// Valid statuses
const VALID_STATUSES = ['pending', 'approved', 'shipped', 'delivered', 'declined'];

const router = Router();

// GET /api/parties/:partyId/kit - Get kit request for a party
router.get('/:partyId/kit', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Get party to check kit settings
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        id: true,
        kitEnabled: true,
        kitDeadline: true,
        partyKit: true,
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    res.json({
      kitEnabled: party.kitEnabled,
      kitDeadline: party.kitDeadline,
      kit: party.partyKit,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/kit - Submit a kit request
router.post('/:partyId/kit', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      requestedTier,
      recipientName,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      phone,
      notes,
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Validate required fields
    if (!recipientName || !addressLine1 || !city || !postalCode) {
      throw new AppError(
        'Missing required fields: recipientName, addressLine1, city, postalCode',
        400,
        'VALIDATION_ERROR'
      );
    }

    // Validate tier if provided (optional - PizzaDAO will allocate the actual tier)
    const tier = requestedTier || 'basic'; // Default to basic if not specified
    if (!VALID_TIERS.includes(tier)) {
      throw new AppError(
        `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`,
        400,
        'INVALID_TIER'
      );
    }

    // Get party to check if kit request already exists
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      include: { partyKit: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Check if a kit request already exists
    if (party.partyKit) {
      throw new AppError(
        'A kit request already exists for this party. Use PATCH to update.',
        409,
        'KIT_EXISTS'
      );
    }

    // Check if kit deadline has passed
    if (party.kitDeadline && new Date(party.kitDeadline) < new Date()) {
      throw new AppError(
        'The deadline for requesting a kit has passed.',
        400,
        'DEADLINE_PASSED'
      );
    }

    // Create kit request
    const kit = await prisma.partyKit.create({
      data: {
        partyId,
        requestedTier: tier,
        recipientName,
        addressLine1,
        addressLine2: addressLine2 || null,
        city,
        state: state || null,
        postalCode,
        country: country || 'USA',
        phone: phone || null,
        notes: notes || null,
        status: 'pending',
      },
    });

    // Enable kit for this party
    await prisma.party.update({
      where: { id: partyId },
      data: { kitEnabled: true },
    });

    res.status(201).json({ kit });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/kit - Update a kit request (host can edit if pending)
router.patch('/:partyId/kit', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      requestedTier,
      recipientName,
      addressLine1,
      addressLine2,
      city,
      state,
      postalCode,
      country,
      phone,
      notes,
      // Admin-only fields
      allocatedTier,
      status,
      trackingNumber,
      trackingUrl,
      adminNotes,
    } = req.body;

    // Get existing kit
    const existingKit = await prisma.partyKit.findFirst({
      where: { partyId },
    });

    if (!existingKit) {
      throw new AppError('No kit request found for this party', 404, 'NOT_FOUND');
    }

    // Check permissions
    const isAdmin = isSuperAdmin(req.userEmail);
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);

    if (!canEdit && !isAdmin) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Non-admins can only edit if status is pending
    if (!isAdmin && existingKit.status !== 'pending') {
      throw new AppError(
        'You can only edit a kit request while it is pending.',
        400,
        'CANNOT_EDIT'
      );
    }

    // Build update data
    const updateData: any = {};

    // Fields that hosts can edit (if pending)
    if (requestedTier !== undefined) {
      if (!VALID_TIERS.includes(requestedTier)) {
        throw new AppError(
          `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`,
          400,
          'INVALID_TIER'
        );
      }
      updateData.requestedTier = requestedTier;
    }
    if (recipientName !== undefined) updateData.recipientName = recipientName;
    if (addressLine1 !== undefined) updateData.addressLine1 = addressLine1;
    if (addressLine2 !== undefined) updateData.addressLine2 = addressLine2;
    if (city !== undefined) updateData.city = city;
    if (state !== undefined) updateData.state = state;
    if (postalCode !== undefined) updateData.postalCode = postalCode;
    if (country !== undefined) updateData.country = country;
    if (phone !== undefined) updateData.phone = phone;
    if (notes !== undefined) updateData.notes = notes;

    // Admin-only fields
    if (isAdmin) {
      if (allocatedTier !== undefined) {
        if (allocatedTier && !VALID_TIERS.includes(allocatedTier)) {
          throw new AppError(
            `Invalid tier. Must be one of: ${VALID_TIERS.join(', ')}`,
            400,
            'INVALID_TIER'
          );
        }
        updateData.allocatedTier = allocatedTier;
      }
      if (status !== undefined) {
        if (!VALID_STATUSES.includes(status)) {
          throw new AppError(
            `Invalid status. Must be one of: ${VALID_STATUSES.join(', ')}`,
            400,
            'INVALID_STATUS'
          );
        }
        updateData.status = status;

        // Set timestamp based on status change
        if (status === 'approved' && existingKit.status !== 'approved') {
          updateData.approvedAt = new Date();
        }
        if (status === 'shipped' && existingKit.status !== 'shipped') {
          updateData.shippedAt = new Date();
        }
        if (status === 'delivered' && existingKit.status !== 'delivered') {
          updateData.deliveredAt = new Date();
        }
      }
      if (trackingNumber !== undefined) updateData.trackingNumber = trackingNumber;
      if (trackingUrl !== undefined) updateData.trackingUrl = trackingUrl;
      if (adminNotes !== undefined) updateData.adminNotes = adminNotes;
    }

    const kit = await prisma.partyKit.update({
      where: { id: existingKit.id },
      data: updateData,
    });

    res.json({ kit });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/kit - Cancel a kit request (if pending)
router.delete('/:partyId/kit', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const isAdmin = isSuperAdmin(req.userEmail);
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);

    if (!canEdit && !isAdmin) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Get existing kit
    const existingKit = await prisma.partyKit.findFirst({
      where: { partyId },
    });

    if (!existingKit) {
      throw new AppError('No kit request found for this party', 404, 'NOT_FOUND');
    }

    // Non-admins can only delete if status is pending
    if (!isAdmin && existingKit.status !== 'pending') {
      throw new AppError(
        'You can only cancel a kit request while it is pending.',
        400,
        'CANNOT_CANCEL'
      );
    }

    await prisma.partyKit.delete({
      where: { id: existingKit.id },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
