/**
 * Hackathon public read (plans/hackathon-platform.md §7, PR 2). Mounted at /api/parties before
 * the host router.
 *
 * GET /:partyId/hackathon
 *   - host / co-host with the hackathon tab / super admin: the full setup (incl. drafts, judges
 *     with emails, disabled state), `canManage: true`. `hackathon: null` when not enabled yet.
 *   - everyone else: the public shape (serialize.publicHackathon, explicit allowlist) only when
 *     the hackathon is published and not disabled; otherwise `hackathon: null` (200, so event
 *     pages don't log 404s).
 */
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { isHackathonHost } from '../lib/hackathon/access.js';
import { HACKATHON_INCLUDE, hostHackathon, isPubliclyVisible, publicHackathon } from '../lib/hackathon/serialize.js';

const router = Router();

router.get('/:partyId/hackathon', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    if (!isUuid(partyId)) throw new AppError('Party not found', 404, 'NOT_FOUND');

    const hackathon = await prisma.hackathon.findUnique({ where: { partyId }, include: HACKATHON_INCLUDE });

    if (await isHackathonHost(partyId, req.userId, req.userEmail)) {
      res.set('Cache-Control', 'private, no-store');
      return res.json({ hackathon: hackathon ? hostHackathon(hackathon) : null, canManage: true });
    }

    res.set('Cache-Control', 'private, no-store');
    res.json({ hackathon: isPubliclyVisible(hackathon) ? publicHackathon(hackathon!) : null, canManage: false });
  } catch (error) {
    next(error);
  }
});

export default router;
