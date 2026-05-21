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
      const createCalls = mockPrisma.guest.create.mock.calls;
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

      const calls = mockPrisma.guest.create.mock.calls;
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
      expect(mockPrisma.guest.create).toHaveBeenCalledTimes(1);
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
});
