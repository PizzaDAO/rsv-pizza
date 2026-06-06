import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { resolveWalletInput } from '../services/ens.service.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { resolvePartyReimbursementOptions } from '../lib/reimbursementOptions.js';

const router = Router();

// All user routes require authentication
router.use(requireAuth);

// GET /api/user/me - Get current user
router.get('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        id: true,
        email: true,
        name: true,
        defaultAddress: true,
        createdAt: true,
        // arugula-38633 v3: payout prefs surfaced for the host-side
        // "Payment details" card in the Payments tab.
        preferredPayoutMethod: true,
        payoutWalletAddress: true,
        payoutBankDetails: true,
      },
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/user/me - Update user profile
router.patch('/me', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const {
      name,
      defaultAddress,
      // arugula-38633 v3 follow-up: persistent payout prefs editable from
      // PaymentDetailsCard on the Payments tab. All three are nullable.
      preferredPayoutMethod,
      payoutWalletAddress,
      payoutBankDetails,
      // marinara-71630 P7: the party this payout method is being configured for.
      // Optional — when present (PaymentDetailsCard always sends it) and a
      // payout method is being SET, the backend hard-enforces that the method is
      // actually allowed for that party (config-resolved options + the Mercury
      // sanctions gate, the SAME layering GET /reimbursement-options uses). This
      // closes the gap where a crafted request could persist a disallowed method
      // (e.g. mercury_card for a Mercury-blocked country). Legitimate saves from
      // the card pass unchanged — the picker only ever offers enabled methods.
      partyId,
    } = req.body;

    // Validate payoutMethod if provided (DB CHECK constraint mirrors this).
    if (
      preferredPayoutMethod !== undefined
      && preferredPayoutMethod !== null
      && !['mercury_card', 'wire', 'usdc_base'].includes(preferredPayoutMethod)
    ) {
      return res.status(400).json({
        error: { message: 'Invalid preferredPayoutMethod', code: 'VALIDATION_ERROR' },
      });
    }

    // marinara-71630 P7: hard-enforce the per-party reimbursement-option gating
    // on the SAVE path. The GET /reimbursement-options endpoint DECIDES which
    // methods a host may use, but until now nothing rejected a save of a
    // disallowed method. When a non-null method is being set AND a partyId is
    // supplied, resolve that party's allowed options and reject if the method is
    // absent from the list or present-but-disabled. We only gate when partyId is
    // provided (the legacy user-pref save without a party context is unchanged),
    // and only when the caller can edit that party (so this never leaks party
    // existence). On a config miss the resolver returns [] → we skip the gate
    // (fail-open) so an unseeded config never blocks legitimate saves; the
    // frontend already only offers enabled methods.
    if (
      preferredPayoutMethod !== undefined
      && preferredPayoutMethod !== null
      && partyId
    ) {
      const canEdit = await canUserEditParty(String(partyId), req.userId, req.userEmail);
      if (canEdit) {
        const party = await prisma.party.findUnique({
          where: { id: String(partyId) },
          select: { country: true, eventTags: true },
        });
        if (party) {
          const options = await resolvePartyReimbursementOptions({
            country: party.country,
            eventTags: party.eventTags,
          });
          // Only enforce when the config actually resolved options for this
          // party (non-empty). An empty list means unseeded config → fail-open.
          if (options.length > 0) {
            const opt = options.find(
              (o) => o.id === preferredPayoutMethod && o.kind === 'method',
            );
            if (!opt || !opt.enabled) {
              return res.status(400).json({
                error: {
                  message:
                    opt?.disabledReason ??
                    `The payout method "${preferredPayoutMethod}" isn't available for this event. Pick an allowed method.`,
                  code: 'PAYOUT_METHOD_NOT_ALLOWED',
                },
              });
            }
          }
        }
      }
    }

    // taleggio-30219: resolve ENS → 0x before storing the user-default
    // payout wallet. Either a 0x address or an ENS-shaped name is accepted;
    // resolution failures bubble out as 400 INVALID_WALLET_ADDRESS.
    let resolvedWallet: string | null | undefined;
    if (payoutWalletAddress !== undefined) {
      if (!payoutWalletAddress) {
        resolvedWallet = null;
      } else {
        try {
          resolvedWallet = await resolveWalletInput(String(payoutWalletAddress));
        } catch (err: any) {
          return res.status(400).json({
            error: {
              message: err?.message || 'Could not resolve wallet address',
              code: 'INVALID_WALLET_ADDRESS',
            },
          });
        }
      }
    }

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(name !== undefined && { name }),
        ...(defaultAddress !== undefined && { defaultAddress }),
        ...(preferredPayoutMethod !== undefined && {
          preferredPayoutMethod: preferredPayoutMethod || null,
        }),
        ...(payoutWalletAddress !== undefined && {
          payoutWalletAddress: resolvedWallet ?? null,
        }),
        ...(payoutBankDetails !== undefined && {
          payoutBankDetails: payoutBankDetails ?? null,
        }),
      },
      select: {
        id: true,
        email: true,
        name: true,
        defaultAddress: true,
        preferredPayoutMethod: true,
        payoutWalletAddress: true,
        payoutBankDetails: true,
      },
    });

    res.json({ user });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/preferences - Get pizza preferences
router.get('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: {
        defaultDietaryRestrictions: true,
        defaultLikedToppings: true,
        defaultDislikedToppings: true,
      },
    });

    res.json({ preferences: user });
  } catch (error) {
    next(error);
  }
});

// PATCH /api/user/preferences - Update pizza preferences
router.patch('/preferences', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const { dietaryRestrictions, likedToppings, dislikedToppings } = req.body;

    const user = await prisma.user.update({
      where: { id: req.userId },
      data: {
        ...(dietaryRestrictions !== undefined && { defaultDietaryRestrictions: dietaryRestrictions }),
        ...(likedToppings !== undefined && { defaultLikedToppings: likedToppings }),
        ...(dislikedToppings !== undefined && { defaultDislikedToppings: dislikedToppings }),
      },
      select: {
        defaultDietaryRestrictions: true,
        defaultLikedToppings: true,
        defaultDislikedToppings: true,
      },
    });

    res.json({ preferences: user });
  } catch (error) {
    next(error);
  }
});

// GET /api/user/sponsorships - Get sponsorships where user email matches sponsor contactEmail
router.get('/sponsorships', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.userId },
      select: { email: true },
    });

    if (!user?.email) {
      return res.json([]);
    }

    const sponsors = await prisma.sponsor.findMany({
      where: {
        contactEmail: {
          equals: user.email,
          mode: 'insensitive',
        },
        intakeSubmittedAt: {
          not: null,
        },
      },
      include: {
        party: {
          select: {
            id: true,
            name: true,
            customUrl: true,
            date: true,
            eventImageUrl: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    const result = sponsors.map((s) => ({
      id: s.id,
      brandName: s.name,
      brandLogo: s.logoUrl,
      brandDescription: s.brandDescription,
      brandInstagram: s.brandInstagram,
      sponsorshipType: s.sponsorshipType,
      amount: s.amount ? Number(s.amount) : null,
      status: s.status,
      intakeSubmittedAt: s.intakeSubmittedAt,
      party: {
        id: s.party.id,
        name: s.party.name,
        customUrl: s.party.customUrl,
        date: s.party.date,
        eventImageUrl: s.party.eventImageUrl,
      },
    }));

    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
