import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

// Use vi.hoisted to create mocks that can be referenced in vi.mock factories
const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  photo: {
    findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(),
    create: vi.fn(), update: vi.fn(), updateMany: vi.fn(),
    groupBy: vi.fn(), delete: vi.fn(),
  },
  guest: { findFirst: vi.fn() },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const parseAuth = (req: any) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    try {
      const decoded = jwt.verify(authHeader.split(' ')[1], 'test-secret') as any;
      req.userId = decoded.userId;
      req.userEmail = decoded.email;
    } catch { }
  }
};

vi.mock('../middleware/auth.js', () => {
  return {
    requireAuth: (req: any, _res: any, next: any) => {
      parseAuth(req);
      next();
    },
    optionalAuth: (req: any, _res: any, next: any) => {
      parseAuth(req);
      next();
    },
    isSuperAdmin: (email?: string) => email === 'hello@rarepizzas.com',
    AuthRequest: {},
  };
});

import photoRoutes from './photo.routes.js';
import { errorHandler } from '../middleware/error.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/parties', photoRoutes);
  app.use(errorHandler);
  return app;
}

function makeToken(userId: string, email: string) {
  return jwt.sign({ userId, email }, 'test-secret', { expiresIn: '1h' });
}

const PARTY_ID = '00000000-0000-0000-0000-000000000001';
const PHOTO_ID = '00000000-0000-0000-0000-000000000010';
const PHOTO_ID_2 = '00000000-0000-0000-0000-000000000020';
const HOST_USER_ID = 'host-user-123';
const HOST_EMAIL = 'host@example.com';

