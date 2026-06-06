import { describe, it, expect, vi, beforeEach } from 'vitest';

// marinara-71630 P2: cover the payout-cap loader's read + fail-safe fallback.
// We mock the prisma client so the loader's DB read is deterministic.
const mockPrisma = vi.hoisted(() => ({
  appConfig: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import {
  getPayoutCaps,
  getCityTiers,
  getReimbursementTiers,
  getReimbursementCapBands,
  getSponsorshipPricing,
  getGppGlobalEditors,
  getOperationalLimits,
  invalidateAll,
  PRIVATE_CONFIG_KEYS,
} from './privateConfig.js';

describe('getPayoutCaps', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAll(); // 60s cache would otherwise leak between cases
  });

  it('returns the seeded config values when an app_config row is present', async () => {
    const seeded = {
      perSubmissionMaxUsd: 675,
      perAddressHardCapUsd: 676,
      perTxCapUsd: 200,
      dailyCapUsd: 2000,
      w9ThresholdUsd: 600,
      hardPerTxCeilingUsd: 675,
    };
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify(seeded) });

    const caps = await getPayoutCaps();

    expect(caps).toEqual(seeded);
    expect(mockPrisma.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: PRIVATE_CONFIG_KEYS.payoutCaps },
    });
  });

  it('returns the fail-safe LOW fallback when the row is absent', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);

    const caps = await getPayoutCaps();

    // Fallback must be present, non-zero, and LOW — every value well under the
    // real production caps so a missing row caps payouts low (safe), never high.
    for (const v of Object.values(caps)) {
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(200);
    }
    // Ordering invariant the consumers rely on: per-address / hard ceiling are
    // not below the per-tx / per-submission caps.
    expect(caps.perAddressHardCapUsd).toBeGreaterThanOrEqual(caps.hardPerTxCeilingUsd);
    expect(caps.hardPerTxCeilingUsd).toBeGreaterThanOrEqual(caps.perTxCapUsd);
    expect(caps.hardPerTxCeilingUsd).toBeGreaterThanOrEqual(caps.perSubmissionMaxUsd);
  });

  it('falls back (never throws) when the DB read fails', async () => {
    mockPrisma.appConfig.findUnique.mockRejectedValue(new Error('db down'));

    const caps = await getPayoutCaps();

    expect(caps.perTxCapUsd).toBeGreaterThan(0);
    expect(caps.hardPerTxCeilingUsd).toBeGreaterThan(0);
  });

  it('falls back when the stored value is not valid JSON', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: 'not-json{' });

    const caps = await getPayoutCaps();

    expect(caps.perTxCapUsd).toBeGreaterThan(0);
  });
});

