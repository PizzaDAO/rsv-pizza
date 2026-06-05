import { Router, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  requireUnderbossAuth,
  UnderbossAuthRequest,
} from '../middleware/underbossAuth.js';
import {
  getCityTiers,
  getSponsorshipPricing,
  getReimbursementTiers,
  getReimbursementCapBands,
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

export default router;
