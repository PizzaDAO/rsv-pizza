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

export default router;
