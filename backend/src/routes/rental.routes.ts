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

// GET /:partyId/rentals - List all rentals for a party (auth required)
router.get('/:partyId/rentals', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const rentals = await prisma.rental.findMany({
      where: { partyId },
      orderBy: { sortOrder: 'asc' },
    });

    res.json({ rentals });
  } catch (error) {
    next(error);
  }
});

// POST /:partyId/rentals - Create a new rental (auth required)
router.post('/:partyId/rentals', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const {
      name,
      description,
      shapeType = 'rectangle',
      color = '#ff393a',
      borderColor = '#ffffff',
      x = 50,
      y = 50,
      width = 10,
      height = 10,
      rotation = 0,
      price,
      priceUnit = 'flat',
      capacity,
      status = 'available',
      bookedBy,
      bookedEmail,
      bookedNotes,
      showLabel = true,
      showOnDisplay = true,
      opacity = 0.3,
      sortOrder = 0,
    } = req.body;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    if (!name) {
      throw new AppError('Name is required', 400, 'VALIDATION_ERROR');
    }

    const validShapeTypes = ['rectangle', 'circle', 'square'];
    if (!validShapeTypes.includes(shapeType)) {
      throw new AppError(`Invalid shape type. Must be one of: ${validShapeTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    const rental = await prisma.rental.create({
      data: {
        partyId,
        name,
        description: description || null,
        shapeType,
        color,
        borderColor: borderColor || null,
        x,
        y,
        width,
        height,
        rotation: rotation || 0,
        price: price !== undefined && price !== null ? price : null,
        priceUnit: priceUnit || 'flat',
        capacity: capacity !== undefined && capacity !== null ? capacity : null,
        status: status || 'available',
        bookedBy: bookedBy || null,
        bookedEmail: bookedEmail || null,
        bookedNotes: bookedNotes || null,
        showLabel,
        showOnDisplay,
        opacity,
        sortOrder,
      },
    });

    res.status(201).json({ rental });
  } catch (error) {
    next(error);
  }
});

// PATCH /:partyId/rentals/:rentalId - Update a rental (auth required)
router.patch('/:partyId/rentals/:rentalId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, rentalId } = req.params;
    const {
      name,
      description,
      shapeType,
      color,
      borderColor,
      x,
      y,
      width,
      height,
      rotation,
      price,
      priceUnit,
      capacity,
      status,
      bookedBy,
      bookedEmail,
      bookedNotes,
      showLabel,
      showOnDisplay,
      opacity,
      sortOrder,
    } = req.body;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const existing = await prisma.rental.findFirst({
      where: { id: rentalId, partyId },
    });

    if (!existing) {
      throw new AppError('Rental not found', 404, 'NOT_FOUND');
    }

    if (shapeType) {
      const validShapeTypes = ['rectangle', 'circle', 'square'];
      if (!validShapeTypes.includes(shapeType)) {
        throw new AppError(`Invalid shape type. Must be one of: ${validShapeTypes.join(', ')}`, 400, 'VALIDATION_ERROR');
      }
    }

    const rental = await prisma.rental.update({
      where: { id: rentalId },
      data: {
        ...(name !== undefined && { name }),
        ...(description !== undefined && { description: description || null }),
        ...(shapeType !== undefined && { shapeType }),
        ...(color !== undefined && { color }),
        ...(borderColor !== undefined && { borderColor: borderColor || null }),
        ...(x !== undefined && { x }),
        ...(y !== undefined && { y }),
        ...(width !== undefined && { width }),
        ...(height !== undefined && { height }),
        ...(rotation !== undefined && { rotation }),
        ...(price !== undefined && { price: price !== null ? price : null }),
        ...(priceUnit !== undefined && { priceUnit: priceUnit || 'flat' }),
        ...(capacity !== undefined && { capacity: capacity !== null ? capacity : null }),
        ...(status !== undefined && { status }),
        ...(bookedBy !== undefined && { bookedBy: bookedBy || null }),
        ...(bookedEmail !== undefined && { bookedEmail: bookedEmail || null }),
        ...(bookedNotes !== undefined && { bookedNotes: bookedNotes || null }),
        ...(showLabel !== undefined && { showLabel }),
        ...(showOnDisplay !== undefined && { showOnDisplay }),
        ...(opacity !== undefined && { opacity }),
        ...(sortOrder !== undefined && { sortOrder }),
      },
    });

    res.json({ rental });
  } catch (error) {
    next(error);
  }
});

// DELETE /:partyId/rentals/:rentalId - Delete a rental (auth required)
router.delete('/:partyId/rentals/:rentalId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, rentalId } = req.params;

    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const existing = await prisma.rental.findFirst({
      where: { id: rentalId, partyId },
    });

    if (!existing) {
      throw new AppError('Rental not found', 404, 'NOT_FOUND');
    }

    await prisma.rental.delete({
      where: { id: rentalId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// ============================================
// Public Rental Endpoints
// ============================================

// GET /view/:partyId/rentals - Get public rentals (no auth, only showOnDisplay=true)
router.get('/view/:partyId/rentals', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    const rentals = await prisma.rental.findMany({
      where: {
        partyId,
        showOnDisplay: true,
      },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        partyId: true,
        name: true,
        description: true,
        shapeType: true,
        color: true,
        borderColor: true,
        x: true,
        y: true,
        width: true,
        height: true,
        rotation: true,
        price: true,
        priceUnit: true,
        capacity: true,
        status: true,
        bookedBy: true,
        // Deliberately exclude bookedEmail and bookedNotes for privacy
        showLabel: true,
        showOnDisplay: true,
        opacity: true,
        sortOrder: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    res.json({ rentals });
  } catch (error) {
    next(error);
  }
});

export default router;
