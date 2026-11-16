import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => {
  const m: any = {
    nftClaim: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), count: vi.fn() },
    guest: { findUnique: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  };
  m.$transaction.mockImplementation((arg: unknown) => (typeof arg === 'function' ? (arg as any)(m) : Promise.all(arg as any[])));
  return m;
});
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('./siteBrand.js', () => ({ brandedSiteForParty: vi.fn(async () => null) }));

import {
  ClaimError,
  dailyMintCap,
  executeClaimMint,
  finishMint,
  findClaimByToken,
  hashClaimToken,
  isBlockedRecipient,
  isNftEligible,
  issueClaim,
  newClaimToken,
  startMint,
  usableWalletOnFile,
} from './nftClaim.js';

const NOW = new Date('2026-11-17T12:00:00Z');
const party = {
  nftEnabled: true,
  eventImageUrl: 'http://img',
  endTime: new Date('2026-11-16T20:00:00Z'),
  date: new Date('2026-11-16T17:00:00Z'),
  requireApproval: false,
};
const guest = { checkedInAt: new Date('2026-11-16T18:00:00Z'), approved: null as boolean | null, nftTokenId: null as number | null };
const ctx = { now: NOW, branded: false, duplicateMinted: false };

describe('isNftEligible', () => {
  it('accepts a checked-in guest at an ended NFT event', () => {
    expect(isNftEligible(guest, party, ctx)).toEqual({ eligible: true });
  });

  it.each([
    ['nft disabled', guest, { ...party, nftEnabled: false }, ctx, 'nft-disabled'],
    ['no flyer', guest, { ...party, eventImageUrl: null }, ctx, 'nft-disabled'],
    ['branded series', guest, party, { ...ctx, branded: true }, 'branded'],
    ['event not over', guest, { ...party, endTime: new Date('2026-11-18T00:00:00Z') }, ctx, 'not-ended'],
    ['no end/date', guest, { ...party, endTime: null, date: null }, ctx, 'not-ended'],
    ['not checked in', { ...guest, checkedInAt: null }, party, ctx, 'not-checked-in'],
    ['declined', { ...guest, approved: false }, party, ctx, 'declined'],
    ['approval required, pending', guest, { ...party, requireApproval: true }, ctx, 'not-approved'],
    ['already has a token', { ...guest, nftTokenId: 3 }, party, ctx, 'already-minted'],
    ['same email minted', guest, party, { ...ctx, duplicateMinted: true }, 'duplicate-email'],
  ])('rejects: %s', (_n, g, p, c, reason) => {
    expect(isNftEligible(g as any, p as any, c as any)).toEqual({ eligible: false, reason });
  });

  it('uses start + 6h when there is no end_time', () => {
    const p = { ...party, endTime: null, date: new Date('2026-11-17T09:00:00Z') }; // ends 15:00, after NOW
    expect(isNftEligible(guest, p, ctx).reason).toBe('not-ended');
    expect(isNftEligible(guest, { ...p, date: new Date('2026-11-17T05:00:00Z') }, ctx).eligible).toBe(true);
  });

  it('accepts an approved guest at an approval-required event', () => {
    expect(isNftEligible({ ...guest, approved: true }, { ...party, requireApproval: true }, ctx).eligible).toBe(true);
  });
});

describe('daily cap', () => {
  const saved = process.env.NFT_MINT_DAILY_CAP;
  afterEach(() => {
    if (saved === undefined) delete process.env.NFT_MINT_DAILY_CAP;
    else process.env.NFT_MINT_DAILY_CAP = saved;
  });

  it('is 0 when unset, empty or invalid', () => {
    delete process.env.NFT_MINT_DAILY_CAP;
    expect(dailyMintCap()).toBe(0);
    process.env.NFT_MINT_DAILY_CAP = '';
    expect(dailyMintCap()).toBe(0);
    process.env.NFT_MINT_DAILY_CAP = 'abc';
    expect(dailyMintCap()).toBe(0);
    process.env.NFT_MINT_DAILY_CAP = '-5';
    expect(dailyMintCap()).toBe(0);
    process.env.NFT_MINT_DAILY_CAP = '25';
    expect(dailyMintCap()).toBe(25);
  });

  it('executeClaimMint is paused when the cap is unset (no DB writes, no mint)', async () => {
    delete process.env.NFT_MINT_DAILY_CAP;
    const f = vi.fn();
    await expect(executeClaimMint('g1', '0x' + 'a'.repeat(40), null, f as any)).rejects.toMatchObject({ code: 'paused', http: 503 });
    expect(f).not.toHaveBeenCalled();
    expect(mockPrisma.nftClaim.updateMany).not.toHaveBeenCalled();
  });

  it('executeClaimMint says cap_reached when the day is used up', async () => {
    process.env.NFT_MINT_DAILY_CAP = '2';
    mockPrisma.nftClaim.count.mockResolvedValue(2);
    await expect(executeClaimMint('g1', '0x' + 'a'.repeat(40), null)).rejects.toMatchObject({ code: 'cap_reached' });
  });
});

