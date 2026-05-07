import type { UnderbossEvent } from '../types';

/** Tier 1 — top global cities (max $1,000) */
const TIER_1_CITIES = [
  // Americas
  'new york', 'nyc', 'los angeles', 'san francisco', 'chicago', 'miami',
  // Europe
  'london', 'paris',
  // Asia-Pacific
  'tokyo', 'singapore', 'hong kong', 'seoul', 'sydney', 'dubai',
  'shanghai', 'beijing', 'shenzhen',
  // Local name variants
  'istanbul', 'İstanbul',
  // India mega-cities
  'delhi', 'new delhi', 'mumbai',
];

/** Tier 2 — major cities (max $500) */
const TIER_2_CITIES = [
  // US
  'boston', 'washington', 'denver', 'seattle', 'austin', 'dallas', 'houston', 'atlanta', 'philadelphia',
  'san diego', 'las vegas', 'phoenix', 'nashville', 'minneapolis', 'detroit', 'portland',
  'kansas city', 'st. louis', 'salt lake city', 'pittsburgh', 'san juan', 'honolulu',
  'raleigh', 'cleveland', 'cincinnati', 'milwaukee', 'memphis', 'jacksonville', 'omaha',
  // Canada
  'toronto', 'vancouver', 'calgary', 'edmonton', 'ottawa', 'montreal', 'winnipeg',
  // Latin America
  'mexico city', 'monterrey', 'sao paulo', 'rio de janeiro', 'buenos aires', 'bogota', 'bogotá',
  'lima', 'santiago', 'medellin', 'medellín', 'caracas', 'quito',
  // Europe
  'berlin', 'amsterdam', 'barcelona', 'lisbon', 'milan', 'munich', 'hamburg', 'rome', 'roma',
  'vienna', 'wien', 'prague', 'warsaw', 'warszawa', 'budapest', 'dublin', 'copenhagen',
  'stockholm', 'oslo', 'zurich', 'brussels', 'athens', 'helsinki', 'bucharest',
  'zagreb', 'ljubljana', 'gothenburg', 'tallinn', 'naples', 'moscow',
  // Asia
  'melbourne', 'bangkok', 'kuala lumpur', 'ho chi minh', 'hanoi', 'doha', 'beirut',
  'chennai', 'kolkata', 'hyderabad', 'bangalore', 'pune', 'colombo', 'kathmandu',
  // Africa
  'lagos', 'nairobi', 'johannesburg', 'kampala', 'dar es salaam', 'accra', 'addis ababa',
  'kigali', 'cape town',
  // Oceania
  'perth', 'gold coast', 'auckland', 'wellington',
];

const TIER_CONFIG: Record<1 | 2 | 3, { floor: number; ceiling: number; max: number }> = {
  1: { floor: 25, ceiling: 150, max: 1000 },
  2: { floor: 25, ceiling: 100, max: 500 },
  3: { floor: 35, ceiling: 100, max: 300 },
};

function matchesList(cityName: string, list: string[]): boolean {
  const normalized = cityName.toLowerCase().replace(/[-\s]/g, '');
  return list.some((c) => normalized.includes(c.replace(/[-\s]/g, '')));
}

export function getCityTier(cityName: string): 1 | 2 | 3 {
  if (matchesList(cityName, TIER_1_CITIES)) return 1;
  if (matchesList(cityName, TIER_2_CITIES)) return 2;
  return 3;
}

/**
 * Calculate the sponsorship price for a single event.
 * Tier 1: $200 (≤25 guests) → $1,000 (150+ guests)
 * Tier 2: $200 (≤25 guests) → $500 (100+ guests)
 * Tier 3: $200 (≤35 guests) → $300 (100+ guests)
 * Rounded to nearest $50.
 */
export function calculateEventPrice(guests: number, cityName: string): number {
  const tier = getCityTier(cityName);
  const { floor, ceiling, max } = TIER_CONFIG[tier];
  const clamped = Math.max(floor, Math.min(ceiling, guests));
  const price = 200 + ((clamped - floor) / (ceiling - floor)) * (max - 200);
  return Math.round(price / 50) * 50;
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
