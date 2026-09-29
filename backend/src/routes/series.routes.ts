/**
 * Public, read-only event-series config (white-label Phase 2c/2d foundation).
 *
 *   GET /api/series           List active series (public branding fields).
 *   GET /api/series/:slug     One series by slug.
 *
 * event_series is RLS-locked to the backend (Phase 1); this serves its
 * NON-SENSITIVE branding config to public surfaces (landing / map / flyer)
 * through the service-role Prisma client, so the browser never gets direct DB
 * access. internalTags is intentionally never returned.
 */
import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { AppError } from '../middleware/error.js';

const router = Router();

function toPublic(s: {
  slug: string; name: string; displayName: string; isActive: boolean;
  themeClass: string | null; logoUrl: string | null; ogImageUrl: string | null;
  description: string | null; eventType: string | null; publicTags: string[];
  requireApproval: boolean; hideGuests: boolean; photosEnabled: boolean; photosPublic: boolean;
  eventDate: Date | null; eventStartTime: string | null; eventEndTime: string | null;
}) {
  return {
    slug: s.slug,
    name: s.name,
    displayName: s.displayName,
    isActive: s.isActive,
    themeClass: s.themeClass,
    logoUrl: s.logoUrl,
    ogImageUrl: s.ogImageUrl,
    description: s.description,
    eventType: s.eventType,
    publicTags: s.publicTags,
    requireApproval: s.requireApproval,
    hideGuests: s.hideGuests,
    photosEnabled: s.photosEnabled,
    photosPublic: s.photosPublic,
    eventDate: s.eventDate ? s.eventDate.toISOString() : null,
    eventStartTime: s.eventStartTime,
    eventEndTime: s.eventEndTime,
  };
}

// Only public branding columns — never internalTags.
const PUBLIC_SELECT = {
  slug: true, name: true, displayName: true, isActive: true,
  themeClass: true, logoUrl: true, ogImageUrl: true, description: true,
  eventType: true, publicTags: true, requireApproval: true, hideGuests: true,
  photosEnabled: true, photosPublic: true, eventDate: true,
  eventStartTime: true, eventEndTime: true,
} as const;

// GET /api/series — active series (public branding).
router.get('/', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const rows = await prisma.eventSeries.findMany({
      where: { isActive: true },
      orderBy: [{ createdAt: 'asc' }],
      select: PUBLIC_SELECT,
    });
    res.json({ series: rows.map(toPublic) });
  } catch (error) {
    next(error);
  }
});

// GET /api/series/:slug — one series by slug.
router.get('/:slug', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const slug = req.params.slug?.trim();
    if (!slug) throw new AppError('slug is required', 400, 'VALIDATION_ERROR');
    const row = await prisma.eventSeries.findUnique({
      where: { slug },
      select: PUBLIC_SELECT,
    });
    if (!row) throw new AppError('Series not found', 404, 'NOT_FOUND');
    res.json({ series: toPublic(row) });
  } catch (error) {
    next(error);
  }
});

export default router;
