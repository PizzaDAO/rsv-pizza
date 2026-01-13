import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// GET /api/rsvp/:inviteCode - Get party info for RSVP page (public)
router.get('/:inviteCode', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;

    const party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        date: true,
        availableBeverages: true,
        rsvpClosedAt: true,
        maxGuests: true,
        user: {
          select: { name: true },
        },
        _count: {
          select: { guests: true },
        },
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Check if RSVPs are closed
    if (party.rsvpClosedAt) {
      return res.json({
        party: {
          name: party.name,
          date: party.date,
          hostName: party.user.name,
        },
        rsvpClosed: true,
        message: 'RSVPs are no longer being accepted for this party',
      });
    }

    // Check if max guests reached
    if (party.maxGuests && party._count.guests >= party.maxGuests) {
      return res.json({
        party: {
          name: party.name,
          date: party.date,
          hostName: party.user.name,
        },
        rsvpClosed: true,
        message: 'This party has reached its maximum number of guests',
      });
    }

    res.json({
      party: {
        name: party.name,
        date: party.date,
        hostName: party.user.name,
        availableBeverages: party.availableBeverages,
        guestCount: party._count.guests,
        maxGuests: party.maxGuests,
      },
      rsvpClosed: false,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/rsvp/:inviteCode/guest - Submit guest preferences (public)
router.post('/:inviteCode/guest', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { name, dietaryRestrictions, likedToppings, dislikedToppings, likedBeverages, dislikedBeverages } = req.body;

    // Validate required fields
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Find party
    const party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        rsvpClosedAt: true,
        maxGuests: true,
        _count: { select: { guests: true } },
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Check if RSVPs are closed
    if (party.rsvpClosedAt) {
      throw new AppError('RSVPs are closed for this party', 400, 'RSVP_CLOSED');
    }

    // Check max guests
    if (party.maxGuests && party._count.guests >= party.maxGuests) {
      throw new AppError('Party has reached maximum guests', 400, 'MAX_GUESTS_REACHED');
    }

    // Create guest
    const guest = await prisma.guest.create({
      data: {
        name: name.trim(),
        dietaryRestrictions: dietaryRestrictions || [],
        likedToppings: likedToppings || [],
        dislikedToppings: dislikedToppings || [],
        likedBeverages: likedBeverages || [],
        dislikedBeverages: dislikedBeverages || [],
        submittedVia: 'link',
        partyId: party.id,
      },
    });

    res.status(201).json({
      success: true,
      guest: {
        id: guest.id,
        name: guest.name,
      },
      message: 'Your preferences have been saved!',
    });
  } catch (error) {
    next(error);
  }
});

export default router;
