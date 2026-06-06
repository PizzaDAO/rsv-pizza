import { useEffect, useState } from 'react';
import type { PayoutCapsConfig } from '../lib/api';
import {
  loadPayoutConfig,
  getCachedPayoutConfig,
  NEUTRAL_PAYOUT_CAPS,
} from './payoutConfigCache';

/**
 * marinara-71630 P6 — shared loader for the payments-admin payout caps that
 * used to be hardcoded in the frontend bundle (`PER_SUBMISSION_MAX_USD = 675`
 * in PayoutReviewModal / ExternalPaymentModal / CreatePrepaymentModal). The real
 * numbers now live in `app_config` (private.payout_caps) and are served by
 * GET /api/config/payout-caps (payments-admin OR underboss gated).
 *
 * marinara-71630 P7: that endpoint now also carries the SWC-hub rules, so the
 * underlying cached request is shared via `payoutConfigCache` with
 * `useSwcHubRules` — both hooks resolve from one network request.
 *
 * Fallback: on any fetch failure (and while loading) the hook resolves to a
 * NEUTRAL cap, NOT the real production value. The backend is the enforcement
 * authority, so the frontend cap is UX-only — it drives the amber "over the cap"
 * warning text and CreatePrepaymentModal's client-side clamp. Baking the real
 * number in as the fallback would re-introduce the private data this refactor
 * removes, so we deliberately do NOT.
 *
 * NEUTRAL value choice: a high sentinel (`Number.POSITIVE_INFINITY`). Because the
 * cap is UX-only, a high neutral means the warning simply never fires while the
 * real cap is unknown (rather than nagging on legitimate amounts), and
 * CreatePrepaymentModal's clamp becomes a no-op until the real cap loads — the
 * graceful option. The cap loads within one request of opening /payments, and
 * the backend rejects any over-cap amount regardless of what the frontend shows.
 */

export { NEUTRAL_PAYOUT_CAPS };

export interface UsePayoutCapsResult {
  caps: PayoutCapsConfig | null;
  loading: boolean;
}

/**
 * Returns the shared payout caps. `caps` is null while loading; consumers should
 * treat a null cap as "cap unknown" (skip the warning, don't clamp) until it
 * resolves.
 */
export function usePayoutCaps(): UsePayoutCapsResult {
  const [caps, setCaps] = useState<PayoutCapsConfig | null>(
    getCachedPayoutConfig()?.payoutCaps ?? null,
  );

  useEffect(() => {
    const cached = getCachedPayoutConfig();
    if (cached) {
      // Already resolved (another consumer beat us to it).
      setCaps(cached.payoutCaps);
      return;
    }
    let active = true;
    loadPayoutConfig().then((cfg) => {
      if (active) setCaps(cfg.payoutCaps);
    });
    return () => {
      active = false;
    };
  }, []);

  return { caps, loading: caps === null };
}
