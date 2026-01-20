import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// GET /api/events/:slug - Get public event details with host profile (public)
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;

    // Find party by invite code OR custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode: slug },
      select: {
        id: true,
        name: true,
        inviteCode: true,
        customUrl: true,
        date: true,
        duration: true,
        timezone: true,
        pizzaStyle: true,
        availableBeverages: true,
        availableToppings: true,
        address: true,
        maxGuests: true,
        hideGuests: true,
        eventImageUrl: true,
        description: true,
        rsvpClosedAt: true,
        coHosts: true,
        password: true, // Just to check if it exists
        user: {
          select: {
            name: true,
            profilePictureUrl: true,
            website: true,
            twitter: true,
            instagram: true,
            youtube: true,
            tiktok: true,
            linkedin: true,
          },
        },
        _count: {
          select: { guests: true },
        },
      },
    });

    // If not found by invite code, try custom URL
    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: slug },
        select: {
          id: true,
          name: true,
          inviteCode: true,
          customUrl: true,
          date: true,
          duration: true,
          timezone: true,
          pizzaStyle: true,
          availableBeverages: true,
          availableToppings: true,
          address: true,
          maxGuests: true,
          hideGuests: true,
          eventImageUrl: true,
          description: true,
          rsvpClosedAt: true,
          coHosts: true,
          password: true,
          user: {
            select: {
              name: true,
              profilePictureUrl: true,
              website: true,
              twitter: true,
              instagram: true,
              youtube: true,
              tiktok: true,
              linkedin: true,
            },
          },
          _count: {
            select: { guests: true },
          },
        },
      });
    }

    if (!party) {
      throw new AppError('Event not found', 404, 'EVENT_NOT_FOUND');
    }

    // Build host profile from user data
    const hostProfile = party.user ? {
      name: party.user.name || null,
      avatar_url: party.user.profilePictureUrl || null,
      website: party.user.website || null,
      twitter: party.user.twitter || null,
      instagram: party.user.instagram || null,
      youtube: party.user.youtube || null,
      tiktok: party.user.tiktok || null,
      linkedin: party.user.linkedin || null,
    } : null;

    res.json({
      event: {
        id: party.id,
        name: party.name,
        inviteCode: party.inviteCode,
        customUrl: party.customUrl,
        date: party.date,
        duration: party.duration,
        timezone: party.timezone,
        pizzaStyle: party.pizzaStyle,
        availableBeverages: party.availableBeverages,
        availableToppings: party.availableToppings,
        address: party.address,
        maxGuests: party.maxGuests,
        hideGuests: party.hideGuests,
        eventImageUrl: party.eventImageUrl,
        description: party.description,
        rsvpClosedAt: party.rsvpClosedAt,
        coHosts: party.coHosts,
        hasPassword: !!party.password,
        hostName: party.user?.name || null,
        hostProfile,
        guestCount: party._count.guests,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
