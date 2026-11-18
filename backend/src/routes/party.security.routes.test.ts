/**
 * Security regressions for PATCH /api/parties/:id (sec-rsvp-party):
 *  - co-host list can only be changed by the owner / an admin (tab-restricted co-host escalation)
 *  - reimbursementCapUsd needs an in-scope underboss who is not the owner / a co-host
 *  - party/guest webhooks are keyed to the PARTY OWNER, not the acting user
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';
const roles = vi.hoisted(() => ({} as Record<string, string>));

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  guest: { create: vi.fn(), delete: vi.fn(), findFirst: vi.fn(), findMany: vi.fn(), update: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  user: { findUnique: vi.fn(), findMany: vi.fn() },
  eventSeries: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
  admin: { findUnique: vi.fn() },
  graphicsAdmin: { findUnique: vi.fn() },
  $queryRaw: vi.fn(async () => []),
  $executeRaw: vi.fn(async () => 1),
  $transaction(fn: any) { return fn(this); },
}));

process.env.JWT_SECRET ??= 'test-secret-rsvp-overwrite-fix-0123456789';
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));
vi.mock('./rsvp.routes.js', () => ({ sendApprovalEmail: vi.fn(), sendPromotionEmail: vi.fn() }));
vi.mock('../lib/privateConfig.js', () => ({
  getReimbursementRules: vi.fn(),
  getOperationalLimits: async () => ({ importHardCap: 2000, photoPerUserPerEvent: 30 }),
  getGppGlobalEditors: async () => [],
}));
vi.mock('../middleware/auth.js', () => {
  const parse = (req: any) => {
    const h = req.headers.authorization;
    if (h?.startsWith('Bearer ')) {
      try {
        const d = jwt.verify(h.split(' ')[1], JWT_SECRET) as any;
        req.userId = d.userId;
        req.userEmail = d.email;
      } catch { /* anonymous */ }
    }
  };
  return {
    requireAuth: (req: any, res: any, next: any) => {
      parse(req);
      if (!req.userId) return res.status(401).json({ error: { code: 'UNAUTHORIZED' } });
      next();
    },
    optionalAuth: (req: any, _res: any, next: any) => { parse(req); next(); },
    isSuperAdmin: async (e?: string) => !!e && roles[e] === 'super_admin',
    isPaymentAdmin: async (e?: string) => !!e && ['payment_admin', 'admin', 'super_admin'].includes(roles[e] ?? ''),
    isAdmin: async (e?: string) => !!e && ['admin', 'super_admin'].includes(roles[e] ?? ''),
    isUnderboss: async (e?: string) => !!e && roles[e] === 'underboss',
    AuthRequest: {},
  };
});
vi.mock('../helpers/underbossScope.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers/underbossScope.js')>();
  return { ...actual, getUnderbossScope: async () => ({ isAdmin: false, regions: ['LATAM'], cities: [] }) };
});

import partyRoutes from './party.routes.js';
import { triggerWebhook } from '../services/webhook.service.js';
import { errorHandler } from '../middleware/error.js';

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', partyRoutes);
  a.use(errorHandler);
  return a;
};
const token = (userId: string, email: string) => jwt.sign({ userId, email }, JWT_SECRET, { expiresIn: '1h' });

const PARTY_ID = '00000000-0000-0000-0000-000000000001';
const OWNER = { id: 'owner-1', email: 'owner@example.org' };
const COHOST = { id: 'co-1', email: 'cohost@example.org' };

const RESTRICTED = { id: 'ch-1', email: COHOST.email, canEdit: true, allowedTabs: ['guests'] };
const OTHER_CH = { id: 'ch-2', email: 'second@example.org', canEdit: true };

function setParty(extra: Record<string, unknown> = {}) {
  const party = {
    id: PARTY_ID,
    userId: OWNER.id,
    coHosts: [RESTRICTED, OTHER_CH],
    eventTags: [],
    eventType: 'gpp',
    region: 'LATAM',
    city: 'Lima',
    name: 'Event',
    ...extra,
  };
  mockPrisma.party.findUnique.mockResolvedValue(party);
  mockPrisma.party.update.mockResolvedValue({ ...party, user: { name: 'H' } });
  return party;
}
const patch = (who: { id: string; email: string }, body: Record<string, unknown>) =>
  request(app()).patch(`/api/parties/${PARTY_ID}`).set('Authorization', `Bearer ${token(who.id, who.email)}`).send(body);
const written = () => mockPrisma.party.update.mock.calls[0]?.[0]?.data;

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(roles)) delete roles[k];
});

