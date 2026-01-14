import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// All party routes require authentication
router.use(requireAuth);

// GET /api/parties - List user's parties
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const parties = await prisma.party.findMany({
      where: { userId: req.userId },
      include: {
        _count: { select: { guests: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ parties });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties - Create new party
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, date, duration, pizzaSize, pizzaStyle, address, maxGuests, availableBeverages, password, eventImageUrl, description, customUrl } = req.body;

    if (!name || !pizzaSize || !pizzaStyle) {
      throw new AppError('Name, pizza size, and pizza style are required', 400, 'VALIDATION_ERROR');
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

    const party = await prisma.party.create({
      data: {
        name,
        date: date ? new Date(date) : null,
        duration: duration || null,
        pizzaSize,
        pizzaStyle,
        availableBeverages: availableBeverages || [],
        address,
        maxGuests,
        password: password || null,
        eventImageUrl: eventImageUrl || null,
        description: description || null,
        customUrl: customUrl || null,
        userId: req.userId!,
      },
    });

    res.status(201).json({ party });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:id - Get party details
router.get('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const party = await prisma.party.findFirst({
      where: { id, userId: req.userId },
      include: {
        guests: {
          orderBy: { submittedAt: 'desc' },
        },
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:id - Update party
router.patch('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, date, duration, pizzaSize, pizzaStyle, address, maxGuests, availableBeverages, password, eventImageUrl, description, customUrl } = req.body;

    // Verify ownership
    const existing = await prisma.party.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
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
        ...(name && { name }),
        ...(date !== undefined && { date: date ? new Date(date) : null }),
        ...(duration !== undefined && { duration }),
        ...(pizzaSize && { pizzaSize }),
        ...(pizzaStyle && { pizzaStyle }),
        ...(address !== undefined && { address }),
        ...(maxGuests !== undefined && { maxGuests }),
        ...(availableBeverages !== undefined && { availableBeverages }),
        ...(password !== undefined && { password: password || null }),
        ...(eventImageUrl !== undefined && { eventImageUrl: eventImageUrl || null }),
        ...(description !== undefined && { description: description || null }),
        ...(customUrl !== undefined && { customUrl: customUrl || null }),
      },
    });

    res.json({ party });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:id - Delete party
router.delete('/:id', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership
    const existing = await prisma.party.findFirst({
      where: { id, userId: req.userId },
    });

    if (!existing) {
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

    const party = await prisma.party.findFirst({
      where: { id, userId: req.userId },
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

    const party = await prisma.party.updateMany({
      where: { id, userId: req.userId },
      data: { rsvpClosedAt: new Date() },
    });

    if (party.count === 0) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    res.json({ success: true, message: 'RSVPs closed' });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/open-rsvp - Reopen RSVPs
router.post('/:id/open-rsvp', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    const party = await prisma.party.updateMany({
      where: { id, userId: req.userId },
      data: { rsvpClosedAt: null },
    });

    if (party.count === 0) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    res.json({ success: true, message: 'RSVPs reopened' });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/guests - Add guest manually (by host)
router.post('/:id/guests', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const { name, dietaryRestrictions, likedToppings, dislikedToppings, likedBeverages, dislikedBeverages } = req.body;

    // Verify ownership
    const party = await prisma.party.findFirst({
      where: { id, userId: req.userId },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
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

    // Verify ownership
    const party = await prisma.party.findFirst({
      where: { id: partyId, userId: req.userId },
    });

    if (!party) {
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

export default router;
