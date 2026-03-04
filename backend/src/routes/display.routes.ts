import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can edit any party
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  // Otherwise, must be the party owner
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

// Helper to generate a URL-safe slug
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50) || 'display';
}

const router = Router();

// GET /api/parties/:partyId/displays - List all displays for a party
router.get('/:partyId/displays', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
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

    // Validate required fields
    if (!name) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    // Validate content type
    const validContentTypes = ['slideshow', 'qr_code', 'event_info', 'photos', 'upload', 'custom'];
    if (!validContentTypes.includes(contentType)) {
      throw new AppError(`Invalid content type. Must be one of: ${validContentTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

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
        contentConfig,
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

    // Check if display exists
    const existing = await prisma.display.findFirst({
      where: { id: displayId, partyId },
    });

    if (!existing) {
      throw new AppError('Display not found', 404, 'NOT_FOUND');
    }

    // Validate content type if provided
    if (contentType) {
      const validContentTypes = ['slideshow', 'qr_code', 'event_info', 'photos', 'upload', 'custom'];
      if (!validContentTypes.includes(contentType)) {
        throw new AppError(`Invalid content type. Must be one of: ${validContentTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
    }

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
        ...(contentConfig !== undefined && { contentConfig }),
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
          ...(config?.filter === 'starred' && { starred: true }),
        },
        orderBy: { createdAt: 'desc' },
        take: config?.limit || 50,
      });
    }

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

    const display = await prisma.display.findUnique({
      where: { partyId_slug: { partyId, slug } },
    });

    if (!display || !display.isActive || display.contentType !== 'photos') {
      throw new AppError('Display not found or not a photo display', 404, 'NOT_FOUND');
    }

    const config = display.contentConfig as any;
    const where: any = {
      partyId: display.partyId,
      ...(config?.filter === 'starred' && { starred: true }),
    };

    // If since timestamp provided, only get newer photos
    if (since) {
      where.createdAt = { gt: new Date(since as string) };
    }

    const photos = await prisma.photo.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: config?.limit || 50,
    });

    res.json({ photos });
  } catch (error) {
    next(error);
  }
});

export default router;
