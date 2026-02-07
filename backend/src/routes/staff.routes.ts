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

// GET /api/parties/:partyId/staff - List all staff for a party (host only)
router.get('/:partyId/staff', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { status, role, limit = '50', offset = '0' } = req.query;

    // Verify ownership or super admin
    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Build query filters
    const where: any = { partyId };

    if (status && typeof status === 'string') {
      where.status = status;
    }

    if (role && typeof role === 'string') {
      where.role = role;
    }

    const staff = await prisma.staff.findMany({
      where,
      orderBy: [
        { status: 'asc' }, // Sort by status (invited first, then confirmed, etc.)
        { createdAt: 'desc' },
      ],
      take: Math.min(parseInt(limit as string, 10), 100),
      skip: parseInt(offset as string, 10),
    });

    const total = await prisma.staff.count({ where });

    res.json({
      staff,
      total,
      limit: parseInt(limit as string, 10),
      offset: parseInt(offset as string, 10),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/staff/stats - Get staff statistics (host only)
// NOTE: This route MUST be defined before /:partyId/staff/:staffId to avoid "stats" being matched as staffId
router.get('/:partyId/staff/stats', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;

    // Verify ownership or super admin
    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Get counts by status
    const totalStaff = await prisma.staff.count({ where: { partyId } });
    const invitedCount = await prisma.staff.count({ where: { partyId, status: 'invited' } });
    const confirmedCount = await prisma.staff.count({ where: { partyId, status: 'confirmed' } });
    const declinedCount = await prisma.staff.count({ where: { partyId, status: 'declined' } });
    const checkedInCount = await prisma.staff.count({ where: { partyId, status: 'checked_in' } });

    // Get unique roles
    const staffWithRoles = await prisma.staff.findMany({
      where: { partyId },
      select: { role: true },
    });
    const uniqueRoles = [...new Set(staffWithRoles.map(s => s.role))];

    res.json({
      totalStaff,
      byStatus: {
        invited: invitedCount,
        confirmed: confirmedCount,
        declined: declinedCount,
        checked_in: checkedInCount,
      },
      uniqueRoles,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:partyId/staff - Add a new staff member (host only)
router.post('/:partyId/staff', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId } = req.params;
    const { name, email, phone, role, status, notes } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Validate required fields
    if (!name || !role) {
      throw new AppError('Name and role are required', 400, 'VALIDATION_ERROR');
    }

    // Validate status if provided
    const validStatuses = ['invited', 'confirmed', 'declined', 'checked_in'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Check if party exists
    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const staff = await prisma.staff.create({
      data: {
        partyId,
        name: name.trim(),
        email: email?.trim().toLowerCase() || null,
        phone: phone?.trim() || null,
        role: role.trim(),
        status: status || 'invited',
        notes: notes?.trim() || null,
        confirmedAt: status === 'confirmed' ? new Date() : null,
        checkedInAt: status === 'checked_in' ? new Date() : null,
      },
    });

    res.status(201).json({ staff });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:partyId/staff/:staffId - Get single staff member (host only)
router.get('/:partyId/staff/:staffId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, staffId } = req.params;

    // Verify ownership or super admin
    const canAccess = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    const staff = await prisma.staff.findFirst({
      where: { id: staffId, partyId },
    });

    if (!staff) {
      throw new AppError('Staff member not found', 404, 'NOT_FOUND');
    }

    res.json({ staff });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:partyId/staff/:staffId - Update staff member (host only)
router.patch('/:partyId/staff/:staffId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, staffId } = req.params;
    const { name, email, phone, role, status, notes } = req.body;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if staff exists
    const existingStaff = await prisma.staff.findFirst({
      where: { id: staffId, partyId },
    });

    if (!existingStaff) {
      throw new AppError('Staff member not found', 404, 'NOT_FOUND');
    }

    // Validate status if provided
    const validStatuses = ['invited', 'confirmed', 'declined', 'checked_in'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(', ')}`, 400, 'VALIDATION_ERROR');
    }

    // Calculate timestamp updates based on status change
    let confirmedAt = existingStaff.confirmedAt;
    let checkedInAt = existingStaff.checkedInAt;

    if (status && status !== existingStaff.status) {
      if (status === 'confirmed' && !confirmedAt) {
        confirmedAt = new Date();
      } else if (status === 'checked_in' && !checkedInAt) {
        checkedInAt = new Date();
        // Also set confirmed if not already
        if (!confirmedAt) {
          confirmedAt = new Date();
        }
      }
    }

    const staff = await prisma.staff.update({
      where: { id: staffId },
      data: {
        ...(name !== undefined && { name: name.trim() }),
        ...(email !== undefined && { email: email?.trim().toLowerCase() || null }),
        ...(phone !== undefined && { phone: phone?.trim() || null }),
        ...(role !== undefined && { role: role.trim() }),
        ...(status !== undefined && { status }),
        ...(notes !== undefined && { notes: notes?.trim() || null }),
        confirmedAt,
        checkedInAt,
      },
    });

    res.json({ staff });
  } catch (error) {
    next(error);
  }
});

// DELETE /api/parties/:partyId/staff/:staffId - Remove staff member (host only)
router.delete('/:partyId/staff/:staffId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { partyId, staffId } = req.params;

    // Verify ownership or super admin
    const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
    if (!canEdit) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

    // Check if staff exists
    const staff = await prisma.staff.findFirst({
      where: { id: staffId, partyId },
    });

    if (!staff) {
      throw new AppError('Staff member not found', 404, 'NOT_FOUND');
    }

    await prisma.staff.delete({
      where: { id: staffId },
    });

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

export default router;
