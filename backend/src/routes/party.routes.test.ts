import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const mockPrisma = vi.hoisted(() => ({
  party: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
    count: vi.fn(),
  },
  guest: {
    create: vi.fn(),
    createManyAndReturn: vi.fn(async (args: any) => args.data.map((_: any, i: number) => ({ id: `g-bulk-${i}` }))),
    delete: vi.fn(),
    findFirst: vi.fn(),
    findMany: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    aggregate: vi.fn(),
    count: vi.fn(),
  },
  user: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  eventSeries: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  admin: {
    findUnique: vi.fn(),
  },
  graphicsAdmin: {
    findUnique: vi.fn(),
  },
  // $transaction in our bulk-import code is called with an array of Prisma
  // promises (prisma.guest.create({...}) calls). We resolve each to satisfy
  // the chunked-insert loop. For the function-form (used by DELETE), invoke
  // the callback with a tx proxy that includes a stub $executeRaw so the
  // audit-context helper doesn't crash.
  $transaction: vi.fn(async (ops: any) => {
    if (Array.isArray(ops)) {
      return Promise.all(ops);
    }
    const txProxy = {
      ...mockPrisma,
      $executeRaw: vi.fn(async () => 1),
      $executeRawUnsafe: vi.fn(async () => 1),
    };
    return ops(txProxy);
  }),
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// Mock webhook service
vi.mock('../services/webhook.service.js', () => ({
  triggerWebhook: vi.fn(),
}));

// Mock email functions from rsvp.routes
vi.mock('./rsvp.routes.js', () => ({
  sendApprovalEmail: vi.fn(),
  sendPromotionEmail: vi.fn(),
}));

// marinara-71630: mock the private-config resolver source so the
// reimbursement-options endpoint test controls the rules without seeding
// `app_config`. We deliberately return rules where mercury_card is ENABLED
// (no config-level Mercury disable) so the test proves the endpoint-level
// isMercuryBlocked layering is what disables it. The real (un-mocked)
// isMercuryBlocked / normalizeCountry is exercised so normalization is tested.
const mockGetReimbursementRules = vi.hoisted(() => vi.fn());
// marinara-71630 P8: the bulk-import handler now resolves its hard cap from
// getOperationalLimits(). Stub it with the current real values so the import
// tests (and the "> 2000" cap test) exercise the production cap.
const mockGetOperationalLimits = vi.hoisted(() =>
  vi.fn(async () => ({ importHardCap: 2000, photoPerUserPerEvent: 30 }))
);
vi.mock('../lib/privateConfig.js', () => ({
  getReimbursementRules: mockGetReimbursementRules,
  getOperationalLimits: mockGetOperationalLimits,
}));

const parseAuth = (req: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], JWT_SECRET) as any;
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
    } catch { }
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
  optionalAuth: (req: any, _res: any, next: any) => {
    parseAuth(req);
    next();
  },
  isSuperAdmin: async (email?: string) => {
    if (!email) return false;
    const admin = mockPrisma.admin.findUnique.mock.results[0];
    return admin?.value?.role === 'super_admin';
  },
  AuthRequest: {},
}));

import partyRoutes from './party.routes.js';
import { _resetSiteBrandCache } from '../lib/siteBrand.js';
import { errorHandler } from '../middleware/error.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parties', partyRoutes);
  app.use(errorHandler);
  return app;
}

function makeToken(userId: string, email: string) {
  return jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' });
}

const PARTY_ID = '00000000-0000-0000-0000-000000000001';
const HOST_USER_ID = 'host-user-123';
const HOST_EMAIL = 'host@example.com';
const OTHER_USER_ID = 'other-user-456';
const OTHER_EMAIL = 'other@example.com';

