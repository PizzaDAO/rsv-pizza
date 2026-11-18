/**
 * PATCH /api/underboss/events/bulk-event-tags: 'go', 'possible-scam' and
 * numeric / party-kit cap tags are payment-admin only (same rule as the party
 * PATCH). Normal tags stay open to scoped underbosses.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  isPaymentAdmin: vi.fn(),
  prisma: { party: { findMany: vi.fn(), update: vi.fn(), findUnique: vi.fn() } },
}));

vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userEmail = req.headers['x-user-email'];
    next();
  },
  isAdmin: vi.fn().mockResolvedValue(false),
  isPaymentAdmin: m.isPaymentAdmin,
}));
vi.mock('../middleware/underbossAuth.js', () => ({
  requireUnderbossAuth: (req: any, _res: any, next: any) => {
    req.underboss = { id: 'u1', name: 'U', email: req.userEmail, region: 'usa', regions: ['usa'], cities: [], isActive: true };
    next();
  },
}));
vi.mock('../helpers/partnerSync.js', () => ({
  addPartnerToParty: vi.fn(),
  removePartnerFromParty: vi.fn(),
  getAutoCoHostPartners: vi.fn().mockResolvedValue([]),
}));

import underbossRouter from './underboss.routes.js';
import { errorHandler } from '../middleware/error.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/underboss', underbossRouter);
  a.use(errorHandler);
  return a;
}

const H = { 'x-user-email': 'ub@example.com' };
const URL = '/api/underboss/events/bulk-event-tags';
const inScope = (id: string) => ({ id, region: 'usa', city: 'X', name: 'Global Pizza Party X', eventType: 'gpp' });

function stored(tags: Record<string, string[]>) {
  m.prisma.party.findMany.mockImplementation(async (args: any) => {
    const ids: string[] = args.where.id.in;
    return ids.map((id) => ({ ...inScope(id), eventTags: tags[id] ?? [] }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  m.isPaymentAdmin.mockResolvedValue(false);
  m.prisma.party.update.mockResolvedValue({});
  m.prisma.party.findUnique.mockResolvedValue(null);
});

describe('bulk-event-tags guard', () => {
  it('underboss can add and remove normal tags', async () => {
    stored({ p1: ['review'] });
    const add = await request(app()).patch(URL).set(H).send({ partyIds: ['p1'], tags: ['swc'], action: 'add' });
    expect(add.status).toBe(200);
    expect(m.prisma.party.update).toHaveBeenCalledWith({ where: { id: 'p1' }, data: { eventTags: ['review', 'swc'] } });
    const rm = await request(app()).patch(URL).set(H).send({ partyIds: ['p1'], tags: ['review'], action: 'remove' });
    expect(rm.status).toBe(200);
    expect(m.prisma.party.update).toHaveBeenLastCalledWith({ where: { id: 'p1' }, data: { eventTags: [] } });
  });

  it.each(['go', ' GO ', 'possible-scam', 'Possible-Scam ', '200', '350.50', 'k40', ' K40 '])(
    'underboss blocked adding %j',
    async (tag) => {
      stored({ p1: [] });
      const r = await request(app()).patch(URL).set(H).send({ partyIds: ['p1'], tags: [tag], action: 'add' });
      expect(r.status).toBe(403);
      expect(r.body.error.code).toBe('FORBIDDEN_TAG');
      expect(m.prisma.party.update).not.toHaveBeenCalled();
    },
  );

  it.each(['go', 'possible-scam', '200', 'k40'])('underboss blocked removing %j', async (tag) => {
    stored({ p1: [tag] });
    const r = await request(app())
      .patch(URL)
      .set(H)
      .send({ partyIds: ['p1'], tags: [` ${tag.toUpperCase()} `], action: 'remove' });
    expect(r.status).toBe(403);
    expect(m.prisma.party.update).not.toHaveBeenCalled();
  });

  it('blocks the whole batch if any party would change a guarded tag (set drops one)', async () => {
    stored({ p1: [], p2: ['go'] });
    const r = await request(app()).patch(URL).set(H).send({ partyIds: ['p1', 'p2'], tags: ['review'], action: 'set' });
    expect(r.status).toBe(403);
    expect(m.prisma.party.update).not.toHaveBeenCalled();
  });

  it('does not block when a guarded tag is already present and unchanged', async () => {
    stored({ p1: ['go', '200'] });
    const r = await request(app()).patch(URL).set(H).send({ partyIds: ['p1'], tags: ['go'], action: 'add' });
    expect(r.status).toBe(200);
  });

  it('payment admin can change guarded tags and possible-scam is logged with actor', async () => {
    m.isPaymentAdmin.mockResolvedValue(true);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    stored({ p1: [] });
    for (const tag of ['go', 'possible-scam', '200']) {
      const r = await request(app()).patch(URL).set(H).send({ partyIds: ['p1'], tags: [tag], action: 'add' });
      expect(r.status).toBe(200);
    }
    expect(m.prisma.party.update).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledWith(expect.stringMatching(/possible-scam-tag\] party=p1 action=flag actor=ub@example.com/));
    log.mockRestore();
  });
});
