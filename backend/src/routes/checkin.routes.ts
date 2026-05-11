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

// Helper: find party by inviteCode or customUrl
async function findPartyByCode(inviteCode: string) {
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

  // Alias fallback: silently resolve old slugs
  if (!party) {
    const alias = await prisma.slugAlias.findUnique({
      where: { oldSlug: inviteCode },
      select: { partyId: true },
    });
    if (alias) {
      party = await prisma.party.findUnique({
        where: { id: alias.partyId },
        select: {
          id: true,
          name: true,
          userId: true,
          coHosts: true,
        },
      });
    }
  }

  return party;
}

// POST /api/checkin/:inviteCode/self-host — Host/co-host self-check-in (bootstrap)
router.post('/:inviteCode/self-host', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Verify user is host or co-host
    const canCheck = await canUserCheckIn(party.id, req.userId, req.userEmail);
    if (!canCheck) {
      throw new AppError('Only hosts and co-hosts can self-check in', 403, 'UNAUTHORIZED');
    }

    // Find existing guest record for this user
    let guest = await prisma.guest.findFirst({
      where: {
        partyId: party.id,
        email: req.userEmail?.toLowerCase(),
      },
    });

    // If host hasn't RSVPd, auto-create a guest record
    if (!guest) {
      guest = await prisma.guest.create({
        data: {
          name: req.userEmail?.split('@')[0] || 'Host',
          email: req.userEmail?.toLowerCase() || null,
          partyId: party.id,
          status: 'CONFIRMED',
          submittedVia: 'host-checkin',
        },
      });
    }

    // Already checked in
    if (guest.checkedInAt) {
      return res.status(200).json({
        success: true,
        alreadyCheckedIn: true,
        guest: {
          id: guest.id,
          name: guest.name,
          checkedInAt: guest.checkedInAt,
        },
        message: `${guest.name} is already checked in`,
      });
    }

    // Check in the host
    const updatedGuest = await prisma.guest.update({
      where: { id: guest.id },
      data: {
        checkedInAt: new Date(),
        checkedInBy: guest.id, // self-vouch
      },
    });

    res.status(200).json({
      success: true,
      guest: {
        id: updatedGuest.id,
        name: updatedGuest.name,
        checkedInAt: updatedGuest.checkedInAt,
      },
      message: `${updatedGuest.name} has checked in!`,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/checkin/:inviteCode/vouch — Vouch for another guest (peer attestation)
router.post('/:inviteCode/vouch', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { targetGuestId } = req.body;

    if (!targetGuestId) {
      throw new AppError('targetGuestId is required', 400, 'VALIDATION_ERROR');
    }

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Find the voucher's guest record (caller)
    const voucher = await prisma.guest.findFirst({
      where: {
        partyId: party.id,
        email: req.userEmail?.toLowerCase(),
      },
    });

    if (!voucher) {
      throw new AppError('You must be an RSVPd guest to vouch for others', 403, 'NOT_A_GUEST');
    }

    // Prevent self-vouch
    if (voucher.id === targetGuestId) {
      throw new AppError("You can't check yourself in!", 400, 'SELF_VOUCH');
    }

    // Voucher must be checked in
    if (!voucher.checkedInAt) {
      throw new AppError('You must be checked in to vouch for others', 403, 'NOT_CHECKED_IN');
    }

    // Find the target guest
    const targetGuest = await prisma.guest.findFirst({
      where: {
        id: targetGuestId,
        partyId: party.id,
      },
    });

    if (!targetGuest) {
      throw new AppError('Guest not found or belongs to a different event', 404, 'GUEST_NOT_FOUND');
    }

    // Already checked in
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
      where: { id: targetGuestId },
      data: {
        checkedInAt: new Date(),
        checkedInBy: voucher.id, // voucher's guest ID
      },
    });

    res.status(200).json({
      success: true,
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

// GET /api/checkin/:inviteCode/:guestId — Get guest check-in status (requires auth, host/co-host only)
router.get('/:inviteCode/:guestId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, guestId } = req.params;

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    // Allow: hosts/co-hosts, the target guest themselves, or any checked-in guest
    const isHostOrCohost = await canUserCheckIn(party.id, req.userId, req.userEmail);

    let isTargetGuest = false;
    let isCheckedInGuest = false;

    if (!isHostOrCohost) {
      // Check if caller is the target guest
      const callerGuest = await prisma.guest.findFirst({
        where: {
          partyId: party.id,
          email: req.userEmail?.toLowerCase(),
        },
        select: { id: true, checkedInAt: true },
      });

      if (callerGuest) {
        if (callerGuest.id === guestId) {
          isTargetGuest = true;
        } else if (callerGuest.checkedInAt) {
          isCheckedInGuest = true;
        }
      }

      if (!isTargetGuest && !isCheckedInGuest) {
        throw new AppError('You are not authorized to view check-in status for this event', 403, 'UNAUTHORIZED');
      }
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
      callerIsTarget: isTargetGuest,
      callerIsHost: isHostOrCohost,
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/checkin/:inviteCode/:guestId/discount — Get discount claim status (no auth required)
router.get('/:inviteCode/:guestId/discount', async (req, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, guestId } = req.params;

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
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
        checkedInAt: true,
        discountClaimedAt: true,
        party: {
          select: {
            date: true,
            duration: true,
          },
        },
      },
    });

    if (!guest) {
      throw new AppError('Guest not found', 404, 'GUEST_NOT_FOUND');
    }

    // Compute hasEnded
    let hasEnded = false;
    if (guest.party.date) {
      const eventEnd = new Date(guest.party.date.getTime() + (guest.party.duration || 0) * 60 * 60 * 1000);
      hasEnded = new Date() > eventEnd;
    }

    res.json({
      guestName: guest.name,
      isCheckedIn: !!guest.checkedInAt,
      hasEnded,
      discountClaimedAt: guest.discountClaimedAt,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/checkin/:inviteCode/:guestId/discount — Claim post-event discount (no auth required)
router.post('/:inviteCode/:guestId/discount', async (req, res: Response, next: NextFunction) => {
  try {
    const { inviteCode, guestId } = req.params;

    const party = await findPartyByCode(inviteCode);
    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
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
        checkedInAt: true,
        discountClaimedAt: true,
        party: {
          select: {
            date: true,
            duration: true,
          },
        },
      },
    });

    if (!guest) {
      throw new AppError('Guest not found', 404, 'GUEST_NOT_FOUND');
    }

    // Validate: guest must be checked in
    if (!guest.checkedInAt) {
      return res.status(403).json({ error: 'Must be checked in to claim discount' });
    }

    // Compute hasEnded
    let hasEnded = false;
    if (guest.party.date) {
      const eventEnd = new Date(guest.party.date.getTime() + (guest.party.duration || 0) * 60 * 60 * 1000);
      hasEnded = new Date() > eventEnd;
    }

    // Validate: event must have ended
    if (!hasEnded) {
      return res.status(400).json({ error: 'Event has not ended yet' });
    }

    // If already claimed, return existing timestamp
    if (guest.discountClaimedAt) {
      return res.json({ success: true, alreadyClaimed: true, claimedAt: guest.discountClaimedAt });
    }

    // Claim the discount
    const updated = await prisma.guest.update({
      where: { id: guestId },
      data: { discountClaimedAt: new Date() },
    });

    res.json({ success: true, alreadyClaimed: false, claimedAt: updated.discountClaimedAt });
  } catch (error) {
    next(error);
  }
});

export default router;
