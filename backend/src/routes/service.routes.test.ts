import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  payout: { findMany: vi.fn() },
  partyTelegramHost: { findMany: vi.fn() },
  party: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import serviceRouter, { safeEqual } from './service.routes.js';
import { parseIdentifiers, telegramVariants, IdentifierError } from '../lib/gppHostLookup.js';
import { errorHandler } from '../middleware/error.js';

const KEY = 'test-service-key-0123456789abcdef';
const WALLET = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/service', serviceRouter);
  a.use(errorHandler);
  return a;
}

function party(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p1',
    customUrl: 'lisbon',
    inviteCode: 'inv1',
    city: 'Lisbon',
    underbossStatus: 'approved',
    eventType: 'gpp',
    date: new Date('2026-05-22T18:00:00Z'),
    userId: null,
    coHosts: [],
    ...overrides,
  };
}

const post = (body: unknown, key: string | null = KEY) => {
  const r = request(app()).post('/api/service/gpp-host-lookup');
  if (key !== null) r.set('x-service-key', key);
  return r.send(body as object);
};

describe('POST /api/service/gpp-host-lookup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIZZADAO_SERVICE_KEY = KEY;
    mockPrisma.user.findMany.mockResolvedValue([]);
    mockPrisma.payout.findMany.mockResolvedValue([]);
    mockPrisma.partyTelegramHost.findMany.mockResolvedValue([]);
    mockPrisma.party.findMany.mockResolvedValue([]);
    mockPrisma.$queryRaw.mockResolvedValue([]);
  });
  afterEach(() => {
    delete process.env.PIZZADAO_SERVICE_KEY;
  });

  describe('auth', () => {
    it('503 when PIZZADAO_SERVICE_KEY is unset (and never touches the DB)', async () => {
      delete process.env.PIZZADAO_SERVICE_KEY;
      const res = await post({ email: 'a@b.co' });
      expect(res.status).toBe(503);
      expect(res.body).toEqual({ ok: false, reason: 'not configured' });
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('401 without the header or with a wrong key', async () => {
      expect((await post({ email: 'a@b.co' }, null)).status).toBe(401);
      expect((await post({ email: 'a@b.co' }, 'nope')).status).toBe(401);
      expect((await post({ email: 'a@b.co' }, KEY + 'x')).status).toBe(401);
      expect(mockPrisma.user.findMany).not.toHaveBeenCalled();
    });

    it('safeEqual compares regardless of length', () => {
      expect(safeEqual('abc', 'abc')).toBe(true);
      expect(safeEqual('abc', 'abcd')).toBe(false);
      expect(safeEqual('', 'a')).toBe(false);
    });
  });

  describe('validation', () => {
    it('400 when no identifier is given', async () => {
      const res = await post({});
      expect(res.status).toBe(400);
      expect(res.body.ok).toBe(false);
    });

    it('400 on malformed identifiers', async () => {
      expect((await post({ email: 'not-an-email' })).status).toBe(400);
      expect((await post({ wallet: '0x123' })).status).toBe(400);
      expect((await post({ telegram: 'a b' })).status).toBe(400);
      expect((await post({ emails: Array.from({ length: 11 }, (_, i) => `u${i}@x.io`) })).status).toBe(400);
    });

    it('normalizes identifiers', () => {
      const ids = parseIdentifiers({
        email: ' Host@Example.COM ',
        emails: ['host@example.com'],
        wallets: [WALLET],
        telegrams: ['@CityHost', 'https://t.me/other_host/'],
      });
      expect(ids).toEqual({
        emails: ['host@example.com'],
        wallets: [WALLET.toLowerCase()],
        telegrams: ['cityhost', 'other_host'],
      });
      expect(() => parseIdentifiers(null)).toThrow(IdentifierError);
      expect(telegramVariants(['foo'])).toEqual(['foo', '@foo', 't.me/foo', 'https://t.me/foo', 'http://t.me/foo']);
    });
  });

  describe('lookup', () => {
    it('no match: matched=false, empty list, no party query', async () => {
      const res = await post({ email: 'nobody@example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, matched: false, events: [] });
      expect(mockPrisma.party.findMany).not.toHaveBeenCalled();
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('owner matched by email: minimal fields only', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'Host@Example.com', telegram: null, payoutWalletAddress: null },
      ]);
      mockPrisma.party.findMany.mockResolvedValue([party({ userId: 'u1', coHosts: [{ email: 'secret@x.io', name: 'Someone' }] })]);

      const res = await post({ email: 'host@example.com' });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        ok: true,
        matched: true,
        events: [
          { slug: 'lisbon', city: 'Lisbon', status: 'approved', type: 'gpp', date: '2026-05-22T18:00:00.000Z', role: 'host', matchedBy: ['email'] },
        ],
      });
      // No PII leaks: no other co-host data, names, ids.
      expect(JSON.stringify(res.body)).not.toMatch(/secret@x\.io|Someone|u1|p1/);

      // Only GPP + approved/listed + not cancelled events are queried.
      const where = mockPrisma.party.findMany.mock.calls[0][0].where;
      expect(where).toMatchObject({ eventType: 'gpp', underbossStatus: { in: ['approved', 'listed'] }, cancelledAt: null });
      expect(where.OR).toEqual([{ userId: { in: ['u1'] } }]);
      // Case-insensitive account lookup.
      expect(mockPrisma.user.findMany.mock.calls[0][0].where.OR).toEqual([
        { email: { in: ['host@example.com'], mode: 'insensitive' } },
      ]);
    });

    it('co-host / underboss matched in co_hosts by email or Telegram', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'p2' }, { id: 'p3' }]);
      mockPrisma.party.findMany.mockResolvedValue([
        party({ id: 'p2', customUrl: null, inviteCode: 'abc123', city: 'Lagos', coHosts: [{ email: 'UB@pizzadao.xyz', isUnderboss: true }] }),
        party({ id: 'p3', customUrl: 'porto', city: 'Porto', underbossStatus: 'listed', date: null, coHosts: [{ telegram: '@CityHost' }] }),
      ]);

      const res = await post({ email: 'ub@pizzadao.xyz', telegram: 'cityhost' });
      expect(res.body.events).toEqual([
        { slug: 'abc123', city: 'Lagos', status: 'approved', type: 'gpp', date: '2026-05-22T18:00:00.000Z', role: 'underboss', matchedBy: ['email'] },
        { slug: 'porto', city: 'Porto', status: 'listed', type: 'gpp', date: null, role: 'cohost', matchedBy: ['telegram'] },
      ]);
      expect(mockPrisma.party.findMany.mock.calls[0][0].where.OR).toEqual([{ id: { in: ['p2', 'p3'] } }]);
    });

    it('wallet matches the account payout wallet and reimbursement payouts', async () => {
      mockPrisma.user.findMany.mockResolvedValue([
        { id: 'u9', email: 'w@x.io', telegram: null, payoutWalletAddress: WALLET.toLowerCase() },
      ]);
      mockPrisma.payout.findMany.mockResolvedValue([{ partyId: 'p5', hostUserId: 'u7' }]);
      mockPrisma.party.findMany.mockResolvedValue([
        party({ id: 'p4', customUrl: 'nyc', userId: 'u9' }),
        party({ id: 'p5', customUrl: 'sf', userId: 'someone-else' }),
      ]);

      const res = await post({ wallets: [WALLET] });
      expect(res.body.events.map((e: { slug: string; role: string; matchedBy: string[] }) => [e.slug, e.role, e.matchedBy])).toEqual([
        ['nyc', 'host', ['wallet']],
        ['sf', 'host', ['wallet']],
      ]);
      expect(mockPrisma.payout.findMany.mock.calls[0][0].where).toEqual({
        payoutWalletAddress: { in: [WALLET.toLowerCase()], mode: 'insensitive' },
      });
    });

    it('bot-verified host Telegram chats count as telegram_verified', async () => {
      mockPrisma.partyTelegramHost.findMany.mockResolvedValue([{ partyId: 'p6' }]);
      mockPrisma.party.findMany.mockResolvedValue([party({ id: 'p6', customUrl: 'rome' })]);
      const res = await post({ telegram: '@CityHost' });
      expect(res.body.events).toEqual([expect.objectContaining({ slug: 'rome', role: 'host', matchedBy: ['telegram_verified'] })]);
      expect(mockPrisma.partyTelegramHost.findMany.mock.calls[0][0].where.username.in).toContain('@cityhost');
    });

    it('drops a returned party that no identifier explains', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([{ id: 'p7' }]);
      mockPrisma.party.findMany.mockResolvedValue([party({ id: 'p7', coHosts: [{ email: 'someone@else.io' }] })]);
      const res = await post({ email: 'me@here.io' });
      expect(res.body).toEqual({ ok: true, matched: false, events: [] });
    });

    it('500 (not a leak) when the DB fails', async () => {
      mockPrisma.user.findMany.mockRejectedValue(new Error('db down'));
      const res = await post({ email: 'a@b.co' });
      expect(res.status).toBe(500);
    });
  });
});
