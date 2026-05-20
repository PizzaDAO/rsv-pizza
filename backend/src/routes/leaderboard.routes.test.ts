import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

const mockPrisma = vi.hoisted(() => ({
  party: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  guest: {
    groupBy: vi.fn(),
  },
  sponsorUser: {
    findMany: vi.fn(),
  },
  admin: {
    findUnique: vi.fn(),
  },
  graphicsAdmin: {
    findUnique: vi.fn(),
  },
  underbossAssignment: {
    findMany: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
        req.userId = decoded.userId;
        req.userEmail = decoded.email;
      } catch {}
    }
    if (!req.userId) {
      return res.status(401).json({ error: { message: 'Unauthorized', code: 'UNAUTHORIZED' } });
    }
    next();
  },
  isSuperAdmin: async () => false,
  isAdmin: async () => false,
  isUnderboss: async () => false,
  AuthRequest: {},
}));

// canUserEditParty: simple owner-match stub so the route's auth gate passes
// when the request user is the party owner.
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: async (partyId: string, userId?: string) => {
    return userId === 'host-user-123' || userId === 'host-user-other';
  },
  GPP_GLOBAL_EDITORS: [],
  VALID_TAB_IDS: [],
}));

import leaderboardRouter, { __testing } from './leaderboard.routes.js';
import { errorHandler } from '../middleware/error.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parties', leaderboardRouter);
  app.use(errorHandler);
  return app;
}

function makeToken(userId: string, email: string) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' });
}

const PARTY_A = '00000000-0000-0000-0000-00000000000a'; // top guest count
const PARTY_B = '00000000-0000-0000-0000-00000000000b';
const PARTY_C = '00000000-0000-0000-0000-00000000000c'; // ties with B
const PARTY_D = '00000000-0000-0000-0000-00000000000d'; // zero guests
const HOST_USER_ID = 'host-user-123';
const HOST_EMAIL = 'host@example.com';

