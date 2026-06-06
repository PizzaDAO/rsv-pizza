/**
 * Reimbursement cap heuristic (arugula-38633 v2; marinara-71630 P5).
 *
 * Suggests a per-event reimbursement cap from the city tier plus the host's
 * planning number for expected guests. The result is a starting point —
 * underbosses validate or override before the cap takes effect on the
 * host-facing payout form.
 *
 * marinara-71630 P5: the private city-tier lists and the per-tier dollar BANDS
 * no longer live in committed source. They are sourced at runtime from
 * GET /api/config/pricing (see `usePricingConfig`) and passed in via `config`.
 * The (non-secret) FORMULA stays here and reproduces the ORIGINAL band math
 * EXACTLY given the seeded numbers:
 *
 *   clamped = clamp(expectedGuests, guestFloor, guestCeiling)
 *   ratio   = (clamped - guestFloor) / (guestCeiling - guestFloor)
 *   rawUsd  = minUsd + ratio * (maxUsd - minUsd)
 *   suggested = round(rawUsd / roundingIncrementUsd) * roundingIncrementUsd
 *
 * This is the original per-tier dollar-band interpolation — NOT the GPP27
 * per-head ($/head × attendance) formula, which is a separate concern.
 *
 * If `expectedGuests` is null/0 the heuristic returns null (no suggested cap).
 * It intentionally does NOT fall back to the live RSVP count — the underboss
 * must set expected_guests first.
 *
 * Country-tier logic is intentionally out of scope (city tier only).
 */

import { getCityTier, type CityTiers } from './sponsorshipPricing';
import type { PricingConfig } from '../lib/api';

export type ReimbursementCapBands = PricingConfig['reimbursementCapBands'];

export interface ReimbursementCapInput {
  city?: string | null;
  /** Reserved for country-tier support — accepted but currently unused. */
  country?: string | null;
  /** Host's planning number for expected guests. Null/0 → no suggestion. */
  expectedGuests: number | null;
}

export interface ReimbursementCapResult {
  /** Null when expected_guests is null/0, or when the cap config is unseeded. */
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

function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

/**
 * Compute the suggested per-event reimbursement cap by interpolating the
 * resolved tier's dollar band against the host's expected-guests planning
 * number. Returns no suggestion (`suggestedUsd: null`) when expected_guests is
 * null/0, OR when the config has no band for the resolved tier (unseeded /
 * partial config → a graceful "cap config unavailable" rather than a bogus $0).
 */
export function computeSuggestedReimbursementCap(
  input: ReimbursementCapInput,
  config: { cityTiers: CityTiers; reimbursementCapBands: ReimbursementCapBands }
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
  const band = config.reimbursementCapBands.bands[String(tier)];
  if (!band) {
    // Unseeded / missing band for this tier → no meaningful suggestion.
    return {
      suggestedUsd: null,
      tier,
      formula: 'cap config unavailable',
    };
  }

  const { guestFloor, guestCeiling, minUsd, maxUsd } = band;
  const increment = config.reimbursementCapBands.roundingIncrementUsd || 25;

  const clamped = Math.max(guestFloor, Math.min(guestCeiling, expected));
  const span = guestCeiling - guestFloor;
  const ratio = span === 0 ? 0 : (clamped - guestFloor) / span;
  const rawUsd = minUsd + ratio * (maxUsd - minUsd);
  const suggestedUsd = roundToIncrement(rawUsd, increment);

  return {
    suggestedUsd,
    tier,
    formula: `Tier ${tier}, ${expected} expected guests → $${suggestedUsd}`,
  };
}
