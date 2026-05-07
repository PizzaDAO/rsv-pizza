import type { UnderbossEvent } from '../types';

const TIER_1_CITIES = [
  'new york', 'nyc', 'los angeles', 'san francisco', 'chicago', 'miami', 'toronto', 'mexico city',
  'boston', 'washington', 'denver', 'seattle', 'austin', 'dallas', 'houston', 'atlanta', 'philadelphia',
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
 * $200 floor: non-tier-1 at ≤35 guests, tier-1 at ≤25 guests.
 * Scales linearly up to $500 (non-tier-1) or $1,000 (tier-1) at 105 guests.
 */
export function calculateEventPrice(guests: number, cityName: string): number {
  const tier1 = isTier1City(cityName);
  const floor = tier1 ? 25 : 35;
  const ceiling = 105;
  const clamped = Math.max(floor, Math.min(ceiling, guests));
  const min = 200;
  const max = tier1 ? 1000 : 500;
  const price = min + ((clamped - floor) / (ceiling - floor)) * (max - min);
  return Math.round(price);
}

/**
 * Calculate the total sponsorship suggestion for a set of events.
 * Extracts city name by stripping "Global Pizza Party " prefix from event name.
 * Uses expectedGuests if available, falls back to guestCount, defaults to 30.
 */
export function calculateTagSponsorshipTotal(
  events: UnderbossEvent[]
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
    total += calculateEventPrice(guests, cityName);
  }

  return { total, eventCount: events.length, missingExpectedGuests };
}
