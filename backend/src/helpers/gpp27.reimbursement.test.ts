import { describe, it, expect } from 'vitest';
import {
  cityTierFrom,
  perHeadFrom,
  computeReimbursementCap,
} from './gpp27.js';

/**
 * marinara-71630 P5 — the city-tier + reimbursement logic is now config-driven
 * and pure (config passed as a param). These tests assert the calc is identical
 * to the old hardcoded behavior when fed the production-equivalent config, and
 * fail-safe (tier 3 + $0) when fed empty/zero config.
 */

// Production-equivalent config (mirrors the real seeded values: tier-1 $10,
// tier-2 $8, tier-3 $6, $625 ceiling, 0.40 RSVP coefficient).
const TIERS = {
  tier1: ['new york', 'nyc', 'london', 'tokyo'],
  tier2: ['austin', 'berlin', 'toronto'],
};
const CFG = {
  tiers: TIERS,
  rates: { '1': 10, '2': 8, '3': 6 },
  ceilingUsd: 625,
  coefficient: 0.4,
};

describe('cityTierFrom', () => {
  it('resolves a configured tier-1 city to tier 1', () => {
    expect(cityTierFrom('New York', TIERS)).toBe(1);
    expect(cityTierFrom('NYC', TIERS)).toBe(1);
  });

  it('resolves a configured tier-2 city to tier 2', () => {
    expect(cityTierFrom('Austin', TIERS)).toBe(2);
  });

  it('resolves an unlisted city to tier 3', () => {
    expect(cityTierFrom('Smallville', TIERS)).toBe(3);
  });

  it('matches case-insensitively after stripping spaces/hyphens', () => {
    expect(cityTierFrom('new-york', TIERS)).toBe(1);
    expect(cityTierFrom('  TOKYO ', TIERS)).toBe(1);
  });

  it('falls back to tier 3 for an empty city or empty config', () => {
    expect(cityTierFrom('', TIERS)).toBe(3);
    expect(cityTierFrom('New York', { tier1: [], tier2: [] })).toBe(3);
  });
});

describe('perHeadFrom', () => {
  it('reads the per-head rate from config by tier', () => {
    expect(perHeadFrom(1, CFG.rates)).toBe(10);
    expect(perHeadFrom(2, CFG.rates)).toBe(8);
    expect(perHeadFrom(3, CFG.rates)).toBe(6);
  });

  it('returns 0 (fail-safe) for a missing tier key', () => {
    expect(perHeadFrom(1, {})).toBe(0);
    expect(perHeadFrom(2, { '1': 10 })).toBe(0);
  });
});

describe('computeReimbursementCap', () => {
  it('uses the configured per-head rate for a tier-1 city', () => {
    // tier 1 -> $10/head; lastYear 50 dominates -> 50*10 = $500.
    const r = computeReimbursementCap(
      { cityName: 'New York', lastYearEstimatedAttendance: 50, currentRsvpCount: 10 },
      CFG,
    );
    expect(r.tier).toBe(1);
    expect(r.perHead).toBe(10);
    expect(r.expectedAttendance).toBe(50);
    expect(r.rawSuggested).toBe(500);
    expect(r.cappedSuggested).toBe(500);
  });

  it('clamps the suggestion to the configured ceiling', () => {
    // tier 1 -> $10/head; lastYear 200 -> raw $2000, clamped to $625.
    const r = computeReimbursementCap(
      { cityName: 'New York', lastYearEstimatedAttendance: 200, currentRsvpCount: 0 },
      CFG,
    );
    expect(r.rawSuggested).toBe(2000);
    expect(r.cappedSuggested).toBe(625);
  });

  it('uses expectedAttendance = max(lastYear, coefficient*rsvp)', () => {
    // lastYear 5, coefficient 0.4 * 100 rsvp = 40 -> rsvp term wins.
    const r = computeReimbursementCap(
      { cityName: 'Austin', lastYearEstimatedAttendance: 5, currentRsvpCount: 100 },
      CFG,
    );
    expect(r.tier).toBe(2);
    expect(r.perHead).toBe(8);
    expect(r.expectedAttendance).toBe(40);
    expect(r.rawSuggested).toBe(320); // 8 * 40
  });

  it('treats a null lastYear as 0 in the max()', () => {
    const r = computeReimbursementCap(
      { cityName: 'Austin', lastYearEstimatedAttendance: null, currentRsvpCount: 25 },
      CFG,
    );
    expect(r.expectedAttendance).toBe(10); // 0.4 * 25
  });

  it('is fail-safe with empty config: tier 3, $0 per-head, $0 capped', () => {
    const emptyCfg = {
      tiers: { tier1: [], tier2: [] },
      rates: { '1': 0, '2': 0, '3': 0 },
      ceilingUsd: 0,
      coefficient: 0,
    };
    const r = computeReimbursementCap(
      { cityName: 'New York', lastYearEstimatedAttendance: 500, currentRsvpCount: 500 },
      emptyCfg,
    );
    expect(r.tier).toBe(3);
    expect(r.perHead).toBe(0);
    expect(r.rawSuggested).toBe(0);
    expect(r.cappedSuggested).toBe(0);
  });
});
