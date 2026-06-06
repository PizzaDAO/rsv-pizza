import { Router, Response, NextFunction } from 'express';
import {
  requireAuth,
  AuthRequest,
  isPaymentAdmin,
  isUnderboss,
} from '../middleware/auth.js';
import {
  requireUnderbossAuth,
  UnderbossAuthRequest,
} from '../middleware/underbossAuth.js';
import { AppError } from '../middleware/error.js';
import {
  getCityTiers,
  getSponsorshipPricing,
  getReimbursementTiers,
  getReimbursementCapBands,
  getPayoutCaps,
  getSocialPostConfig,
} from '../lib/privateConfig.js';

/**
 * marinara-71630 P5 — read-only private-config endpoint for the admin/underboss
 * UI.
 *
 * Surfaces the city-tier lists, sponsorship pricing tiers, and GPP27
 * reimbursement rates/ceiling/formula that now live in `app_config` (moved out
 * of committed source). The frontend (migrated by a later agent) consumes this
 * instead of its hardcoded copies.
 *
 * These values feed underboss/admin tooling (budget suggestions, sponsorship
 * pricing), so the endpoint is gated with the SAME middleware the /underboss
 * routes use: `requireAuth` + `requireUnderbossAuth` (admin, graphics-admin, or
 * any in-scope underboss). The accessors always return safe fallbacks, so this
 * never 500s on unseeded config.
 */

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/config/pricing — city tiers + sponsorship pricing + GPP27
// reimbursement config + reimbursement-cap bands. Admin/underboss-gated
// (drives admin UI).
// ---------------------------------------------------------------------------
router.get(
  '/pricing',
  requireAuth,
  requireUnderbossAuth,
  async (_req: UnderbossAuthRequest, res: Response, next: NextFunction) => {
    try {
      const [cityTiers, sponsorshipPricing, reimbursement, reimbursementCapBands] =
        await Promise.all([
          getCityTiers(),
          getSponsorshipPricing(),
          getReimbursementTiers(),
          getReimbursementCapBands(),
        ]);

      res.json({
        cityTiers,
        sponsorshipPricing,
        reimbursement: {
          perHeadRates: reimbursement.perHeadRates,
          ceilingUsd: reimbursement.ceilingUsd,
          attendanceRsvpCoefficient: reimbursement.attendanceRsvpCoefficient,
        },
        reimbursementCapBands: {
          bands: reimbursementCapBands.bands,
          roundingIncrementUsd: reimbursementCapBands.roundingIncrementUsd,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/config/payout-caps — per-submission / per-address payout caps for
// the payments-admin modals (marinara-71630 P6).
//
// The 3 payments-admin modals (PayoutReviewModal, ExternalPaymentModal,
// CreatePrepaymentModal) used to bake the per-submission cap ($675) into the
// frontend bundle for a UX-only warning + a client-side clamp. The real number
// now lives in `app_config` (key `private.payout_caps`, already seeded) and is
// served here so it stays out of the open-source frontend.
//
// Auth: these modals are rendered on /payments by a BROADER set of roles than
// /pricing's underboss gate — admin / super_admin / payment_admin (via
// `requireAnyAdminOrPaymentAdmin` on the admin-payout routes), OR a regional
// underboss on a regional portal. A `payment_admin` would NOT pass
// `requireUnderbossAuth`, so this endpoint can't reuse the /pricing gate.
// Instead it admits anyone who is a payments-admin OR an active underboss —
// exactly the viewer set that opens these modals. The cap is UX-only (the
// backend remains the enforcement authority), so this is low-stakes.
// ---------------------------------------------------------------------------
async function requirePaymentsAdminOrUnderboss(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
) {
  try {
    const email = req.userEmail;
    if ((await isPaymentAdmin(email)) || (await isUnderboss(email))) {
      next();
      return;
    }
    throw new AppError('Payments admin or underboss access required', 403, 'FORBIDDEN');
  } catch (err) {
    next(err);
  }
}

router.get(
  '/payout-caps',
  requireAuth,
  requirePaymentsAdminOrUnderboss,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const caps = await getPayoutCaps();
      // Only the two caps the frontend modals actually use for UX. The rest of
      // PayoutCaps (per-tx, daily, w9 threshold, hard ceiling) stay backend-only.
      res.json({
        payoutCaps: {
          perSubmissionMaxUsd: caps.perSubmissionMaxUsd,
          perAddressHardCapUsd: caps.perAddressHardCapUsd,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /api/config/social-post — recap template + adjective pool for the
// SocialPostModal (grissini-58481).
//
// Auth: any logged-in user (requireAuth only). The copy is non-sensitive and is
// interpolated client-side. The accessor always falls back to the original
// hardcoded copy, so this never 500s on unseeded config.
// ---------------------------------------------------------------------------
router.get(
  '/social-post',
  requireAuth,
  async (_req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      const { template, adjectives } = await getSocialPostConfig();
      res.json({ template, adjectives });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
