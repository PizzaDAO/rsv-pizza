import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, optionalAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

// Helper function to check if user can edit a party
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

const router = Router();

// GET /api/parties/:partyId/performers - List all performers for a party
router.get('/:partyId/performers', optionalAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Get party to check existence and music settings
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, musicEnabled: true, musicNotes: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const performers = await prisma.performer.findMany({
      where: { partyId },
      orderBy: { sortOrder: 'asc' },
    });

    // Strip sensitive fields from public responses (non-host users)
    const isHost = await canUserEditParty(partyId, req.userId, req.userEmail);
    const safePerformers = isHost ? performers : performers.map(p => ({
      id: p.id,
      name: p.name,
      type: p.type,
      genre: p.genre,
      setTime: p.setTime,
      setDuration: p.setDuration,
      sortOrder: p.sortOrder,
      partyId: p.partyId,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    }));

    res.json({
      performers: safePerformers,
      musicEnabled: party.musicEnabled,
      musicNotes: party.musicNotes,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/performers - Add a performer (host only)
router.post('/:partyId/performers', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      name,
      type = 'dj',
      genre,
      setTime,
      setDuration,
      contactName,
      contactEmail,
      contactPhone,
      instagram,
      soundcloud,
      status = 'confirmed',
      equipmentProvided = false,
      equipmentNotes,
      fee,
      feePaid = false,
      notes,
    } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Validate required fields
    if (!name || !name.trim()) {
      throw new AppError('Performer name is required', 400, 'VALIDATION_ERROR');
    }

    // Validate type
    const validTypes = ['dj', 'live_band', 'solo', 'playlist'];
    if (!validTypes.includes(type)) {
      throw new AppError('Invalid performer type', 400, 'VALIDATION_ERROR');
    }

    // Validate status
    const validStatuses = ['pending', 'confirmed', 'cancelled'];
    if (!validStatuses.includes(status)) {
      throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
    }

    // Get the next sort order
    const lastPerformer = await prisma.performer.findFirst({
      where: { partyId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const nextSortOrder = (lastPerformer?.sortOrder ?? -1) + 1;

    const performer = await prisma.performer.create({
      data: {
        partyId,
        name: name.trim(),
        type,
        genre: genre?.trim() || null,
        setTime: setTime || null,
        setDuration: setDuration ? parseInt(setDuration, 10) : null,
        sortOrder: nextSortOrder,
        contactName: contactName?.trim() || null,
        contactEmail: contactEmail?.trim()?.toLowerCase() || null,
        contactPhone: contactPhone?.trim() || null,
        instagram: instagram?.trim() || null,
        soundcloud: soundcloud?.trim() || null,
        status,
        equipmentProvided,
        equipmentNotes: equipmentNotes?.trim() || null,
        fee: fee ? parseFloat(fee) : null,
        feePaid,
        notes: notes?.trim() || null,
      },
    });

    res.status(201).json({ performer });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/performers/:performerId - Update a performer (host only)
router.patch('/:partyId/performers/:performerId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, performerId } = req.params;
    const {
      name,
      type,
      genre,
      setTime,
      setDuration,
      contactName,
      contactEmail,
      contactPhone,
      instagram,
      soundcloud,
      status,
      equipmentProvided,
      equipmentNotes,
      fee,
      feePaid,
      notes,
    } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if performer exists
    const existingPerformer = await prisma.performer.findFirst({
      where: { id: performerId, partyId },
    });

    if (!existingPerformer) {
      throw new AppError('Performer not found', 404, 'NOT_FOUND');
    }

    // Validate type if provided
    if (type !== undefined) {
      const validTypes = ['dj', 'live_band', 'solo', 'playlist'];
      if (!validTypes.includes(type)) {
        throw new AppError('Invalid performer type', 400, 'VALIDATION_ERROR');
      }
    }

    // Validate status if provided
    if (status !== undefined) {
      const validStatuses = ['pending', 'confirmed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
      }
    }

    const performer = await prisma.performer.update({
      where: { id: performerId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(type !== undefined && { type }),
        ...(genre !== undefined && { genre: genre?.trim() || null }),
        ...(setTime !== undefined && { setTime: setTime || null }),
        ...(setDuration !== undefined && { setDuration: setDuration ? parseInt(setDuration, 10) : null }),
        ...(contactName !== undefined && { contactName: contactName?.trim() || null }),
        ...(contactEmail !== undefined && { contactEmail: contactEmail?.trim()?.toLowerCase() || null }),
        ...(contactPhone !== undefined && { contactPhone: contactPhone?.trim() || null }),
        ...(instagram !== undefined && { instagram: instagram?.trim() || null }),
        ...(soundcloud !== undefined && { soundcloud: soundcloud?.trim() || null }),
        ...(status !== undefined && { status }),
        ...(equipmentProvided !== undefined && { equipmentProvided }),
        ...(equipmentNotes !== undefined && { equipmentNotes: equipmentNotes?.trim() || null }),
        ...(fee !== undefined && { fee: fee ? parseFloat(fee) : null }),
        ...(feePaid !== undefined && { feePaid }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
      },
    });

    res.json({ performer });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/performers/:performerId - Delete a performer (host only)
router.delete('/:partyId/performers/:performerId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, performerId } = req.params;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if performer exists
    const existingPerformer = await prisma.performer.findFirst({
      where: { id: performerId, partyId },
    });

    if (!existingPerformer) {
      throw new AppError('Performer not found', 404, 'NOT_FOUND');
    }

    await prisma.performer.delete({
      where: { id: performerId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/performers/reorder - Reorder performers (host only)
router.patch('/:partyId/performers/reorder', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { performerIds } = req.body;

    // Verify ownership
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Validate performerIds
    if (!Array.isArray(performerIds) || performerIds.length === 0) {
      throw new AppError('performerIds must be a non-empty array', 400, 'VALIDATION_ERROR');
    }

    // Verify all performers belong to this party
    const performers = await prisma.performer.findMany({
      where: { partyId },
      select: { id: true },
    });

    const existingIds = new Set(performers.map(p => p.id));
    for (const id of performerIds) {
      if (!existingIds.has(id)) {
        throw new AppError(`Performer ${id} not found in this party`, 400, 'VALIDATION_ERROR');
      }
    }

    // Update sort orders
    await prisma.$transaction(
      performerIds.map((id: string, index: number) =>
        prisma.performer.update({
          where: { id },
          data: { sortOrder: index },
        })
      )
    );

    // Return updated performers
    const updatedPerformers = await prisma.performer.findMany({
      where: { partyId },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ performers: updatedPerformers });
  } catch (error) {
    next(error);
  }
});

export default router;
