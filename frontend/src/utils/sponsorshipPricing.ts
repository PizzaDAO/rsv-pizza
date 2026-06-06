import type { UnderbossEvent } from '../types';
import type { PricingConfig } from '../lib/api';

/**
 * Sponsorship pricing (marinara-71630 P5).
 *
 * The private city-tier lists and the sponsorship dollar tiers (per-tier
 * floor/ceiling/max, the base price, and the rounding increment) USED to be
 * hardcoded here. They are now sourced at runtime from GET /api/config/pricing
 * (see `usePricingConfig`) so they no longer live in the open-source bundle.
 * The (non-secret) FORMULAS stay here — these functions take the resolved
 * config as a parameter and reproduce the original math exactly given the
 * seeded numbers.
 */

export type CityTiers = PricingConfig['cityTiers'];
export type SponsorshipPricing = PricingConfig['sponsorshipPricing'];

/** Normalize + substring-match a city name against a list (drops spaces/hyphens). */
function matchesList(cityName: string, list: string[]): boolean {
  const normalized = cityName.toLowerCase().replace(/[-\s]/g, '');
  return list.some((c) => normalized.includes(c.replace(/[-\s]/g, '')));
}

/**
 * Resolve a city's tier from the configured tier-1/tier-2 lists. Anything not
 * matched (including empty lists) is tier 3.
 */
export function getCityTier(cityName: string, cityTiers: CityTiers): 1 | 2 | 3 {
  if (matchesList(cityName, cityTiers.tier1)) return 1;
  if (matchesList(cityName, cityTiers.tier2)) return 2;
  return 3;
}

/**
 * Calculate the sponsorship price for a single event.
 *
 * price = base + ((clamp(guests, floor, ceiling) - floor) / (ceiling - floor))
 *               * (max - base), rounded to the nearest `roundTo`.
 *
 * Tier bands (floor/ceiling/max), the `base`, and `roundTo` all come from the
 * resolved config. A tier with no config entry (e.g. unseeded config → empty
 * tierConfig) yields 0 so consumers can render a placeholder instead of a
 * bogus number.
 */
export function calculateEventPrice(
  guests: number,
  cityName: string,
  config: { cityTiers: CityTiers; sponsorshipPricing: SponsorshipPricing }
): number {
  const tier = getCityTier(cityName, config.cityTiers);
  const { tierConfig, base, roundTo } = config.sponsorshipPricing;
  const band = tierConfig[String(tier)];
  // No band configured for this tier (unseeded / partial config) → no price.
  if (!band) return 0;
  const { floor, ceiling, max } = band;
  // Guard a degenerate band (ceiling === floor) to avoid divide-by-zero.
  const span = ceiling - floor;
  const clamped = Math.max(floor, Math.min(ceiling, guests));
  const ratio = span === 0 ? 0 : (clamped - floor) / span;
  const price = base + ratio * (max - base);
  const increment = roundTo > 0 ? roundTo : 1;
  return Math.round(price / increment) * increment;
}

/**
 * Calculate the total sponsorship suggestion for a set of events.
 * Extracts city name by stripping "Global Pizza Party " prefix from event name.
 * Uses expectedGuests if available, falls back to guestCount, defaults to 30.
 */
export function calculateTagSponsorshipTotal(
  events: UnderbossEvent[],
  config: { cityTiers: CityTiers; sponsorshipPricing: SponsorshipPricing }
): { total: number; eventCount: number; missingExpectedGuests: number } {
  const prefix = 'Global Pizza Party ';
  let total = 0;
  let missingExpectedGuests = 0;

  for (const event of events) {
    const cityName = event.name.startsWith(prefix)
      ? event.name.slice(prefix.length)
      : event.name;
    if (event.expectedGuests == null) missingExpectedGuests++;
    const guests = event.expectedGuests ?? event.guestCount ?? 30;
    total += calculateEventPrice(guests, cityName, config);
  }

  return { total, eventCount: events.length, missingExpectedGuests };
}
