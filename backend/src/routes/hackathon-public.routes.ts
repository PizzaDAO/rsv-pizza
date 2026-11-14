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
 *
 * PR 5: once the host reveals results (results_revealed_at), both shapes carry
 * `resultsRevealedAt` + `winners` (awards.publicWinners: prize name / amount / track, place,
 * project name + tagline, team name; only `submitted` projects). Before the reveal: null / [].
 * Never recipients, wallets, payout status, references, notes, emails or user ids.
 */
import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { isHackathonHost } from '../lib/hackathon/access.js';
// Event-page gates (pre-launch GPP27 / side) + password rule, shared with the gallery (PR 6).
import { viewerCanSeeEvent } from '../lib/hackathon/gallery.js';
import { HACKATHON_INCLUDE, hostHackathon, isPubliclyVisible, publicHackathon } from '../lib/hackathon/serialize.js';
import { AWARD_INCLUDE, publicWinners } from '../lib/hackathon/awards.js';

const router = Router();

/** Winners block (PR 5): only queried once results are revealed. */
async function winnersBlock(h: { id: string; resultsRevealedAt: Date | null; tracks?: Array<{ id: string; name: string }> }) {
  if (!h.resultsRevealedAt) return { resultsRevealedAt: null, winners: [] };
  const awards = await prisma.hackathonAward.findMany({ where: { hackathonId: h.id }, include: AWARD_INCLUDE, take: 1000 });
  return { resultsRevealedAt: h.resultsRevealedAt.toISOString(), winners: publicWinners(awards, h.tracks ?? []) };
}

router.get('/:partyId/hackathon', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    if (!isUuid(partyId)) throw new AppError('Party not found', 404, 'NOT_FOUND');

    const hackathon = await prisma.hackathon.findUnique({ where: { partyId }, include: HACKATHON_INCLUDE });

    if (await isHackathonHost(partyId, req.userId, req.userEmail)) {
      res.set('Cache-Control', 'private, no-store');
      return res.json({ hackathon: hackathon ? { ...hostHackathon(hackathon), ...(await winnersBlock(hackathon)) } : null, canManage: true });
    }

    res.set('Cache-Control', 'private, no-store');
    const visible = isPubliclyVisible(hackathon) && (await viewerCanSeeEvent(partyId, req.userEmail));
    res.json({ hackathon: visible ? { ...publicHackathon(hackathon!), ...(await winnersBlock(hackathon!)) } : null, canManage: false });
  } catch (error) {
    next(error);
  }
});

export default router;
