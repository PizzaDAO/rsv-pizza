import type { UnderbossEvent } from '../types';

const TIER_1_CITIES = [
  'new york', 'nyc', 'los angeles', 'san francisco', 'chicago', 'miami', 'toronto', 'mexico city',
  'london', 'paris', 'berlin', 'amsterdam', 'barcelona', 'lisbon', 'milan',
  'tokyo', 'singapore', 'hong kong', 'seoul', 'sydney', 'melbourne', 'bangkok', 'dubai', 'mumbai',
  'sao paulo', 'buenos aires',
];

/**
 * Check if a city name matches a tier-1 city.
 * Normalizes by lowercasing and stripping hyphens/spaces, then checks
 * if any tier-1 city string is contained in the normalized name.
 */
export function isTier1City(cityName: string): boolean {
  const normalized = cityName.toLowerCase().replace(/[-\s]/g, '');
  return TIER_1_CITIES.some((tier1) => {
    const normalizedTier1 = tier1.replace(/[-\s]/g, '');
    return normalized.includes(normalizedTier1);
  });
}

/**
 * Calculate the sponsorship price for a single event.
 * Base price scales linearly from $2 (30 guests) to $500 (250 guests).
 * Tier-1 cities get a 2x multiplier.
 * Guest count is clamped to [30, 250].
 */
export function calculateEventPrice(guests: number, cityName: string): number {
  const clamped = Math.max(30, Math.min(250, guests));
  // Linear interpolation: $2 at 30 guests, $500 at 250 guests
  const base = 2 + ((clamped - 30) / (250 - 30)) * (500 - 2);
  const multiplier = isTier1City(cityName) ? 2 : 1;
  return Math.round(base * multiplier);
}

/**
 * Calculate the total sponsorship suggestion for a set of events.
 * Extracts city name by stripping "Global Pizza Party " prefix from event name.
 * Uses expectedGuests if available, falls back to guestCount, defaults to 30.
 */
export function calculateTagSponsorshipTotal(
  events: UnderbossEvent[]
): { total: number; eventCount: number } {
  const prefix = 'Global Pizza Party ';
  let total = 0;

  for (const event of events) {
    const cityName = event.name.startsWith(prefix)
      ? event.name.slice(prefix.length)
      : event.name;
    const guests = event.expectedGuests ?? event.guestCount ?? 30;
    total += calculateEventPrice(guests, cityName);
  }

  return { total, eventCount: events.length };
}
