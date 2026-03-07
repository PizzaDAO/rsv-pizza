import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

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

const router = Router();

// All venue photo routes require authentication
router.use(requireAuth);

// POST /api/parties/:partyId/venues/:venueId/photos - Create photo record
router.post('/:partyId/venues/:venueId/photos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId } = req.params;
    const { url, fileName, fileSize, mimeType, width, height, caption, category } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify venue belongs to party
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!venue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    // Validate required fields
    if (!url || !fileName || !fileSize || !mimeType) {
      throw new AppError('Missing required fields: url, fileName, fileSize, mimeType', 400, 'VALIDATION_ERROR');
    }

    // Get max sort order
    const maxOrder = await prisma.venuePhoto.aggregate({
      where: { venueId },
      _max: { sortOrder: true },
    });

    const photo = await prisma.venuePhoto.create({
      data: {
        venueId,
        url,
        fileName,
        fileSize,
        mimeType,
        width: width || null,
        height: height || null,
        caption: caption || null,
        category: category || null,
        sortOrder: (maxOrder._max.sortOrder || 0) + 1,
      },
    });

    res.status(201).json({ photo });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/venues/:venueId/photos - List photos for a venue
router.get('/:partyId/venues/:venueId/photos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify venue belongs to party
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!venue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    const photos = await prisma.venuePhoto.findMany({
      where: { venueId },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ photos });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/venues/:venueId/photos/:photoId - Update photo caption/category
router.patch('/:partyId/venues/:venueId/photos/:photoId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId, photoId } = req.params;
    const { caption, category, sortOrder } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify venue belongs to party
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!venue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    // Verify photo belongs to venue
    const existingPhoto = await prisma.venuePhoto.findFirst({
      where: { id: photoId, venueId },
    });

    if (!existingPhoto) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    const photo = await prisma.venuePhoto.update({
      where: { id: photoId },
      data: {
        ...(caption !== undefined && { caption: caption || null }),
        ...(category !== undefined && { category: category || null }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    res.json({ photo });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/venues/:venueId/photos/:photoId - Delete photo
router.delete('/:partyId/venues/:venueId/photos/:photoId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, venueId, photoId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Verify venue belongs to party
    const venue = await prisma.venue.findFirst({
      where: { id: venueId, partyId },
    });

    if (!venue) {
      throw new AppError('Venue not found', 404, 'NOT_FOUND');
    }

    // Verify photo belongs to venue
    const existingPhoto = await prisma.venuePhoto.findFirst({
      where: { id: photoId, venueId },
    });

    if (!existingPhoto) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    await prisma.venuePhoto.delete({
      where: { id: photoId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
