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

// Helper to find party by inviteCode or customUrl
async function findPartyByCode(inviteCode: string, select: Record<string, any>) {
  let party = await prisma.party.findUnique({
    where: { inviteCode },
    select,
  });

  if (!party) {
    party = await prisma.party.findUnique({
      where: { customUrl: inviteCode },
      select,
    });
  }

  return party;
}

// POST /api/checkin/:inviteCode/self-host - Host/co-host self-check-in (no vouch needed)
router.post('/:inviteCode/self-host', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;

    const party = await findPartyByCode(inviteCode, {
      id: true,
      name: true,
      userId: true,
      coHosts: true,
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Verify user is host or co-host
    const canCheckIn = await canUserCheckIn(party.id, req.userId, req.userEmail);
    if (!canCheckIn) {
      throw new AppError('Only hosts and co-hosts can self-check in', 403, 'UNAUTHORIZED');
    }

    // Find existing guest record for this host
    let guest = await prisma.guest.findFirst({
      where: {
        partyId: party.id,
        email: req.userEmail?.toLowerCase(),
      },
    });

    // If host hasn't RSVPd, auto-create guest record
    if (!guest) {
      guest = await prisma.guest.create({
        data: {
          name: req.userEmail?.split('@')[0] || 'Host',
          email: req.userEmail?.toLowerCase() || null,
          partyId: party.id,
          status: 'CONFIRMED',
          submittedVia: 'host-checkin',
          roles: [],
          dietaryRestrictions: [],
          likedToppings: [],
          dislikedToppings: [],
          likedBeverages: [],
          dislikedBeverages: [],
          pizzeriaRankings: [],
          suggestedPizzerias: [],
        },
      });
    }

    // Check if already checked in
    if (guest.checkedInAt) {
      return res.status(200).json({
        success: true,
        alreadyCheckedIn: true,
        guest: {
          id: guest.id,
          name: guest.name,
          checkedInAt: guest.checkedInAt,
        },
        message: 'You are already checked in!',
      });
    }

    // Check in (self-vouch for hosts)
    const updatedGuest = await prisma.guest.update({
      where: { id: guest.id },
      data: {
        checkedInAt: new Date(),
        checkedInBy: guest.id,
      },
    });

    res.status(200).json({
      success: true,
      alreadyCheckedIn: false,
      guest: {
        id: updatedGuest.id,
        name: updatedGuest.name,
        checkedInAt: updatedGuest.checkedInAt,
      },
      message: "You're checked in!",
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/checkin/:inviteCode/vouch - Vouch for another guest (peer attestation)
router.post('/:inviteCode/vouch', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { targetGuestId } = req.body;

    if (!targetGuestId) {
      throw new AppError('targetGuestId is required', 400, 'VALIDATION_ERROR');
    }

    const party = await findPartyByCode(inviteCode, {
      id: true,
      name: true,
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Find the voucher (caller) - they must be checked in
    const voucher = await prisma.guest.findFirst({
      where: {
        partyId: party.id,
        email: req.userEmail?.toLowerCase(),
      },
    });

    if (!voucher) {
      throw new AppError('You are not a guest at this event', 404, 'GUEST_NOT_FOUND');
    }

    if (!voucher.checkedInAt) {
      throw new AppError('You must be checked in to vouch for others', 403, 'NOT_CHECKED_IN');
    }

    // Find the target guest - must belong to same party
    const targetGuest = await prisma.guest.findFirst({
      where: {
        id: targetGuestId,
        partyId: party.id,
      },
    });

    if (!targetGuest) {
      throw new AppError('Guest not found at this event', 404, 'GUEST_NOT_FOUND');
    }

    // Check if already checked in
    if (targetGuest.checkedInAt) {
      return res.status(200).json({
        success: true,
        alreadyCheckedIn: true,
        guest: {
          id: targetGuest.id,
          name: targetGuest.name,
          checkedInAt: targetGuest.checkedInAt,
        },
        message: `${targetGuest.name} is already checked in`,
      });
    }

    // Vouch: check in the target guest
    const updatedGuest = await prisma.guest.update({
      where: { id: targetGuest.id },
      data: {
        checkedInAt: new Date(),
        checkedInBy: voucher.id,
      },
    });

    res.status(200).json({
      success: true,
      alreadyCheckedIn: false,
      guest: {
        id: updatedGuest.id,
        name: updatedGuest.name,
        checkedInAt: updatedGuest.checkedInAt,
      },
      message: `${updatedGuest.name} has been checked in!`,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/checkin/:inviteCode/:guestId - Check in a guest (requires auth, host/co-host only)
router.post('/:inviteCode/:guestId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, guestId } = req.params;

    const party = await findPartyByCode(inviteCode, {
      id: true,
      name: true,
      userId: true,
      coHosts: true,
    });

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

    const party = await findPartyByCode(inviteCode, {
      id: true,
      name: true,
      userId: true,
      coHosts: true,
    });

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
