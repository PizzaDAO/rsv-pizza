import { describe, it, expect } from 'vitest';
import { computeSuggestedReimbursementCap } from './reimbursementCap';
import type { PricingConfig } from '../lib/api';

/**
 * These bands reproduce the ORIGINAL arugula-38633 per-tier dollar-band math
 * (the real numbers that used to be hardcoded in reimbursementCap.ts, now
 * sourced from GET /api/config/pricing → private.reimbursement_cap_bands):
 *   Tier 1: floor 25, ceiling 150, min 100, max 625
 *   Tier 2: floor 25, ceiling 100, min  75, max 400
 *   Tier 3: floor 35, ceiling 150, min  50, max 300
 * Suggestion = round( min + ratio*(max-min) , 25 ) where
 *   ratio = (clamp(expected, floor, ceiling) - floor) / (ceiling - floor).
 */
const CFG: Pick<PricingConfig, 'cityTiers' | 'reimbursementCapBands'> = {
  cityTiers: {
    tier1: ['new york', 'london'],
    tier2: ['austin', 'berlin'],
  },
  reimbursementCapBands: {
    bands: {
      '1': { guestFloor: 25, guestCeiling: 150, minUsd: 100, maxUsd: 625 },
      '2': { guestFloor: 25, guestCeiling: 100, minUsd: 75, maxUsd: 400 },
      '3': { guestFloor: 35, guestCeiling: 150, minUsd: 50, maxUsd: 300 },
    },
    roundingIncrementUsd: 25,
  },
};

describe('computeSuggestedReimbursementCap', () => {
  it('returns no suggestion when expected guests is null/0', () => {
    const r1 = computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: null }, CFG);
    expect(r1.suggestedUsd).toBeNull();
    expect(r1.tier).toBeNull();
    expect(r1.formula).toBe('expected guests not set');
    expect(
      computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 0 }, CFG).suggestedUsd,
    ).toBeNull();
  });

  it('tier 1 at or above the ceiling → maxUsd ($625)', () => {
    const r = computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 150 }, CFG);
    expect(r.tier).toBe(1);
    expect(r.suggestedUsd).toBe(625);
    // anything above the ceiling clamps to the same max
    expect(
      computeSuggestedReimbursementCap({ city: 'London', expectedGuests: 5000 }, CFG).suggestedUsd,
    ).toBe(625);
  });

  it('tier 2 at or below the floor → minUsd ($75)', () => {
    // expected (25) == guestFloor → ratio 0 → minUsd 75
    const r = computeSuggestedReimbursementCap({ city: 'Austin', expectedGuests: 25 }, CFG);
    expect(r.tier).toBe(2);
    expect(r.suggestedUsd).toBe(75);
    // below the floor clamps up to the floor → still 75
    expect(
      computeSuggestedReimbursementCap({ city: 'Berlin', expectedGuests: 10 }, CFG).suggestedUsd,
    ).toBe(75);
  });

  it('tier 1 mid-range interpolation, rounded to $25', () => {
    // floor 25, ceiling 150, min 100, max 625; expected 87
    // ratio = (87-25)/125 = 0.496; raw = 100 + 0.496*525 = 360.4
    // round(360.4/25)*25 = 14*25 = 350
    const r = computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 87 }, CFG);
    expect(r.tier).toBe(1);
    expect(r.suggestedUsd).toBe(350);
    expect(r.formula).toBe('Tier 1, 87 expected guests → $350');
  });

  it('tier 2 mid-range interpolation, rounded to $25', () => {
    // floor 25, ceiling 100, min 75, max 400; expected 62
    // ratio = (62-25)/75 = 0.49333; raw = 75 + 0.49333*325 = 235.33
    // round(235.33/25)*25 = 9*25 = 225
    const r = computeSuggestedReimbursementCap({ city: 'Austin', expectedGuests: 62 }, CFG);
    expect(r.tier).toBe(2);
    expect(r.suggestedUsd).toBe(225);
  });

  it('falls back to tier 3 for unmatched cities', () => {
    // floor 35, ceiling 150, min 50, max 300; expected 150 → ratio 1 → 300
    const r = computeSuggestedReimbursementCap({ city: 'Smallville', expectedGuests: 150 }, CFG);
    expect(r.tier).toBe(3);
    expect(r.suggestedUsd).toBe(300);
  });

  it('empty/missing city → tier 3', () => {
    const r = computeSuggestedReimbursementCap({ city: '', expectedGuests: 35 }, CFG);
    expect(r.tier).toBe(3);
    // expected 35 == floor → ratio 0 → minUsd 50
    expect(r.suggestedUsd).toBe(50);
  });

  it('returns no suggestion (not $0) when the band for the tier is missing/unseeded', () => {
    const unseeded: Pick<PricingConfig, 'cityTiers' | 'reimbursementCapBands'> = {
      cityTiers: { tier1: [], tier2: [] },
      reimbursementCapBands: { bands: {}, roundingIncrementUsd: 25 },
    };
    const r = computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 50 }, unseeded);
    expect(r.suggestedUsd).toBeNull();
    expect(r.tier).toBe(3);
    expect(r.formula).toBe('cap config unavailable');
  });
});
