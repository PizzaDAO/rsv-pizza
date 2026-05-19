/**
 * Reimbursement cap heuristic (arugula-38633 v2).
 *
 * Suggests a per-event reimbursement cap from the city tier (reused from
 * sponsorshipPricing.ts) plus the confirmed RSVP count. The result is a
 * starting point — underbosses validate or override before the cap takes
 * effect on the host-facing payout form.
 *
 * Country-tier logic is intentionally out of scope for v1 (city tier only).
 */

import { getCityTier } from './sponsorshipPricing';

export interface ReimbursementCapInput {
  city?: string | null;
  /** Reserved for v2 country-tier support — accepted but currently unused. */
  country?: string | null;
  confirmedRsvpCount: number;
}

export interface ReimbursementCapResult {
  suggestedUsd: number;
  tier: 1 | 2 | 3;
  /** Human-readable explanation, e.g. "Tier 2, 67 RSVPs → $300". */
  formula: string;
}

interface TierConfig {
  /** Floor RSVP count — anything ≤ this gets the floor amount. */
  rsvpFloor: number;
  /** Ceiling RSVP count — anything ≥ this gets the max amount. */
  rsvpCeiling: number;
  /** Minimum suggested cap (at or below rsvpFloor). */
  minUsd: number;
  /** Maximum suggested cap (at or above rsvpCeiling). */
  maxUsd: number;
}

const TIER_CONFIG: Record<1 | 2 | 3, TierConfig> = {
  1: { rsvpFloor: 25, rsvpCeiling: 150, minUsd: 100, maxUsd: 625 },
  2: { rsvpFloor: 25, rsvpCeiling: 100, minUsd: 75,  maxUsd: 400 },
  3: { rsvpFloor: 35, rsvpCeiling: 150, minUsd: 50,  maxUsd: 300 },
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
  const tier = resolveTier(input.city);
  const { rsvpFloor, rsvpCeiling, minUsd, maxUsd } = TIER_CONFIG[tier];

  const rsvps = Math.max(0, Math.floor(input.confirmedRsvpCount ?? 0));
  const clamped = Math.max(rsvpFloor, Math.min(rsvpCeiling, rsvps));
  const ratio = (clamped - rsvpFloor) / (rsvpCeiling - rsvpFloor);
  const raw = minUsd + ratio * (maxUsd - minUsd);
  const suggestedUsd = roundToIncrement(raw, ROUNDING_INCREMENT_USD);

  return {
    suggestedUsd,
    tier,
    formula: `Tier ${tier}, ${rsvps} RSVPs → $${suggestedUsd}`,
  };
}