describe('Photo Routes - Moderation', () => {
  beforeEach(() => { vi.clearAllMocks(); });

  describe('POST /:partyId/photos', () => {
    const pp = { url: 'https://s.com/p.jpg', fileName: 'p.jpg', fileSize: 500000, mimeType: 'image/jpeg' };

    it('sets status=approved when moderation OFF', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, photosEnabled: true, photoModeration: false });
      mockPrisma.photo.create.mockResolvedValue({ id: PHOTO_ID, ...pp, partyId: PARTY_ID, status: 'approved', guest: null });
      const res = await request(app).post(`/api/parties/${PARTY_ID}/photos`).send(pp);
      expect(res.status).toBe(201);
      expect(mockPrisma.photo.create.mock.calls[0][0].data.status).toBe('approved');
    });

    it('sets status=pending when moderation ON', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, photosEnabled: true, photoModeration: true });
      mockPrisma.photo.create.mockResolvedValue({ id: PHOTO_ID, ...pp, partyId: PARTY_ID, status: 'pending', guest: null });
      const res = await request(app).post(`/api/parties/${PARTY_ID}/photos`).send(pp);
      expect(res.status).toBe(201);
      expect(mockPrisma.photo.create.mock.calls[0][0].data.status).toBe('pending');
    });
  });

  describe('GET /:partyId/photos', () => {
    it('guests only see approved photos by default', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, photosEnabled: true, photosPublic: true, userId: HOST_USER_ID, photoModeration: true });
      mockPrisma.photo.findMany.mockResolvedValue([]);
      mockPrisma.photo.count.mockResolvedValue(0);

      await request(app).get(`/api/parties/${PARTY_ID}/photos`);
      expect(mockPrisma.photo.findMany.mock.calls[0][0].where.status).toBe('approved');
    });

    it('host can filter by status=pending', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      // First call is the initial party lookup, second call is from canUserEditParty
      mockPrisma.party.findUnique
        .mockResolvedValueOnce({ id: PARTY_ID, photosEnabled: true, photosPublic: true, userId: HOST_USER_ID, photoModeration: true })
        .mockResolvedValueOnce({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });
      mockPrisma.photo.findMany.mockResolvedValue([]);
      mockPrisma.photo.count.mockResolvedValue(0);

      await request(app).get(`/api/parties/${PARTY_ID}/photos?status=pending`).set('Authorization', `Bearer ${token}`);
      expect(mockPrisma.photo.findMany.mock.calls[0][0].where.status).toBe('pending');
    });

    it('host can see all statuses with status=all', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockPrisma.party.findUnique
        .mockResolvedValueOnce({ id: PARTY_ID, photosEnabled: true, photosPublic: true, userId: HOST_USER_ID, photoModeration: true })
        .mockResolvedValueOnce({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });
      mockPrisma.photo.findMany.mockResolvedValue([]);
      mockPrisma.photo.count.mockResolvedValue(0);

      await request(app).get(`/api/parties/${PARTY_ID}/photos?status=all`).set('Authorization', `Bearer ${token}`);
      // status should NOT be set in the where clause
      expect(mockPrisma.photo.findMany.mock.calls[0][0].where.status).toBeUndefined();
    });

    it('non-host with status=pending still gets only approved', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique
        .mockResolvedValueOnce({ id: PARTY_ID, photosEnabled: true, photosPublic: true, userId: HOST_USER_ID, photoModeration: true })
        .mockResolvedValueOnce({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] }); // canUserEditParty lookup
      mockPrisma.photo.findMany.mockResolvedValue([]);
      mockPrisma.photo.count.mockResolvedValue(0);

      await request(app).get(`/api/parties/${PARTY_ID}/photos?status=pending`);
      expect(mockPrisma.photo.findMany.mock.calls[0][0].where.status).toBe('approved');
    });
  });

  describe('PATCH /:partyId/photos/:photoId - status updates', () => {
    it('approve sets status, reviewedAt, reviewedBy', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });
      mockPrisma.photo.findFirst.mockResolvedValue({ id: PHOTO_ID, partyId: PARTY_ID, status: 'pending' });
      mockPrisma.photo.update.mockResolvedValue({ id: PHOTO_ID, status: 'approved', guest: null });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}/photos/${PHOTO_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'approved' });

      expect(res.status).toBe(200);
      const updateData = mockPrisma.photo.update.mock.calls[0][0].data;
      expect(updateData.status).toBe('approved');
      expect(updateData.reviewedAt).toBeDefined();
      expect(updateData.reviewedBy).toBe(HOST_USER_ID);
    });

    it('reject sets status, reviewedAt, reviewedBy', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });
      mockPrisma.photo.findFirst.mockResolvedValue({ id: PHOTO_ID, partyId: PARTY_ID, status: 'pending' });
      mockPrisma.photo.update.mockResolvedValue({ id: PHOTO_ID, status: 'rejected', guest: null });

      const res = await request(app)
        .patch(`/api/parties/${PARTY_ID}/photos/${PHOTO_ID}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status: 'rejected' });

      expect(res.status).toBe(200);
      const updateData = mockPrisma.photo.update.mock.calls[0][0].data;
      expect(updateData.status).toBe('rejected');
      expect(updateData.reviewedAt).toBeDefined();
      expect(updateData.reviewedBy).toBe(HOST_USER_ID);
    });
  });

  describe('POST /:partyId/photos/batch-review', () => {
    it('approve multiple photos', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });
      mockPrisma.photo.updateMany.mockResolvedValue({ count: 2 });

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/photos/batch-review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photoIds: [PHOTO_ID, PHOTO_ID_2], status: 'approved' });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(2);
      const updateCall = mockPrisma.photo.updateMany.mock.calls[0][0];
      expect(updateCall.where.id.in).toEqual([PHOTO_ID, PHOTO_ID_2]);
      expect(updateCall.data.status).toBe('approved');
      expect(updateCall.data.reviewedAt).toBeDefined();
      expect(updateCall.data.reviewedBy).toBe(HOST_USER_ID);
    });

    it('reject multiple photos', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });
      mockPrisma.photo.updateMany.mockResolvedValue({ count: 2 });

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/photos/batch-review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photoIds: [PHOTO_ID, PHOTO_ID_2], status: 'rejected' });

      expect(res.status).toBe(200);
      expect(res.body.updated).toBe(2);
    });

    it('rejects invalid status', async () => {
      const app = createTestApp();
      const token = makeToken(HOST_USER_ID, HOST_EMAIL);
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });

      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/photos/batch-review`)
        .set('Authorization', `Bearer ${token}`)
        .send({ photoIds: [PHOTO_ID], status: 'invalid' });

      expect(res.status).toBe(400);
    });

    it('requires host authorization', async () => {
      const app = createTestApp();
      // Without a token, userId is undefined => canUserEditParty returns false
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, userId: HOST_USER_ID, coHosts: [] });
      const res = await request(app)
        .post(`/api/parties/${PARTY_ID}/photos/batch-review`)
        .send({ photoIds: [PHOTO_ID], status: 'approved' });
      expect(res.status).toBe(403);
    });
  });

  describe('GET /:partyId/photos/stats', () => {
    it('includes pendingPhotos count', async () => {
      const app = createTestApp();
      mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY_ID, photosEnabled: true });
      mockPrisma.photo.count
        .mockResolvedValueOnce(10) // totalPhotos
        .mockResolvedValueOnce(3)  // starredPhotos
        .mockResolvedValueOnce(2); // pendingPhotos
      mockPrisma.photo.findMany.mockResolvedValue([]);
      mockPrisma.photo.groupBy.mockResolvedValue([]);

      const res = await request(app).get(`/api/parties/${PARTY_ID}/photos/stats`);
      expect(res.status).toBe(200);
      expect(res.body.pendingPhotos).toBe(2);

      // Verify the third count call is for pending status
      expect(mockPrisma.photo.count.mock.calls[2][0].where.status).toBe('pending');
    });
  });
});