describe('Leaderboard route — quattro-71244', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear in-memory cache between tests so we don't bleed state.
    __testing.cache.clear();
  });

  describe('GET /api/parties/:partyId/leaderboard-rank', () => {
    it('returns rank 1 for the party with the highest totalRsvps in scope', async () => {
      // Scope: gpp2026 season. 4 parties, A=10, B=5, C=5, D=0.
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_A,
        eventType: 'gpp',
        eventTags: ['gpp2026'],
      });
      mockPrisma.party.findMany.mockResolvedValue([
        { id: PARTY_A },
        { id: PARTY_B },
        { id: PARTY_C },
        { id: PARTY_D },
      ]);
      mockPrisma.guest.groupBy.mockResolvedValue([
        { partyId: PARTY_A, _count: { _all: 10 } },
        { partyId: PARTY_B, _count: { _all: 5 } },
        { partyId: PARTY_C, _count: { _all: 5 } },
        // PARTY_D omitted by groupBy (no guests) — route should still place it
      ]);

      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ rank: 1, total: 4, topPercent: 25, scope: 'gpp-season' });

      // tomato-71832: the universe query must filter by underbossStatus='approved'.
      expect(mockPrisma.party.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventType: 'gpp',
            underbossStatus: 'approved',
            eventTags: { has: 'gpp2026' },
          }),
        }),
      );
    });

    it('excludes unapproved parties from the ranking universe (tomato-71832)', async () => {
      // Mixed fixture: A is approved+top-rsvps, B is approved, C is pending
      // (should NOT be counted), D is approved+zero-rsvps. The route relies on
      // Prisma to filter by `underbossStatus: 'approved'`, so we simulate that
      // by returning only the approved parties from `findMany`.
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_A,
        eventType: 'gpp',
        eventTags: ['gpp2026'],
      });
      // Note: C is intentionally absent — Prisma would have filtered it out
      // server-side because its underbossStatus is 'pending', not 'approved'.
      mockPrisma.party.findMany.mockResolvedValue([
        { id: PARTY_A },
        { id: PARTY_B },
        { id: PARTY_D },
      ]);
      mockPrisma.guest.groupBy.mockResolvedValue([
        { partyId: PARTY_A, _count: { _all: 10 } },
        { partyId: PARTY_B, _count: { _all: 5 } },
        // D has zero guests; C would have had 99 but it's pending so excluded.
      ]);

      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // total=3 (A, B, D) — pending party C is NOT counted in the denominator.
      expect(res.body).toEqual({ rank: 1, total: 3, topPercent: 33, scope: 'gpp-season' });

      // Verify the actual Prisma where clause requested the approved filter.
      expect(mockPrisma.party.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            eventType: 'gpp',
            underbossStatus: 'approved',
          }),
        }),
      );
    });

    it('applies the approved filter on the gpp-all fallback scope too (tomato-71832)', async () => {
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_A,
        eventType: 'gpp',
        eventTags: [], // no season tag → gpp-all fallback
      });
      mockPrisma.party.findMany.mockResolvedValue([{ id: PARTY_A }, { id: PARTY_B }]);
      mockPrisma.guest.groupBy.mockResolvedValue([
        { partyId: PARTY_A, _count: { _all: 2 } },
        { partyId: PARTY_B, _count: { _all: 1 } },
      ]);

      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('gpp-all');

      // The fallback path still narrows by underbossStatus='approved'.
      const call = mockPrisma.party.findMany.mock.calls[0][0];
      expect(call.where.eventType).toBe('gpp');
      expect(call.where.underbossStatus).toBe('approved');
      // No season tag filter on gpp-all.
      expect(call.where.eventTags).toBeUndefined();
    });

    it('uses standard-competition ranking: ties share rank, next-non-tie skips slots', async () => {
      // A=10, B=5, C=5 → A rank 1, B rank 2, C rank 2, D rank 4 (rank 3 skipped).
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_D,
        eventType: 'gpp',
        eventTags: ['gpp2026'],
      });
      mockPrisma.party.findMany.mockResolvedValue([
        { id: PARTY_A },
        { id: PARTY_B },
        { id: PARTY_C },
        { id: PARTY_D },
      ]);
      mockPrisma.guest.groupBy.mockResolvedValue([
        { partyId: PARTY_A, _count: { _all: 10 } },
        { partyId: PARTY_B, _count: { _all: 5 } },
        { partyId: PARTY_C, _count: { _all: 5 } },
      ]);

      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .get(`/api/parties/${PARTY_D}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      // D has 0 guests, 3 parties strictly higher → rank 4 of 4. Tied parties
      // at rank 2 do NOT each consume a slot, so D is "rank 4 of 4" (top 100%).
      expect(res.body).toEqual({ rank: 4, total: 4, topPercent: 100, scope: 'gpp-season' });
    });

    it('rounds topPercent correctly for a mid-pack party', async () => {
      // 5 parties, B is rank 2 → topPercent = round(100 * 2 / 5) = 40.
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_B,
        eventType: 'gpp',
        eventTags: ['gpp2026'],
      });
      mockPrisma.party.findMany.mockResolvedValue([
        { id: PARTY_A },
        { id: PARTY_B },
        { id: PARTY_C },
        { id: PARTY_D },
        { id: 'e' },
      ]);
      mockPrisma.guest.groupBy.mockResolvedValue([
        { partyId: PARTY_A, _count: { _all: 100 } },
        { partyId: PARTY_B, _count: { _all: 50 } },
        { partyId: PARTY_C, _count: { _all: 10 } },
        { partyId: PARTY_D, _count: { _all: 5 } },
        { partyId: 'e', _count: { _all: 1 } },
      ]);

      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .get(`/api/parties/${PARTY_B}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ rank: 2, total: 5, topPercent: 40, scope: 'gpp-season' });
    });

    it('falls back to gpp-all scope when no season tag is present', async () => {
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_A,
        eventType: 'gpp',
        eventTags: [], // no season tag
      });
      mockPrisma.party.findMany.mockResolvedValue([{ id: PARTY_A }, { id: PARTY_B }]);
      mockPrisma.guest.groupBy.mockResolvedValue([
        { partyId: PARTY_A, _count: { _all: 3 } },
        { partyId: PARTY_B, _count: { _all: 1 } },
      ]);

      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.scope).toBe('gpp-all');
      expect(res.body.rank).toBe(1);
    });

    it('returns cached counts on the second call within the TTL', async () => {
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_A,
        eventType: 'gpp',
        eventTags: ['gpp2026'],
      });
      mockPrisma.party.findMany.mockResolvedValue([{ id: PARTY_A }, { id: PARTY_B }]);
      mockPrisma.guest.groupBy.mockResolvedValue([
        { partyId: PARTY_A, _count: { _all: 7 } },
        { partyId: PARTY_B, _count: { _all: 3 } },
      ]);

      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const first = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);
      expect(first.status).toBe(200);
      expect(first.body.rank).toBe(1);
      expect(mockPrisma.guest.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.party.findMany).toHaveBeenCalledTimes(1);

      // Second call should hit the cache — party.findUnique still runs (per-party
      // scope determination) but findMany / groupBy must NOT be re-invoked.
      const second = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);
      expect(second.status).toBe(200);
      expect(second.body.rank).toBe(1);
      expect(mockPrisma.guest.groupBy).toHaveBeenCalledTimes(1);
      expect(mockPrisma.party.findMany).toHaveBeenCalledTimes(1);
    });

    it('rejects unsupported metrics with 400', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      const res = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=walletAddresses`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 403 for users without edit access', async () => {
      const app = createTestApp();
      const token = makeToken('not-a-host', 'random@example.com');
      const res = await request(app)
        .get(`/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(403);
    });

    it('returns 401 for unauthenticated requests', async () => {
      const app = createTestApp();
      const res = await request(app).get(
        `/api/parties/${PARTY_A}/leaderboard-rank?metric=totalRsvps`,
      );
      expect(res.status).toBe(401);
    });
  });

  describe('findSeasonTag helper', () => {
    it('picks the first gpp<YYYY> tag', () => {
      expect(__testing.findSeasonTag(['gpp2026', 'go', 'partner'])).toBe('gpp2026');
      expect(__testing.findSeasonTag(['go', 'gpp2025'])).toBe('gpp2025');
    });
    it('returns undefined when no season tag is present', () => {
      expect(__testing.findSeasonTag(['go', 'partner'])).toBeUndefined();
      expect(__testing.findSeasonTag([])).toBeUndefined();
      expect(__testing.findSeasonTag(null as any)).toBeUndefined();
    });
  });
});
