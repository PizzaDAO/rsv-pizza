import { describe, it, expect, vi, beforeEach } from 'vitest';

// marinara-71630 P2: cover the payout-cap loader's read + fail-safe fallback.
// We mock the prisma client so the loader's DB read is deterministic.
const mockPrisma = vi.hoisted(() => ({
  appConfig: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import { getPayoutCaps, invalidateAll, PRIVATE_CONFIG_KEYS } from './privateConfig.js';

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
