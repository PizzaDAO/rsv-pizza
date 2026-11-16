import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  nftClaim: { findMany: vi.fn(), update: vi.fn() },
  party: { findMany: vi.fn() },
  guest: { findMany: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const site = vi.hoisted(() => ({ brandedSiteForParty: vi.fn() }));
vi.mock('./siteBrand.js', () => site);

const claimLib = vi.hoisted(() => ({
  mintBudget: vi.fn(),
  executeClaimMint: vi.fn(),
  issueClaim: vi.fn(),
  loadEligibility: vi.fn(),
}));
vi.mock('./nftClaim.js', async (orig) => ({ ...(await orig<typeof import('./nftClaim.js')>()), ...claimLib }));

const email = vi.hoisted(() => ({ sendNftClaimEmail: vi.fn() }));
vi.mock('./nftClaimEmail.js', async (orig) => ({ ...(await orig<typeof import('./nftClaimEmail.js')>()), ...email }));

import { runNftClaimCron } from './nftClaimCron.js';
import { buildNftClaimEmail } from './nftClaimEmail.js';
import { ClaimError } from './nftClaim.js';

const NOW = new Date('2026-11-17T12:00:00Z');
const A = '0x' + 'a'.repeat(40);
const party = { id: 'p1', name: 'Pizza Night', eventImageUrl: 'http://img', endTime: new Date('2026-11-16T10:00:00Z'), date: null, requireApproval: false, nftEnabled: true };
const walletGuest = { id: 'g1', partyId: 'p1', name: 'Ann', email: 'ann@x.com', ethereumAddress: A, walletSource: 'manual' };
const privyGuest = { ...walletGuest, id: 'g2', email: 'bo@x.com', walletSource: 'privy-embedded' };
const noWalletGuest = { ...walletGuest, id: 'g3', email: 'cy@x.com', ethereumAddress: null, walletSource: null, checkedInAt: new Date('2026-11-16T09:00:00Z'), approved: null, nftTokenId: null };

const savedEmails = process.env.NFT_CLAIM_EMAILS;
beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.NFT_CLAIM_EMAILS;
  claimLib.mintBudget.mockResolvedValue({ cap: 50, used: 0, remaining: 50 });
  claimLib.loadEligibility.mockResolvedValue({ eligible: true });
  claimLib.issueClaim.mockResolvedValue({ claim: {}, token: null });
  claimLib.executeClaimMint.mockResolvedValue({ txHash: '0x1', tokenId: 1, alreadyMinted: false });
  site.brandedSiteForParty.mockResolvedValue(null);
  mockPrisma.nftClaim.findMany.mockResolvedValue([]);
  mockPrisma.party.findMany.mockResolvedValue([party]);
  mockPrisma.guest.findMany.mockResolvedValue([walletGuest, privyGuest, noWalletGuest]);
});
afterEach(() => {
  if (savedEmails === undefined) delete process.env.NFT_CLAIM_EMAILS;
  else process.env.NFT_CLAIM_EMAILS = savedEmails;
});

