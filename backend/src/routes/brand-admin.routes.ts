/**
 * Brand-admin API (plans/wl-self-serve-brands.md §2.1), mounted at /api/brand-admin.
 *
 *   POST /api/brand-admin/accept {token}   Accept an emailed invite as the signed-in user.
 *
 * Series-scoped routes (`/:seriesId/...`, all behind requireSeriesAdmin) are added by the next PR.
 */
import { Router, Response, NextFunction } from 'express';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { acceptSeriesInvite } from '../lib/seriesAdmins.js';
import { isWellFormedInviteToken } from '../lib/seriesInvites.js';
import { reserveInviteAccept } from '../lib/seriesInviteLimit.js';

const router = Router();

router.post('/accept', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    if (!req.userId || !req.userEmail) throw new AppError('Unauthorized', 401, 'UNAUTHORIZED');
    let allowed: boolean;
    try {
      allowed = await reserveInviteAccept(req.ip, req.userId);
    } catch (err) {
      console.error('[brand-admin/accept] rate store unavailable', err);
      throw new AppError('Please try again shortly', 503, 'UNAVAILABLE');
    }
    if (!allowed) throw new AppError('Too many attempts. Try again later.', 429, 'RATE_LIMITED');

    const token = (req.body || {}).token;
    if (!isWellFormedInviteToken(token)) throw new AppError('This invite link is invalid or has expired', 400, 'INVALID_INVITE');
    const { seriesId } = await acceptSeriesInvite({ token, userId: req.userId, userEmail: req.userEmail });
    res.json({ success: true, seriesId });
  } catch (error) {
    next(error);
  }
});

export default router;
