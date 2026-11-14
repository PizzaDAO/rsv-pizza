import { Router, Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { normalizeEmail } from '../helpers/email.js';
import { siteForOrigin } from '../lib/siteBrand.js';
import { issueLoginCode, takeCodeSend, reserveVerifyAttempt } from '../lib/loginCode.js';
import { getJwtSecret } from '../config/secrets.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';

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

    // mushroom-48468: canonicalize email so iOS auto-capitalization can't create
    // duplicate User rows. Use `normalized` for every DB read/write below.
    const normalized = normalizeEmail(email);
    if (!normalized) {
      throw new AppError('Invalid email format', 400, 'VALIDATION_ERROR');
    }

    // Find or create user
    let user = await prisma.user.findUnique({ where: { email: normalized } });

    // Exact-match the request Origin against registered series site_urls; else today's FRONTEND_URL.
    const site = await siteForOrigin(req.get('origin'), process.env.FRONTEND_URL || 'http://localhost:5176');
    // invite-verify: code creation + the sign-in email live in lib/loginCode.ts so the RSVP
    // form's inline code step sends exactly this email (no new email type).
    // invite-verify (security review): per-email send limit, shared with the RSVP code step
    // and charged to the requester (email + IP), so someone spamming this address can't use
    // up the owner's own allowance. Not an oracle: any address can request a code.
    if (!(await takeCodeSend(normalized, req.ip))) {
      throw new AppError('Too many codes requested for this email. Try again in a few minutes.', 429, 'CODE_SEND_LIMIT');
    }
    const { magicLinkUrl } = await issueLoginCode(normalized, site, user?.id);

    // Check if user is new (no name set)
    const isNewUser = !user || !user.name;

    res.json({
      success: true,
      message: 'Magic link sent to your email',
      isNewUser,
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

// Remaining lifetime (seconds) for a hand-off session, capped at the minting session's expiry; 30d otherwise.
function handoffCap(code: string): number {
  const m = HANDOFF_CODE_RE.exec(code);
  if (!m) return 30 * 24 * 60 * 60;
  return Math.max(60, Math.min(30 * 24 * 60 * 60, Number(m[1]) - Math.floor(Date.now() / 1000)));
}

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

    // Atomic single-use spend: only one concurrent request can flip used false -> true.
    // (A read-then-update here would let two simultaneous redemptions both succeed.)
    const spent = await prisma.magicLink.updateMany({
      where: { id: magicLink.id, used: false, expiresAt: { gt: new Date() } },
      data: { used: true },
    });
    if (spent.count !== 1) {
      throw new AppError('Magic link already used', 401, 'TOKEN_USED');
    }

    // Create user if doesn't exist
    let user = magicLink.user;
    if (!user) {
      // mushroom-48468: normalize even though /magic-link now writes lowercase,
      // because pre-existing MagicLink rows may still hold mixed-case email.
      user = await prisma.user.create({
        data: { email: normalizeEmail(magicLink.email)! },
      });
    }

    // Generate JWT
    const jwtSecret = getJwtSecret();

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      jwtSecret,
      { expiresIn: handoffCap(magicLink.code) }
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

// POST /api/auth/handoff - Mint a short-lived single-use sign-in link so a signed-in
// user can carry their session into a wallet's in-app browser (a different cookie/
// localStorage jar). Reuses the MagicLink table: redeemed through POST /verify-token.
// Controls: requires a valid Bearer JWT, 2-minute TTL, single use (atomic spend in
// /verify-token), and the row's `code` is not 6 digits so /verify-code can never match it.
export const HANDOFF_TTL_MS = 2 * 60 * 1000;
// Per-user cap on minting (10 per 10 minutes), keyed on the authenticated user id.
const handoffLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 10,
  keyGenerator: (req) => (req as AuthRequest).userId ?? 'anon',
  message: { error: { message: 'Too many sign-in links requested. Try again in a few minutes.', code: 'RATE_LIMITED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});
// Hand-off rows carry the minting session's expiry in their `code` ("ho<24 hex>x<exp epoch seconds>")
// so the redeemed session can never outlive the session that minted it (no schema change).
const HANDOFF_CODE_RE = /^ho[0-9a-f]{24}x(\d+)$/;
router.post('/handoff', requireAuth, handoffLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: req.userId! } });
    if (!user) {
      throw new AppError('User not found', 401, 'UNAUTHORIZED');
    }

    const token = randomBytes(32).toString('hex');
    const decoded = jwt.decode(req.headers.authorization!.split(' ')[1]) as { exp?: number } | null;
    const sessionExp = decoded?.exp ?? Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
    const code = `ho${randomBytes(12).toString('hex')}x${sessionExp}`;
    const expiresAt = new Date(Date.now() + HANDOFF_TTL_MS);

    await prisma.magicLink.create({
      data: { token, code, email: user.email, expiresAt, userId: user.id },
    });

    const site = await siteForOrigin(req.get('origin'), process.env.FRONTEND_URL || 'http://localhost:5176');
    const rawNext = typeof req.body?.next === 'string' ? req.body.next : '';
    // Only local paths; anything else is dropped (the frontend re-validates too).
    const next_ = /^\/(?![/\\])[^\s]*$/.test(rawNext) ? rawNext : '';
    const params = new URLSearchParams({ token });
    if (next_) params.set('next', next_);

    res.setHeader('Cache-Control', 'no-store');
    res.json({
      success: true,
      token,
      url: `${site.url}/auth/verify?${params.toString()}`,
      expiresAt: expiresAt.toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/auth/verify-code - Verify 6-digit code
router.post('/verify-code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code, name } = req.body;

    if (!code || typeof code !== 'string') {
      throw new AppError('Code is required', 400, 'VALIDATION_ERROR');
    }

    // Validate code format (6 digits)
    if (!/^\d{6}$/.test(code)) {
      throw new AppError('Invalid code format', 400, 'INVALID_FORMAT');
    }

    // invite-verify: every current caller (AuthVerifyPage, GPP landing, the RSVP code step)
    // passes `email`. The code must then belong to that email; a code that exists for some
    // OTHER email gets the same INVALID_CODE as a code that doesn't exist.
    // Requests WITHOUT `email` (bundles cached from before PR #1253) still use the old
    // code-only lookup, with their own low per-IP failure budget (FAIL_PER_IP_CODE_ONLY).
    // TODO(invite-verify, added 2026-11-14): after 2026-11-28, reject requests without
    // `email` (400) and delete the code-only lookup.
    let boundEmail: string | null = null;
    if (req.body?.email !== undefined) {
      boundEmail = typeof req.body.email === 'string' ? normalizeEmail(req.body.email) : null;
      if (!boundEmail) {
        throw new AppError('Invalid email format', 400, 'VALIDATION_ERROR');
      }
    }

    // invite-verify (security review): brute-force budget, charged to the CALLER (IP, and
    // email+IP when bound), checked before the lookup so a refused caller learns nothing.
    // Wrong guesses never lock the stored codes, so nobody can lock the owner out.
    // See lib/loginCode.ts for the limits and the PR for the math. The attempt slot is
    // reserved synchronously, so parallel bursts can't all slip past the budget.
    const attempt = await reserveVerifyAttempt(req.ip, boundEmail);
    if (!attempt) {
      throw new AppError('Too many wrong codes. Try again in a few minutes.', 429, 'VERIFY_RATE_LIMITED');
    }
    const fail = async (message: string, status: number, errCode: string): Promise<never> => {
      await attempt.fail();
      throw new AppError(message, status, errCode);
    };
    /** A stale code that DID belong to the submitted email: not a guess, don't charge it. */
    const staleOwnCode = (message: string, errCode: string): never => {
      attempt.release();
      throw new AppError(message, 401, errCode);
    };

    // Find magic link by code
    let magicLink;
    try {
      magicLink = await prisma.magicLink.findUnique({
        where: { code },
        include: { user: true },
      });
    } catch (err) {
      attempt.release();
      throw err;
    }

    if (!magicLink || (boundEmail && normalizeEmail(magicLink.email) !== boundEmail)) {
      return await fail('Invalid code', 401, 'INVALID_CODE');
    }

    // Legacy: rows locked by an older build. Nothing sets locked_at any more.
    if (magicLink.lockedAt) {
      return await fail('Code locked due to too many failed attempts', 429, 'CODE_LOCKED');
    }

    // Check if expired
    if (magicLink.expiresAt < new Date()) {
      if (boundEmail) staleOwnCode('Code expired', 'CODE_EXPIRED');
      return await fail('Code expired', 401, 'CODE_EXPIRED');
    }

    // Check if already used
    if (magicLink.used) {
      if (boundEmail) staleOwnCode('Code already used', 'CODE_USED');
      return await fail('Code already used', 401, 'CODE_USED');
    }

    // The code is right: give the reserved slot back.
    attempt.release();

    // Mark as used
    await prisma.magicLink.update({
      where: { id: magicLink.id },
      data: { used: true },
    });

    // Create user if doesn't exist, or update name if provided
    let user = magicLink.user;
    if (!user) {
      // mushroom-48468: normalize even though /magic-link now writes lowercase,
      // because pre-existing MagicLink rows may still hold mixed-case email.
      user = await prisma.user.create({
        data: {
          email: normalizeEmail(magicLink.email)!,
          name: name?.trim() || null,
        },
      });
    } else if (name?.trim() && !user.name) {
      // Update name if user exists but has no name set
      user = await prisma.user.update({
        where: { id: user.id },
        data: { name: name.trim() },
      });
    }

    // Generate JWT
    const jwtSecret = getJwtSecret();

    const accessToken = jwt.sign(
      { userId: user.id, email: user.email },
      jwtSecret,
      { expiresIn: '30d' }
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

// PATCH /api/auth/profile - Update user profile
router.patch('/profile', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new AppError('Authorization required', 401, 'UNAUTHORIZED');
    }

    const token = authHeader.split(' ')[1];
    const jwtSecret = getJwtSecret();

    // Verify token
    let decoded: { userId: string; email: string };
    try {
      decoded = jwt.verify(token, jwtSecret) as { userId: string; email: string };
    } catch {
      throw new AppError('Invalid token', 401, 'INVALID_TOKEN');
    }

    const { name, username, bio, profilePictureUrl, instagram, twitter, youtube, tiktok, linkedin, website } = req.body;

    // Update user
    const user = await prisma.user.update({
      where: { id: decoded.userId },
      data: {
        ...(name !== undefined && { name: name?.trim() || null }),
        ...(username !== undefined && { username: username?.trim() || null }),
        ...(bio !== undefined && { bio: bio?.trim() || null }),
        ...(profilePictureUrl !== undefined && { profilePictureUrl: profilePictureUrl?.trim() || null }),
        ...(instagram !== undefined && { instagram: instagram?.trim() || null }),
        ...(twitter !== undefined && { twitter: twitter?.trim() || null }),
        ...(youtube !== undefined && { youtube: youtube?.trim() || null }),
        ...(tiktok !== undefined && { tiktok: tiktok?.trim() || null }),
        ...(linkedin !== undefined && { linkedin: linkedin?.trim() || null }),
        ...(website !== undefined && { website: website?.trim() || null }),
      },
    });

    res.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        username: user.username,
        bio: user.bio,
        profilePictureUrl: user.profilePictureUrl,
        instagram: user.instagram,
        twitter: user.twitter,
        youtube: user.youtube,
        tiktok: user.tiktok,
        linkedin: user.linkedin,
        website: user.website,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
