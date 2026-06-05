/**
 * Reimbursement cap heuristic (arugula-38633 v2; marinara-71630 P5).
 *
 * Suggests a per-event reimbursement cap from the city tier plus the host's
 * planning number for expected guests. The result is a starting point —
 * underbosses validate or override before the cap takes effect on the
 * host-facing payout form.
 *
 * marinara-71630 P5: the private city-tier lists and the per-head reimbursement
 * rates + ceiling no longer live in committed source. They are sourced at
 * runtime from GET /api/config/pricing (see `usePricingConfig`) and passed in
 * via `config`. The (non-secret) FORMULA stays here and mirrors the backend's
 * `computeReimbursementCap`:
 *
 *   suggested = round(perHeadRate[tier] * expectedGuests), clamped to ceiling.
 *
 * If `expectedGuests` is null/0 the heuristic returns null (no suggested cap).
 * It intentionally does NOT fall back to the live RSVP count — the underboss
 * must set expected_guests first.
 *
 * Country-tier logic is intentionally out of scope (city tier only).
 */

import { getCityTier, type CityTiers } from './sponsorshipPricing';
import type { PricingConfig } from '../lib/api';

export type ReimbursementConfig = PricingConfig['reimbursement'];

export interface ReimbursementCapInput {
  city?: string | null;
  /** Reserved for country-tier support — accepted but currently unused. */
  country?: string | null;
  /** Host's planning number for expected guests. Null/0 → no suggestion. */
  expectedGuests: number | null;
}

export interface ReimbursementCapResult {
  /** Null when expected_guests is null/0. */
  suggestedUsd: number | null;
  /** Null when expected_guests is null/0. */
  tier: 1 | 2 | 3 | null;
  /** Human-readable explanation, e.g. "Tier 2, 67 expected guests → $300", or "expected guests not set". */
  formula: string;
}

function resolveTier(city: string | null | undefined, cityTiers: CityTiers): 1 | 2 | 3 {
  if (!city) return 3;
  const trimmed = city.trim();
  if (!trimmed) return 3;
  // getCityTier does case-insensitive matching against the same lists used for
  // sponsorship pricing — single source of truth for tier classification.
  return getCityTier(trimmed, cityTiers);
}

function perHeadFor(tier: 1 | 2 | 3, rates: Record<string, number>): number {
  const r = rates[String(tier)];
  return typeof r === 'number' && Number.isFinite(r) ? r : 0;
}

/**
 * Compute the suggested per-event reimbursement cap from the resolved pricing
 * config. Returns no suggestion (`suggestedUsd: null`) when expected_guests is
 * null/0 OR when the config is unseeded (per-head rate 0 → a $0 suggestion is
 * meaningless, so we surface "not configured" rather than a bogus $0 cap).
 */
export function computeSuggestedReimbursementCap(
  input: ReimbursementCapInput,
  config: { cityTiers: CityTiers; reimbursement: ReimbursementConfig }
): ReimbursementCapResult {
  const raw = input.expectedGuests;
  const expected = raw == null ? 0 : Math.max(0, Math.floor(raw));
  if (expected <= 0) {
    return {
      suggestedUsd: null,
      tier: null,
      formula: 'expected guests not set',
    };
  }

  const tier = resolveTier(input.city, config.cityTiers);
  const perHead = perHeadFor(tier, config.reimbursement.perHeadRates);
  if (perHead <= 0) {
    // Unseeded / zero-rate config → no meaningful suggestion.
    return {
      suggestedUsd: null,
      tier,
      formula: `Tier ${tier}, ${expected} expected guests → not configured`,
    };
  }

  const ceiling = config.reimbursement.ceilingUsd;
  const rawUsd = Math.round(perHead * expected);
  const suggestedUsd = ceiling > 0 ? Math.min(rawUsd, ceiling) : rawUsd;

  return {
    suggestedUsd,
    tier,
    formula: `Tier ${tier}, ${expected} expected guests → $${suggestedUsd}`,
  };
}
