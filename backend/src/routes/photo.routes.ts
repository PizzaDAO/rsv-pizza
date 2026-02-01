import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Helper function to check if user can access/edit a party
async function canUserEditParty(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can edit any party
  if (isSuperAdmin(userEmail)) {
    return true;
  }

  // Otherwise, must be the party owner
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

const router = Router();

// GET /api/parties/:partyId/photos - List all photos for a party (public if photosPublic is true)
router.get('/:partyId/photos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { starred, tag, uploadedBy, limit = '50', offset = '0' } = req.query;

    // Get party to check if photos are public
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true, photosPublic: true, userId: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!party.photosEnabled) {
      throw new AppError('Photos are not enabled for this party', 403, 'PHOTOS_DISABLED');
    }

    // If photos are not public, require authentication and ownership
    if (!party.photosPublic) {
      const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canAccess) {
        throw new AppError('Photos are private', 403, 'PHOTOS_PRIVATE');
      }
    }

    // Build query filters
    const where: any = { partyId };

    if (starred === 'true') {
      where.starred = true;
    }

    if (tag && typeof tag === 'string') {
      where.tags = { has: tag };
    }

    if (uploadedBy && typeof uploadedBy === 'string') {
      where.uploadedBy = uploadedBy;
    }

    const photos = await prisma.photo.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(parseInt(limit as string, 10), 100),
      skip: parseInt(offset as string, 10),
      include: {
        guest: { select: { id: true, name: true } },
      },
    });

    const total = await prisma.photo.count({ where });

    res.json({
      photos,
      total,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/photos - Upload a new photo (requires guest identity or auth)
router.post('/:partyId/photos', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      url,
      thumbnailUrl,
      fileName,
      fileSize,
      mimeType,
      width,
      height,
      uploaderName,
      uploaderEmail,
      guestId,
      caption,
      tags,
    } = req.body;

    // Validate required fields
    if (!url || !fileName || !fileSize || !mimeType) {
      throw new AppError('Missing required fields: url, fileName, fileSize, mimeType', 400, 'VALIDATION_ERROR');
    }

    // Get party to check if photos are enabled
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!party.photosEnabled) {
      throw new AppError('Photos are not enabled for this party', 403, 'PHOTOS_DISABLED');
    }

    // Validate MIME type
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedMimeTypes.includes(mimeType)) {
      throw new AppError('Invalid file type. Allowed: jpeg, png, webp, gif', 400, 'INVALID_FILE_TYPE');
    }

    // Validate file size (10MB max)
    if (fileSize > 10 * 1024 * 1024) {
      throw new AppError('File too large. Maximum size is 10MB', 400, 'FILE_TOO_LARGE');
    }

    // If guestId provided, verify it belongs to this party
    let verifiedGuestId: string | null = null;
    if (guestId) {
      const guest = await prisma.guest.findFirst({
        where: { id: guestId, partyId },
      });
      if (guest) {
        verifiedGuestId = guest.id;
      }
    }

    const photo = await prisma.photo.create({
      data: {
        partyId,
        url,
        thumbnailUrl: thumbnailUrl || null,
        fileName,
        fileSize,
        mimeType,
        width: width || null,
        height: height || null,
        uploadedBy: verifiedGuestId,
        uploaderName: uploaderName || null,
        uploaderEmail: uploaderEmail?.toLowerCase() || null,
        caption: caption || null,
        tags: tags || [],
      },
      include: {
        guest: { select: { id: true, name: true } },
      },
    });

    res.status(201).json({ photo });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/photos/:photoId - Get single photo details
router.get('/:partyId/photos/:photoId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, photoId } = req.params;

    // Get party to check if photos are public
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true, photosPublic: true, userId: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!party.photosEnabled) {
      throw new AppError('Photos are not enabled for this party', 403, 'PHOTOS_DISABLED');
    }

    // If photos are not public, require authentication and ownership
    if (!party.photosPublic) {
      const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (!canAccess) {
        throw new AppError('Photos are private', 403, 'PHOTOS_PRIVATE');
      }
    }

    const photo = await prisma.photo.findFirst({
      where: { id: photoId, partyId },
      include: {
        guest: { select: { id: true, name: true } },
      },
    });

    if (!photo) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    res.json({ photo });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/photos/:photoId - Update photo (host only)
router.patch('/:partyId/photos/:photoId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, photoId } = req.params;
    const { caption, tags, starred } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if photo exists
    const existingPhoto = await prisma.photo.findFirst({
      where: { id: photoId, partyId },
    });

    if (!existingPhoto) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    const photo = await prisma.photo.update({
      where: { id: photoId },
      data: {
        ...(caption !== undefined && { caption }),
        ...(tags !== undefined && { tags }),
        ...(starred !== undefined && {
          starred,
          starredAt: starred ? new Date() : null,
        }),
      },
      include: {
        guest: { select: { id: true, name: true } },
      },
    });

    res.json({ photo });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/photos/:photoId - Delete a photo (host or uploader)
router.delete('/:partyId/photos/:photoId', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, photoId } = req.params;
    const { uploaderEmail } = req.query;

    // Get the photo first
    const photo = await prisma.photo.findFirst({
      where: { id: photoId, partyId },
    });

    if (!photo) {
      throw new AppError('Photo not found', 404, 'NOT_FOUND');
    }

    // Check if user can delete:
    // 1. Party host/owner can delete any photo
    // 2. Original uploader can delete their own photo (by email match)
    const isHost = await canUserEditParty(partyId, req.userId, req.userEmail);
    const isUploader = uploaderEmail &&
      photo.uploaderEmail &&
      photo.uploaderEmail.toLowerCase() === (uploaderEmail as string).toLowerCase();

    if (!isHost && !isUploader) {
      throw new AppError('Unauthorized to delete this photo', 403, 'UNAUTHORIZED');
    }

    await prisma.photo.delete({
      where: { id: photoId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/photos/stats - Get photo statistics for a party
router.get('/:partyId/photos/stats', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Get party to check existence
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, photosEnabled: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const totalPhotos = await prisma.photo.count({ where: { partyId } });
    const starredPhotos = await prisma.photo.count({ where: { partyId, starred: true } });

    // Get unique tags
    const photos = await prisma.photo.findMany({
      where: { partyId },
      select: { tags: true },
    });
    const allTags = photos.flatMap(p => p.tags);
    const uniqueTags = [...new Set(allTags)];

    // Get unique uploaders count
    const uniqueUploaders = await prisma.photo.groupBy({
      by: ['uploaderEmail'],
      where: { partyId, uploaderEmail: { not: null } },
    });

    res.json({
      totalPhotos,
      starredPhotos,
      uniqueTags,
      uniqueUploadersCount: uniqueUploaders.length,
      photosEnabled: party.photosEnabled,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
