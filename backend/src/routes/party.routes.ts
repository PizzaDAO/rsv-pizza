import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { sendApprovalEmail } from './rsvp.routes.js';

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

// Helper function to get party with ownership check
async function getPartyWithOwnershipCheck(partyId: string, userId?: string, userEmail?: string) {
  // Super admin can access any party
  if (isSuperAdmin(userEmail)) {
    return prisma.party.findUnique({
      where: { id: partyId },
      include: {
        user: { select: { name: true } },
        guests: {
          orderBy: { submittedAt: 'desc' },
        },
      },
    });
  }

  // Otherwise, must be the party owner
  return prisma.party.findFirst({
    where: { id: partyId, userId },
    include: {
      user: { select: { name: true } },
      guests: {
        orderBy: { submittedAt: 'desc' },
      },
    },
  });
}

const router = Router();

// All party routes require authentication
router.use(requireAuth);

// GET /api/parties - List user's parties
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parties = await prisma.party.findMany({
      where: { userId: req.userId },
      include: {
        user: { select: { name: true } },
        _count: { select: { guests: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Map to include hostName from user for backwards compatibility
    const partiesWithHost = parties.map(party => ({
      ...party,
      hostName: party.user?.name || null,
      user: undefined, // Remove user object from response
    }));

    res.json({ parties: partiesWithHost });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties - Create new party
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name, date, endTime, duration, pizzaStyle, address, maxGuests,
      availableBeverages, availableToppings, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, coHosts
    } = req.body;

    // Generate default party name if not provided
    let partyName = name?.trim();
    if (!partyName) {
      const count = await prisma.party.count();
      partyName = `Pizza Party ${count + 1}`;
    }

    // Validate custom URL if provided
    if (customUrl) {
      // Only allow lowercase letters, numbers, and hyphens
      if (!/^[a-z0-9-]+$/.test(customUrl)) {
        throw new AppError('Custom URL can only contain lowercase letters, numbers, and hyphens', 400, 'VALIDATION_ERROR');
      }
      if (customUrl.length < 3 || customUrl.length > 50) {
        throw new AppError('Custom URL must be between 3 and 50 characters', 400, 'VALIDATION_ERROR');
      }
    }

    // Get user's name for co-hosts default
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { name: true },
    });

    // Build coHosts array with host email if provided
    const hostCoHosts = req.userEmail
      ? [{ id: crypto.randomUUID(), name: user?.name || '', email: req.userEmail, showOnEvent: false }]
      : [];
    const finalCoHosts = coHosts || hostCoHosts;

    const party = await prisma.party.create({
      data: {
        name: partyName,
        date: date ? new Date(date) : null,
        endTime: endTime ? new Date(endTime) : null,
        duration: duration || null,
        timezone: timezone || null,
        pizzaStyle: pizzaStyle || 'new-york',
        availableBeverages: availableBeverages || [],
        availableToppings: availableToppings || [],
        address: address || null,
        maxGuests: maxGuests || null,
        hideGuests: hideGuests || false,
        requireApproval: requireApproval || false,
        password: password || null,
        eventImageUrl: eventImageUrl || null,
        description: description || null,
        customUrl: customUrl || null,
        coHosts: finalCoHosts,
        userId: req.userId!,
      },
      include: {
        user: { select: { name: true } },
      },
    });

    // Add the host as a guest so they can bypass password protection
    if (req.userEmail) {
      await prisma.guest.create({
        data: {
          name: user?.name || 'Host',
          email: req.userEmail.toLowerCase(),
          dietaryRestrictions: [],
          likedToppings: [],
          dislikedToppings: [],
          likedBeverages: [],
          dislikedBeverages: [],
          submittedVia: 'host',
          partyId: party.id,
        },
      });
    }

    // Return with hostName for backwards compatibility
    res.status(201).json({
      party: {
        ...party,
        hostName: party.user?.name || null,
        user: undefined,
      }
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:id - Get party details
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const party = await getPartyWithOwnershipCheck(id, req.userId, req.userEmail);

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Return with hostName and userId for ownership checks
    res.json({
      party: {
        ...party,
        hostName: party.user?.name || null,
        user: undefined,
      }
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:id - Update party
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const {
      name, date, endTime, duration, pizzaStyle, address, maxGuests,
      availableBeverages, availableToppings, password, eventImageUrl, description,
      customUrl, timezone, hideGuests, requireApproval, coHosts
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // Validate custom URL if provided
    if (customUrl !== undefined && customUrl !== null && customUrl !== '') {
      if (!/^[a-z0-9-]+$/.test(customUrl)) {
        throw new AppError('Custom URL can only contain lowercase letters, numbers, and hyphens', 400, 'VALIDATION_ERROR');
      }
      if (customUrl.length < 3 || customUrl.length > 50) {
        throw new AppError('Custom URL must be between 3 and 50 characters', 400, 'VALIDATION_ERROR');
      }
    }

    const party = await prisma.party.update({
      where: { id },
      data: {
        ...(name !== undefined && { name }),
        ...(date !== undefined && { date: date ? new Date(date) : null }),
        ...(endTime !== undefined && { endTime: endTime ? new Date(endTime) : null }),
        ...(duration !== undefined && { duration }),
        ...(timezone !== undefined && { timezone }),
        ...(pizzaStyle && { pizzaStyle }),
        ...(address !== undefined && { address }),
        ...(maxGuests !== undefined && { maxGuests }),
        ...(hideGuests !== undefined && { hideGuests }),
        ...(requireApproval !== undefined && { requireApproval }),
        ...(availableBeverages !== undefined && { availableBeverages }),
        ...(availableToppings !== undefined && { availableToppings }),
        ...(password !== undefined && { password: password || null }),
        ...(eventImageUrl !== undefined && { eventImageUrl: eventImageUrl || null }),
        ...(description !== undefined && { description: description || null }),
        ...(customUrl !== undefined && { customUrl: customUrl || null }),
        ...(coHosts !== undefined && { coHosts }),
      },
      include: {
        user: { select: { name: true } },
      },
    });

    // Return with hostName for backwards compatibility
    res.json({
      party: {
        ...party,
        hostName: party.user?.name || null,
        user: undefined,
      }
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:id - Delete party
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    await prisma.party.delete({ where: { id } });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:id/invite-link - Get invite link
router.get('/:id/invite-link', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const party = await prisma.party.findUnique({
      where: { id },
      select: { inviteCode: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const baseUrl = process.env.FRONTEND_URL || 'http://localhost:5176';
    const inviteLink = `${baseUrl}/rsvp/${party.inviteCode}`;

    res.json({ inviteCode: party.inviteCode, inviteLink });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/close-rsvp - Close RSVPs
router.post('/:id/close-rsvp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    await prisma.party.update({
      where: { id },
      data: { rsvpClosedAt: new Date() },
    });

    res.json({ success: true, message: 'RSVPs closed' });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/open-rsvp - Reopen RSVPs
router.post('/:id/open-rsvp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    await prisma.party.update({
      where: { id },
      data: { rsvpClosedAt: null },
    });

    res.json({ success: true, message: 'RSVPs reopened' });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/guests - Add guest manually (by host)
router.post('/:id/guests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, email, dietaryRestrictions, likedToppings, dislikedToppings, likedBeverages, dislikedBeverages } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(id, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Check if guest with this email already exists for this party
    if (email) {
      const existingGuest = await prisma.guest.findFirst({
        where: { partyId: id, email: email.toLowerCase() },
      });
      if (existingGuest) {
        // Guest already exists, return success without creating duplicate
        res.status(200).json({ guest: existingGuest, alreadyExists: true });
        return;
      }
    }

    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
        email: email ? email.toLowerCase() : null,
        dietaryRestrictions: dietaryRestrictions || [],
        likedToppings: likedToppings || [],
        dislikedToppings: dislikedToppings || [],
        likedBeverages: likedBeverages || [],
        dislikedBeverages: dislikedBeverages || [],
        submittedVia: 'host',
        partyId: id,
      },
    });

    res.status(201).json({ guest });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/guests/:guestId - Remove guest
router.delete('/:partyId/guests/:guestId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    await prisma.guest.delete({
      where: { id: guestId, partyId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/guests/:guestId/approve - Approve or decline guest
router.patch('/:partyId/guests/:guestId/approve', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, guestId } = req.params;
    const { approved } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (typeof approved !== 'boolean') {
      throw new AppError('approved must be a boolean', 400, 'VALIDATION_ERROR');
    }

    const guest = await prisma.guest.update({
      where: { id: guestId, partyId },
      data: { approved },
    });

    // Send approval email with QR code if guest is approved and has an email
    if (approved && guest.email) {
      try {
        // Get party details for the email
        const party = await prisma.party.findUnique({
          where: { id: partyId },
          select: {
            name: true,
            date: true,
            address: true,
            inviteCode: true,
            customUrl: true,
          },
        });

        if (party) {
          await sendApprovalEmail({
            guestEmail: guest.email,
            guestName: guest.name,
            guestId: guest.id,
            partyName: party.name,
            partyDate: party.date,
            partyAddress: party.address,
            inviteCode: party.inviteCode,
            customUrl: party.customUrl,
          });
        }
      } catch (emailError) {
        console.error('Failed to send approval email:', emailError);
        // Don't fail the approval if email fails
      }
    }

    res.json({ guest });
  } catch (error) {
    next(error);
  }
});

export default router;
