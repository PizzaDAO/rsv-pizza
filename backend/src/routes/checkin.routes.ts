import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// Helper function to check if user can check in guests for a party (host or co-host)
async function canUserCheckIn(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can check in for any party
  if (await isSuperAdmin(userEmail)) {
    return true;
  }

  // Get party to check ownership and co-hosts
  const party = await prisma.party.findUnique({
    where: { id: partyId },
    select: {
      userId: true,
      coHosts: true,
    },
  });

  if (!party) return false;

  // Check if user is the owner
  if (party.userId === userId) return true;

  // Check if user is a co-host
  if (userEmail && party.coHosts && Array.isArray(party.coHosts)) {
    const normalizedEmail = userEmail.toLowerCase();
    const isCoHost = party.coHosts.some((host: any) =>
      host.email?.toLowerCase() === normalizedEmail
    );
    if (isCoHost) return true;
  }

  return false;
}

// POST /api/checkin/:inviteCode/:guestId - Check in a guest (requires auth, host/co-host only)
router.post('/:inviteCode/:guestId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, guestId } = req.params;

    // Find party by invite code or custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        userId: true,
        coHosts: true,
      },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          userId: true,
          coHosts: true,
        },
      });
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Verify user can check in guests for this party
    const canCheckIn = await canUserCheckIn(party.id, req.userId, req.userEmail);
    if (!canCheckIn) {
      throw new AppError('You are not authorized to check in guests for this event', 403, 'UNAUTHORIZED');
    }

    // Find the guest
    const guest = await prisma.guest.findFirst({
      where: {
        id: guestId,
        partyId: party.id,
      },
    });

    if (!guest) {
      throw new AppError('Guest not found', 404, 'GUEST_NOT_FOUND');
    }

    // Check if already checked in
    if (guest.checkedInAt) {
      return res.status(200).json({
        success: true,
        alreadyCheckedIn: true,
        guest: {
          id: guest.id,
          name: guest.name,
          email: guest.email,
          checkedInAt: guest.checkedInAt,
          checkedInBy: guest.checkedInBy,
        },
        message: `${guest.name} was already checked in`,
      });
    }

    // Check in the guest
    const updatedGuest = await prisma.guest.update({
      where: { id: guestId },
      data: {
        checkedInAt: new Date(),
        checkedInBy: req.userId,
      },
    });

    res.status(200).json({
      success: true,
      alreadyCheckedIn: false,
      guest: {
        id: updatedGuest.id,
        name: updatedGuest.name,
        email: updatedGuest.email,
        checkedInAt: updatedGuest.checkedInAt,
        checkedInBy: updatedGuest.checkedInBy,
      },
      message: `${updatedGuest.name} has been checked in!`,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/checkin/:inviteCode/:guestId - Get guest check-in status (requires auth, host/co-host only)
router.get('/:inviteCode/:guestId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, guestId } = req.params;

    // Find party by invite code or custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        userId: true,
        coHosts: true,
      },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          userId: true,
          coHosts: true,
        },
      });
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Verify user can check in guests for this party
    const canCheckIn = await canUserCheckIn(party.id, req.userId, req.userEmail);
    if (!canCheckIn) {
      throw new AppError('You are not authorized to view check-in status for this event', 403, 'UNAUTHORIZED');
    }

    // Find the guest
    const guest = await prisma.guest.findFirst({
      where: {
        id: guestId,
        partyId: party.id,
      },
      select: {
        id: true,
        name: true,
        email: true,
        checkedInAt: true,
        checkedInBy: true,
      },
    });

    if (!guest) {
      throw new AppError('Guest not found', 404, 'GUEST_NOT_FOUND');
    }

    res.json({
      guest,
      isCheckedIn: !!guest.checkedInAt,
    });
  } catch (error) {
    next(error);
  }
});

export default router;
