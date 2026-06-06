import { useEffect, useState } from 'react';
import { fetchPayoutCaps, type PayoutCapsConfig } from '../lib/api';

/**
 * marinara-71630 P6 — shared loader for the payments-admin payout caps that
 * used to be hardcoded in the frontend bundle (`PER_SUBMISSION_MAX_USD = 675`
 * in PayoutReviewModal / ExternalPaymentModal / CreatePrepaymentModal). The real
 * numbers now live in `app_config` (private.payout_caps) and are served by
 * GET /api/config/payout-caps (payments-admin OR underboss gated).
 *
 * Caching: the fetch fires ONCE process-wide. The in-flight promise is cached at
 * module scope so several modals mounting together share a single request. The
 * resolved value is memoized so late subscribers resolve on the next tick.
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

/** Neutral, non-secret fallback. High sentinel → UX warning/clamp is inert until the real cap loads. */
export const NEUTRAL_PAYOUT_CAPS: PayoutCapsConfig = {
  perSubmissionMaxUsd: Number.POSITIVE_INFINITY,
  perAddressHardCapUsd: Number.POSITIVE_INFINITY,
};

// Module-level cache: shared across every hook consumer for the page lifetime.
let cachedPromise: Promise<PayoutCapsConfig> | null = null;
let cachedCaps: PayoutCapsConfig | null = null;

function loadPayoutCaps(): Promise<PayoutCapsConfig> {
  if (!cachedPromise) {
    cachedPromise = fetchPayoutCaps()
      .then((caps) => {
        cachedCaps = caps;
        return caps;
      })
      .catch((err) => {
        console.warn('[usePayoutCaps] failed to load payout caps; using neutral fallback', err);
        cachedCaps = NEUTRAL_PAYOUT_CAPS;
        // Reset so a later mount can retry the fetch (e.g. transient 401/network).
        cachedPromise = null;
        return NEUTRAL_PAYOUT_CAPS;
      });
  }
  return cachedPromise;
}

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
  const [caps, setCaps] = useState<PayoutCapsConfig | null>(cachedCaps);

  useEffect(() => {
    if (cachedCaps) {
      // Already resolved (another consumer beat us to it).
      setCaps(cachedCaps);
      return;
    }
    let active = true;
    loadPayoutCaps().then((c) => {
      if (active) setCaps(c);
    });
    return () => {
      active = false;
    };
  }, []);

  return { caps, loading: caps === null };
}
