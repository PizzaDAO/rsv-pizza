import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { canUserEditParty, canUserAccessTab } from '../helpers/partyAccess.js';
import { Prisma } from '@prisma/client';
import { isUuid } from '../lib/guestToken.js';
import { buildDisplayHackathon, parseHackathonDisplayConfig } from '../lib/hackathon/gallery.js';
import { galleryLimiter } from './hackathon-gallery.routes.js';

// Helper to generate a URL-safe slug
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'display';
}

const router = Router();

// Public display feeds: only approved photos (pending/rejected never show, whether or not
// moderation is on), and an explicit select so uploader email / guest id / reviewer never leak.
export const DISPLAY_PHOTO_SELECT = {
  id: true,
  partyId: true,
  url: true,
  thumbnailUrl: true,
  fileName: true,
  fileSize: true,
  mimeType: true,
  width: true,
  height: true,
  uploaderName: true,
  caption: true,
  tags: true,
  photoYear: true,
  starred: true,
  starredAt: true,
  status: true,
  duration: true,
  voteCount: true,
  createdAt: true,
  updatedAt: true,
} as const;

export const VALID_CONTENT_TYPES = ['slideshow', 'qr_code', 'event_info', 'photos', 'upload', 'custom', 'hackathon'];

/**
 * hackathon (PR 6): the party must have the Hackathon app enabled, and the config is reduced to
 * the known keys (lib/hackathon/gallery.ts parseHackathonDisplayConfig). Other types: unchanged.
 */
async function checkContentConfig(partyId: string, contentType: string, contentConfig: any): Promise<any> {
  if (contentType !== 'hackathon') return contentConfig;
  const h = await prisma.hackathon.findUnique({ where: { partyId }, select: { id: true, disabledAt: true } });
  if (!h || h.disabledAt) throw new AppError('Turn on the Hackathon app for this event first', 400, 'HACKATHON_NOT_ENABLED');
  try {
    return parseHackathonDisplayConfig(contentConfig) as Prisma.InputJsonValue;
  } catch (e) {
    throw new AppError((e as Error).message, 400, 'VALIDATION_ERROR');
  }
}

