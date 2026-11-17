import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

const mockPrisma = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  payout: { findMany: vi.fn() },
  partyTelegramHost: { findMany: vi.fn() },
  party: { findMany: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import serviceRouter from './service.routes.js';
import { errorHandler } from '../middleware/error.js';

const KEY = 'test-service-key-0123456789abcdef';
const sha = (e: string) => crypto.createHash('sha256').update(e.trim().toLowerCase()).digest('hex');
const H1 = sha('Member@Example.org');
const H2 = sha('other@example.org');
const W1 = '0xAbCdEf0123456789aBcDeF0123456789AbCdEf01';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/service', serviceRouter);
  a.use(errorHandler);
  return a;
}

const post = (body: unknown, key: string | null = KEY) => {
  const r = request(app()).post('/api/service/guest-attendance');
  if (key !== null) r.set('x-service-key', key);
  return r.send(body as object);
};

const party = (o: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Slice Night',
  date: new Date('2026-05-22T18:00:00Z'),
  city: 'Lisbon',
  customUrl: 'lisbon',
  inviteCode: 'inv1',
  hideGuests: false,
  password: null,
  ...o,
});

describe('POST /api/service/guest-attendance', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIZZADAO_SERVICE_KEY = KEY;
    process.env.PIZZADAO_GUEST_LOOKUP_ENABLED = '1';
    mockPrisma.$queryRaw.mockResolvedValue([]);
    mockPrisma.party.findMany.mockResolvedValue([]);
  });
  afterEach(() => {
    delete process.env.PIZZADAO_SERVICE_KEY;
    delete process.env.PIZZADAO_GUEST_LOOKUP_ENABLED;
  });

  it('auth: 503 unconfigured, 401 wrong/missing key, 503 when the flag is off; never touches the DB', async () => {
    delete process.env.PIZZADAO_SERVICE_KEY;
    expect((await post({ emailHashes: [H1] })).status).toBe(503);
    process.env.PIZZADAO_SERVICE_KEY = KEY;
    expect((await post({ emailHashes: [H1] }, null)).status).toBe(401);
    expect((await post({ emailHashes: [H1] }, 'nope')).status).toBe(401);
    delete process.env.PIZZADAO_GUEST_LOOKUP_ENABLED;
    const off = await post({ emailHashes: [H1] });
    expect(off.status).toBe(503);
    expect(off.body).toEqual({ ok: false, reason: 'disabled' });
    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.party.findMany).not.toHaveBeenCalled();
  });

  it('returns exactly the PII-free event shape and sets no-store', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([{ party_id: 'p1', email_hash: H1, wallet: null }]);
    mockPrisma.party.findMany.mockResolvedValue([party()]);
    const res = await post({ emailHashes: [H1.toUpperCase()] });
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toBe('private, no-store');
    expect(Object.keys(res.body).sort()).toEqual(['events', 'ok']);
    expect(res.body.events).toHaveLength(1);
    expect(Object.keys(res.body.events[0]).sort()).toEqual(
      ['city', 'date', 'eventId', 'hideGuestList', 'matchedBy', 'name', 'url'],
    );
    expect(res.body.events[0]).toEqual({
      eventId: 'p1',
      name: 'Slice Night',
      date: '2026-05-22T18:00:00.000Z',
      city: 'Lisbon',
      url: 'https://rsv.pizza/lisbon',
      matchedBy: ['email'],
      hideGuestList: false,
    });
    // party select never asks for guests, emails or hosts
    const sel = mockPrisma.party.findMany.mock.calls[0][0].select;
    expect(Object.keys(sel).sort()).toEqual(
      ['city', 'customUrl', 'date', 'hideGuests', 'id', 'inviteCode', 'name', 'password'],
    );
  });

  it('merges email + wallet matches (wallet case-insensitive), flags hidden guest lists, nulls invite-only urls', async () => {
    mockPrisma.$queryRaw.mockResolvedValue([
      { party_id: 'p1', email_hash: H1, wallet: W1.toLowerCase() },
      { party_id: 'p2', email_hash: sha('stranger@x.org'), wallet: W1.toLowerCase() },
      { party_id: 'p3', email_hash: sha('stranger@x.org'), wallet: null }, // matches nothing we asked for
    ]);
    mockPrisma.party.findMany.mockResolvedValue([
      party(),
      party({ id: 'p2', hideGuests: true, password: 'x', customUrl: null }),
    ]);
    const res = await post({ emailHashes: [H1], wallets: [W1] });
    expect(res.status).toBe(200);
    const [a, b] = res.body.events;
    expect(a.matchedBy).toEqual(['email', 'wallet']);
    expect(b).toMatchObject({ eventId: 'p2', matchedBy: ['wallet'], hideGuestList: true, url: null });
    expect(mockPrisma.party.findMany.mock.calls[0][0].where.id.in.sort()).toEqual(['p1', 'p2']);
  });

  it('no rows -> empty events and no party query', async () => {
    const res = await post({ emailHashes: [H1] });
    expect(res.body).toEqual({ ok: true, events: [] });
    expect(mockPrisma.party.findMany).not.toHaveBeenCalled();
  });

  it('only qualifying guests are queried (checked in, not cancelled, not private)', async () => {
    await post({ emailHashes: [H1] });
    const sql = (mockPrisma.$queryRaw.mock.calls[0][0] as TemplateStringsArray).join('?');
    expect(sql).toContain('g.checked_in_at IS NOT NULL');
    expect(sql).toContain("g.status NOT IN ('CANCELLED', 'DECLINED')");
    expect(sql).toContain('p.cancelled_at IS NULL');
    expect(sql).toContain('p.event_type');
    expect(mockPrisma.$queryRaw.mock.calls[0].slice(1)).toContainEqual(['standard', 'gpp']);
  });

  describe('validation and limits', () => {
    it('400 on bad bodies', async () => {
      for (const body of [
        {},
        { emailHashes: [] },
        { emailHashes: ['not-a-hash'] },
        { emailHashes: 'abc' },
        { emailHashes: [123] },
        { wallets: ['nope'] },
        { wallets: ['1BoatSLRHtKNngkdXEeobR76b53LETtpyT'] }, // not EVM
        { emailHashes: [H1], dryRun: 'yes' },
        [H1],
      ]) {
        expect((await post(body)).status, JSON.stringify(body)).toBe(400);
      }
      expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    });

    it('enforces the 10-identifier limits', async () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => sha(`u${i}@x.org`));
      expect((await post({ emailHashes: many(10) })).status).toBe(200);
      expect((await post({ emailHashes: many(11) })).status).toBe(400);
      const wallets = (n: number) => Array.from({ length: n }, (_, i) => '0x' + i.toString(16).padStart(40, '0'));
      expect((await post({ wallets: wallets(10) })).status).toBe(200);
      expect((await post({ wallets: wallets(11) })).status).toBe(400);
    });
  });

  describe('dryRun', () => {
    it('returns only a match count of distinct hashes', async () => {
      mockPrisma.$queryRaw.mockResolvedValue([
        { party_id: 'p1', email_hash: H1, wallet: null },
        { party_id: 'p2', email_hash: H1, wallet: null },
        { party_id: 'p3', email_hash: H2, wallet: null },
        { party_id: 'p4', email_hash: sha('unasked@x.org'), wallet: null },
      ]);
      const res = await post({ dryRun: true, emailHashes: [H1, H2, sha('nobody@x.org')] });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true, dryRun: true, matchedMembers: 2 });
      expect(mockPrisma.party.findMany).not.toHaveBeenCalled();
    });

    it('accepts up to 100 hashes, rejects more, rejects wallets', async () => {
      const many = (n: number) => Array.from({ length: n }, (_, i) => sha(`u${i}@x.org`));
      expect((await post({ dryRun: true, emailHashes: many(100) })).status).toBe(200);
      expect((await post({ dryRun: true, emailHashes: many(101) })).status).toBe(400);
      expect((await post({ dryRun: true, emailHashes: [H1], wallets: [W1] })).status).toBe(400);
    });
  });
});
