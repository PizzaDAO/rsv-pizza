import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  guest: { findFirst: vi.fn(), update: vi.fn() },
  party: { findUnique: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import { mintNftOnApproval } from './mintOnApproval.js';

const guest = {
  id: 'g1', name: 'Ann', approved: true, ethereumAddress: '0x' + 'a'.repeat(40), nftTokenId: null,
};
const party = {
  id: 'p1', name: 'Party', nftEnabled: true, nftChain: 'base', eventImageUrl: 'http://img',
  date: new Date('2026-11-01T00:00:00Z'), venueName: 'V', address: 'A', customUrl: null, inviteCode: 'abc',
};

describe('mintNftOnApproval', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SUPABASE_URL = 'https://x.supabase.co';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc';
    mockPrisma.guest.findFirst.mockResolvedValue(guest);
    mockPrisma.party.findUnique.mockResolvedValue(party);
  });

  it('mints and records the token', async () => {
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ txHash: '0xabc', tokenId: '7' }) });
    const r = await mintNftOnApproval('p1', 'g1', f as any);
    expect(r.minted).toBe(true);
    expect(f).toHaveBeenCalledOnce();
    expect(mockPrisma.guest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nftTokenId: 7, nftTransactionHash: '0xabc' }) }),
    );
  });

  it.each([
    ['nft disabled', () => mockPrisma.party.findUnique.mockResolvedValue({ ...party, nftEnabled: false }), 'nft-disabled'],
    ['no address', () => mockPrisma.guest.findFirst.mockResolvedValue({ ...guest, ethereumAddress: null }), 'no-address'],
    ['already minted', () => mockPrisma.guest.findFirst.mockResolvedValue({ ...guest, nftTokenId: 3 }), 'already-minted'],
    ['not approved', () => mockPrisma.guest.findFirst.mockResolvedValue({ ...guest, approved: false }), 'not-approved'],
  ])('skips when %s', async (_n, setup, reason) => {
    setup();
    const f = vi.fn();
    const r = await mintNftOnApproval('p1', 'g1', f as any);
    expect(r).toEqual({ minted: false, reason });
    expect(f).not.toHaveBeenCalled();
  });

  it('does not throw when the mint call fails', async () => {
    const f = vi.fn().mockResolvedValue({ ok: false, statusText: 'bad', json: async () => ({ error: 'nope' }) });
    const r = await mintNftOnApproval('p1', 'g1', f as any);
    expect(r).toEqual({ minted: false, reason: 'mint-failed' });
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('does not throw when fetch rejects', async () => {
    const f = vi.fn().mockRejectedValue(new Error('net'));
    const r = await mintNftOnApproval('p1', 'g1', f as any);
    expect(r.minted).toBe(false);
  });
});
