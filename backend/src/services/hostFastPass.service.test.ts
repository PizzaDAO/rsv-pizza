import { describe, it, expect, vi, beforeEach } from 'vitest';

const prisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  payout: { findFirst: vi.fn() },
  user: { findUnique: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma }));

import { isSelfInterested } from './hostFastPass.service.js';

const party = (over: Record<string, unknown> = {}) => ({
  userId: 'host1',
  coHosts: [],
  user: { email: 'host@x.com', payoutWalletAddress: null },
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  prisma.party.findUnique.mockResolvedValue(party());
  prisma.payout.findFirst.mockResolvedValue(null);
  prisma.user.findUnique.mockResolvedValue({ payoutWalletAddress: null });
});

describe('isSelfInterested', () => {
  it('is false for an unrelated admin', async () => {
    expect(await isSelfInterested('p', 'admin1', 'admin@x.com')).toBe(false);
  });
  it('is true for the host by id or email (case/space-insensitive)', async () => {
    expect(await isSelfInterested('p', 'host1', 'a@x.com')).toBe(true);
    expect(await isSelfInterested('p', 'zzz', ' HOST@x.com ')).toBe(true);
  });
  it('is true for a co-host, tolerating junk entries and padded emails', async () => {
    prisma.party.findUnique.mockResolvedValue(
      party({ coHosts: [null, 42, { email: 7 }, { email: ' Admin@X.com ' }] }),
    );
    expect(await isSelfInterested('p', 'admin1', 'admin@x.com')).toBe(true);
  });
  it('is true when the admin is the host user of a payout on the party', async () => {
    prisma.payout.findFirst.mockResolvedValueOnce({ id: 'po1' });
    expect(await isSelfInterested('p', 'admin1', 'admin@x.com')).toBe(true);
  });
  it("is true when the admin's payout wallet is the host's or a party payout's", async () => {
    prisma.user.findUnique.mockResolvedValue({ payoutWalletAddress: '0xABC' });
    prisma.party.findUnique.mockResolvedValue(party({ user: { email: 'host@x.com', payoutWalletAddress: '0xabc' } }));
    expect(await isSelfInterested('p', 'admin1', 'admin@x.com')).toBe(true);

    prisma.party.findUnique.mockResolvedValue(party());
    prisma.payout.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 'po2' });
    expect(await isSelfInterested('p', 'admin1', 'admin@x.com')).toBe(true);
  });
  it('is false for an unknown party', async () => {
    prisma.party.findUnique.mockResolvedValue(null);
    expect(await isSelfInterested('p', 'admin1', 'admin@x.com')).toBe(false);
  });
});
