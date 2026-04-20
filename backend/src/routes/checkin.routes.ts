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

// Haversine distance in meters between two lat/lng pairs
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const GEO_CHECKIN_THRESHOLD_METERS = 500;

// POST /api/checkin/:inviteCode/self - Self-check-in via geolocation (requires auth, guest only)
router.post('/:inviteCode/self', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { inviteCode } = req.params;
    const { latitude, longitude, accuracy } = req.body;

    if (latitude == null || longitude == null) {
      throw new AppError('Latitude and longitude are required', 400, 'VALIDATION_ERROR');
    }

    // Find party by invite code or custom URL
    let party = await prisma.party.findUnique({
      where: { inviteCode },
      select: {
        id: true,
        name: true,
        latitude: true,
        longitude: true,
      },
    });

    if (!party) {
      party = await prisma.party.findUnique({
        where: { customUrl: inviteCode },
        select: {
          id: true,
          name: true,
          latitude: true,
          longitude: true,
        },
      });
    }

    if (!party) {
      throw new AppError('Party not found', 404, 'PARTY_NOT_FOUND');
    }

    if (party.latitude == null || party.longitude == null) {
      throw new AppError('This event does not have a venue location set', 400, 'NO_VENUE_LOCATION');
    }

    // Find guest by authenticated user's email
    const guest = await prisma.guest.findFirst({
      where: {
        partyId: party.id,
        email: req.userEmail?.toLowerCase(),
      },
    });

    if (!guest) {
      throw new AppError('You are not an RSVP\'d guest for this event', 404, 'GUEST_NOT_FOUND');
    }

    // Check if already checked in
    if (guest.checkedInAt) {
      return res.status(200).json({
        success: true,
        alreadyCheckedIn: true,
        checkedInAt: guest.checkedInAt,
        message: 'You are already checked in!',
      });
    }

    // Calculate distance
    const distance = haversineDistance(
      latitude, longitude,
      party.latitude, party.longitude
    );

    if (distance > GEO_CHECKIN_THRESHOLD_METERS) {
      const distanceDisplay = distance >= 1000
        ? `${(distance / 1000).toFixed(1)}km`
        : `${Math.round(distance)}m`;

      return res.status(400).json({
        success: false,
        alreadyCheckedIn: false,
        distance: Math.round(distance),
        threshold: GEO_CHECKIN_THRESHOLD_METERS,
        message: `You're ~${distanceDisplay} away. You need to be within ${GEO_CHECKIN_THRESHOLD_METERS}m of the venue to check in.`,
      });
    }

    // Check in the guest (self-check-in: checkedInBy = guest's own ID)
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
      checkedInAt: updatedGuest.checkedInAt,
      distance: Math.round(distance),
      threshold: GEO_CHECKIN_THRESHOLD_METERS,
      message: 'You\'re checked in!',
    });
  } catch (error) {
    next(error);
  }
});

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
