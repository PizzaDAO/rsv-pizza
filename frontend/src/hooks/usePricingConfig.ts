import { useEffect, useState } from 'react';
import { fetchPricingConfig, type PricingConfig } from '../lib/api';

/**
 * marinara-71630 P5 — shared loader for the private pricing config
 * (city-tier lists + sponsorship/reimbursement dollar numbers) that used to be
 * hardcoded in the frontend bundle. The real values now live in `app_config`
 * and are served by GET /api/config/pricing (admin/underboss-gated).
 *
 * Caching: the fetch fires ONCE process-wide. The in-flight promise is cached
 * at module scope so that several components mounting together (EventRow,
 * EventTable, PartnerCitiesFlyer) share a single network request rather than
 * each refetching. The resolved config is also memoized so late subscribers
 * resolve synchronously on the next tick.
 *
 * Fallback: on any fetch failure the hook resolves to a NEUTRAL config — empty
 * tier lists (so every city resolves to tier 3), an empty sponsorship
 * tierConfig with base 0 (so a price can't be computed → consumers render a
 * placeholder rather than a bogus number), roundTo 50 (non-zero to avoid a
 * divide-by-zero in the price formula), and all-zero reimbursement rates. The
 * real city lists / dollar tiers are deliberately NOT baked in as the fallback;
 * doing so would re-introduce the private data this refactor removes.
 */

/** Neutral, non-secret fallback. Mirrors the backend accessors' fail-safe defaults. */
export const NEUTRAL_PRICING_CONFIG: PricingConfig = {
  cityTiers: { tier1: [], tier2: [] },
  sponsorshipPricing: { tierConfig: {}, base: 0, roundTo: 50 },
  reimbursement: { perHeadRates: { '1': 0, '2': 0, '3': 0 }, ceilingUsd: 0, attendanceRsvpCoefficient: 0 },
};

// Module-level cache: shared across every hook consumer for the page lifetime.
let cachedPromise: Promise<PricingConfig> | null = null;
let cachedConfig: PricingConfig | null = null;

function loadPricingConfig(): Promise<PricingConfig> {
  if (!cachedPromise) {
    cachedPromise = fetchPricingConfig()
      .then((cfg) => {
        cachedConfig = cfg;
        return cfg;
      })
      .catch((err) => {
        console.warn('[usePricingConfig] failed to load pricing config; using neutral fallback', err);
        cachedConfig = NEUTRAL_PRICING_CONFIG;
        // Reset so a later mount can retry the fetch (e.g. transient 401/network).
        cachedPromise = null;
        return NEUTRAL_PRICING_CONFIG;
      });
  }
  return cachedPromise;
}

export interface UsePricingConfigResult {
  config: PricingConfig | null;
  loading: boolean;
}

/**
 * Returns the shared pricing config. `config` is null while loading; consumers
 * should render a placeholder for any price/total until it resolves.
 */
export function usePricingConfig(): UsePricingConfigResult {
  const [config, setConfig] = useState<PricingConfig | null>(cachedConfig);

  useEffect(() => {
    if (cachedConfig) {
      // Already resolved (another consumer beat us to it).
      setConfig(cachedConfig);
      return;
    }
    let active = true;
    loadPricingConfig().then((cfg) => {
      if (active) setConfig(cfg);
    });
    return () => {
      active = false;
    };
  }, []);

  return { config, loading: config === null };
}
