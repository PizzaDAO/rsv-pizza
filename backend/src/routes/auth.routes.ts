import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// Helper function to send magic link email
async function sendMagicLinkEmail(email: string, magicLinkUrl: string, code: string, resendApiKey: string) {
  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Sign In to RSV.Pizza</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">🍕 Sign In to RSV.Pizza</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">Enter this code to sign in:</p>
        </div>

        <div style="background: #f9f9f9; padding: 30px 20px; border-radius: 12px; text-align: center; margin: 30px 0;">
          <p style="margin: 0 0 15px 0; font-size: 14px; color: #666; font-weight: 600;">YOUR SIGN-IN CODE</p>
          <div style="font-size: 48px; font-weight: 700; letter-spacing: 8px; color: #ff393a; margin: 10px 0;">${code}</div>
          <p style="margin: 15px 0 0 0; font-size: 13px; color: #999;">This code expires in 15 minutes</p>
        </div>

        <div style="border-top: 1px solid #e0e0e0; padding-top: 20px; margin-top: 30px; text-align: center; color: #666; font-size: 13px;">
          <p style="margin-top: 20px;">
            If you didn't request this email, you can safely ignore it.
          </p>
        </div>
      </body>
    </html>
  `;

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: 'RSV.Pizza <noreply@rsv.pizza>',
      to: [email],
      subject: `RSV.Pizza Code [${code}]`,
      html: emailHtml,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Resend API error: ${error}`);
  }

  return response.json();
}

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

    // Generate unique 6-digit code
    let code = '';
    let codeExists = true;
    while (codeExists) {
      code = Math.floor(100000 + Math.random() * 900000).toString();
      const existing = await prisma.magicLink.findUnique({ where: { code } });
      codeExists = !!existing;
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Create magic link record
    await prisma.magicLink.create({
      data: {
        token,
        code,
        email,
        expiresAt,
        userId: user?.id,
      },
    });

    // Send magic link email
    const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:5176';
    const magicLinkUrl = `${frontendUrl}/auth/verify?token=${token}`;

    // Log for development
    if (process.env.NODE_ENV !== 'production') {
      console.log('\n========================================');
      console.log('Magic Link (dev mode):');
      console.log(magicLinkUrl);
      console.log('========================================\n');
    }

    // Send email via Resend
    const resendApiKey = process.env.RESEND_API_KEY;
    if (resendApiKey) {
      try {
        await sendMagicLinkEmail(email, magicLinkUrl, code, resendApiKey);
      } catch (emailError) {
        console.error('Failed to send magic link email:', emailError);
        // Don't fail the request if email fails
      }
    }

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

// GET /api/auth/verify - Validate magic link token (does NOT mark as used)
// This allows email scanners to click without consuming the token
router.get('/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.query;

    if (!token || typeof token !== 'string') {
      throw new AppError('Token is required', 400, 'VALIDATION_ERROR');
    }

    // Find magic link
    const magicLink = await prisma.magicLink.findUnique({
      where: { token },
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

    // Return success but DON'T mark as used - frontend must call POST /verify-token
    res.json({
      success: true,
      valid: true,
      email: magicLink.email,
      message: 'Token is valid. Call POST /verify-token to complete sign-in.',
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/verify-token - Complete magic link verification
router.post('/verify-token', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { token } = req.body;

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

// POST /api/auth/verify-code - Verify 6-digit code
router.post('/verify-code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.body;

    if (!code || typeof code !== 'string') {
      throw new AppError('Code is required', 400, 'VALIDATION_ERROR');
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      throw new AppError('Invalid code format', 400, 'INVALID_FORMAT');
    }

    // Find magic link by code
    const magicLink = await prisma.magicLink.findUnique({
      where: { code },
      include: { user: true },
    });

    if (!magicLink) {
      throw new AppError('Invalid code', 401, 'INVALID_CODE');
    }

    // Check if locked due to too many attempts
    if (magicLink.lockedAt) {
      throw new AppError('Code locked due to too many failed attempts', 429, 'CODE_LOCKED');
    }

    // Check if expired
    if (magicLink.expiresAt < new Date()) {
      throw new AppError('Code expired', 401, 'CODE_EXPIRED');
    }

    // Check if already used
    if (magicLink.used) {
      throw new AppError('Code already used', 401, 'CODE_USED');
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
