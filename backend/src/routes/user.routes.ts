import { Router, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest, isSuperAdmin } from '../middleware/auth.js';
import { resolveWalletInput } from '../services/ens.service.js';
import { canUserEditParty } from '../helpers/partyAccess.js';
import { getReimbursementRules } from '../lib/privateConfig.js';
import { resolvePartyReimbursementOptions } from '../lib/reimbursementOptions.js';
import { payoutRowSnapshotFromUser, NON_TERMINAL_PAYOUT_STATUSES } from '../services/payout-snapshot.js';

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

    // marinara-71630 P7b: surface the server-side super-admin determination so
    // the frontend can stop hardcoding the internal `hello@rarepizzas.com`
    // identity (HostPage/EventPage). Computed via the EXISTING `isSuperAdmin`
    // DB-backed rule (Admin table, role === 'super_admin') so it extends these
    // controls to ALL Admin-table super_admins, not just one email.
    const superAdmin = await isSuperAdmin(req.userEmail);

    res.json({ user: user ? { ...user, isSuperAdmin: superAdmin } : user });
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
      // marinara-71630 P7b: PaymentDetailsCard sends the party in scope so the
      // backend can hard-enforce party-scoped reimbursement-option gating on the
      // SAVE path (the GET endpoint only DECIDES which methods are allowed).
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

    // marinara-71630 P7b: hard-enforce party-scoped reimbursement-option gating
    // on the SAVE path. The GET endpoint only DECIDES which methods a host may
    // pick; a crafted request could otherwise persist a method this party isn't
    // allowed to use (e.g. mercury_card for a Mercury-blocked country). When the
    // request sets a non-null payout method AND names a partyId the caller can
    // edit, resolve that party's allowed options (via the SAME shared helper the
    // GET endpoint uses) and reject if the submitted method is absent or
    // disabled. FAIL OPEN if the config is unseeded (empty resolved set) so a
    // missing app_config row never blocks legitimate saves.
    if (
      preferredPayoutMethod !== undefined
      && preferredPayoutMethod !== null
      && partyId
      && typeof partyId === 'string'
    ) {
      const canEdit = await canUserEditParty(partyId, req.userId, req.userEmail);
      if (canEdit) {
        const party = await prisma.party.findUnique({
          where: { id: partyId },
          select: { country: true, eventTags: true },
        });
        if (party) {
          const rules = await getReimbursementRules();
          const options = resolvePartyReimbursementOptions(
            { country: party.country, eventTags: party.eventTags },
            rules
          );
          // Fail OPEN on an unseeded config: an empty resolved set means we have
          // no rules to enforce, so don't block the save.
          if (options.length > 0) {
            const opt = options.find(
              (o) => o.id === preferredPayoutMethod && o.kind === 'method'
            );
            if (!opt || !opt.enabled) {
              return res.status(400).json({
                error: {
                  message:
                    opt?.disabledReason ||
                    `The payout method "${preferredPayoutMethod}" is not available for this event.`,
                  code: 'PAYOUT_METHOD_NOT_ALLOWED',
                },
              });
            }
          }
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

    // ricotta-58512: when the host edits their payout prefs, mirror the UPDATED
    // profile onto their non-terminal rolling event payouts. The execute/send
    // path reads the payout ROW (no host fallback), so without this a host who
    // fixes their wallet AFTER the rolling row exists (incl. after an admin has
    // approved it) stays un-payable.
    // tortano-58516: re-stamp across ALL non-terminal statuses
    // (NON_TERMINAL_PAYOUT_STATUSES = pending/approved/queued), now INCLUDING
    // 'queued'. This matches the receipt-upload snapshot path in
    // payout.routes.ts (which already uses NON_TERMINAL_PAYOUT_STATUSES), so an
    // admin who marks a payout 'queued' before the host has finalized their
    // wallet/method no longer strands it un-payable when the host later fixes
    // their profile. Terminal rows (paid/completed/withdrawn/rejected/failed)
    // stay excluded because NON_TERMINAL_PAYOUT_STATUSES lists only the three
    // non-terminal statuses. The mercury_card guard avoids clobbering an
    // admin-issued Mercury card with the host's self-serve prefs.
    if (
      preferredPayoutMethod !== undefined
      || payoutWalletAddress !== undefined
      || payoutBankDetails !== undefined
    ) {
      try {
        const snap = payoutRowSnapshotFromUser(user);
        await prisma.payout.updateMany({
          where: {
            hostUserId: req.userId,
            purpose: 'event',
            status: { in: [...NON_TERMINAL_PAYOUT_STATUSES] },
            NOT: { payoutMethod: 'mercury_card' },
          },
          data: snap,
        });
      } catch (err) {
        // Non-fatal — the profile save itself succeeded; the row sync is a
        // best-effort convenience so a stale rolling row doesn't strand a host.
        console.warn('[user] failed to sync payout prefs onto rolling rows:', err);
      }
    }

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
