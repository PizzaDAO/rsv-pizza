import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  photo: { findMany: vi.fn(), count: vi.fn() },
  sponsor: { findMany: vi.fn() },
  guest: { count: vi.fn() },
  eventSeries: { findUnique: vi.fn() },
  reel: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn(), create: vi.fn() },
  appConfig: { findUnique: vi.fn(), upsert: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

// Test identities travel in a header: "x-user: email|userId".
const parseAuth = (req: any) => {
  const h = req.headers['x-user'];
  if (typeof h === 'string') {
    const [email, id] = h.split('|');
    req.userEmail = email;
    req.userId = id;
  }
};
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    parseAuth(req);
    if (!req.userEmail) return res.status(401).json({ error: 'unauth' });
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => { parseAuth(req); next(); },
  isSuperAdmin: (email?: string) => email === 'super@example.com',
  isAdmin: (email?: string) => email === 'admin@example.com',
  isPaymentAdmin: () => false,
  isUnderboss: () => false,
}));

const canEdit = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: canEdit }));

import { invalidateAll } from '../lib/privateConfig.js';
import { reelRouter, adminReelRouter } from './reel.routes.js';
import { errorHandler } from '../middleware/error.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', reelRouter);
  a.use('/api/admin/reels', adminReelRouter);
  a.use(errorHandler);
  return a;
}

const PARTY = {
  id: 'party-1',
  name: 'Slice Night',
  city: 'Austin',
  date: new Date('2026-05-22T23:00:00Z'),
  timezone: 'America/Chicago',
  cancelledAt: null,
  photosEnabled: true,
  eventSeriesId: null,
};

function photos(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    id: `ph${i}`, url: `https://example.com/${i}.jpg`, mimeType: 'image/jpeg', width: 100, height: 100,
    starred: i === 0, voteCount: 0, payoutRole: null, status: 'approved', deletedAt: null,
    createdAt: new Date(2026, 4, 22, 20, i),
  }));
}

beforeEach(() => {
  vi.resetAllMocks();
  mockPrisma.party.findUnique.mockResolvedValue(PARTY);
  mockPrisma.reel.count.mockResolvedValue(0);
  mockPrisma.photo.findMany.mockResolvedValue(photos(8));
  mockPrisma.photo.count.mockResolvedValue(8);
  mockPrisma.sponsor.findMany.mockResolvedValue([{ id: 's1', name: 'Acme', logoUrl: 'https://example.com/acme.png' }]);
  mockPrisma.guest.count.mockResolvedValue(25);
  mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify({ enabled: true }) });
  invalidateAll();
  mockPrisma.reel.create.mockImplementation(async ({ data }: any) => ({
    ...data, progress: 0, outputs: null, error: null, createdAt: new Date(), finishedAt: null,
  }));
  canEdit.mockResolvedValue(true);
});

