/**
 * Reimbursement cap heuristic (arugula-38633 v2).
 *
 * Suggests a per-event reimbursement cap from the city tier (reused from
 * sponsorshipPricing.ts) plus the host's planning number for expected guests.
 * The result is a starting point — underbosses validate or override before
 * the cap takes effect on the host-facing payout form.
 *
 * If `expectedGuests` is null/0 the heuristic returns null (no suggested cap).
 * It intentionally does NOT fall back to the live RSVP count — the underboss
 * must set expected_guests first.
 *
 * Country-tier logic is intentionally out of scope for v1 (city tier only).
 */

import { getCityTier } from './sponsorshipPricing';

export interface ReimbursementCapInput {
  city?: string | null;
  /** Reserved for v2 country-tier support — accepted but currently unused. */
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

interface TierConfig {
  /** Floor expected-guests count — anything ≤ this gets the floor amount. */
  guestFloor: number;
  /** Ceiling expected-guests count — anything ≥ this gets the max amount. */
  guestCeiling: number;
  /** Minimum suggested cap (at or below guestFloor). */
  minUsd: number;
  /** Maximum suggested cap (at or above guestCeiling). */
  maxUsd: number;
}

const TIER_CONFIG: Record<1 | 2 | 3, TierConfig> = {
  1: { guestFloor: 25, guestCeiling: 150, minUsd: 100, maxUsd: 625 },
  2: { guestFloor: 25, guestCeiling: 100, minUsd: 75,  maxUsd: 400 },
  3: { guestFloor: 35, guestCeiling: 150, minUsd: 50,  maxUsd: 300 },
};

const ROUNDING_INCREMENT_USD = 25;

function resolveTier(city?: string | null): 1 | 2 | 3 {
  if (!city) return 3;
  const trimmed = city.trim();
  if (!trimmed) return 3;
  // getCityTier already does case-insensitive matching against the same lists
  // we use for sponsorship pricing — single source of truth for tier
  // classification.
  return getCityTier(trimmed);
}

function roundToIncrement(value: number, increment: number): number {
  return Math.round(value / increment) * increment;
}

export function computeSuggestedReimbursementCap(
  input: ReimbursementCapInput
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

  const tier = resolveTier(input.city);
  const { guestFloor, guestCeiling, minUsd, maxUsd } = TIER_CONFIG[tier];

  const clamped = Math.max(guestFloor, Math.min(guestCeiling, expected));
  const ratio = (clamped - guestFloor) / (guestCeiling - guestFloor);
  const rawUsd = minUsd + ratio * (maxUsd - minUsd);
  const suggestedUsd = roundToIncrement(rawUsd, ROUNDING_INCREMENT_USD);

  return {
    suggestedUsd,
    tier,
    formula: `Tier ${tier}, ${expected} expected guests → $${suggestedUsd}`,
  };
}
