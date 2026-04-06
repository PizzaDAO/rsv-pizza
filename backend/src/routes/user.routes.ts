import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

const router = Router();

// All user routes require authentication
router.use(requireAuth);

// GET /api/user/me - Get current user
router.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        defaultAddress: true,
        createdAt: true,
      },
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/user/me - Update user profile
router.patch('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { name, defaultAddress } = req.body;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(name !== undefined && { name }),
        ...(defaultAddress !== undefined && { defaultAddress }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        defaultAddress: true,
      },
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/preferences - Get pizza preferences
router.get('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        defaultDietaryRestrictions: true,
        defaultLikedToppings: true,
        defaultDislikedToppings: true,
      },
    });

    res.json({ preferences: user });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/user/preferences - Update pizza preferences
router.patch('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { dietaryRestrictions, likedToppings, dislikedToppings } = req.body;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(dietaryRestrictions !== undefined && { defaultDietaryRestrictions: dietaryRestrictions }),
        ...(likedToppings !== undefined && { defaultLikedToppings: likedToppings }),
        ...(dislikedToppings !== undefined && { defaultDislikedToppings: dislikedToppings }),
      },
      select: {
        defaultDietaryRestrictions: true,
        defaultLikedToppings: true,
        defaultDislikedToppings: true,
      },
    });

    res.json({ preferences: user });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/sponsorships - Get sponsorships where user email matches sponsor contactEmail
router.get('/sponsorships', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { email: true },
    });

    if (!user?.email) {
      return res.json([]);
    }

    const sponsors = await prisma.sponsor.findMany({
      where: {
        contactEmail: {
          equals: user.email,
          mode: 'insensitive',
        },
        intakeSubmittedAt: {
          not: null,
        },
      },
      include: {
        party: {
          select: {
            id: true,
            name: true,
            customUrl: true,
            date: true,
            eventImageUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const result = sponsors.map((s) => ({
      id: s.id,
      brandName: s.name,
      brandLogo: s.logoUrl,
      brandDescription: s.brandDescription,
      brandInstagram: s.brandInstagram,
      sponsorshipType: s.sponsorshipType,
      amount: s.amount ? Number(s.amount) : null,
      status: s.status,
      intakeSubmittedAt: s.intakeSubmittedAt,
      party: {
        id: s.party.id,
        name: s.party.name,
        customUrl: s.party.customUrl,
        date: s.party.date,
        eventImageUrl: s.party.eventImageUrl,
      },
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
