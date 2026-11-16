import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';

process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret-nft-claim';

const mockPrisma = vi.hoisted(() => ({ guest: { findUnique: vi.fn() } }));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// The in-memory express limiter is shared across the whole file; the durable store is what we assert on.
vi.mock('express-rate-limit', () => ({ rateLimit: () => (_req: unknown, _res: unknown, next: () => void) => next() }));

const store = vi.hoisted(() => ({ reserve: vi.fn() }));
vi.mock('../lib/authRateLimit.js', async (orig) => ({
  ...(await orig<typeof import('../lib/authRateLimit.js')>()),
  prismaRateStore: () => store,
}));

const ens = vi.hoisted(() => ({ resolveWalletInputWithMeta: vi.fn() }));
vi.mock('../services/ens.service.js', () => ens);

const claimLib = vi.hoisted(() => ({
  findClaimByToken: vi.fn(),
  mintBudget: vi.fn(),
  executeClaimMint: vi.fn(),
  issueClaim: vi.fn(),
  loadEligibility: vi.fn(),
}));
vi.mock('../lib/nftClaim.js', async (orig) => ({ ...(await orig<typeof import('../lib/nftClaim.js')>()), ...claimLib }));

const cron = vi.hoisted(() => ({ runNftClaimCron: vi.fn() }));
vi.mock('../lib/nftClaimCron.js', () => cron);

import { nftClaimRouter, nftClaimCronRouter } from './nftClaim.routes.js';
import { ClaimError } from '../lib/nftClaim.js';
import { signGuestToken } from '../lib/guestToken.js';
import { errorHandler } from '../middleware/error.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/nft/claim', nftClaimRouter);
  a.use('/api/cron', nftClaimCronRouter);
  a.use(errorHandler);
  return a;
}

const TOKEN = 'A'.repeat(43);
const ADDR = '0x' + 'a'.repeat(40);
const claim = {
  guestId: 'g1',
  status: 'issued',
  txHash: null,
  recipientAddress: null,
  tokenExpiresAt: new Date('2027-01-01'),
  party: { name: 'Pizza Night', eventImageUrl: 'http://img', nftChain: 'base' },
  guest: { id: 'g1', email: 'secret@example.com', name: 'Ann' },
};
const OPEN_BUDGET = { cap: 100, used: 0, remaining: 100 };

beforeEach(() => {
  vi.clearAllMocks();
  claimLib.mintBudget.mockResolvedValue(OPEN_BUDGET);
  store.reserve.mockResolvedValue({ counts: [0], ids: ['1'], retryAfterMs: [null] });
  ens.resolveWalletInputWithMeta.mockImplementation(async (s: string) => ({
    address: s.startsWith('0x') ? s : ADDR,
    input: s,
    wasEns: !s.startsWith('0x'),
  }));
});

