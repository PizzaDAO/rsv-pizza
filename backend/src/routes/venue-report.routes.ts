import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import crypto from 'crypto';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

// Generate a unique slug for public venue reports
function generateSlug(): string {
  return crypto.randomBytes(8).toString('hex');
}

const router = Router();

// GET /api/parties/:partyId/venue-report - Get venue report data (host only)
router.get('/:partyId/venue-report', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: {
        id: true,
        name: true,
        venueReportPublished: true,
        venueReportSlug: true,
        venueReportPassword: true,
        venueReportTitle: true,
        venueReportNotes: true,
        venues: {
          orderBy: [
            { isSelected: 'desc' },
            { createdAt: 'desc' },
          ],
          include: {
            photos: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    res.json({
      venueReport: {
        partyId: party.id,
        partyName: party.name,
        title: party.venueReportTitle,
        notes: party.venueReportNotes,
        published: party.venueReportPublished,
        slug: party.venueReportSlug,
        hasPassword: !!party.venueReportPassword,
        password: party.venueReportPassword,
        venues: party.venues,
      },
    });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/venue-report - Update venue report title/notes
router.patch('/:partyId/venue-report', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { title, notes } = req.body;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    await prisma.party.update({
      where: { id: partyId },
      data: {
        ...(title !== undefined && { venueReportTitle: title || null }),
        ...(notes !== undefined && { venueReportNotes: notes || null }),
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/venue-report/publish - Publish venue report
router.post('/:partyId/venue-report/publish', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const existingParty = await prisma.party.findUnique({
      where: { id: partyId },
      select: { venueReportPublished: true, venueReportSlug: true },
    });

    if (!existingParty) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const { password } = req.body || {};

    // Generate slug if not already set
    let slug = existingParty.venueReportSlug;
    if (!slug) {
      slug = generateSlug();
    }

    const party = await prisma.party.update({
      where: { id: partyId },
      data: {
        venueReportPublished: true,
        venueReportSlug: slug,
        venueReportPassword: password || null,
      },
    });

    res.json({
      success: true,
      venueReportSlug: party.venueReportSlug,
      publicUrl: `/venue-report/${party.venueReportSlug}`,
      hasPassword: !!party.venueReportPassword,
    });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/venue-report/publish - Unpublish venue report
router.delete('/:partyId/venue-report/publish', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    await prisma.party.update({
      where: { id: partyId },
      data: {
        venueReportPublished: false,
      },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/public/:slug/venue/check - Check if venue report requires password (public)
router.get('/public/:slug/venue/check', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const party = await prisma.party.findUnique({
      where: { venueReportSlug: slug },
      select: { venueReportPublished: true, venueReportPassword: true, name: true, venueReportTitle: true },
    });

    if (!party || !party.venueReportPublished) {
      throw new AppError('Venue report not found', 404, 'NOT_FOUND');
    }

    res.json({
      requiresPassword: !!party.venueReportPassword,
      name: party.name,
      title: party.venueReportTitle,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/reports/public/:slug/venue - View published venue report (public)
router.get('/public/:slug/venue', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { slug } = req.params;
    const password = req.query.password as string | undefined;

    // Quick password check
    const check = await prisma.party.findUnique({
      where: { venueReportSlug: slug },
      select: { venueReportPassword: true, venueReportPublished: true },
    });

    if (!check || !check.venueReportPublished) {
      throw new AppError('Venue report not found', 404, 'NOT_FOUND');
    }

    if (check.venueReportPassword && check.venueReportPassword !== password) {
      throw new AppError('Password required', 401, 'PASSWORD_REQUIRED');
    }

    const party = await prisma.party.findUnique({
      where: { venueReportSlug: slug },
      select: {
        id: true,
        name: true,
        date: true,
        timezone: true,
        address: true,
        venueName: true,
        eventImageUrl: true,
        venueReportTitle: true,
        venueReportNotes: true,
        venues: {
          orderBy: [
            { isSelected: 'desc' },
            { createdAt: 'desc' },
          ],
          include: {
            photos: {
              orderBy: { sortOrder: 'asc' },
            },
          },
        },
      },
    });

    if (!party) {
      throw new AppError('Venue report not found', 404, 'NOT_FOUND');
    }

    res.json({
      venueReport: {
        partyId: party.id,
        partyName: party.name,
        date: party.date,
        timezone: party.timezone,
        address: party.address,
        venueName: party.venueName,
        eventImageUrl: party.eventImageUrl,
        title: party.venueReportTitle,
        notes: party.venueReportNotes,
        venues: party.venues,
      },
    });
  } catch (error) {
    next(error);
  }
});

export default router;
