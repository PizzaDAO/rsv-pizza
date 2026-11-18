import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  party: { findMany: vi.fn(), findUnique: vi.fn() },
  slugAlias: { findUnique: vi.fn() },
  sponsor: { findMany: vi.fn() },
  user: { findMany: vi.fn() },
  pageView: { count: vi.fn() },
  partyBooth: { findUnique: vi.fn() },
  $queryRaw: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const mockAuth = vi.hoisted(() => ({
  isAdmin: vi.fn(),
  userId: undefined as string | undefined,
}));
vi.mock('../middleware/auth.js', () => ({
  isAdmin: mockAuth.isAdmin,
  // Mirrors the real optionalAuth: a Bearer header means "authenticated as test@example.org".
  optionalAuth: (req: any, _res: any, next: any) => {
    if (req.headers.authorization?.startsWith('Bearer ')) {
      req.userId = 'u1';
      req.userEmail = 'host@example.org';
    }
    next();
  },
}));
vi.mock('../lib/privateConfig.js', () => ({ getGppGlobalEditors: vi.fn(async () => []) }));
vi.mock('../helpers/gpp27.js', () => ({ resolveGppByYear: vi.fn(async () => null), isGpp27Hidden: vi.fn(async () => false) }));
vi.mock('../helpers/eventVisibility.js', () => ({ isEventHiddenFrom: vi.fn(async () => false) }));
vi.mock('../lib/boothSettings.js', () => ({ isBoothGloballyOn: vi.fn(async () => false) }));
vi.mock('../helpers/reimbursementCap.js', () => ({ computeEffectiveCapUsd: vi.fn(() => null) }));
vi.mock('../lib/eventTags.js', () => ({ publicTags: (t: unknown) => t }));

import eventRoutes from './event.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/events', eventRoutes);
app.use(errorHandler);

const PARTY = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Test Party',
  inviteCode: 'abc123',
  customUrl: 'test-party',
  eventType: 'regular',
  coHosts: [{ name: 'Co', email: 'Co@Example.org' }],
  password: null,
  user: null,
  userId: 'owner',
  _count: { guests: 3 },
  hackathon: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.party.findMany.mockResolvedValue([PARTY]);
  mockPrisma.sponsor.findMany.mockResolvedValue([]);
  mockPrisma.user.findMany.mockResolvedValue([{ email: 'co@example.org', profilePictureUrl: 'a.png', twitter: null, website: null, instagram: null }]);
  mockPrisma.pageView.count.mockResolvedValue(10);
  mockPrisma.$queryRaw.mockResolvedValue([{ count: 4n }]);
  mockAuth.isAdmin.mockResolvedValue(false);
});

describe('GET /api/events/:slug', () => {
  it('looks the party up with a single OR query and runs the side queries once', async () => {
    const res = await request(app).get('/api/events/abc123');
    expect(res.status).toBe(200);
    expect(mockPrisma.party.findMany).toHaveBeenCalledTimes(1);
    expect(mockPrisma.party.findMany.mock.calls[0][0].where).toEqual({ OR: [{ inviteCode: 'abc123' }, { customUrl: 'abc123' }] });
    expect(mockPrisma.party.findUnique).not.toHaveBeenCalled();
    expect(res.body.event.coHosts[0]).toMatchObject({ name: 'Co', avatar_url: 'a.png' });
    expect(res.body.event.coHosts[0].email).toBeUndefined();
    expect(res.body.event.guestCount).toBe(3);
  });

  it('prefers the invite-code match when both columns match different parties', async () => {
    mockPrisma.party.findMany.mockResolvedValue([
      { ...PARTY, id: 'by-custom', inviteCode: 'zzz', customUrl: 'dup' },
      { ...PARTY, id: 'by-invite', inviteCode: 'dup', customUrl: 'other' },
    ]);
    const res = await request(app).get('/api/events/dup');
    expect(res.body.event.id).toBe('by-invite');
  });

  it('is CDN-cacheable only for anonymous callers', async () => {
    const anon = await request(app).get('/api/events/abc123');
    expect(anon.headers['cache-control']).toBe('public, s-maxage=30, stale-while-revalidate=300');
    expect(anon.headers['vary']).toMatch(/Authorization/i);

    const authed = await request(app).get('/api/events/abc123').set('Authorization', 'Bearer x');
    expect(authed.headers['cache-control']).toBe('private, no-store');
  });

  it('never sets a public cache header on a 404', async () => {
    mockPrisma.party.findMany.mockResolvedValue([]);
    mockPrisma.slugAlias.findUnique.mockResolvedValue(null);
    const res = await request(app).get('/api/events/nope');
    expect(res.status).toBe(404);
    expect(res.headers['cache-control'] ?? '').not.toMatch(/public/);
  });
});

describe('POST /api/events/:slug/check-host', () => {
  beforeEach(() => {
    mockPrisma.party.findMany.mockResolvedValue([]);
    mockPrisma.party.findUnique.mockResolvedValue({ coHosts: [{ email: 'Host@Example.org', canEdit: true }], userId: 'owner', eventType: 'regular' });
  });

  it('ignores a body email: unauthenticated callers are never hosts', async () => {
    const res = await request(app).post('/api/events/abc123/check-host').send({ email: 'host@example.org' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ isHost: false, canEdit: false });
    expect(mockAuth.isAdmin).not.toHaveBeenCalled();
    expect(mockPrisma.party.findUnique).not.toHaveBeenCalled();
  });

  it('derives the caller from the token', async () => {
    const res = await request(app).post('/api/events/abc123/check-host').set('Authorization', 'Bearer x').send({ email: 'someone-else@example.org' });
    expect(res.body).toEqual({ isHost: true, canEdit: true });
  });
});