describe('Party Routes', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: isSuperAdmin returns false
    mockPrisma.admin.findUnique.mockResolvedValue(null);
  });

  describe('POST /api/parties - Create party', () => {
    it('creates a party with provided fields', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Host User' });
      mockPrisma.party.create.mockResolvedValue({
        id: PARTY_ID,
        name: 'Test Pizza Party',
        inviteCode: 'abc123',
        userId: HOST_USER_ID,
        user: { name: 'Host User' },
      });
      mockPrisma.guest.create.mockResolvedValue({
        id: 'guest-host',
        name: 'Host User',
        email: HOST_EMAIL,
      });

      const res = await request(app)
        .post('/api/parties')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Pizza Party',
          date: '2026-06-15T18:00:00Z',
          duration: 3,
          pizzaStyle: 'new-york',
          address: '123 Pizza St',
          maxGuests: 50,
        });

      expect(res.status).toBe(201);
      expect(res.body.party).toBeDefined();
      expect(mockPrisma.party.create).toHaveBeenCalledTimes(1);
    });

    describe('seriesSlug stamping (white-label)', () => {
      // In-memory fake of the where-clause brandedSeriesBySlug sends: slug match,
      // isActive, siteUrl not null.
      const SERIES = [
        { id: 'series-team1', slug: 'team1', isActive: true, siteUrl: 'https://team1.rsv.pizza', publicTags: ['team1', 'web3'] }, // brand-check-ignore-line
        { id: 'series-notags', slug: 'notags', isActive: true, siteUrl: 'https://notags.rsv.pizza', publicTags: [] }, // brand-check-ignore-line
        { id: 'series-gpp', slug: 'gpp2026', isActive: true, siteUrl: null },
        { id: 'series-old', slug: 'oldbrand', isActive: false, siteUrl: 'https://old.rsv.pizza' }, // brand-check-ignore-line
      ];

      async function create(body: Record<string, unknown>) {
        mockPrisma.eventSeries.findFirst.mockImplementation(async ({ where }: any) =>
          SERIES.find(
            (r) =>
              r.slug === where.slug &&
              (where.isActive === undefined || r.isActive === where.isActive) &&
              (where.siteUrl?.not === null ? r.siteUrl !== null : true)
          ) ?? null
        );
        mockPrisma.user.findUnique.mockResolvedValue({ name: 'Host User' });
        mockPrisma.party.create.mockResolvedValue({
          id: PARTY_ID, name: 'P', inviteCode: 'abc123', userId: HOST_USER_ID, user: { name: 'Host User' },
        });
        mockPrisma.guest.create.mockResolvedValue({ id: 'g' });
        const res = await request(createTestApp())
          .post('/api/parties')
          .set('Authorization', `Bearer ${makeToken(HOST_USER_ID, HOST_EMAIL)}`)
          .send({ name: 'P', ...body });
        expect(res.status).toBe(201);
        return mockPrisma.party.create.mock.calls[0][0].data;
      }

      it('stamps eventSeriesId for an active series with site_url', async () => {
        const data = await create({ seriesSlug: 'team1' });
        expect(data.eventSeriesId).toBe('series-team1');
        expect(data.eventType).toBeUndefined();
      });

      it('applies the branded series publicTags as eventTags', async () => {
        const data = await create({ seriesSlug: 'team1' });
        expect(data.eventTags).toEqual(['team1', 'web3']);
      });

      it('a body eventTags cannot override the series tags (create never read it)', async () => {
        const data = await create({ seriesSlug: 'team1', eventTags: ['go'] });
        expect(data.eventTags).toEqual(['team1', 'web3']);
      });

      it('series with no publicTags leaves eventTags unset', async () => {
        const data = await create({ seriesSlug: 'notags' });
        expect('eventTags' in data).toBe(false);
      });

      it('no branded series: eventTags unset', async () => {
        const data = await create({ seriesSlug: 'gpp2026' });
        expect('eventTags' in data).toBe(false);
      });

      it('ignores gpp2026 (site_url NULL)', async () => {
        const data = await create({ seriesSlug: 'gpp2026' });
        expect('eventSeriesId' in data).toBe(false);
      });

      it('ignores an inactive branded series', async () => {
        const data = await create({ seriesSlug: 'oldbrand' });
        expect('eventSeriesId' in data).toBe(false);
      });

      it('ignores an unknown series', async () => {
        const data = await create({ seriesSlug: 'nope' });
        expect('eventSeriesId' in data).toBe(false);
      });

      it('ignores a non-string seriesSlug without querying', async () => {
        const data = await create({ seriesSlug: { slug: 'team1' } });
        expect('eventSeriesId' in data).toBe(false);
        expect(mockPrisma.eventSeries.findFirst).not.toHaveBeenCalled();
      });

      it('no seriesSlug: data has no eventSeriesId and no series lookup', async () => {
        const data = await create({});
        expect('eventSeriesId' in data).toBe(false);
        expect(mockPrisma.eventSeries.findFirst).not.toHaveBeenCalled();
      });
    });

    it('validates custom URL format', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .post('/api/parties')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Party',
          customUrl: 'Invalid URL!',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('validates custom URL length (3-50 chars)', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const res = await request(app)
        .post('/api/parties')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: 'Test Party',
          customUrl: 'ab', // Too short
        });

      expect(res.status).toBe(400);
    });

    it('auto-adds host as guest', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Host User' });
      mockPrisma.party.create.mockResolvedValue({
        id: PARTY_ID,
        name: 'Test Party',
        userId: HOST_USER_ID,
        user: { name: 'Host User' },
      });
      mockPrisma.guest.create.mockResolvedValue({
        id: 'guest-host',
        name: 'Host User',
        email: HOST_EMAIL,
      });

      await request(app)
        .post('/api/parties')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Test Party' });

      // Host should be added as a guest
      expect(mockPrisma.guest.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.guest.create.mock.calls[0][0].data.email).toBe(HOST_EMAIL.toLowerCase());
      expect(mockPrisma.guest.create.mock.calls[0][0].data.submittedVia).toBe('host');
    });

    it('requires authentication', async () => {
      const app = createTestApp();

      const res = await request(app)
        .post('/api/parties')
        .send({ name: 'Test Party' });

      expect(res.status).toBe(401);
    });
  });

  describe('GET /api/parties/:id/invite-link (white-label base URL)', () => {
    const OWNED = { id: PARTY_ID, userId: HOST_USER_ID, coHosts: [], inviteCode: 'abc123' };
    const get = () =>
      request(createTestApp())
        .get(`/api/parties/${PARTY_ID}/invite-link`)
        .set('Authorization', `Bearer ${makeToken(HOST_USER_ID, HOST_EMAIL)}`);

    it('no series: link is unchanged (FRONTEND_URL, then localhost fallback)', async () => {
      mockPrisma.party.findUnique.mockResolvedValue({ ...OWNED, eventSeriesId: null });
      const saved = process.env.FRONTEND_URL;
      process.env.FRONTEND_URL = 'https://rsv.pizza'; // brand-check-ignore-line
      let res = await get();
      expect(res.body).toEqual({ inviteCode: 'abc123', inviteLink: 'https://rsv.pizza/rsvp/abc123' }); // brand-check-ignore-line
      delete process.env.FRONTEND_URL;
      res = await get();
      expect(res.body.inviteLink).toBe('http://localhost:5176/rsvp/abc123');
      if (saved !== undefined) process.env.FRONTEND_URL = saved;
    });

    it('branded series: link uses the series site_url', async () => {
      _resetSiteBrandCache();
      mockPrisma.eventSeries.findMany.mockResolvedValue([
        { id: 'series-team1', slug: 'team1', siteUrl: 'https://team1.rsv.pizza/', brandName: 'Team1 Pizza', displayName: 'Team1', name: 'Team1 Pizza Parties' }, // brand-check-ignore-line
      ]);
      mockPrisma.party.findUnique.mockResolvedValue({ ...OWNED, eventSeriesId: 'series-team1' });
      const res = await get();
      expect(res.body.inviteLink).toBe('https://team1.rsv.pizza/rsvp/abc123'); // brand-check-ignore-line
      _resetSiteBrandCache();
    });
  });

  describe('PATCH /api/parties/:id - Update party', () => {
    it('updates party with selective fields', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      // canUserEditParty check
      mockPrisma.party.findUnique.mockResolvedValueOnce({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [],
      });

      mockPrisma.party.update.mockResolvedValue({
        id: PARTY_ID,
        name: 'Updated Name',
        userId: HOST_USER_ID,
        user: { name: 'Host User' },
      });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated Name' });

      expect(res.status).toBe(200);
      expect(mockPrisma.party.update).toHaveBeenCalledTimes(1);
    });

    it('preserves underboss co-host entries on update', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      const existingCoHosts = [
        { id: '1', name: 'Regular CoHost', email: 'cohost@example.com', canEdit: true },
        { id: '2', name: 'Underboss', email: 'boss@example.com', isUnderboss: true },
      ];

      // canUserEditParty check
      mockPrisma.party.findUnique
        .mockResolvedValueOnce({
          id: PARTY_ID,
          userId: HOST_USER_ID,
          coHosts: existingCoHosts,
        })
        .mockResolvedValueOnce({
          id: PARTY_ID,
          coHosts: existingCoHosts,
        });

      mockPrisma.party.update.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [],
        user: { name: 'Host User' },
      });

      const clientCoHosts = [
        { id: '1', name: 'Regular CoHost', email: 'cohost@example.com', canEdit: true },
        { id: '3', name: 'New CoHost', email: 'new@example.com', isUnderboss: true }, // Spoofed!
      ];

      await request(app)
        .patch(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ coHosts: clientCoHosts });

      const updateData = mockPrisma.party.update.mock.calls[0][0].data;
      const updatedCoHosts = updateData.coHosts;

      // Client-submitted isUnderboss should be stripped
      const newCoHost = updatedCoHosts.find((h: any) => h.id === '3');
      expect(newCoHost.isUnderboss).toBeUndefined();

      // Existing underboss should be preserved
      const underboss = updatedCoHosts.find((h: any) => h.id === '2');
      expect(underboss).toBeDefined();
      expect(underboss.isUnderboss).toBe(true);
    });

    it('returns 404 for unauthorized user', async () => {
      const app = createTestApp();
      const token = makeToken(OTHER_USER_ID, OTHER_EMAIL);

      // canUserEditParty returns false
      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [],
      });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Hacked' });

      expect(res.status).toBe(404);
    });
  });

  describe('DELETE /api/parties/:id', () => {
    it('deletes party for owner', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [],
      });
      mockPrisma.party.delete.mockResolvedValue({ id: PARTY_ID });

      const res = await request(app)
        .delete(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('returns 404 for non-owner', async () => {
      const app = createTestApp();
      const token = makeToken(OTHER_USER_ID, OTHER_EMAIL);

      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [],
      });

      const res = await request(app)
        .delete(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`);

      expect(res.status).toBe(404);
    });
  });

  describe('canUserEditParty (via PATCH)', () => {
    it('allows owner to edit', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [],
      });
      mockPrisma.party.update.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        user: { name: 'Host' },
      });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated' });

      expect(res.status).toBe(200);
    });

    it('allows co-host with canEdit to edit', async () => {
      const app = createTestApp();
      const token = makeToken(OTHER_USER_ID, OTHER_EMAIL);

      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [
          { email: OTHER_EMAIL, canEdit: true },
        ],
      });
      mockPrisma.party.update.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        user: { name: 'Host' },
      });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Updated by co-host' });

      expect(res.status).toBe(200);
    });

    it('rejects co-host without canEdit', async () => {
      const app = createTestApp();
      const token = makeToken(OTHER_USER_ID, OTHER_EMAIL);

      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [
          { email: OTHER_EMAIL, canEdit: false },
        ],
      });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Should fail' });

      expect(res.status).toBe(404);
    });

    it('rejects unrelated user', async () => {
      const app = createTestApp();
      const token = makeToken('unrelated-user', 'stranger@example.com');

      mockPrisma.party.findUnique.mockResolvedValue({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [{ email: OTHER_EMAIL, canEdit: true }],
      });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Should fail' });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /api/parties/:id/guests/import - Bulk import (calzone-83291)', () => {
    // The endpoint reuses canUserEditParty + canUserAccessTab. Both helpers
    // call prisma.party.findUnique. Owner check is `userId === HOST_USER_ID`.
    // We chain findUnique with successive resolved values for each call site.
    function mockOwnerAccess() {
      mockPrisma.party.findUnique
        .mockResolvedValueOnce({
          // canUserEditParty
          id: PARTY_ID,
          userId: HOST_USER_ID,
          coHosts: [],
        })
        .mockResolvedValueOnce({
          // canUserAccessTab
          userId: HOST_USER_ID,
          coHosts: [],
          eventType: 'standard',
          region: null,
          name: 'Test Party',
        });
    }

    it('inserts guests with submittedVia=import-luma and approved=true by default', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockOwnerAccess();
      mockPrisma.guest.findMany.mockResolvedValueOnce([]); // no existing emails
      // The transaction returns the same shape as our create payloads with ids.
      mockPrisma.guest.create.mockImplementation((args: any) =>
        Promise.resolve({ id: `g-${args.data.email}`, ...args.data })
      );

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'luma',
          guests: [
            { name: 'Alice Sun', email: 'alice@x.com', status: 'CONFIRMED', approved: true },
            { name: 'Bob Lee', email: 'bob@y.com', status: 'CONFIRMED', approved: true },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(2);
      expect(res.body.skipped).toEqual([]);
      expect(res.body.errors).toEqual([]);
      const createCalls = mockPrisma.guest.createManyAndReturn.mock.calls.flatMap((c: any) => c[0].data.map((d: any) => [{ data: d }]));
      expect(createCalls).toHaveLength(2);
      expect(createCalls[0][0].data.submittedVia).toBe('import-luma');
      expect(createCalls[0][0].data.approved).toBe(true);
      expect(createCalls[0][0].data.status).toBe('CONFIRMED');
    });

    it('sets approved=null for landing status pending and status=WAITLISTED for waitlist', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockOwnerAccess();
      mockPrisma.guest.findMany.mockResolvedValueOnce([]);
      mockPrisma.guest.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'g-' + Math.random(), ...args.data })
      );

      await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'luma',
          guests: [
            { name: 'Pending Pat', email: 'pat@x.com', status: 'CONFIRMED', approved: null },
            { name: 'Wait Wendy', email: 'wendy@x.com', status: 'WAITLISTED', approved: null },
          ],
        });

      const calls = mockPrisma.guest.createManyAndReturn.mock.calls.flatMap((c: any) => c[0].data.map((d: any) => [{ data: d }]));
      const pat = calls.find((c: any) => c[0].data.email === 'pat@x.com')?.[0].data;
      const wendy = calls.find((c: any) => c[0].data.email === 'wendy@x.com')?.[0].data;
      expect(pat.approved).toBeNull();
      expect(pat.status).toBe('CONFIRMED');
      expect(wendy.status).toBe('WAITLISTED');
      expect(wendy.approved).toBeNull();
    });

    it('skips rows whose email already exists on the party (case-insensitive)', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockOwnerAccess();
      mockPrisma.guest.findMany.mockResolvedValueOnce([{ email: 'alice@x.com' }]);
      mockPrisma.guest.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'g-new', ...args.data })
      );

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'luma',
          guests: [
            { name: 'Alice Upper', email: 'ALICE@x.com' }, // dup (case-insensitive)
            { name: 'New Neal', email: 'neal@x.com' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(1);
      expect(res.body.skipped).toHaveLength(1);
      expect(res.body.skipped[0].reason).toBe('duplicate');
      expect(mockPrisma.guest.createManyAndReturn.mock.calls.flatMap((c: any) => c[0].data)).toHaveLength(1);
    });

    it('dedups within the input batch (two rows with the same email → one insert)', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockOwnerAccess();
      mockPrisma.guest.findMany.mockResolvedValueOnce([]);
      mockPrisma.guest.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'g-' + Math.random(), ...args.data })
      );

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'csv',
          guests: [
            { name: 'A', email: 'dup@x.com' },
            { name: 'B', email: 'dup@x.com' },
          ],
        });

      expect(res.status).toBe(200);
      expect(res.body.inserted).toBe(1);
      expect(res.body.skipped).toHaveLength(1);
    });

    it('returns 400 when guests is empty', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockOwnerAccess();

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sourcePlatform: 'luma', guests: [] });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 400 when guests > 2000', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockOwnerAccess();

      const guests = Array.from({ length: 2001 }, (_, i) => ({
        name: `Guest ${i}`,
        email: `g${i}@x.com`,
      }));

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({ sourcePlatform: 'csv', guests });

      expect(res.status).toBe(400);
    });

    it('returns 400 when sourcePlatform is unknown', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockOwnerAccess();

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'partiful',
          guests: [{ name: 'X', email: 'x@x.com' }],
        });

      expect(res.status).toBe(400);
    });

    it('returns 403 for a co-host without "guests" in allowedTabs', async () => {
      const app = createTestApp();
      const token = makeToken(OTHER_USER_ID, OTHER_EMAIL);

      // canUserEditParty: co-host with canEdit=true
      mockPrisma.party.findUnique
        .mockResolvedValueOnce({
          id: PARTY_ID,
          userId: HOST_USER_ID,
          coHosts: [{ email: OTHER_EMAIL, canEdit: true, allowedTabs: ['details'] }],
        })
        .mockResolvedValueOnce({
          // canUserAccessTab: co-host with restricted allowedTabs (no 'guests')
          userId: HOST_USER_ID,
          coHosts: [{ email: OTHER_EMAIL, canEdit: true, allowedTabs: ['details'] }],
          eventType: 'standard',
          region: null,
          name: 'Test Party',
        });

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'luma',
          guests: [{ name: 'X', email: 'x@x.com' }],
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('TAB_ACCESS_DENIED');
    });

    it('returns 404 for a non-owner non-cohost user', async () => {
      const app = createTestApp();
      const token = makeToken('stranger-id', 'stranger@example.com');

      // canUserEditParty: party exists but user has no relation
      mockPrisma.party.findUnique.mockResolvedValueOnce({
        id: PARTY_ID,
        userId: HOST_USER_ID,
        coHosts: [],
      });

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'luma',
          guests: [{ name: 'X', email: 'x@x.com' }],
        });

      expect(res.status).toBe(404);
    });

    it('calls triggerWebhook once (not per row) with guest.imported', async () => {
      const { triggerWebhook } = await import('../services/webhook.service.js');
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);

      mockOwnerAccess();
      mockPrisma.guest.findMany.mockResolvedValueOnce([]);
      mockPrisma.guest.create.mockImplementation((args: any) =>
        Promise.resolve({ id: 'g-' + Math.random(), ...args.data })
      );

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/guests/import`)
        .set('Authorization', `Bearer ${token}`)
        .send({
          sourcePlatform: 'eventbrite',
          guests: [
            { name: 'A', email: 'a@x.com' },
            { name: 'B', email: 'b@x.com' },
            { name: 'C', email: 'c@x.com' },
          ],
        });

      expect(res.status).toBe(200);
      const calls = (triggerWebhook as any).mock.calls.filter(
        (c: any[]) => c[0] === 'guest.imported'
      );
      expect(calls).toHaveLength(1);
      expect(calls[0][1]).toMatchObject({
        partyId: PARTY_ID,
        count: 3,
        source: 'eventbrite',
      });
    });
  });

  describe('GET /api/parties/:id/reimbursement-options - Mercury gating (marinara-71630)', () => {
    // Rules where mercury_card is visible AND enabled at the config level — no
    // country rule disables it. Any disabling must come from the endpoint's
    // isMercuryBlocked layer, which normalizes the country string.
    const RULES_MERCURY_ENABLED = {
      methods: [
        { id: 'usdc_base', label: 'USDC on Base', kind: 'method' as const },
        { id: 'mercury_card', label: 'Mercury virtual card', kind: 'method' as const },
        { id: 'wire', label: 'Bank wire', kind: 'method' as const },
      ],
      default: ['usdc_base', 'mercury_card', 'wire'],
      countryRules: [],
    };

    // canUserEditParty does its own findUnique (owner match) then the endpoint
    // does a second findUnique for { country, eventTags }. Queue both.
    function mockPartyForCountry(country: string) {
      mockPrisma.party.findUnique
        .mockResolvedValueOnce({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] })
        .mockResolvedValueOnce({ country, eventTags: [] });
    }

    async function getOptions(country: string) {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockGetReimbursementRules.mockResolvedValue(RULES_MERCURY_ENABLED);
      mockPartyForCountry(country);
      const res = await request(app)
        .get(`/api/parties/${PARTY_ID}/reimbursement-options`)
        .set('Authorization', `Bearer ${token}`);
      return res;
    }

    it('disables mercury_card for an exact-match blocked country', async () => {
      const res = await getOptions('Iran');
      expect(res.status).toBe(200);
      const mercury = res.body.options.find((o: any) => o.id === 'mercury_card');
      expect(mercury.enabled).toBe(false);
      expect(mercury.disabledReason).toBe(
        'Mercury cards are unavailable in Iran due to compliance restrictions.'
      );
      // other options untouched
      expect(res.body.options.find((o: any) => o.id === 'usdc_base').enabled).toBe(true);
      expect(res.body.options.find((o: any) => o.id === 'wire').enabled).toBe(true);
    });

    it('disables mercury_card for a parenthetical variant (normalization)', async () => {
      // Exact-match config rules would NOT catch this; isMercuryBlocked normalizes
      // "Iran (Islamic Republic of Iran)" → "iran".
      const res = await getOptions('Iran (Islamic Republic of Iran)');
      expect(res.status).toBe(200);
      const mercury = res.body.options.find((o: any) => o.id === 'mercury_card');
      expect(mercury.enabled).toBe(false);
      expect(mercury.disabledReason).toBe(
        'Mercury cards are unavailable in Iran (Islamic Republic of Iran) due to compliance restrictions.'
      );
    });

    it('disables mercury_card for a lowercase variant (normalization)', async () => {
      const res = await getOptions('north korea');
      expect(res.status).toBe(200);
      const mercury = res.body.options.find((o: any) => o.id === 'mercury_card');
      expect(mercury.enabled).toBe(false);
      expect(mercury.disabledReason).toBe(
        'Mercury cards are unavailable in north korea due to compliance restrictions.'
      );
    });

    it('leaves mercury_card enabled for a non-blocked country', async () => {
      const res = await getOptions('United States');
      expect(res.status).toBe(200);
      const mercury = res.body.options.find((o: any) => o.id === 'mercury_card');
      expect(mercury.enabled).toBe(true);
      expect(mercury.disabledReason).toBeUndefined();
    });

    it('does nothing when mercury_card is not among the resolved options', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      // Rules without mercury_card at all.
      mockGetReimbursementRules.mockResolvedValue({
        methods: [{ id: 'usdc_base', label: 'USDC on Base', kind: 'method' as const }],
        default: ['usdc_base'],
        countryRules: [],
      });
      mockPartyForCountry('Iran');
      const res = await request(app)
        .get(`/api/parties/${PARTY_ID}/reimbursement-options`)
        .set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(200);
      expect(res.body.options.map((o: any) => o.id)).toEqual(['usdc_base']);
      expect(res.body.options[0].enabled).toBe(true);
    });
  });

  describe('GET /api/parties/:id/guests + /my-guest (guests-anon-exposure PR1a)', () => {
    const COHOST_ID = 'cohost-user-789';
    const COHOST_EMAIL = 'cohost@example.com';
    const FORBIDDEN_KEYS = [
      'survey_token', 'surveyToken', 'privy_user_id', 'visitor_session_id', 'email_resend_id',
      'email_status', 'reminder_sent_at', 'nft_token_id', 'nft_transaction_hash',
      'discount_claimed_at', 'wallet_source',
    ];
    const guestRow = {
      id: 'g1', partyId: PARTY_ID, name: 'Guest One', email: 'g1@example.com', ethereumAddress: null,
      roles: [], mailingListOptIn: false, dietaryRestrictions: [], likedToppings: [], dislikedToppings: [],
      likedBeverages: [], dislikedBeverages: [], pizzeriaRankings: [], suggestedPizzerias: [],
      swcOptIn: false, swcCaOptIn: false, swcAuOptIn: false, swcEuOptIn: false, swcUkOptIn: false,
      swcBrOptIn: false, ethconfOptIn: false, optinAbVariant: null, submittedAt: new Date('2026-01-01'),
      submittedVia: 'link', checkedInAt: null, approved: null, checkedInBy: null, status: 'CONFIRMED',
      waitlistPosition: null, promotedAt: null,
    };
    const party = (coHosts: any[] = []) => ({ id: PARTY_ID, userId: HOST_USER_ID, coHosts, eventType: 'regular', user: { name: 'H' } });

    it('owner gets snake_case DbGuest rows with no sensitive keys, via one indexed query', async () => {
      mockPrisma.party.findUnique.mockResolvedValueOnce(party());
      mockPrisma.guest.findMany.mockResolvedValueOnce([guestRow]);
      const res = await request(createTestApp())
        .get(`/api/parties/${PARTY_ID}/guests`)
        .set('Authorization', `Bearer ${makeToken(HOST_USER_ID, HOST_EMAIL)}`);
      expect(res.status).toBe(200);
      expect(res.body.guests).toHaveLength(1);
      expect(res.body.guests[0]).toMatchObject({ id: 'g1', party_id: PARTY_ID, name: 'Guest One', email: 'g1@example.com', submitted_via: 'link' });
      for (const k of FORBIDDEN_KEYS) expect(res.body.guests[0]).not.toHaveProperty(k);
      expect(mockPrisma.guest.findMany).toHaveBeenCalledTimes(1);
      const arg = mockPrisma.guest.findMany.mock.calls[0][0];
      expect(arg.where).toEqual({ partyId: PARTY_ID, status: { not: 'INVITED' } });
      for (const k of ['surveyToken', 'privyUserId', 'visitorSessionId', 'emailResendId', 'nftTokenId', 'walletSource']) {
        expect(arg.select).not.toHaveProperty(k);
      }
    });

    it('co-host with canEdit gets the list', async () => {
      mockPrisma.party.findUnique.mockResolvedValueOnce(party([{ email: COHOST_EMAIL, canEdit: true }]));
      mockPrisma.guest.findMany.mockResolvedValueOnce([guestRow]);
      const res = await request(createTestApp())
        .get(`/api/parties/${PARTY_ID}/guests`)
        .set('Authorization', `Bearer ${makeToken(COHOST_ID, COHOST_EMAIL)}`);
      expect(res.status).toBe(200);
      expect(res.body.guests).toHaveLength(1);
    });

    it('non-editor (including a co-host without canEdit) gets 404 and no guest query', async () => {
      mockPrisma.party.findUnique.mockResolvedValue(party([{ email: COHOST_EMAIL, canEdit: false }]));
      for (const [id, email] of [[OTHER_USER_ID, OTHER_EMAIL], [COHOST_ID, COHOST_EMAIL]]) {
        const res = await request(createTestApp())
          .get(`/api/parties/${PARTY_ID}/guests`)
          .set('Authorization', `Bearer ${makeToken(id, email)}`);
        expect(res.status).toBe(404);
      }
      expect(mockPrisma.guest.findMany).not.toHaveBeenCalled();
    });

    it('unauthenticated gets 401', async () => {
      const res = await request(createTestApp()).get(`/api/parties/${PARTY_ID}/guests`);
      expect(res.status).toBe(401);
      expect(mockPrisma.guest.findMany).not.toHaveBeenCalled();
    });

    it('wrong party (unknown id or malformed id) gets 404', async () => {
      mockPrisma.party.findUnique.mockResolvedValueOnce(null);
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      const a = await request(createTestApp()).get('/api/parties/00000000-0000-0000-0000-0000000000ff/guests').set('Authorization', `Bearer ${token}`);
      expect(a.status).toBe(404);
      const b = await request(createTestApp()).get('/api/parties/not-a-uuid/guests').set('Authorization', `Bearer ${token}`);
      expect(b.status).toBe(404);
      expect(mockPrisma.guest.findMany).not.toHaveBeenCalled();
    });

    it('my-guest returns only the caller own row (lookup keyed on the token email)', async () => {
      mockPrisma.guest.findFirst.mockResolvedValueOnce({ id: 'g1', name: 'Me', email: OTHER_EMAIL, status: 'CONFIRMED' });
      const res = await request(createTestApp())
        .get(`/api/parties/${PARTY_ID}/my-guest`)
        .set('Authorization', `Bearer ${makeToken(OTHER_USER_ID, 'Other@Example.com')}`);
      expect(res.status).toBe(200);
      expect(res.body.guest).toMatchObject({ id: 'g1' });
      const arg = mockPrisma.guest.findFirst.mock.calls[0][0];
      expect(arg.where.partyId).toBe(PARTY_ID);
      expect(arg.where.email).toBe('other@example.com');
      for (const k of ['surveyToken', 'privyUserId', 'visitorSessionId']) expect(arg.select).not.toHaveProperty(k);
    });

    it('my-guest matches the email exactly (no ILIKE wildcards: a_b@x.com must not match axb@x.com)', async () => {
      mockPrisma.guest.findFirst.mockResolvedValueOnce(null);
      await request(createTestApp())
        .get(`/api/parties/${PARTY_ID}/my-guest`)
        .set('Authorization', `Bearer ${makeToken(OTHER_USER_ID, ' a_b@x.com ')}`);
      const where = mockPrisma.guest.findFirst.mock.calls[0][0].where;
      expect(where.email).toBe('a_b@x.com'); // plain string = SQL equality, never LIKE/ILIKE
      expect(where.email).not.toBe('axb@x.com');
    });

    it('my-guest returns null when no row, null for a malformed party id, 401 unauthenticated', async () => {
      const token = makeToken(OTHER_USER_ID, OTHER_EMAIL);
      mockPrisma.guest.findFirst.mockResolvedValueOnce(null);
      const a = await request(createTestApp()).get(`/api/parties/${PARTY_ID}/my-guest`).set('Authorization', `Bearer ${token}`);
      expect(a.status).toBe(200);
      expect(a.body).toEqual({ guest: null });
      mockPrisma.guest.findFirst.mockClear();
      const b = await request(createTestApp()).get('/api/parties/bogus/my-guest').set('Authorization', `Bearer ${token}`);
      expect(b.body).toEqual({ guest: null });
      expect(mockPrisma.guest.findFirst).not.toHaveBeenCalled();
      const c = await request(createTestApp()).get(`/api/parties/${PARTY_ID}/my-guest`);
      expect(c.status).toBe(401);
    });
  });
});