// marinara-71630 P5: city tiers + reimbursement tiers + sponsorship pricing
// accessors. Cover read-through and the SAFE (not just present) fallbacks.
describe('getCityTiers / getReimbursementTiers / getSponsorshipPricing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAll();
  });

  it('reads city tiers from app_config when present', async () => {
    const seeded = { tier1: ['new york'], tier2: ['austin'] };
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify(seeded) });

    const tiers = await getCityTiers();

    expect(tiers).toEqual(seeded);
    expect(mockPrisma.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: PRIVATE_CONFIG_KEYS.cityTiers },
    });
  });

  it('city tiers fall back to EMPTY lists (everything -> tier 3) when absent', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);
    expect(await getCityTiers()).toEqual({ tier1: [], tier2: [] });
  });

  it('reads reimbursement tiers from app_config when present', async () => {
    const seeded = {
      perHeadRates: { '1': 10, '2': 8, '3': 6 },
      ceilingUsd: 625,
      attendanceRsvpCoefficient: 0.4,
    };
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify(seeded) });

    const reimb = await getReimbursementTiers();

    expect(reimb).toEqual(seeded);
    expect(mockPrisma.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: PRIVATE_CONFIG_KEYS.reimbursementTiers },
    });
  });

  it('reimbursement tiers fall back to ALL-ZERO ($0 suggestion) when absent', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);
    const reimb = await getReimbursementTiers();
    expect(reimb.ceilingUsd).toBe(0);
    expect(reimb.attendanceRsvpCoefficient).toBe(0);
    for (const v of Object.values(reimb.perHeadRates)) expect(v).toBe(0);
  });

  it('sponsorship pricing fall back has a NON-ZERO roundTo (no divide-by-zero)', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);
    const pricing = await getSponsorshipPricing();
    expect(pricing.tierConfig).toEqual({});
    expect(pricing.base).toBe(0);
    expect(pricing.roundTo).toBeGreaterThan(0);
  });

  it('reads reimbursement cap bands from app_config when present', async () => {
    const seeded = {
      bands: {
        '1': { guestFloor: 25, guestCeiling: 150, minUsd: 100, maxUsd: 625 },
        '2': { guestFloor: 25, guestCeiling: 100, minUsd: 75, maxUsd: 400 },
        '3': { guestFloor: 35, guestCeiling: 150, minUsd: 50, maxUsd: 300 },
      },
      roundingIncrementUsd: 25,
    };
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify(seeded) });

    const cap = await getReimbursementCapBands();

    expect(cap).toEqual(seeded);
    expect(mockPrisma.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: PRIVATE_CONFIG_KEYS.reimbursementCapBands },
    });
  });

  it('reimbursement cap bands fall back to EMPTY bands (no suggestion) + non-zero increment', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);
    const cap = await getReimbursementCapBands();
    // Empty bands → the frontend util surfaces NO suggestion (not $0).
    expect(cap.bands).toEqual({});
    // Increment is the original 25 and must be non-zero (it's a divisor).
    expect(cap.roundingIncrementUsd).toBe(25);
  });
});

// marinara-71630 P6: GPP global-editor allowlist accessor. Cover read-through
// and the SAFE (empty = no one) fallback.
describe('getGppGlobalEditors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAll();
  });

  it('reads the allowlist from app_config when present', async () => {
    const seeded = ['editor@example.com', 'someone@example.com'];
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify(seeded) });

    const editors = await getGppGlobalEditors();

    expect(editors).toEqual(seeded);
    expect(mockPrisma.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: PRIVATE_CONFIG_KEYS.gppGlobalEditors },
    });
  });

  it('falls back to an EMPTY list (no one gets global-editor rights) when absent', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);
    expect(await getGppGlobalEditors()).toEqual([]);
  });

  it('falls back to [] (never throws) when the DB read fails', async () => {
    mockPrisma.appConfig.findUnique.mockRejectedValue(new Error('db down'));
    expect(await getGppGlobalEditors()).toEqual([]);
  });

  it('falls back to [] when the stored value is not valid JSON', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: 'not-json[' });
    expect(await getGppGlobalEditors()).toEqual([]);
  });
});

// marinara-71630 P8: operational quota limits accessor. NON-SECRET — the
// fallback IS the current real value (2000 / 30), so behavior is identical
// with or without a row; the row only lets the team override without a deploy.
describe('getOperationalLimits', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    invalidateAll();
  });

  it('returns the seeded config values when an app_config row is present', async () => {
    const seeded = { importHardCap: 5000, photoPerUserPerEvent: 50 };
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify(seeded) });

    const limits = await getOperationalLimits();

    expect(limits).toEqual(seeded);
    expect(mockPrisma.appConfig.findUnique).toHaveBeenCalledWith({
      where: { key: PRIVATE_CONFIG_KEYS.operationalLimits },
    });
  });

  it('falls back to the CURRENT real values (2000 / 30) when the row is absent', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);
    expect(await getOperationalLimits()).toEqual({
      importHardCap: 2000,
      photoPerUserPerEvent: 30,
    });
  });

  it('falls back to current values (never throws) when the DB read fails', async () => {
    mockPrisma.appConfig.findUnique.mockRejectedValue(new Error('db down'));
    expect(await getOperationalLimits()).toEqual({
      importHardCap: 2000,
      photoPerUserPerEvent: 30,
    });
  });

  it('falls back to current values when the stored value is not valid JSON', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: 'not-json{' });
    expect(await getOperationalLimits()).toEqual({
      importHardCap: 2000,
      photoPerUserPerEvent: 30,
    });
  });
});