describe('runNftClaimCron', () => {
  it('is paused and does nothing when NFT_MINT_DAILY_CAP is unset', async () => {
    claimLib.mintBudget.mockResolvedValue({ cap: 0, used: 0, remaining: 0 });
    const r = await runNftClaimCron({ now: NOW });
    expect(r.paused).toBe(true);
    expect(mockPrisma.party.findMany).not.toHaveBeenCalled();
    expect(mockPrisma.nftClaim.findMany).not.toHaveBeenCalled();
    expect(claimLib.executeClaimMint).not.toHaveBeenCalled();
    expect(claimLib.issueClaim).not.toHaveBeenCalled();
  });

  it('mints directly for a manual wallet; issues claim rows for privy / no-wallet guests (no email)', async () => {
    const r = await runNftClaimCron({ now: NOW });
    expect(r).toMatchObject({ paused: false, issued: 3, minted: 1, emailed: 0 });
    expect(claimLib.issueClaim).toHaveBeenCalledWith(walletGuest, 'wallet_on_file', expect.objectContaining({ withToken: false }));
    expect(claimLib.issueClaim).toHaveBeenCalledWith(privyGuest, 'claim_link', expect.objectContaining({ withToken: false }));
    expect(claimLib.issueClaim).toHaveBeenCalledWith(noWalletGuest, 'claim_link', expect.objectContaining({ withToken: false }));
    expect(claimLib.executeClaimMint).toHaveBeenCalledTimes(1);
    expect(claimLib.executeClaimMint).toHaveBeenCalledWith('g1', A, null, undefined);
    expect(email.sendNftClaimEmail).not.toHaveBeenCalled();
  });

  it('includes pending (NULL approved) guests: the guest query uses OR, not { not: false }', async () => {
    await runNftClaimCron({ now: NOW });
    const where = mockPrisma.guest.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ approved: true }, { approved: null }]);
    expect(where).not.toHaveProperty('approved');
  });

  it('does not create a wallet_on_file row once the daily cap is used up', async () => {
    claimLib.mintBudget
      .mockResolvedValueOnce({ cap: 50, used: 0, remaining: 50 }) // paused check
      .mockResolvedValue({ cap: 50, used: 50, remaining: 0 });
    mockPrisma.guest.findMany.mockResolvedValue([walletGuest]);
    const r = await runNftClaimCron({ now: NOW });
    expect(claimLib.issueClaim).not.toHaveBeenCalled();
    expect(r.issued).toBe(0);
  });

  it('retries a stranded wallet_on_file row (issued, no recipient) with the wallet on file', async () => {
    mockPrisma.nftClaim.findMany.mockResolvedValueOnce([
      { guestId: 'g9', recipientAddress: null, guest: { ethereumAddress: A, walletSource: 'manual' } },
      { guestId: 'g8', recipientAddress: null, guest: { ethereumAddress: null, walletSource: null } },
    ]);
    mockPrisma.party.findMany.mockResolvedValue([]);
    const r = await runNftClaimCron({ now: NOW });
    expect(r.retried).toBe(1);
    expect(claimLib.executeClaimMint).toHaveBeenCalledWith('g9', A, null, undefined);
    const where = mockPrisma.nftClaim.findMany.mock.calls[0][0].where;
    expect(where.OR).toContainEqual({ status: 'issued', source: 'wallet_on_file', recipientAddress: null });
  });

  it('skips branded-series parties', async () => {
    site.brandedSiteForParty.mockResolvedValue({ url: 'https://team1.example', name: 'Team1', fromEmail: 'x' });
    const r = await runNftClaimCron({ now: NOW });
    expect(r.issued).toBe(0);
    expect(mockPrisma.guest.findMany).not.toHaveBeenCalled();
  });

  it('skips guests the eligibility check rejects', async () => {
    claimLib.loadEligibility.mockResolvedValue({ eligible: false });
    const r = await runNftClaimCron({ now: NOW });
    expect(r.issued).toBe(0);
    expect(claimLib.issueClaim).not.toHaveBeenCalled();
  });

  it('retries failed claims with their locked recipient', async () => {
    mockPrisma.nftClaim.findMany.mockResolvedValueOnce([{ guestId: 'g9', recipientAddress: A, guest: {} }]);
    mockPrisma.party.findMany.mockResolvedValue([]);
    const r = await runNftClaimCron({ now: NOW });
    expect(r.retried).toBe(1);
    expect(claimLib.executeClaimMint).toHaveBeenCalledWith('g9', A, null, undefined);
  });

  it('stops minting when the daily cap is reached mid-run', async () => {
    claimLib.executeClaimMint.mockRejectedValue(new ClaimError('cap_reached', 503, 'cap'));
    const r = await runNftClaimCron({ now: NOW });
    expect(r.minted).toBe(0);
    expect(r.issued).toBe(1); // the wallet guest got a row, then the run stopped
  });

  describe('claim emails (NFT_CLAIM_EMAILS)', () => {
    const pending = {
      guestId: 'g3',
      guest: noWalletGuest,
      party,
    };

    it('are not sent unless NFT_CLAIM_EMAILS=on', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      process.env.NFT_CLAIM_EMAILS = 'true';
      const r = await runNftClaimCron({ now: NOW });
      expect(r.emailed).toBe(0);
      expect(mockPrisma.nftClaim.findMany).toHaveBeenCalledTimes(1); // retries only, no pending-email query
      expect(email.sendNftClaimEmail).not.toHaveBeenCalled();
    });

    it('are sent (token rotated, emailSentAt recorded) when NFT_CLAIM_EMAILS=on', async () => {
      process.env.NFT_CLAIM_EMAILS = 'on';
      mockPrisma.party.findMany.mockResolvedValue([]);
      mockPrisma.nftClaim.findMany.mockResolvedValueOnce([]).mockResolvedValueOnce([pending]);
      const expires = new Date('2027-02-15T12:00:00Z');
      claimLib.issueClaim.mockResolvedValue({ claim: { tokenExpiresAt: expires }, token: 'T'.repeat(43) });
      email.sendNftClaimEmail.mockResolvedValue('resend-1');
      const r = await runNftClaimCron({ now: NOW, sleep: async () => {} });
      expect(r.emailed).toBe(1);
      expect(claimLib.issueClaim).toHaveBeenCalledWith(noWalletGuest, 'claim_link', expect.objectContaining({ withToken: true }));
      expect(email.sendNftClaimEmail).toHaveBeenCalledWith(party, { name: 'Ann', email: 'cy@x.com' }, 'T'.repeat(43), expires, undefined);
      expect(mockPrisma.nftClaim.update).toHaveBeenCalledWith({
        where: { guestId: 'g3' },
        data: { emailSentAt: NOW, emailResendId: 'resend-1' },
      });
    });
  });
});

describe('buildNftClaimEmail', () => {
  it('derives the days left from the expiry (and omits the sentence when unknown)', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const f = (exp: Date | null) => buildNftClaimEmail({ name: 'P' }, { name: 'Ann' }, 'https://claims.example.test/x', exp, now).html;
    expect(f(new Date('2027-02-15T12:00:00Z'))).toContain('claim within 90 days');
    expect(f(new Date('2027-03-17T12:00:00Z'))).toContain('claim within 120 days');
    expect(f(new Date('2026-11-17T20:00:00Z'))).toContain('claim within 1 day.');
    expect(f(null)).not.toContain('claim within');
  });

  it('escapes the party name and links to the claim URL', () => {
    const { subject, html } = buildNftClaimEmail({ name: '<b>Pizza</b>', eventImageUrl: null }, { name: 'Ann Lee' }, 'https://claims.example.test/nft/claim/abc');
    expect(subject).toContain('Claim your');
    expect(html).toContain('href="https://claims.example.test/nft/claim/abc"');
    expect(html).toContain('&lt;b&gt;Pizza&lt;/b&gt;');
    expect(html).not.toContain('<b>Pizza</b>');
    expect(html).toContain('Thanks for coming, Ann!');
  });
});
