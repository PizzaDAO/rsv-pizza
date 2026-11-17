import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  prisma: {
    partyKit: { findMany: vi.fn(), count: vi.fn(), groupBy: vi.fn() },
    party: { count: vi.fn(), findMany: vi.fn() },
  },
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = 'u1'; req.userEmail = 'boss@example.org'; next(); },
  isAdmin: async () => true,
  AuthRequest: {},
}));

import router from './shipping.routes.js';
import { notBrandOnlyApproved } from '../lib/partyApproval.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/shipping', router);
app.use(errorHandler);

const lastPartyWhere = (fn: ReturnType<typeof vi.fn>) => fn.mock.calls.at(-1)![0].where;

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.partyKit.findMany.mockResolvedValue([]);
  m.prisma.party.count.mockResolvedValue(0);
  m.prisma.party.findMany.mockResolvedValue([]);
});

// Kits cost PizzaDAO money: a brand-admin-only approval must not make a party kit-eligible.
describe('shipping kit lists exclude brand-admin-only approvals', () => {
  it('GET /stats (no-request count)', async () => {
    await request(app).get('/api/shipping/stats');
    const where = lastPartyWhere(m.prisma.party.count);
    expect(where.underbossStatus).toBe('approved');
    expect(where.NOT).toEqual(notBrandOnlyApproved.NOT);
  });

  it('GET /kits/export (placeholder parties)', async () => {
    await request(app).get('/api/shipping/kits/export');
    const where = lastPartyWhere(m.prisma.party.findMany);
    expect(where.underbossStatus).toBe('approved');
    expect(where.NOT).toEqual(notBrandOnlyApproved.NOT);
  });

  it('GET /kits (placeholder parties)', async () => {
    await request(app).get('/api/shipping/kits');
    const where = lastPartyWhere(m.prisma.party.findMany);
    expect(where.underbossStatus).toBe('approved');
    expect(where.NOT).toEqual(notBrandOnlyApproved.NOT);
  });
});
