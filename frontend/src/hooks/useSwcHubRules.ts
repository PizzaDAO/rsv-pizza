import { useEffect, useState } from 'react';
import type { SwcHubRulesConfig } from '../lib/api';
import {
  loadPayoutConfig,
  getCachedPayoutConfig,
  EMPTY_SWC_HUB_RULES,
} from './payoutConfigCache';

/**
 * marinara-71630 P7 — shared loader for the SWC-hub matching rules that used to
 * be hardcoded country/tag literals in the OPEN frontend (`swcHub.ts`:
 * 'United States', 'SWC Hub', the 'nonhub' exclusion). The real values now live
 * in `app_config` (private.swc_hub_rules) and are served by GET
 * /api/config/payout-caps — the same payments-admin endpoint the cap warning
 * uses (same gate, same /payments modals), so the request is shared via
 * `payoutConfigCache` with `usePayoutCaps`.
 *
 * Fallback: on any fetch failure (and while loading) the hook resolves to EMPTY
 * rules, so NOTHING is flagged SWC-hub. This is the SAFE default — the SWC
 * warning is a frontend-only admin ACK (not an enforcement gate), so an
 * unseeded config simply means the soft warning doesn't appear and the send
 * isn't blocked, never an over-broad block.
 */

export { EMPTY_SWC_HUB_RULES };

export interface UseSwcHubRulesResult {
  /**
   * The SWC-hub rules, or null while loading. Consumers that pass this into
   * `isSwcHubParty` can pass it directly — a null/undefined rules arg makes the
   * matcher return false (NOT-SWC), which is the safe "rules unresolved" state.
   */
  rules: SwcHubRulesConfig | null;
  loading: boolean;
}

/**
 * Returns the shared SWC-hub rules. `rules` is null while loading; pass it
 * straight into `isSwcHubParty(party, rules)` — the matcher treats a null rules
 * arg as NOT-SWC, the safe default while the config resolves.
 */
export function useSwcHubRules(): UseSwcHubRulesResult {
  const [rules, setRules] = useState<SwcHubRulesConfig | null>(
    getCachedPayoutConfig()?.swcHub ?? null,
  );

  useEffect(() => {
    const cached = getCachedPayoutConfig();
    if (cached) {
      setRules(cached.swcHub);
      return;
    }
    let active = true;
    loadPayoutConfig().then((cfg) => {
      if (active) setRules(cfg.swcHub);
    });
    return () => {
      active = false;
    };
  }, []);

  return { rules, loading: rules === null };
}
