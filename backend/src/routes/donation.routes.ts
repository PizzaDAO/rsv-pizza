import { Router, Response, NextFunction, Request } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { retrievePaymentIntent, chargeIdOf } from '../lib/stripeVerify.js';
import { withDonationLock } from '../lib/donationLock.js';

const router = Router();

// Format a donor's name for public display: first name + last-initial.
// e.g. "Jane Doe" -> "Jane D.", "Cher" -> "Cher", anonymous -> "Anon".
// NEVER expose the raw donorName/full surname to the client.
function formatDonorDisplayName(donorName: string | null | undefined, isAnonymous: boolean): string {
  if (isAnonymous) return 'Anon';
  const n = (donorName || '').trim();
  if (!n) return 'Supporter';
  const parts = n.split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

// Helper function to check if user can access party donations
async function canUserAccessDonations(partyId: string, userId?: string, userEmail?: string): Promise<boolean> {
  // Super admin can access any party
  if (await isSuperAdmin(userEmail)) {
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
        donationRecipientUrl: true,
        donationEthAddress: true,
        suggestedAmounts: true,
        donationAmountsPublic: true,
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

    // Get successful donations.
    // NOTE: donorEmail is selected for server-side avatar lookup ONLY —
    // it must NEVER be returned to the client.
    const donations = await prisma.donation.findMany({
      where: {
        partyId: id,
        status: 'succeeded',
      },
      select: {
        amount: true,
        donorName: true,
        donorEmail: true,
        isAnonymous: true,
        message: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const totalAmount = donations.reduce((sum, d) => sum + Number(d.amount), 0);
    const donorCount = donations.length;
    const amountsPublic = party.donationAmountsPublic;

    // Return public donor list (respecting anonymity).
    // Left exactly as-is so the DonationStep modal is unaffected.
    const recentDonors = donations.slice(0, 10).map(d => ({
      name: d.isAnonymous ? 'Anonymous' : d.donorName,
      message: d.message,
      createdAt: d.createdAt,
    }));

    // All donors by amount DESC, for the public "Supporters" row + modal.
    // Capped at 250 defensively.
    const sortedDonations = [...donations]
      .sort((a, b) => Number(b.amount) - Number(a.amount))
      .slice(0, 250);

    // Best-effort avatar lookup: match non-anonymous donor emails to
    // registered users' profile pictures (case-insensitive). Most donors
    // won't have an account; that's expected.
    const lookupEmails = Array.from(
      new Set(
        sortedDonations
          .filter(d => !d.isAnonymous && d.donorEmail)
          .map(d => (d.donorEmail as string).toLowerCase())
      )
    );
    const avatarMap = new Map<string, string>();
    if (lookupEmails.length > 0) {
      const users = await prisma.user.findMany({
        where: { email: { in: lookupEmails } },
        select: { email: true, profilePictureUrl: true },
      });
      for (const u of users) {
        if (u.email && u.profilePictureUrl) {
          avatarMap.set(u.email.toLowerCase(), u.profilePictureUrl);
        }
      }
    }

    // Public donor list. Only the formatted displayName is exposed —
    // never the raw donorName, full surname, or donorEmail.
    const donors = sortedDonations.map(d => ({
      displayName: formatDonorDisplayName(d.donorName, d.isAnonymous),
      amount: amountsPublic ? Number(d.amount) : null,
      message: d.message,
      avatarUrl: d.isAnonymous
        ? null
        : (avatarMap.get((d.donorEmail ?? '').toLowerCase()) ?? null),
    }));

    res.json({
      enabled: true,
      totalAmount,
      donorCount,
      goal: party.donationGoal ? Number(party.donationGoal) : null,
      message: party.donationMessage,
      recipient: party.donationRecipient,
      recipientUrl: party.donationRecipientUrl,
      suggestedAmounts: party.suggestedAmounts,
      donationEthAddress: party.donationEthAddress,
      amountsPublic,
      recentDonors,
      donors,
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
      // Crypto donation fields
      paymentMethod = 'stripe',
      chainId,
      tokenSymbol,
      tokenAddress,
      txHash,
      walletAddress,
    } = req.body;

    // Validate party exists and has donations enabled
    const party = await prisma.party.findUnique({
      where: { id },
      select: { id: true, donationEnabled: true, cancelledAt: true },
    });

    if (!party) {
      throw new AppError('Party not found', 404, 'NOT_FOUND');
    }

    // porchetta-81402: block donations on cancelled events. Stripe payment
    // intents that are already in flight (created before cancel) may still
    // charge — the donation row stays in status=pending until the webhook
    // resolves them, which is acceptable since the donation itself is real
    // money the host received. The check here only blocks NEW intents.
    if (party.cancelledAt) {
      throw new AppError('This event has been cancelled', 410, 'EVENT_CANCELLED');
    }

    if (!party.donationEnabled) {
      throw new AppError('Donations are not enabled for this event', 400, 'DONATIONS_DISABLED');
    }

    if (!amount || amount <= 0) {
      throw new AppError('Invalid donation amount', 400, 'VALIDATION_ERROR');
    }

    // Only link a guest that actually belongs to this party (the host list exposes guest name/email).
    let safeGuestId: string | null = null;
    if (guestId) {
      const guest = await prisma.guest.findFirst({
        where: { id: String(guestId), partyId: id },
        select: { id: true },
      });
      // A guest from another party is silently dropped (the donation itself is still valid).
      safeGuestId = guest ? guest.id : null;
    }

    // Card donations: status is decided by Stripe, never by the client. Verify the PaymentIntent
    // server-side (succeeded + same amount/currency + created for this party's donation).
    let status: 'pending' | 'succeeded' = 'pending';
    let verifiedChargeId: string | null = null;
    if (paymentIntentId && (paymentMethod || 'stripe') === 'stripe') {
      const got = await retrievePaymentIntent(String(paymentIntentId));
      const pi = got.ok ? got.pi : null;
      if (
        pi &&
        pi.status === 'succeeded' &&
        pi.metadata?.type === 'donation' &&
        pi.metadata?.partyId === id &&
        pi.amount === Math.round(Number(amount) * 100) &&
        (pi.currency || '').toLowerCase() === String(currency || 'usd').toLowerCase()
      ) {
        status = 'succeeded';
        verifiedChargeId = chargeIdOf(pi);
      }
    }

    const createData = {
      amount,
      currency,
      status, // pending unless Stripe confirmed the payment server-side above
      paymentIntentId,
      chargeId: verifiedChargeId ?? (status === 'succeeded' ? null : chargeId),
      donorName: donorName || null,
      donorEmail: donorEmail || null,
      isAnonymous,
      message: message || null,
      partyId: id,
      guestId: safeGuestId,
      // Crypto donation fields
      paymentMethod: paymentMethod || 'stripe',
      chainId: chainId ? Number(chainId) : null,
      tokenSymbol: tokenSymbol || null,
      tokenAddress: tokenAddress || null,
      txHash: txHash || null,
      walletAddress: walletAddress || null,
    };

    // Idempotent: the Stripe webhook may already have created the row for this intent. The
    // find-then-create runs under a per-intent transaction lock so the two cannot both insert.
    if (paymentIntentId) {
      const outcome = await withDonationLock(String(paymentIntentId), async (tx) => {
        const existing = await tx.donation.findFirst({ where: { paymentIntentId: String(paymentIntentId) } });
        if (existing) {
          if (existing.partyId !== id) {
            throw new AppError('Payment already recorded', 409, 'CONFLICT');
          }
          const updated = await tx.donation.update({
            where: { id: existing.id },
            data: {
              donorName: donorName || existing.donorName,
              donorEmail: donorEmail || existing.donorEmail,
              isAnonymous,
              message: message || existing.message,
              guestId: safeGuestId ?? existing.guestId,
              ...(status === 'succeeded' && existing.status === 'pending' && { status }),
            },
          });
          return { donation: updated, created: false };
        }
        return { donation: await tx.donation.create({ data: createData }), created: true };
      });
      return res.status(outcome.created ? 201 : 200).json({ donation: outcome.donation });
    }

    const donation = await prisma.donation.create({ data: createData });

    res.status(201).json({ donation });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/parties/:id/donations/:donationId - Update donation status (host only)
router.patch('/:id/donations/:donationId', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { id, donationId } = req.params;
    const { status, chargeId } = req.body;

    // Verify ownership or super admin
    const canAccess = await canUserAccessDonations(id, req.userId, req.userEmail);
    if (!canAccess) {
      throw new AppError('Unauthorized', 403, 'UNAUTHORIZED');
    }

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
