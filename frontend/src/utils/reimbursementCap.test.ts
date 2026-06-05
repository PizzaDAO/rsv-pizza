import { describe, it, expect } from 'vitest';
import { computeSuggestedReimbursementCap } from './reimbursementCap';
import type { PricingConfig } from '../lib/api';

const CFG: Pick<PricingConfig, 'cityTiers' | 'reimbursement'> = {
  cityTiers: {
    tier1: ['new york', 'london'],
    tier2: ['austin', 'berlin'],
  },
  reimbursement: {
    // GET /api/config/pricing example numbers.
    perHeadRates: { '1': 10, '2': 8, '3': 6 },
    ceilingUsd: 625,
    attendanceRsvpCoefficient: 0.4,
  },
};

describe('computeSuggestedReimbursementCap', () => {
  it('returns no suggestion when expected guests is null/0', () => {
    expect(computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: null }, CFG).suggestedUsd).toBeNull();
    expect(computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 0 }, CFG).suggestedUsd).toBeNull();
  });

  it('uses the per-head rate for the resolved tier', () => {
    // tier1 rate 10 × 30 guests = 300 (under ceiling)
    const r = computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 30 }, CFG);
    expect(r.tier).toBe(1);
    expect(r.suggestedUsd).toBe(300);
  });

  it('applies the tier-2 rate', () => {
    // tier2 rate 8 × 50 = 400
    const r = computeSuggestedReimbursementCap({ city: 'Austin', expectedGuests: 50 }, CFG);
    expect(r.tier).toBe(2);
    expect(r.suggestedUsd).toBe(400);
  });

  it('falls back to tier 3 for unmatched cities', () => {
    // tier3 rate 6 × 40 = 240
    const r = computeSuggestedReimbursementCap({ city: 'Smallville', expectedGuests: 40 }, CFG);
    expect(r.tier).toBe(3);
    expect(r.suggestedUsd).toBe(240);
  });

  it('clamps to the configured ceiling', () => {
    // tier1 rate 10 × 1000 = 10000 → clamped to 625
    const r = computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 1000 }, CFG);
    expect(r.suggestedUsd).toBe(625);
  });

  it('returns no suggestion (not $0) when rates are unseeded/zero', () => {
    const zero: Pick<PricingConfig, 'cityTiers' | 'reimbursement'> = {
      cityTiers: { tier1: [], tier2: [] },
      reimbursement: { perHeadRates: { '1': 0, '2': 0, '3': 0 }, ceilingUsd: 0, attendanceRsvpCoefficient: 0 },
    };
    const r = computeSuggestedReimbursementCap({ city: 'New York', expectedGuests: 50 }, zero);
    expect(r.suggestedUsd).toBeNull();
    expect(r.formula).toContain('not configured');
  });
});
