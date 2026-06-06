import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

// marinara-71630 P7: cover the PATCH /api/user/me payout-method SAVE guard.
// The GET /reimbursement-options endpoint DECIDES which methods a host may use;
// this test proves the SAVE path now hard-rejects a disallowed method (e.g.
// mercury_card for a Mercury-blocked country) with a 400, while leaving every
// legitimate save (an allowed method, or no partyId) untouched.

const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  party: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// ENS resolution is exercised only for usdc_base; stub it so wire/mercury saves
// don't touch the network. Returns the input unchanged when it looks like 0x.
vi.mock('../services/ens.service.js', () => ({
  resolveWalletInput: vi.fn(async (input: string) => input),
}));

// Control the per-party edit gate directly (auth logic is orthogonal to the
// payout-method enforcement under test).
const mockCanUserEditParty = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: mockCanUserEditParty,
}));

// Drive the config resolver deterministically. We return rules where
// mercury_card is visible + enabled at the config level (no country rule
// disables it) so the test proves the code-side isMercuryBlocked layering
// inside resolvePartyReimbursementOptions is what rejects the save. The real
// (un-mocked) resolveReimbursementOptions + isMercuryBlocked run.
const mockGetReimbursementRules = vi.hoisted(() => vi.fn());
vi.mock('../lib/privateConfig.js', () => ({
  getReimbursementRules: mockGetReimbursementRules,
}));

const parseAuth = (req: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
    } catch {
      /* ignore */
    }
  }
};

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    parseAuth(req);
    if (!req.userId) {
      return res.status(401).json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
    }
    next();
  },
  AuthRequest: {},
}));

import userRoutes from './user.routes.js';
import { errorHandler } from '../middleware/error.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/user', userRoutes);
  app.use(errorHandler);
  return app;
}

function makeToken(userId: string, email: string) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' });
}

const USER_ID = 'host-user-123';
const EMAIL = 'host@example.com';
const PARTY_ID = '00000000-0000-0000-0000-000000000001';

const RULES_MERCURY_ENABLED = {
  methods: [
    { id: 'usdc_base', label: 'USDC on Base', kind: 'method' as const },
    { id: 'mercury_card', label: 'Mercury virtual card', kind: 'method' as const },
    { id: 'wire', label: 'Bank wire', kind: 'method' as const },
  ],
  default: ['usdc_base', 'mercury_card', 'wire'],
  countryRules: [],
};

describe('PATCH /api/user/me - payout method save guard (marinara-71630 P7)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanUserEditParty.mockResolvedValue(true);
    mockGetReimbursementRules.mockResolvedValue(RULES_MERCURY_ENABLED);
    mockPrisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      name: null,
      defaultAddress: null,
      preferredPayoutMethod: null,
      payoutWalletAddress: null,
      payoutBankDetails: null,
    });
  });

  it('rejects mercury_card for a Mercury-blocked country with 400', async () => {
    const app = createTestApp();
    const token = makeToken(USER_ID, EMAIL);
    // The party is in a Mercury-blocked country (Iran). resolvePartyReimbursementOptions
    // layers isMercuryBlocked → mercury_card resolves enabled:false.
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'Iran', eventTags: [] });

    const res = await request(app)
      .patch('/api/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYOUT_METHOD_NOT_ALLOWED');
    // The save must NOT have persisted.
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects a parenthetical/cased variant of a blocked country (normalization)', async () => {
    const app = createTestApp();
    const token = makeToken(USER_ID, EMAIL);
    // Exact-match config wouldn't catch this; isMercuryBlocked normalizes it.
    mockPrisma.party.findUnique.mockResolvedValue({
      country: 'Iran (Islamic Republic of Iran)',
      eventTags: [],
    });

    const res = await request(app)
      .patch('/api/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYOUT_METHOD_NOT_ALLOWED');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('allows mercury_card for a non-blocked country (normal save → 200)', async () => {
    const app = createTestApp();
    const token = makeToken(USER_ID, EMAIL);
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'United States', eventTags: [] });
    mockPrisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      name: null,
      defaultAddress: null,
      preferredPayoutMethod: 'mercury_card',
      payoutWalletAddress: null,
      payoutBankDetails: null,
    });

    const res = await request(app)
      .patch('/api/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(200);
    expect(res.body.user.preferredPayoutMethod).toBe('mercury_card');
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it('allows an allowed method (usdc_base) for any country (200)', async () => {
    const app = createTestApp();
    const token = makeToken(USER_ID, EMAIL);
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'Iran', eventTags: [] });
    mockPrisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      name: null,
      defaultAddress: null,
      preferredPayoutMethod: 'usdc_base',
      payoutWalletAddress: '0x1111111111111111111111111111111111111111',
      payoutBankDetails: null,
    });

    const res = await request(app)
      .patch('/api/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send({
        preferredPayoutMethod: 'usdc_base',
        payoutWalletAddress: '0x1111111111111111111111111111111111111111',
        partyId: PARTY_ID,
      });

    expect(res.status).toBe(200);
    expect(res.body.user.preferredPayoutMethod).toBe('usdc_base');
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it('skips the gate (legacy save) when no partyId is supplied → 200', async () => {
    const app = createTestApp();
    const token = makeToken(USER_ID, EMAIL);
    mockPrisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      name: null,
      defaultAddress: null,
      preferredPayoutMethod: 'mercury_card',
      payoutWalletAddress: null,
      payoutBankDetails: null,
    });

    const res = await request(app)
      .patch('/api/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredPayoutMethod: 'mercury_card' });

    expect(res.status).toBe(200);
    // No party lookup or gate when partyId is absent.
    expect(mockPrisma.party.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });

  it('fails open when config is unseeded (resolver returns []) → 200', async () => {
    const app = createTestApp();
    const token = makeToken(USER_ID, EMAIL);
    // Empty rules → resolvePartyReimbursementOptions returns [] → gate is skipped.
    mockGetReimbursementRules.mockResolvedValue({ methods: [], default: [], countryRules: [] });
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'Iran', eventTags: [] });
    mockPrisma.user.update.mockResolvedValue({
      id: USER_ID,
      email: EMAIL,
      name: null,
      defaultAddress: null,
      preferredPayoutMethod: 'mercury_card',
      payoutWalletAddress: null,
      payoutBankDetails: null,
    });

    const res = await request(app)
      .patch('/api/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalled();
  });
});
