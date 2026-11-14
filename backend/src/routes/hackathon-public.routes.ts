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
 *   - the same pre-launch gates as GET /api/events/:slug (helpers/eventVisibility.ts): a hidden
 *     GPP27 / side event returns null. A password-protected event returns null unless the caller
 *     is logged in as one of its (non-rejected) guests; the password itself is only checked
 *     client-side, so there's no unlock proof to accept here.
 */
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { isEventHiddenFrom } from '../helpers/eventVisibility.js';
import { isHackathonHost } from '../lib/hackathon/access.js';
import { HACKATHON_INCLUDE, hostHackathon, isPubliclyVisible, publicHackathon } from '../lib/hackathon/serialize.js';

const router = Router();

/** Non-host viewer: the event-page gates (pre-launch GPP27 / side) + password protection. */
async function viewerCanSeeEvent(partyId: string, viewerEmail: string | undefined): Promise<boolean> {
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: { eventType: true, eventTags: true, date: true, region: true, city: true, password: true },
  });
  if (!party) return false;
  if (await isEventHiddenFrom(party, viewerEmail)) return false;
  if (party.password) {
    if (!viewerEmail) return false;
    const guest = await prisma.guest.findFirst({
      where: { partyId, email: { equals: viewerEmail, mode: 'insensitive' }, NOT: { approved: false } },
      select: { id: true },
    });
    return !!guest;
  }
  return true;
}

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
    const visible = isPubliclyVisible(hackathon) && (await viewerCanSeeEvent(partyId, req.userEmail));
    res.json({ hackathon: visible ? publicHackathon(hackathon!) : null, canManage: false });
  } catch (error) {
    next(error);
  }
});

export default router;
