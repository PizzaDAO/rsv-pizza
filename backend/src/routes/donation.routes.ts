import { Router, Response, NextFunction, Request } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';

const router = Router();

// Helper function to check if user can access party donations
async function canUserAccessDonations(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can access any party
  if (isSuperAdmin(userEmail)) {
    return true;
  }

  // Otherwise, must be the party owner
  const party = await prisma.party.findFirst({
    where: { id: partyId, userId },
  });

  return !!party;
}

// GET /api/parties/:id/donations - Host: get donation list
router.get('/:id/donations', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Verify ownership or super admin
    const canAccess = await canUserAccessDonations(id, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    const donations = await prisma.donation.findMany({
      where: { partyId: id },
      orderBy: { createdAt: 'desc' },
      include: {
        guest: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    // Calculate totals
    const successfulDonations = donations.filter(d => d.status === 'succeeded');
    const totalAmount = successfulDonations.reduce((sum, d) => sum + Number(d.amount), 0);
    const totalCount = successfulDonations.length;

    res.json({
      donations,
      summary: {
        totalAmount,
        totalCount,
        currency: 'usd',
      },
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/parties/:id/donations/public - Public stats (total, goal progress)
router.get('/:id/donations/public', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;

    // Check if party exists and has donations enabled
    const party = await prisma.party.findUnique({
      where: { id },
      select: {
        id: true,
        donationEnabled: true,
        donationGoal: true,
        donationMessage: true,
        donationRecipient: true,
        suggestedAmounts: true,
      },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!party.donationEnabled) {
      res.json({
        enabled: false,
      });
      return;
    }

    // Get successful donations
    const donations = await prisma.donation.findMany({
      where: {
        partyId: id,
        status: 'succeeded',
      },
      select: {
        amount: true,
        donorName: true,
        isAnonymous: true,
        message: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalAmount = donations.reduce((sum, d) => sum + Number(d.amount), 0);
    const donorCount = donations.length;

    // Return public donor list (respecting anonymity)
    const recentDonors = donations.slice(0, 10).map(d => ({
      name: d.isAnonymous ? 'Anonymous' : d.donorName,
      message: d.message,
      createdAt: d.createdAt,
    }));

    res.json({
      enabled: true,
      totalAmount,
      donorCount,
      goal: party.donationGoal ? Number(party.donationGoal) : null,
      message: party.donationMessage,
      recipient: party.donationRecipient,
      suggestedAmounts: party.suggestedAmounts,
      recentDonors,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/parties/:id/donations - Create a donation
router.post('/:id/donations', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id } = req.params;
    const {
      amount,
      currency = 'usd',
      paymentIntentId,
      chargeId,
      donorName,
      donorEmail,
      isAnonymous = false,
      message,
      guestId,
    } = req.body;

    // Validate party exists and has donations enabled
    const party = await prisma.party.findUnique({
      where: { id },
      select: { id: true, donationEnabled: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    if (!party.donationEnabled) {
      throw new AppError('Donations are not enabled for this event', 400, 'DONATIONS_DISABLED');
    }

    if (!amount || amount <= 0) {
      throw new AppError('Invalid donation amount', 400, 'VALIDATION_ERROR');
    }

    // Create the donation record
    const donation = await prisma.donation.create({
      data: {
        amount,
        currency,
        status: paymentIntentId ? 'succeeded' : 'pending',
        paymentIntentId,
        chargeId,
        donorName: donorName || null,
        donorEmail: donorEmail || null,
        isAnonymous,
        message: message || null,
        partyId: id,
        guestId: guestId || null,
      },
    });

    res.status(201).json({ donation });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:id/donations/:donationId - Update donation status (e.g., after webhook)
router.patch('/:id/donations/:donationId', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { id, donationId } = req.params;
    const { status, chargeId } = req.body;

    // Validate donation exists and belongs to party
    const existingDonation = await prisma.donation.findFirst({
      where: { id: donationId, partyId: id },
    });

    if (!existingDonation) {
      throw new AppError('Donation not found', 404, 'NOT_FOUND');
    }

    const validStatuses = ['pending', 'succeeded', 'failed', 'refunded'];
    if (status && !validStatuses.includes(status)) {
      throw new AppError('Invalid status', 400, 'VALIDATION_ERROR');
    }

    const donation = await prisma.donation.update({
      where: { id: donationId },
      data: {
        ...(status && { status }),
        ...(chargeId && { chargeId }),
      },
    });

    res.json({ donation });
  } catch (error) {
    next(error);
  }
});

export default router;
