import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// POST /api/auth/magic-link - Request magic link
router.post('/magic-link', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { email } = req.body;

    if (!email || typeof email !== 'string') {
      throw new AppError('Email is required', 400, 'VALIDATION_ERROR');
    }

    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new AppError('Invalid email format', 400, 'VALIDATION_ERROR');
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email } });

    // Generate secure token
    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create magic link record
    await prisma.magicLink.create({
      data: {
        token,
        email,
        expiresAt,
        userId: user?.id,
      },
    });

    // In production, send email here
    // For development, log the link
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5176';
    const magicLinkUrl = `${frontendUrl}/auth/verify?token=${token}`;

    console.log('\n========================================');
    console.log('Magic Link (dev mode):');
    console.log(magicLinkUrl);
    console.log('========================================\n');

    // TODO: Send email in production
    // await emailService.sendMagicLink(email, magicLinkUrl);

    res.json({
      success: true,
      message: 'Magic link sent to your email',
      // Only include in development
      ...(process.env.NODE_ENV !== 'production' && { devLink: magicLinkUrl }),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/auth/verify - Verify magic link token
router.get('/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      throw new AppError('Token is required', 400, 'VALIDATION_ERROR');
    }

    // Find magic link
    const magicLink = await prisma.magicLink.findUnique({
      where: { token },
      include: { user: true },
    });

    if (!magicLink) {
      throw new AppError('Invalid magic link', 401, 'INVALID_TOKEN');
    }

    if (magicLink.used) {
      throw new AppError('Magic link already used', 401, 'TOKEN_USED');
    }

    if (magicLink.expiresAt < new Date()) {
      throw new AppError('Magic link expired', 401, 'TOKEN_EXPIRED');
    }

    // Mark as used
    await prisma.magicLink.update({
      where: { id: magicLink.id },
      data: { used: true },
    });

    // Create user if doesn't exist
    let user = magicLink.user;
    if (!user) {
      user = await prisma.user.create({
        data: { email: magicLink.email },
      });
    }

    // Generate JWT
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      throw new AppError('JWT secret not configured', 500, 'CONFIG_ERROR');
    }

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      jwtSecret,
      { expiresIn: '7d' }
    );

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
      accessToken,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/logout - Logout (client-side token removal)
router.post('/logout', (req: Request, res: Response) => {
  // JWT is stateless, so logout is handled client-side
  // This endpoint exists for consistency and potential future token blacklisting
  res.json({ success: true, message: 'Logged out' });
});

export default router;