describe('claim tokens', () => {
  beforeEach(() => vi.clearAllMocks());

  it('generates 43-char base64url tokens and hashes them to sha256 hex', () => {
    const t = newClaimToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashClaimToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashClaimToken(t)).not.toContain(t);
    expect(newClaimToken()).not.toBe(t);
  });

  it('findClaimByToken rejects malformed tokens without touching the DB', async () => {
    expect(await findClaimByToken('nope')).toBeNull();
    expect(mockPrisma.nftClaim.findUnique).not.toHaveBeenCalled();
  });

  it('findClaimByToken: unknown, revoked and expired are all null; minted survives expiry', async () => {
    const t = newClaimToken();
    mockPrisma.nftClaim.findUnique.mockResolvedValueOnce(null);
    expect(await findClaimByToken(t, NOW)).toBeNull();
    mockPrisma.nftClaim.findUnique.mockResolvedValueOnce({ status: 'revoked', tokenExpiresAt: new Date('2027-01-01') });
    expect(await findClaimByToken(t, NOW)).toBeNull();
    mockPrisma.nftClaim.findUnique.mockResolvedValueOnce({ status: 'issued', tokenExpiresAt: new Date('2026-11-01') });
    expect(await findClaimByToken(t, NOW)).toBeNull();
    mockPrisma.nftClaim.findUnique.mockResolvedValueOnce({ status: 'issued', tokenExpiresAt: new Date('2027-01-01') });
    expect(await findClaimByToken(t, NOW)).not.toBeNull();
    mockPrisma.nftClaim.findUnique.mockResolvedValueOnce({ status: 'minted', tokenExpiresAt: new Date('2026-11-01') });
    expect(await findClaimByToken(t, NOW)).not.toBeNull();
    expect(mockPrisma.nftClaim.findUnique).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { tokenHash: hashClaimToken(t) } }),
    );
  });

  it('issueClaim stores only the hash, with a 90-day expiry; leaves minted rows alone', async () => {
    mockPrisma.nftClaim.findUnique.mockResolvedValueOnce(null);
    mockPrisma.nftClaim.create.mockImplementation(async ({ data }: any) => data);
    const { token } = await issueClaim({ id: 'g1', partyId: 'p1' }, 'claim_link', { withToken: true, now: NOW });
    const data = mockPrisma.nftClaim.create.mock.calls[0][0].data;
    expect(data.tokenHash).toBe(hashClaimToken(token!));
    expect(JSON.stringify(data)).not.toContain(token!);
    expect(data.tokenExpiresAt.getTime() - NOW.getTime()).toBe(90 * 24 * 60 * 60 * 1000);

    mockPrisma.nftClaim.findUnique.mockResolvedValueOnce({ status: 'minted' });
    const again = await issueClaim({ id: 'g1', partyId: 'p1' }, 'claim_link', { withToken: true, now: NOW });
    expect(again.token).toBeNull();
    expect(mockPrisma.nftClaim.update).not.toHaveBeenCalled();
  });
});

