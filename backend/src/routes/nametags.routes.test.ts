/**
 * Member name tag routes: guests-tab permission (403), scope setting gating, only hashes sent out, no emails in
 * the response, upstream failure -> 200 'unavailable', admin settings. Prisma, party access and the pizzadao.org
 * client are mocked.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-nametags-routes-0123456789';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  guest: { findMany: vi.fn() },
  appConfig: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn() },
  appConfigAudit: { create: vi.fn() },
  admin: { findUnique: vi.fn() },
  $transaction: vi.fn(),
}) as Record<string, any>);
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const canTab = vi.hoisted(() => vi.fn());
vi.mock('../helpers/partyAccess.js', () => ({ canUserAccessTab: canTab, canUserEditParty: vi.fn() }));

const lookup = vi.hoisted(() => vi.fn());
vi.mock('../services/pizzadaoNametags.js', () => ({ lookupNametagMembers: lookup }));

import nametagsRoutes, { nametagsAdminRouter } from './nametags.routes.js';
import { errorHandler } from '../middleware/error.js';
import { hashEmail } from '../lib/nametagMerge.js';

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', nametagsRoutes);
  a.use('/api/admin/nametags', nametagsAdminRouter);
  a.use(errorHandler);
  return a;
}

const PARTY = '11111111-1111-4111-8111-111111111111';
const auth = () => `Bearer ${jwt.sign({ userId: 'u-host', email: 'host@example.com' }, JWT_SECRET, { expiresIn: '1h' })}`;

function setting(scope: number | null, max?: number) {
  const rows: { key: string; value: string }[] = [];
  if (scope !== null) rows.push({ key: 'nametags.scope', value: JSON.stringify(scope) });
  if (max !== undefined) rows.push({ key: 'nametags.maxIdentifiers', value: JSON.stringify(max) });
  mockPrisma.appConfig.findMany.mockResolvedValue(rows);
}

const guest = (id: string, o: Record<string, unknown> = {}) => ({ id, email: null, ethereumAddress: null, submittedAt: new Date('2026-01-01'), approved: null, ...o });
const memberA = { memberId: '1', name: 'Pat', pfpUrl: 'https://img.example/p.png' };

beforeEach(() => {
  vi.clearAllMocks();
  canTab.mockResolvedValue(true);
  setting(2, 500);
  mockPrisma.admin.findUnique.mockResolvedValue(null);
  mockPrisma.$transaction.mockImplementation(async (fn: any) => fn(mockPrisma));
  mockPrisma.appConfig.findUnique.mockResolvedValue(null);
  mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY, eventSeriesId: null, eventType: 'standard', cancelledAt: null });
  mockPrisma.guest.findMany.mockResolvedValue([guest('g1', { email: 'a@example.com' }), guest('g2', { email: 'b@example.com' })]);
  lookup.mockResolvedValue([{ emailHash: hashEmail('a@example.com'), member: memberA }]);
});

describe('GET /api/parties/:id/nametags', () => {
  it('401 without a token, 403 without guests access', async () => {
    expect((await request(app()).get(`/api/parties/${PARTY}/nametags`)).status).toBe(401);
    canTab.mockResolvedValue(false);
    const res = await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth());
    expect(res.status).toBe(403);
    expect(canTab).toHaveBeenCalledWith(PARTY, 'host@example.com', 'u-host', 'guests');
    expect(lookup).not.toHaveBeenCalled();
  });
  it('merges a member onto its guest, sends only hashes, and returns no emails', async () => {
    const res = await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(res.body).toEqual({ memberLookup: 'ok', members: { g1: memberA } });
    expect(JSON.stringify(res.body)).not.toContain('@');
    const sent = lookup.mock.calls[0][0];
    expect(sent.emailHashes).toEqual([hashEmail('a@example.com'), hashEmail('b@example.com')]);
    expect(JSON.stringify(sent)).not.toContain('@');
    expect(lookup.mock.calls[0][1]).toEqual({ maxIdentifiers: 500 });
  });
  it('lookup failure -> 200 unavailable (all tags plain)', async () => {
    lookup.mockResolvedValue(null);
    const res = await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ memberLookup: 'unavailable', members: {} });
  });
  it('setting off (or unset): disabled, no lookup', async () => {
    for (const v of [0, null]) {
      setting(v);
      const res = await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth());
      expect(res.body).toEqual({ memberLookup: 'disabled', members: {} });
    }
    expect(lookup).not.toHaveBeenCalled();
    expect(mockPrisma.guest.findMany).not.toHaveBeenCalled();
  });
  it('scope 1 allows only events in a series', async () => {
    setting(1);
    let res = await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth());
    expect(res.body.memberLookup).toBe('disabled');
    mockPrisma.party.findUnique.mockResolvedValue({ id: PARTY, eventSeriesId: 'series-1', eventType: 'gpp', cancelledAt: null });
    res = await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth());
    expect(res.body.memberLookup).toBe('ok');
  });
  it('failed settings read fails closed', async () => {
    mockPrisma.appConfig.findMany.mockRejectedValue(new Error('db'));
    const res = await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth());
    expect(res.body.memberLookup).toBe('disabled');
  });
  it('400 bad id, 404 unknown party', async () => {
    expect((await request(app()).get('/api/parties/nope/nametags').set('Authorization', auth())).status).toBe(400);
    mockPrisma.party.findUnique.mockResolvedValue(null);
    expect((await request(app()).get(`/api/parties/${PARTY}/nametags`).set('Authorization', auth())).status).toBe(404);
  });
});

describe('GET /api/parties/:id/nametags/status', () => {
  it('reports availability from the scope setting, behind guests access', async () => {
    let res = await request(app()).get(`/api/parties/${PARTY}/nametags/status`).set('Authorization', auth());
    expect(res.body).toEqual({ available: true });
    setting(0);
    res = await request(app()).get(`/api/parties/${PARTY}/nametags/status`).set('Authorization', auth());
    expect(res.body).toEqual({ available: false });
    canTab.mockResolvedValue(false);
    expect((await request(app()).get(`/api/parties/${PARTY}/nametags/status`).set('Authorization', auth())).status).toBe(403);
  });
});

describe('admin settings', () => {
  const superAdmin = () => mockPrisma.admin.findUnique.mockResolvedValue({ role: 'super_admin' });
  it('rejects non super admins', async () => {
    expect((await request(app()).get('/api/admin/nametags/settings').set('Authorization', auth())).status).toBe(403);
    expect((await request(app()).put('/api/admin/nametags/settings').set('Authorization', auth()).send({ key: 'nametags.scope', value: 1 })).status).toBe(403);
  });
  it('lists both settings with their defaults (off)', async () => {
    superAdmin();
    setting(null);
    const res = await request(app()).get('/api/admin/nametags/settings').set('Authorization', auth());
    expect(res.status).toBe(200);
    expect(res.body.settings.map((s: any) => [s.key, s.value])).toEqual([['nametags.scope', 0], ['nametags.maxIdentifiers', 500]]);
  });
  it('changes a setting (audited), refuses unknown keys and out-of-range values', async () => {
    superAdmin();
    setting(0, 500);
    let res = await request(app()).put('/api/admin/nametags/settings').set('Authorization', auth()).send({ key: 'nametags.scope', value: 1 });
    expect(res.body).toEqual({ ok: true, value: 1 });
    expect(mockPrisma.appConfigAudit.create).toHaveBeenCalled();
    res = await request(app()).put('/api/admin/nametags/settings').set('Authorization', auth()).send({ key: 'nametags.scope', value: 5 });
    expect(res.status).toBe(400);
    res = await request(app()).put('/api/admin/nametags/settings').set('Authorization', auth()).send({ key: 'other', value: 1 });
    expect(res.status).toBe(400);
  });
});
