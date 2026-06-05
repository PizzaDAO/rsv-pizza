import { describe, it, expect } from 'vitest';
import {
  getCityTier,
  calculateEventPrice,
  calculateTagSponsorshipTotal,
} from './sponsorshipPricing';
import type { PricingConfig } from '../lib/api';
import type { UnderbossEvent } from '../types';

// The real seeded numbers (matching the pre-refactor hardcoded values and the
// GET /api/config/pricing example payload). Reproducing the original math from
// these inputs proves the parameterization is faithful.
const SEEDED: Pick<PricingConfig, 'cityTiers' | 'sponsorshipPricing'> = {
  cityTiers: {
    tier1: ['new york', 'london', 'tokyo'],
    tier2: ['austin', 'berlin', 'toronto'],
  },
  sponsorshipPricing: {
    tierConfig: {
      '1': { floor: 25, ceiling: 150, max: 1000 },
      '2': { floor: 25, ceiling: 100, max: 500 },
      '3': { floor: 35, ceiling: 150, max: 400 },
    },
    base: 200,
    roundTo: 50,
  },
};

describe('getCityTier', () => {
  it('matches tier-1 cities (case-insensitive, space/hyphen-insensitive)', () => {
    expect(getCityTier('New York', SEEDED.cityTiers)).toBe(1);
    expect(getCityTier('LONDON', SEEDED.cityTiers)).toBe(1);
  });
  it('matches tier-2 cities', () => {
    expect(getCityTier('Austin', SEEDED.cityTiers)).toBe(2);
    expect(getCityTier('berlin', SEEDED.cityTiers)).toBe(2);
  });
  it('defaults unmatched cities to tier 3', () => {
    expect(getCityTier('Smallville', SEEDED.cityTiers)).toBe(3);
  });
  it('treats every city as tier 3 when lists are empty (neutral fallback)', () => {
    expect(getCityTier('New York', { tier1: [], tier2: [] })).toBe(3);
  });
});

describe('calculateEventPrice (reproduces pre-refactor math)', () => {
  it('floors small tier-1 events at the base price', () => {
    // guests <= floor → base 200, rounded to 50 → 200
    expect(calculateEventPrice(10, 'New York', SEEDED)).toBe(200);
  });
  it('caps large tier-1 events at the tier max', () => {
    // guests >= ceiling → max 1000
    expect(calculateEventPrice(300, 'New York', SEEDED)).toBe(1000);
  });
  it('interpolates a tier-1 mid-range event and rounds to $50', () => {
    // tier1: floor 25, ceiling 150, max 1000, base 200
    // guests 87: ratio = (87-25)/(150-25) = 62/125 = 0.496
    // price = 200 + 0.496*(1000-200) = 200 + 396.8 = 596.8 → round/50 → 600
    expect(calculateEventPrice(87, 'New York', SEEDED)).toBe(600);
  });
  it('prices a tier-3 (unmatched) city with the tier-3 band', () => {
    // tier3: floor 35, ceiling 150, max 400. guests 100:
    // ratio = (100-35)/(150-35) = 65/115 = 0.565
    // price = 200 + 0.565*(400-200) = 200 + 113.04 = 313.04 → round/50 → 300
    expect(calculateEventPrice(100, 'Smallville', SEEDED)).toBe(300);
  });
  it('returns 0 when the tier has no configured band (unseeded config)', () => {
    const empty: Pick<PricingConfig, 'cityTiers' | 'sponsorshipPricing'> = {
      cityTiers: { tier1: [], tier2: [] },
      sponsorshipPricing: { tierConfig: {}, base: 0, roundTo: 50 },
    };
    expect(calculateEventPrice(100, 'New York', empty)).toBe(0);
  });
});

describe('calculateTagSponsorshipTotal', () => {
  function evt(name: string, expectedGuests: number | null, guestCount = 0): UnderbossEvent {
    return { name, expectedGuests, guestCount } as unknown as UnderbossEvent;
  }

  it('sums event prices and counts events missing expected guests', () => {
    const events = [
      evt('Global Pizza Party New York', 300),  // tier1 cap → 1000
      evt('Global Pizza Party Austin', 10),     // tier2 floor → 200
      evt('Global Pizza Party Smallville', null, 100), // tier3, falls back to guestCount 100 → 300
    ];
    const res = calculateTagSponsorshipTotal(events, SEEDED);
    expect(res.eventCount).toBe(3);
    expect(res.missingExpectedGuests).toBe(1);
    expect(res.total).toBe(1000 + 200 + 300);
  });
});