// GET /api/parties/:partyId/displays - List all displays for a party
router.get('/:partyId/displays', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to displays tab
    const canAccessDisplays = await canUserAccessTab(partyId, req.userEmail, req.userId, 'displays');
    if (!canAccessDisplays) {
      throw new AppError('You do not have access to the displays tab', 403, 'TAB_ACCESS_DENIED');
    }

    const displays = await prisma.display.findMany({
      where: { partyId },
      orderBy: { createdAt: 'asc' },
    });

    res.json({ displays });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/displays - Create a new display
router.post('/:partyId/displays', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      name,
      contentType = 'slideshow',
      contentConfig = {},
      rotationInterval = 10,
      backgroundColor = '#000000',
      showClock = false,
      showEventName = true,
      password,
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to displays tab
    const canAccessDisplaysTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'displays');
    if (!canAccessDisplaysTab) {
      throw new AppError('You do not have access to the displays tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Validate required fields
    if (!name) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Validate content type
    if (!VALID_CONTENT_TYPES.includes(contentType)) {
      throw new AppError(`Invalid content type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}`, 400, 'VALIDATION_ERROR');
    }
    const finalConfig = await checkContentConfig(partyId, contentType, contentConfig);

    // Generate unique slug
    let baseSlug = generateSlug(name);
    let slug = baseSlug;
    let counter = 1;

    // Check for slug conflicts and generate unique one
    while (true) {
      const existing = await prisma.display.findUnique({
        where: { partyId_slug: { partyId, slug } },
      });
      if (!existing) break;
      slug = `${baseSlug}-${counter}`;
      counter++;
    }

    const display = await prisma.display.create({
      data: {
        partyId,
        name,
        slug,
        contentType,
        contentConfig: finalConfig,
        rotationInterval,
        backgroundColor,
        showClock,
        showEventName,
        password: password || null,
      },
    });

    res.status(201).json({ display });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/displays/:displayId - Get display details
router.get('/:partyId/displays/:displayId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, displayId } = req.params;

    // Verify ownership or super admin
    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to displays tab
    const canAccessDisplays = await canUserAccessTab(partyId, req.userEmail, req.userId, 'displays');
    if (!canAccessDisplays) {
      throw new AppError('You do not have access to the displays tab', 403, 'TAB_ACCESS_DENIED');
    }

    const display = await prisma.display.findFirst({
      where: { id: displayId, partyId },
    });

    if (!display) {
      throw new AppError('Display not found', 404, 'NOT_FOUND');
    }

    res.json({ display });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/displays/:displayId - Update display
router.patch('/:partyId/displays/:displayId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, displayId } = req.params;
    const {
      name,
      contentType,
      contentConfig,
      rotationInterval,
      backgroundColor,
      showClock,
      showEventName,
      isActive,
      password,
    } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to displays tab
    const canAccessDisplaysTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'displays');
    if (!canAccessDisplaysTab) {
      throw new AppError('You do not have access to the displays tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Check if display exists
    const existing = await prisma.display.findFirst({
      where: { id: displayId, partyId },
    });

    if (!existing) {
      throw new AppError('Display not found', 404, 'NOT_FOUND');
    }

    // Validate content type if provided
    if (contentType) {
      if (!VALID_CONTENT_TYPES.includes(contentType)) {
        throw new AppError(`Invalid content type. Must be one of: ${VALID_CONTENT_TYPES.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
    }
    // A hackathon display's config is validated whenever the type or the config changes.
    const nextType = contentType ?? existing.contentType;
    const nextConfig = nextType === 'hackathon' && (contentType !== undefined || contentConfig !== undefined)
      ? await checkContentConfig(partyId, nextType, contentConfig ?? existing.contentConfig)
      : contentConfig;

    // Update slug if name changes
    let newSlug = existing.slug;
    if (name && name !== existing.name) {
      let baseSlug = generateSlug(name);
      newSlug = baseSlug;
      let counter = 1;

      while (true) {
        const conflict = await prisma.display.findFirst({
          where: {
            partyId,
            slug: newSlug,
            id: { not: displayId },
          },
        });
        if (!conflict) break;
        newSlug = `${baseSlug}-${counter}`;
        counter++;
      }
    }

    const display = await prisma.display.update({
      where: { id: displayId },
      data: {
        ...(name !== undefined && { name, slug: newSlug }),
        ...(contentType !== undefined && { contentType }),
        ...(nextConfig !== undefined && { contentConfig: nextConfig }),
        ...(rotationInterval !== undefined && { rotationInterval }),
        ...(backgroundColor !== undefined && { backgroundColor }),
        ...(showClock !== undefined && { showClock }),
        ...(showEventName !== undefined && { showEventName }),
        ...(isActive !== undefined && { isActive }),
        ...(password !== undefined && { password: password || null }),
      },
    });

    res.json({ display });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/displays/:displayId - Delete display
router.delete('/:partyId/displays/:displayId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, displayId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify co-host has access to displays tab
    const canAccessDisplaysTab = await canUserAccessTab(partyId, req.userEmail, req.userId, 'displays');
    if (!canAccessDisplaysTab) {
      throw new AppError('You do not have access to the displays tab', 403, 'TAB_ACCESS_DENIED');
    }

    // Check if display exists
    const existing = await prisma.display.findFirst({
      where: { id: displayId, partyId },
    });

    if (!existing) {
      throw new AppError('Display not found', 404, 'NOT_FOUND');
    }

    await prisma.display.delete({
      where: { id: displayId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Public Display Viewer Endpoints
// ============================================

// GET /api/display/:partyId/:slug - Get display for public viewer
router.get('/view/:partyId/:slug', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, slug } = req.params;
    const { password } = req.query;

    const display = await prisma.display.findUnique({
      where: { partyId_slug: { partyId, slug } },
      include: {
        party: {
          select: {
            id: true,
            name: true,
            date: true,
            address: true,
            venueName: true,
            eventImageUrl: true,
            inviteCode: true,
            customUrl: true,
          },
        },
      },
    });

    if (!display) {
      throw new AppError('Display not found', 404, 'NOT_FOUND');
    }

    if (!display.isActive) {
      throw new AppError('Display is not active', 403, 'DISPLAY_INACTIVE');
    }

    // Check password if required
    if (display.password) {
      if (!password || password !== display.password) {
        throw new AppError('Password required', 401, 'PASSWORD_REQUIRED');
      }
    }

    // Update view count and last viewed time
    await prisma.display.update({
      where: { id: display.id },
      data: {
        viewCount: { increment: 1 },
        lastViewedAt: new Date(),
      },
    });

    // If content type is photos, include recent photos
    let photos = null;
    if (display.contentType === 'photos') {
      const config = display.contentConfig as any;
      photos = await prisma.photo.findMany({
        where: {
          partyId: display.partyId,
          deletedAt: null, // provolone-58931: never show soft-deleted photos
          status: 'approved',
          ...(config?.filter === 'starred' && { starred: true }),
        },
        orderBy: { createdAt: 'desc' },
        take: config?.limit || 50,
        select: DISPLAY_PHOTO_SELECT,
      });
    }

    // Hackathon display (PR 6): public-serializer data only (lib/hackathon/gallery.ts).
    const hackathon = display.contentType === 'hackathon'
      ? await buildDisplayHackathon(display.partyId, { displayHasPassword: !!display.password })
      : undefined;

    res.json({
      display: {
        id: display.id,
        name: display.name,
        slug: display.slug,
        contentType: display.contentType,
        contentConfig: display.contentConfig,
        rotationInterval: display.rotationInterval,
        backgroundColor: display.backgroundColor,
        showClock: display.showClock,
        showEventName: display.showEventName,
      },
      party: display.party,
      photos,
      ...(hackathon !== undefined && { hackathon }),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/display/:partyId/:slug/photos - Get photos for display (for live refresh)
router.get('/view/:partyId/:slug/photos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, slug } = req.params;
    const { since } = req.query;

    let sinceDate: Date | null = null;
    if (since !== undefined) {
      sinceDate = typeof since === 'string' ? new Date(since) : null;
      if (!sinceDate || Number.isNaN(sinceDate.getTime())) {
        throw new AppError('Invalid since timestamp', 400, 'VALIDATION_ERROR');
      }
    }

    const display = await prisma.display.findUnique({
      where: { partyId_slug: { partyId, slug } },
    });

    if (!display || !display.isActive || display.contentType !== 'photos') {
      throw new AppError('Display not found or not a photo display', 404, 'NOT_FOUND');
    }

    const config = display.contentConfig as any;
    const where: any = {
      partyId: display.partyId,
      deletedAt: null, // provolone-58931: never show soft-deleted photos
      status: 'approved',
      ...(config?.filter === 'starred' && { starred: true }),
    };

    // If since timestamp provided, only get newer photos
    if (sinceDate) {
      where.createdAt = { gt: sinceDate };
    }

    const photos = await prisma.photo.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: config?.limit || 50,
      select: DISPLAY_PHOTO_SELECT,
    });

    res.json({ photos });
  } catch (error) {
    next(error);
  }
});

// GET /api/display/view/:partyId/:slug/hackathon - hackathon block refresh (the TV polls every 30s)
router.get('/view/:partyId/:slug/hackathon', galleryLimiter, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, slug } = req.params;
    if (!isUuid(partyId)) throw new AppError('Display not found', 404, 'NOT_FOUND');
    const display = await prisma.display.findUnique({ where: { partyId_slug: { partyId, slug } } });
    if (!display || !display.isActive || display.contentType !== 'hackathon') {
      throw new AppError('Display not found or not a hackathon display', 404, 'NOT_FOUND');
    }
    if (display.password && req.query.password !== display.password) {
      throw new AppError('Password required', 401, 'PASSWORD_REQUIRED');
    }
    res.set('Cache-Control', 'private, no-store');
    res.json({ hackathon: await buildDisplayHackathon(display.partyId, { displayHasPassword: !!display.password }) });
  } catch (error) {
    next(error);
  }
});

export default router;
