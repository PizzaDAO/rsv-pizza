/**
 * POST /api/pizzadao-link  (Bearer session of the signed-in rsv.pizza user)
 *   body { returnUrl, state } -> 200 { url }   (the frontend then navigates to `url`)
 * `returnUrl` must be on the PIZZADAO_LINK_RETURN_ORIGINS allowlist; `state` is the nonce
 * pizzadao.org bound to its own session. See lib/pizzadaoLink.ts for the token contract.
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { hasSigningKey } from '../lib/pizzaMcpToken.js';
import { buildLinkRedirect, LinkInputError } from '../lib/pizzadaoLink.js';

const router = Router();

const linkLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20,
  keyGenerator: (req) => (req as AuthRequest).userId ?? 'anon',
  message: { error: { message: 'Too many link attempts. Try again in a few minutes.', code: 'RATE_LIMITED' } },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

router.post('/', requireAuth, linkLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control', 'no-store');
  try {
    if (!hasSigningKey()) throw new AppError('Account linking is not configured', 503, 'NOT_CONFIGURED');
    const user = await prisma.user.findUnique({ where: { id: req.userId! }, select: { email: true } });
    if (!user?.email) throw new AppError('User not found', 401, 'UNAUTHORIZED');
    try {
      const url = buildLinkRedirect({ email: user.email, returnUrl: req.body?.returnUrl, state: req.body?.state });
      res.json({ url });
    } catch (e) {
      if (e instanceof LinkInputError) throw new AppError(e.message, 400, 'BAD_REQUEST');
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

export default router;
