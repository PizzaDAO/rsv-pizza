import {
  fetchPayoutConfig,
  type PayoutConfigResponse,
  type PayoutCapsConfig,
  type SwcHubRulesConfig,
} from '../lib/api';

/**
 * marinara-71630 P6/P7 — shared module-level cache for GET /api/config/payout-caps.
 *
 * That endpoint now returns BOTH the payout caps (P6) and the SWC-hub matching
 * rules (P7). `usePayoutCaps` and `useSwcHubRules` are both rendered on
 * /payments, so they share this single cached request rather than each firing
 * their own. The in-flight promise is cached at module scope so several modals
 * mounting together hit the network once; the resolved value is memoized so late
 * subscribers resolve on the next tick.
 *
 * Fallbacks are NEUTRAL / EMPTY (never the real values) so an unseeded config or
 * a fetch failure is SAFE: caps stay inert (high sentinel → UX warning/clamp is
 * a no-op) and the SWC rules flag NOTHING (the admin ack warning simply doesn't
 * appear). Both are UX-only — the backend remains the enforcement authority.
 */

/** Neutral cap fallback — high sentinel so the UX warning/clamp is inert. */
export const NEUTRAL_PAYOUT_CAPS: PayoutCapsConfig = {
  perSubmissionMaxUsd: Number.POSITIVE_INFINITY,
  perAddressHardCapUsd: Number.POSITIVE_INFINITY,
};

/** Empty SWC-hub rules fallback — nothing is flagged SWC-hub. */
export const EMPTY_SWC_HUB_RULES: SwcHubRulesConfig = {
  countries: [],
  tags: [],
  excludeTags: [],
};

const NEUTRAL_CONFIG: PayoutConfigResponse = {
  payoutCaps: NEUTRAL_PAYOUT_CAPS,
  swcHub: EMPTY_SWC_HUB_RULES,
};

let cachedPromise: Promise<PayoutConfigResponse> | null = null;
let cachedConfig: PayoutConfigResponse | null = null;

/** Resolve the combined payout config, sharing one request across all consumers. */
export function loadPayoutConfig(): Promise<PayoutConfigResponse> {
  if (!cachedPromise) {
    cachedPromise = fetchPayoutConfig()
      .then((cfg) => {
        cachedConfig = cfg;
        return cfg;
      })
      .catch((err) => {
        console.warn('[payoutConfigCache] failed to load payout config; using neutral fallback', err);
        cachedConfig = NEUTRAL_CONFIG;
        // Reset so a later mount can retry (e.g. transient 401/network).
        cachedPromise = null;
        return NEUTRAL_CONFIG;
      });
  }
  return cachedPromise;
}

/** Synchronously-available resolved config, or null while still loading. */
export function getCachedPayoutConfig(): PayoutConfigResponse | null {
  return cachedConfig;
}