describe('startMint (the lock)', () => {
  const addr = '0x' + 'b'.repeat(40);
  beforeEach(() => vi.clearAllMocks());

  it('409s when the lock is not won (already minting, or locked to another address)', async () => {
    mockPrisma.nftClaim.updateMany.mockResolvedValue({ count: 0 });
    await expect(startMint('g1', addr, null)).rejects.toMatchObject({ code: 'conflict', http: 409 });
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });

  it('locks to the recipient only from null/same address, and only for issued/failed/stale rows', async () => {
    mockPrisma.nftClaim.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.guest.findUnique.mockResolvedValue({ ethereumAddress: null });
    await startMint('g1', addr, 'name.eth', NOW);
    const arg = mockPrisma.nftClaim.updateMany.mock.calls[0][0];
    expect(arg.where.AND[1]).toEqual({ OR: [{ recipientAddress: null }, { recipientAddress: addr }] });
    expect(arg.where.attempts).toEqual({ lt: 5 });
    expect(arg.where.AND[0].OR[0]).toEqual({ status: { in: ['issued', 'failed'] } });
    expect(arg.data).toMatchObject({ status: 'minting', recipientAddress: addr, recipientInput: 'name.eth', attempts: { increment: 1 } });
  });

  it('writes the claimed address to the guest and remembers the previous one', async () => {
    mockPrisma.nftClaim.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.guest.findUnique.mockResolvedValue({ ethereumAddress: '0xPRIVY' });
    await startMint('g1', addr, null);
    expect(mockPrisma.nftClaim.update).toHaveBeenCalledWith({ where: { guestId: 'g1' }, data: { previousAddress: '0xprivy' } });
    expect(mockPrisma.guest.update).toHaveBeenCalledWith({
      where: { id: 'g1' },
      data: { ethereumAddress: addr, walletSource: 'claim' },
    });
  });

  it('leaves the guest alone when the recipient is already their wallet', async () => {
    mockPrisma.nftClaim.updateMany.mockResolvedValue({ count: 1 });
    mockPrisma.guest.findUnique.mockResolvedValue({ ethereumAddress: addr.toUpperCase().replace('0X', '0x') });
    await startMint('g1', addr, null);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });
});

describe('finishMint', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records tx + token on the claim and the guest', async () => {
    expect(await finishMint('g1', { ok: true, status: 200, txHash: '0xabc', tokenId: 7 }, NOW)).toBe(true);
    expect(mockPrisma.nftClaim.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'minted', txHash: '0xabc', tokenId: 7 }) }),
    );
    expect(mockPrisma.guest.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ nftTokenId: 7, nftTransactionHash: '0xabc' }) }),
    );
  });

  it('treats alreadyMinted (no tx hash) as success', async () => {
    expect(await finishMint('g1', { ok: true, status: 200, alreadyMinted: true, tokenId: 4 }, NOW)).toBe(true);
    const data = mockPrisma.guest.update.mock.calls[0][0].data;
    expect(data.nftTokenId).toBe(4);
    expect(data).not.toHaveProperty('nftTransactionHash');
  });

  it('marks the claim failed with the (truncated) error', async () => {
    expect(await finishMint('g1', { ok: false, status: 500, error: 'x'.repeat(900) })).toBe(false);
    const data = mockPrisma.nftClaim.update.mock.calls[0][0].data;
    expect(data.status).toBe('failed');
    expect(data.lastError).toHaveLength(500);
    expect(mockPrisma.guest.update).not.toHaveBeenCalled();
  });
});

describe('recipient + wallet helpers', () => {
  it('blocks zero, dead and env-listed addresses', () => {
    process.env.NFT_CLAIM_BLOCKED_ADDRESSES = '0x' + 'c'.repeat(40);
    expect(isBlockedRecipient('0x' + '0'.repeat(40))).toBe(true);
    expect(isBlockedRecipient('0x000000000000000000000000000000000000dEaD')).toBe(true);
    expect(isBlockedRecipient('0x' + 'C'.repeat(40))).toBe(true);
    expect(isBlockedRecipient('0x' + 'd'.repeat(40))).toBe(false);
    delete process.env.NFT_CLAIM_BLOCKED_ADDRESSES;
  });

  it('usableWalletOnFile: manual 0x yes; privy, ENS, empty no', () => {
    const a = '0x' + 'A'.repeat(40);
    expect(usableWalletOnFile({ ethereumAddress: a, walletSource: 'manual' })).toBe(a.toLowerCase());
    expect(usableWalletOnFile({ ethereumAddress: a, walletSource: null })).toBe(a.toLowerCase());
    expect(usableWalletOnFile({ ethereumAddress: a, walletSource: 'privy-embedded' })).toBeNull();
    expect(usableWalletOnFile({ ethereumAddress: 'vitalik.eth', walletSource: 'manual' })).toBeNull();
    expect(usableWalletOnFile({ ethereumAddress: null, walletSource: null })).toBeNull();
  });
});

describe('ClaimError', () => {
  it('carries code and http status', () => {
    const e = new ClaimError('paused', 503, 'x');
    expect(e).toBeInstanceOf(Error);
    expect([e.code, e.http]).toEqual(['paused', 503]);
  });
});
