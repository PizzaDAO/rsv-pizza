/**
 * Hackathon public gallery + project pages (plans/hackathon-platform.md §7-8, PR 6). Mounted at
 * /api/parties. Rules and shapes: lib/hackathon/gallery.ts.
 *
 * GET /:partyId/hackathon/gallery
 *   - host / co-host (hackathon tab) / admin: always, as a preview (`preview: true` while the
 *     public can't see it yet). Submitted projects only, i.e. what the public will see.
 *   - everyone else: projects only while the gallery is open AND the viewer can see the event
 *     (pre-launch gates + password rule, same as GET /:partyId/hackathon). Otherwise 200 with
 *     `available: false` and no projects (so event pages don't log errors).
 * GET /:partyId/hackathon/projects/:projectSlug
 *   - host: any project, any status (preview).
 *   - the project's own team: their project at any status (preview).
 *   - everyone else: submitted projects of an open gallery the viewer can see; otherwise 404
 *     (never says whether a hidden project exists).
 *
 * Unauthenticated, so: a per-IP limiter on top of the global /api one, and a short private
 * cache for public responses (previews are no-store). Images are short-lived signed URLs from a
 * process cache (lib/hackathon/signedUrlCache.ts).
 */
import { Router, Response, NextFunction } from 'express';
import { rateLimit, ipKeyGenerator } from 'express-rate-limit';
import { prisma } from '../config/database.js';
import { optionalAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { isUuid } from '../lib/guestToken.js';
import { isHackathonHost } from '../lib/hackathon/access.js';
import { buildGallery, buildProject, galleryMeta, isGalleryOpen, loadGalleryHackathon, loadProject, PUBLIC_STATUS, viewerCanSeeEvent } from '../lib/hackathon/gallery.js';

const router = Router();

/** 300 / 5 min per IP for the unauthenticated gallery reads (a page view is 1-2 calls). */
export const galleryLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 300,
  message: { error: 'You\'ve been rate limited. Please wait a few minutes before trying again.' },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
  keyGenerator: (req) => 'hkg:' + ipKeyGenerator(req.ip ?? ''),
});

const PUBLIC_CACHE = 'private, max-age=60';
const NO_STORE = 'private, no-store';
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

router.get('/:partyId/hackathon/gallery', galleryLimiter, optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    if (!isUuid(partyId)) throw new AppError('Party not found', 404, 'NOT_FOUND');
    const h = await loadGalleryHackathon(partyId);
    const host = await isHackathonHost(partyId, req.userId, req.userEmail);
    const now = new Date();

    if (!h || (!host && (!h.publishedAt || h.disabledAt))) {
      res.set('Cache-Control', host ? NO_STORE : PUBLIC_CACHE);
      return res.json({ available: false, preview: false, galleryOpen: false, opensAfter: null, tracks: [], projects: [] });
    }

    const meta = galleryMeta(h, now);
    if (host) {
      res.set('Cache-Control', NO_STORE);
      return res.json({ available: true, preview: !meta.galleryOpen, canManage: true, ...meta, ...(await buildGallery(h)) });
    }

    const canSee = await viewerCanSeeEvent(partyId, req.userEmail);
    res.set('Cache-Control', PUBLIC_CACHE);
    if (!canSee) return res.json({ available: false, preview: false, galleryOpen: false, opensAfter: null, tracks: [], projects: [] });
    if (!meta.galleryOpen) {
      return res.json({ available: false, preview: false, ...meta, tracks: [], projects: [] });
    }
    res.json({ available: true, preview: false, ...meta, ...(await buildGallery(h)) });
  } catch (error) {
    next(error);
  }
});

router.get('/:partyId/hackathon/projects/:projectSlug', galleryLimiter, optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, projectSlug } = req.params;
    const notFound = () => new AppError('Project not found', 404, 'NOT_FOUND');
    if (!isUuid(partyId) || typeof projectSlug !== 'string' || projectSlug.length > 120 || !SLUG_RE.test(projectSlug)) throw notFound();

    const h = await loadGalleryHackathon(partyId);
    if (!h) throw notFound();
    const s = await loadProject(h, projectSlug);
    const host = await isHackathonHost(partyId, req.userId, req.userEmail);

    let preview = false;
    if (host) {
      if (!s) throw notFound();
      preview = !(isGalleryOpen(h) && s.status === PUBLIC_STATUS);
    } else {
      const ownTeam = !!s && !!req.userId && !!(await prisma.hackathonTeamMember.findUnique({
        where: { hackathonId_userId: { hackathonId: h.id, userId: req.userId } },
        select: { teamId: true },
      }).then((m) => m && m.teamId === s.teamId));
      if (!s) throw notFound();
      if (ownTeam && !h.disabledAt) {
        preview = !(isGalleryOpen(h) && s.status === PUBLIC_STATUS);
      } else {
        if (s.status !== PUBLIC_STATUS || !isGalleryOpen(h)) throw notFound();
        if (!(await viewerCanSeeEvent(partyId, req.userEmail))) throw notFound();
      }
    }

    res.set('Cache-Control', preview || host ? NO_STORE : PUBLIC_CACHE);
    res.json({
      preview,
      canManage: host,
      ...galleryMeta(h),
      tracks: h.tracks.map((t) => ({ id: t.id, name: t.name })),
      project: await buildProject(h, s, preview),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
