import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

// Use vi.hoisted so the mocks can be referenced inside vi.mock factories.
const mockPrisma = vi.hoisted(() => ({
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  party: {
    findUnique: vi.fn(),
  },
  admin: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// ENS resolution is mocked to a pass-through so usdc_base saves don't hit the
// network. We only ever submit hex addresses in these tests.
vi.mock('../services/ens.service.js', () => ({
  resolveWalletInput: vi.fn(async (v: string) => v),
}));

// marinara-71630 P7b: control the reimbursement rules without seeding app_config.
// We return rules where mercury_card is ENABLED at the config level so the test
// proves the SAVE-path gate's isMercuryBlocked layering (via the shared
// resolvePartyReimbursementOptions helper) is what rejects it. The real,
// un-mocked isMercuryBlocked / normalizeCountry runs so normalization is tested.
const mockGetReimbursementRules = vi.hoisted(() => vi.fn());
vi.mock('../lib/privateConfig.js', () => ({
  getReimbursementRules: mockGetReimbursementRules,
}));

// Caller is always allowed to edit the party in these tests (the auth gate is
// covered elsewhere); we focus on the method-allowed enforcement.
const mockCanUserEditParty = vi.hoisted(() => vi.fn(async () => true));
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: mockCanUserEditParty,
}));

const parseAuth = (req: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
    } catch { /* ignore */ }
  }
};

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    parseAuth(req);
    if (!req.userId) {
      return _res.status(401).json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
    }
    next();
  },
  isSuperAdmin: async () => false,
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

const PARTY_ID = '00000000-0000-0000-0000-000000000001';
const USER_ID = 'user-123';
const USER_EMAIL = 'host@example.com';

// Rules with all three methods visible + enabled (no config-level disable). Any
// blocking of mercury_card must come from the endpoint's isMercuryBlocked layer.
const RULES_ALL_ENABLED = {
  methods: [
    { id: 'usdc_base', label: 'USDC on Base', kind: 'method' as const },
    { id: 'mercury_card', label: 'Mercury virtual card', kind: 'method' as const },
    { id: 'wire', label: 'Bank wire', kind: 'method' as const },
  ],
  default: ['usdc_base', 'mercury_card', 'wire'],
  countryRules: [],
};

const UPDATED_USER = {
  id: USER_ID,
  email: USER_EMAIL,
  name: 'Host',
  preferredPayoutMethod: null,
  payoutWalletAddress: null,
  payoutBankDetails: null,
};

describe('PATCH /api/user/me — payout-method gating (marinara-71630 P7b)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCanUserEditParty.mockResolvedValue(true);
    mockPrisma.user.update.mockResolvedValue(UPDATED_USER);
  });

  function patch(body: any) {
    const app = createTestApp();
    const token = makeToken(USER_ID, USER_EMAIL);
    return request(app)
      .patch('/api/user/me')
      .set('Authorization', `Bearer ${token}`)
      .send(body);
  }

  it('rejects mercury_card for a Mercury-blocked country (400 PAYOUT_METHOD_NOT_ALLOWED)', async () => {
    mockGetReimbursementRules.mockResolvedValue(RULES_ALL_ENABLED);
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'Iran', eventTags: [] });

    const res = await patch({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYOUT_METHOD_NOT_ALLOWED');
    expect(res.body.error.message).toContain('Mercury cards are unavailable');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('rejects mercury_card for a parenthetical/case country variant (normalization)', async () => {
    mockGetReimbursementRules.mockResolvedValue(RULES_ALL_ENABLED);
    // "Iran (Islamic Republic of Iran)" normalizes → "iran"; an exact-match
    // config rule would NOT catch this, but isMercuryBlocked does.
    mockPrisma.party.findUnique.mockResolvedValue({
      country: 'Iran (Islamic Republic of Iran)',
      eventTags: [],
    });

    const res = await patch({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('PAYOUT_METHOD_NOT_ALLOWED');
    expect(mockPrisma.user.update).not.toHaveBeenCalled();
  });

  it('allows an enabled method (usdc_base) for a blocked country (200)', async () => {
    mockGetReimbursementRules.mockResolvedValue(RULES_ALL_ENABLED);
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'Iran', eventTags: [] });

    const res = await patch({
      preferredPayoutMethod: 'usdc_base',
      payoutWalletAddress: '0x1111111111111111111111111111111111111111',
      partyId: PARTY_ID,
    });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('allows mercury_card for a non-blocked country (200)', async () => {
    mockGetReimbursementRules.mockResolvedValue(RULES_ALL_ENABLED);
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'United States', eventTags: [] });

    const res = await patch({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('allows a save with no partyId (legacy/global) without consulting rules (200)', async () => {
    const res = await patch({ preferredPayoutMethod: 'mercury_card' });

    expect(res.status).toBe(200);
    expect(mockGetReimbursementRules).not.toHaveBeenCalled();
    expect(mockPrisma.party.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });

  it('fails OPEN when the config is unseeded — even mercury_card in a blocked country (200)', async () => {
    // Unseeded config → empty resolved options → no rules to enforce.
    mockGetReimbursementRules.mockResolvedValue({ methods: [], default: [], countryRules: [] });
    mockPrisma.party.findUnique.mockResolvedValue({ country: 'Iran', eventTags: [] });

    const res = await patch({ preferredPayoutMethod: 'mercury_card', partyId: PARTY_ID });

    expect(res.status).toBe(200);
    expect(mockPrisma.user.update).toHaveBeenCalledTimes(1);
  });
});