describe('GET /api/nft/claim/:token', () => {
  it('404s uniformly for unknown / expired / malformed tokens', async () => {
    claimLib.findClaimByToken.mockResolvedValue(null);
    const a = await request(app()).get(`/api/nft/claim/${TOKEN}`);
    const b = await request(app()).get('/api/nft/claim/short');
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.body).toEqual(b.body);
  });

  it('returns the claim page data and never the email or guest id', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    const res = await request(app()).get(`/api/nft/claim/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ partyName: 'Pizza Night', chain: 'base', status: 'issued', paused: false });
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('secret@example.com');
    expect(text).not.toContain('g1');
    expect(text).not.toContain('guestId');
  });

  it('reports paused when NFT_MINT_DAILY_CAP is unset', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    claimLib.mintBudget.mockResolvedValue({ cap: 0, used: 0, remaining: 0 });
    const res = await request(app()).get(`/api/nft/claim/${TOKEN}`);
    expect(res.body.paused).toBe(true);
  });
});

describe('POST /api/nft/claim/:token', () => {
  it('503 paused with a clear status when minting is off (no mint, no rate budget burned)', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    claimLib.mintBudget.mockResolvedValue({ cap: 0, used: 0, remaining: 0 });
    const res = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: ADDR });
    expect(res.status).toBe(503);
    expect(res.body.status).toBe('paused');
    expect(claimLib.executeClaimMint).not.toHaveBeenCalled();
    expect(store.reserve).not.toHaveBeenCalled();
  });

  it('503 cap_reached when the day is used up', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    claimLib.mintBudget.mockResolvedValue({ cap: 5, used: 5, remaining: 0 });
    const res = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: ADDR });
    expect([res.status, res.body.status]).toEqual([503, 'cap_reached']);
  });

  it('404s an unknown token', async () => {
    claimLib.findClaimByToken.mockResolvedValue(null);
    const res = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: ADDR });
    expect(res.status).toBe(404);
  });

  it('mints to a pasted address', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    claimLib.executeClaimMint.mockResolvedValue({ txHash: '0xabc', tokenId: 1, alreadyMinted: false });
    const res = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: ADDR });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'minted', txHash: '0xabc', explorerUrl: 'https://basescan.org/tx/0xabc' });
    expect(claimLib.executeClaimMint).toHaveBeenCalledWith('g1', ADDR, null);
  });

  it('resolves ENS and passes the typed name along', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    claimLib.executeClaimMint.mockResolvedValue({ txHash: '0xabc', tokenId: 1, alreadyMinted: false });
    await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: 'alice.eth' });
    expect(claimLib.executeClaimMint).toHaveBeenCalledWith('g1', ADDR, 'alice.eth');
  });

  it('400s a bad address and the zero address', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    ens.resolveWalletInputWithMeta.mockRejectedValueOnce(new Error('bad'));
    const bad = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: 'nonsense' });
    expect([bad.status, bad.body.status]).toEqual([400, 'invalid_address']);
    const zero = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: '0x' + '0'.repeat(40) });
    expect(zero.status).toBe(400);
    expect(claimLib.executeClaimMint).not.toHaveBeenCalled();
  });

  it('429s when the durable per-IP budget is spent; 503 when the store is down', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    store.reserve.mockResolvedValueOnce({ counts: [10], ids: null, retryAfterMs: [1000] });
    const limited = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: ADDR });
    expect(limited.status).toBe(429);
    store.reserve.mockRejectedValueOnce(new Error('db down'));
    const down = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: ADDR });
    expect(down.status).toBe(503);
    expect(claimLib.executeClaimMint).not.toHaveBeenCalled();
  });

  it('maps a lock conflict to 409', async () => {
    claimLib.findClaimByToken.mockResolvedValue(claim);
    claimLib.executeClaimMint.mockRejectedValue(new ClaimError('conflict', 409, 'locked'));
    const res = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: ADDR });
    expect([res.status, res.body.status]).toEqual([409, 'conflict']);
  });

  it('is single use: a minted token only reads back the result', async () => {
    claimLib.findClaimByToken.mockResolvedValue({ ...claim, status: 'minted', txHash: '0xabc', recipientAddress: ADDR });
    const res = await request(app()).post(`/api/nft/claim/${TOKEN}`).send({ address: '0x' + 'b'.repeat(40) });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ status: 'minted', txHash: '0xabc' });
    expect(claimLib.executeClaimMint).not.toHaveBeenCalled();
  });
});

describe('POST /api/nft/claim/guest/:guestId', () => {
  const GUEST_ID = '11111111-1111-4111-8111-111111111111';
  const guest = { id: GUEST_ID, email: 'ann@example.com' };
  const eligible = { eligible: true, claim: null, party: { nftChain: 'base' } };

  it('404s a caller who does not own the guest (no token, wrong token)', async () => {
    mockPrisma.guest.findUnique.mockResolvedValue(guest);
    const none = await request(app()).post(`/api/nft/claim/guest/${GUEST_ID}`).send({ address: ADDR });
    const wrong = await request(app())
      .post(`/api/nft/claim/guest/${GUEST_ID}`)
      .set('X-Guest-Token', 'nope')
      .send({ address: ADDR });
    expect(none.status).toBe(404);
    expect(wrong.status).toBe(404);
    expect(claimLib.executeClaimMint).not.toHaveBeenCalled();
  });

  it('404s a malformed guest id', async () => {
    const res = await request(app()).post('/api/nft/claim/guest/not-a-uuid').send({ address: ADDR });
    expect(res.status).toBe(404);
  });

  it('lets the guest-token holder claim', async () => {
    mockPrisma.guest.findUnique.mockResolvedValue(guest);
    claimLib.loadEligibility.mockResolvedValue(eligible);
    claimLib.executeClaimMint.mockResolvedValue({ txHash: '0xabc', tokenId: 2, alreadyMinted: false });
    const res = await request(app())
      .post(`/api/nft/claim/guest/${GUEST_ID}`)
      .set('X-Guest-Token', signGuestToken(GUEST_ID))
      .send({ address: ADDR });
    expect(res.status).toBe(200);
    expect(claimLib.issueClaim).toHaveBeenCalledWith(guest, 'logged_in', { withToken: false });
    expect(claimLib.executeClaimMint).toHaveBeenCalledWith(GUEST_ID, ADDR, null);
  });

  it('creates no claim row while minting is paused', async () => {
    mockPrisma.guest.findUnique.mockResolvedValue(guest);
    claimLib.loadEligibility.mockResolvedValue(eligible);
    claimLib.mintBudget.mockResolvedValue({ cap: 0, used: 0, remaining: 0 });
    const res = await request(app())
      .post(`/api/nft/claim/guest/${GUEST_ID}`)
      .set('X-Guest-Token', signGuestToken(GUEST_ID))
      .send({ address: ADDR });
    expect([res.status, res.body.status]).toEqual([503, 'paused']);
    expect(claimLib.issueClaim).not.toHaveBeenCalled();
  });

  it('403s an ineligible guest', async () => {
    mockPrisma.guest.findUnique.mockResolvedValue(guest);
    claimLib.loadEligibility.mockResolvedValue({ ...eligible, eligible: false });
    const res = await request(app())
      .post(`/api/nft/claim/guest/${GUEST_ID}`)
      .set('X-Guest-Token', signGuestToken(GUEST_ID))
      .send({ address: ADDR });
    expect(res.status).toBe(403);
  });
});

describe('cron /api/cron/nft-claims', () => {
  const saved = process.env.CRON_SECRET;
  afterAll(() => {
    if (saved === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = saved;
  });

  it('401s without the secret, and when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    expect((await request(app()).post('/api/cron/nft-claims')).status).toBe(401);
    process.env.CRON_SECRET = 'shh';
    expect((await request(app()).post('/api/cron/nft-claims').set('Authorization', 'Bearer wrong')).status).toBe(401);
    expect(cron.runNftClaimCron).not.toHaveBeenCalled();
  });

  it('runs on GET (Vercel cron) and POST with the secret, returning the paused state', async () => {
    process.env.CRON_SECRET = 'shh';
    cron.runNftClaimCron.mockResolvedValue({ paused: true, minted: 0 });
    const get = await request(app()).get('/api/cron/nft-claims').set('Authorization', 'Bearer shh');
    const post = await request(app()).post('/api/cron/nft-claims').set('Authorization', 'Bearer shh');
    expect([get.status, post.status]).toEqual([200, 200]);
    expect(get.body.paused).toBe(true);
  });
});