describe('POST /api/parties/:id/reels', () => {
  it('requires auth', async () => {
    await request(app()).post('/api/parties/party-1/reels').send({}).expect(401);
  });

  it('rejects people who cannot edit the party', async () => {
    canEdit.mockResolvedValue(false);
    const res = await request(app()).post('/api/parties/party-1/reels').set('x-user', 'guest@example.com|u9').send({});
    expect(res.status).toBe(403);
    expect(mockPrisma.reel.create).not.toHaveBeenCalled();
  });

  it('blocks hosts before the event date', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, date: new Date(Date.now() + 86400000) });
    const res = await request(app()).post('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1').send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EVENT_NOT_HAPPENED');
  });

  it('lets an admin make a reel before the event date', async () => {
    canEdit.mockResolvedValue(false);
    mockPrisma.party.findUnique.mockResolvedValue({ ...PARTY, date: new Date(Date.now() + 86400000) });
    const res = await request(app()).post('/api/parties/party-1/reels').set('x-user', 'admin@example.com|u2').send({ musicKey: 'none' });
    expect(res.status).toBe(201);
  });

  it('queues a reel with a self-contained spec for the host', async () => {
    const res = await request(app())
      .post('/api/parties/party-1/reels')
      .set('x-user', 'host@example.com|u1')
      .send({ title: '  Our   night ', musicKey: 'none' });
    expect(res.status).toBe(201);
    expect(res.body.reel.status).toBe('queued');
    const data = mockPrisma.reel.create.mock.calls[0][0].data;
    expect(data.partyId).toBe('party-1');
    expect(data.requestedBy).toBe('host@example.com');
    expect(data.spec.title).toBe('Our night');
    expect(data.spec.music).toBeNull();
    expect(data.spec.items).toHaveLength(8);
    expect(data.spec.sponsors).toHaveLength(1);
    expect(data.spec.outputPrefix).toBe(`reels/party-1/${data.id}`);
  });

  it('refuses when there are too few photos', async () => {
    mockPrisma.photo.findMany.mockResolvedValue(photos(2));
    const res = await request(app()).post('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1').send({});
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('NOT_ENOUGH_PHOTOS');
  });

  it('refuses a second reel while one is active', async () => {
    mockPrisma.reel.count.mockResolvedValue(1);
    const res = await request(app()).post('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1').send({});
    expect(res.status).toBe(429);
    expect(res.body.error.code).toBe('REEL_IN_PROGRESS');
  });

  it('rejects a track that is not in the eligible library', async () => {
    const res = await request(app())
      .post('/api/parties/party-1/reels')
      .set('x-user', 'host@example.com|u1')
      .send({ musicKey: 'songs/x/y.mp3' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TRACK');
  });

  it('is off by default: no config row means 404', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue(null);
    invalidateAll();
    const res = await request(app()).post('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1').send({});
    expect(res.status).toBe(404);
    expect(mockPrisma.reel.create).not.toHaveBeenCalled();
    await request(app()).get('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1').expect(404);
  });

  it('is 404 when explicitly disabled', async () => {
    mockPrisma.appConfig.findUnique.mockResolvedValue({ value: JSON.stringify({ enabled: false }) });
    invalidateAll();
    await request(app()).post('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1').send({}).expect(404);
  });

  it('ignores photos hosted outside our storage origin', async () => {
    process.env.SUPABASE_URL = 'https://storage.example.com';
    try {
      const res = await request(app()).post('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1').send({ musicKey: 'none' });
      expect(res.status).toBe(422); // all fixtures are on example.com, not the storage origin
    } finally {
      delete process.env.SUPABASE_URL;
    }
  });
});

describe('GET /api/parties/:id/reels/:reelId', () => {
  const OTHER = '11111111-2222-3333-4444-555555555555';
  it('returns 404 for a reel that belongs to another party (IDOR)', async () => {
    mockPrisma.reel.findFirst.mockResolvedValue(null);
    const res = await request(app()).get(`/api/parties/party-1/reels/${OTHER}`).set('x-user', 'host@example.com|u1');
    expect(res.status).toBe(404);
    expect(mockPrisma.reel.findFirst).toHaveBeenCalledWith({ where: { id: OTHER, partyId: 'party-1' } });
  });
  it('404s on a non-uuid id without touching the db', async () => {
    await request(app()).get('/api/parties/party-1/reels/nope').set('x-user', 'host@example.com|u1').expect(404);
    expect(mockPrisma.reel.findFirst).not.toHaveBeenCalled();
  });
});

describe('GET /api/parties/:id/reels', () => {
  it('forbids non-editors', async () => {
    canEdit.mockResolvedValue(false);
    await request(app()).get('/api/parties/party-1/reels').set('x-user', 'guest@example.com|u9').expect(403);
  });

  it('lists reels and hides worker error details and unfinished outputs', async () => {
    mockPrisma.reel.findMany.mockResolvedValue([
      {
        id: 'r1', status: 'failed', progress: 10, outputs: { '9x16': 'x' }, error: 'ENOENT /secret/path',
        spec: { title: 'T' }, createdAt: new Date(), finishedAt: null,
      },
    ]);
    const res = await request(app()).get('/api/parties/party-1/reels').set('x-user', 'host@example.com|u1');
    expect(res.status).toBe(200);
    expect(res.body.eligible).toBe(true);
    expect(res.body.reels[0].outputs).toBeNull();
    expect(JSON.stringify(res.body)).not.toContain('/secret/path');
  });
});

describe('admin settings', () => {
  it('rejects non-admins', async () => {
    await request(app()).get('/api/admin/reels/settings').set('x-user', 'host@example.com|u1').expect(403);
    await request(app()).put('/api/admin/reels/settings').set('x-user', 'host@example.com|u1').send({}).expect(403);
  });

  it('saves clamped settings for admins', async () => {
    const res = await request(app())
      .put('/api/admin/reels/settings')
      .set('x-user', 'admin@example.com|u2')
      .send({ settings: { maxSeconds: 999, musicFolders: ['house-band'] } });
    expect(res.status).toBe(200);
    expect(res.body.settings.maxSeconds).toBe(60);
    const call = mockPrisma.appConfig.upsert.mock.calls[0][0];
    expect(call.where.key).toBe('reels.settings');
    expect(JSON.parse(call.create.value).musicFolders).toEqual(['house-band']);
  });
});