describe('PATCH co-hosts: owner/admin only', () => {
  it('rejects a tab-restricted co-host dropping their own allowedTabs', async () => {
    setParty();
    const res = await patch(COHOST, { coHosts: [{ id: 'ch-1', email: COHOST.email, canEdit: true }, OTHER_CH] });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN_COHOSTS');
    expect(mockPrisma.party.update).not.toHaveBeenCalled();
  });

  it('rejects a co-host removing another co-host or adding one', async () => {
    setParty();
    expect((await patch(COHOST, { coHosts: [RESTRICTED] })).status).toBe(403);
    expect((await patch(COHOST, { coHosts: [RESTRICTED, OTHER_CH, { id: 'x', email: 'x@example.org', canEdit: true }] })).status).toBe(403);
    expect(mockPrisma.party.update).not.toHaveBeenCalled();
  });

  it('writes a co-host cosmetic edit (never 200 without writing)', async () => {
    setParty();
    const res = await patch(COHOST, { name: 'Renamed', coHosts: [OTHER_CH, { ...RESTRICTED, avatar: 'a.png' }] });
    expect(res.status).toBe(200);
    expect(written().name).toBe('Renamed');
    expect(written().coHosts).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'ch-1', avatar: 'a.png' })]));
  });

  it('lets a co-host add/remove non-editor entries', async () => {
    setParty({ coHosts: [RESTRICTED, OTHER_CH, { id: 'p1', email: 'p@example.org', name: 'P' }] });
    const res = await patch(COHOST, { coHosts: [RESTRICTED, OTHER_CH, { id: 'n1', name: 'New partner' }] });
    expect(res.status).toBe(200);
    expect(written().coHosts).toHaveLength(3);
  });

  it('lets an in-scope underboss change the list', async () => {
    setParty();
    roles['ub@example.org'] = 'underboss';
    const res = await patch({ id: 'ub-1', email: 'ub@example.org' }, { coHosts: [RESTRICTED] });
    expect(res.status).toBe(200);
    expect(written().coHosts).toEqual([expect.objectContaining({ id: 'ch-1' })]);
  });

  it('lets the owner change the list', async () => {
    setParty();
    const res = await patch(OWNER, { coHosts: [RESTRICTED] });
    expect(res.status).toBe(200);
    expect(written().coHosts).toEqual([expect.objectContaining({ id: 'ch-1' })]);
  });

  it('lets an admin change the list', async () => {
    setParty();
    roles['admin@example.org'] = 'admin';
    const res = await patch({ id: 'admin-1', email: 'admin@example.org' }, { coHosts: [] });
    expect(res.status).toBe(200);
    expect(written().coHosts).toEqual([]);
  });
});

describe('PATCH reimbursementCapUsd: in-scope underboss, never self', () => {
  const UB = { id: 'ub-1', email: 'ub@example.org' };

  it('in-scope underboss (not owner/co-host) can set it', async () => {
    roles[UB.email] = 'underboss';
    setParty(); // gpp + LATAM = in scope
    const res = await patch(UB, { reimbursementCapUsd: 250 });
    expect(res.status).toBe(200);
    expect(written().reimbursementCapUsd).toBe(250);
  });

  it('out-of-scope underboss is silently dropped', async () => {
    roles[UB.email] = 'underboss';
    // non-gpp party the underboss can edit only as a co-host, in a region outside their scope
    setParty({ eventType: null, region: 'EUROPE', coHosts: [{ id: 'u', email: UB.email, canEdit: true }] });
    const res = await patch(UB, { name: 'x', reimbursementCapUsd: 9999 });
    expect(res.status).toBe(200);
    expect(written()).not.toHaveProperty('reimbursementCapUsd');
  });

  it('underboss who OWNS the party cannot set the cap even in scope', async () => {
    roles[UB.email] = 'underboss';
    setParty({ userId: UB.id });
    const res = await patch(UB, { name: 'x', reimbursementCapUsd: 9999 });
    expect(res.status).toBe(200);
    expect(written()).not.toHaveProperty('reimbursementCapUsd');
  });

  it('underboss who CO-HOSTS the party cannot set the cap even in scope', async () => {
    roles[UB.email] = 'underboss';
    setParty({ coHosts: [{ id: 'u', email: UB.email, canEdit: true }] });
    const res = await patch(UB, { name: 'x', reimbursementCapUsd: 9999 });
    expect(res.status).toBe(200);
    expect(written()).not.toHaveProperty('reimbursementCapUsd');
  });

  it('admin is unchanged', async () => {
    roles['admin@example.org'] = 'admin';
    setParty();
    const res = await patch({ id: 'a', email: 'admin@example.org' }, { reimbursementCapUsd: 5000 });
    expect(res.status).toBe(200);
    expect(written().reimbursementCapUsd).toBe(5000);
  });
});

describe('webhooks are sent with the party owner id', () => {
  it('a co-host editing the party fires party.updated for the OWNER', async () => {
    setParty();
    const res = await patch(COHOST, { name: 'Renamed' });
    expect(res.status).toBe(200);
    expect(triggerWebhook).toHaveBeenCalledWith('party.updated', expect.anything(), OWNER.id);
  });

  it('a co-host adding a guest fires guest.registered for the OWNER', async () => {
    setParty();
    mockPrisma.guest.create.mockResolvedValue({ id: 'g1', name: 'G' });
    const res = await request(app())
      .post(`/api/parties/${PARTY_ID}/guests`)
      .set('Authorization', `Bearer ${token(COHOST.id, COHOST.email)}`)
      .send({ name: 'G', email: 'g@example.org' });
    expect([200, 201]).toContain(res.status);
    expect(triggerWebhook).toHaveBeenCalledWith('guest.registered', expect.anything(), OWNER.id);
  });
});
