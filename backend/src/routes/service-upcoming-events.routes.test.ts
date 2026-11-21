import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
  payout: { findMany: vi.fn() },
  partyTelegramHost: { findMany: vi.fn() },
  party: { findMany: vi.fn() },
  guest: { groupBy: vi.fn() },
  $queryRaw: vi.fn(),
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import serviceRouter from './service.routes.js';
import { errorHandler } from '../middleware/error.js';
import { brandUrl } from '../config/brand.js';
import { upcomingWhere } from '../lib/upcomingEvents.js';

const KEY = 'test-service-key-0123456789abcdef';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/service', serviceRouter);
  a.use(errorHandler);
  return a;
}

const post = (body: unknown, key: string | null = KEY) => {
  const r = request(app()).post('/api/service/upcoming-events');
  if (key !== null) r.set('x-service-key', key);
  return r.send(body as object);
};

const party = (o: Record<string, unknown> = {}) => ({
  id: 'p1',
  name: 'Global Pizza Party Lisbon',
  inviteCode: 'inv123',
  customUrl: 'lisbon',
  date: new Date('2099-05-22T18:00:00Z'),
  timezone: 'Europe/Lisbon',
  city: 'Lisbon',
  latitude: 38.7,
  longitude: -9.1,
  addressIsCityDefault: false,
  maxGuests: null,
  rsvpClosedAt: null,
  eventType: 'gpp',
  ...o,
});

describe('POST /api/service/upcoming-events', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.PIZZADAO_SERVICE_KEY = KEY;
    process.env.UPCOMING_EVENTS_ENABLED = '1';
    mockPrisma.party.findMany.mockResolvedValue([]);
    mockPrisma.guest.groupBy.mockResolvedValue([]);
  });
  afterEach(() => {
    delete process.env.PIZZADAO_SERVICE_KEY;
    delete process.env.UPCOMING_EVENTS_ENABLED;
  });

  it('auth: 503 unconfigured, 401 wrong or missing key, 503 when the flag is off; never touches the DB', async () => {
    delete process.env.PIZZADAO_SERVICE_KEY;
    expect((await post({})).status).toBe(503);
    process.env.PIZZADAO_SERVICE_KEY = KEY;
    expect((await post({}, null)).status).toBe(401);
    expect((await post({}, 'wrong-key')).status).toBe(401);
    delete process.env.UPCOMING_EVENTS_ENABLED;
    const off = await post({});
    expect(off.status).toBe(503);
    expect(off.body).toEqual({ ok: false, reason: 'disabled' });
    expect(mockPrisma.party.findMany).not.toHaveBeenCalled();
  });

  it('the visibility predicate: curated, public, future, not cancelled, with coordinates', () => {
    const now = new Date('2099-01-01T00:00:00Z');
    const until = new Date('2099-02-01T00:00:00Z');
    const w = upcomingWhere(now, until);
    expect(w.underbossStatus).toEqual({ in: ['approved', 'listed'] });
    expect(w.cancelledAt).toBeNull();
    expect(w.password).toBeNull();
    expect(w.date).toEqual({ gt: now, lte: until });
    expect(w.latitude).toEqual({ not: null });
    expect(w.longitude).toEqual({ not: null });
    expect(JSON.stringify(w.AND)).toContain('"private"');
    expect(JSON.stringify(w.AND)).toContain('"gpp"');
    expect(JSON.stringify(w.AND)).toContain('eventSeriesId');
  });

  it('queries with that predicate, soonest first, and selects no host or guest or address column', async () => {
    await post({});
    const args = mockPrisma.party.findMany.mock.calls[0][0];
    expect(args.where.underbossStatus).toEqual({ in: ['approved', 'listed'] });
    expect(args.orderBy).toEqual({ date: 'asc' });
    expect(args.take).toBe(500);
    const cols = Object.keys(args.select);
    for (const forbidden of ['address', 'user', 'userId', 'guests', 'coHosts', 'password', 'venueName', 'hostName', 'email', 'notes']) {
      expect(cols).not.toContain(forbidden);
    }
  });

  it('returns only the contract fields, with the public link, and no PII', async () => {
    mockPrisma.party.findMany.mockResolvedValue([party(), party({ id: 'p2', customUrl: null, eventType: 'standard', addressIsCityDefault: true })]);
    const r = await post({});
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
    expect(r.body.events).toHaveLength(2);
    expect(Object.keys(r.body.events[0]).sort()).toEqual(
      ['addressIsCityDefault', 'city', 'date', 'eventId', 'full', 'kind', 'latitude', 'longitude', 'name', 'rsvpClosed', 'timezone', 'url'].sort(),
    );
    expect(r.body.events[0]).toMatchObject({ eventId: 'p1', url: brandUrl('lisbon'), kind: 'gpp', full: false, rsvpClosed: false });
    expect(r.body.events[1]).toMatchObject({ url: brandUrl('inv123'), kind: 'series', addressIsCityDefault: true });
  });

  it('marks full (from a guest count, never guest rows) and rsvp closed', async () => {
    mockPrisma.party.findMany.mockResolvedValue([
      party({ id: 'a', maxGuests: 10 }),
      party({ id: 'b', maxGuests: 10 }),
      party({ id: 'c', rsvpClosedAt: new Date() }),
    ]);
    mockPrisma.guest.groupBy.mockResolvedValue([
      { partyId: 'a', _count: { _all: 10 } },
      { partyId: 'b', _count: { _all: 3 } },
    ]);
    const r = await post({});
    const by = Object.fromEntries(r.body.events.map((e: { eventId: string }) => [e.eventId, e]));
    expect(by.a.full).toBe(true);
    expect(by.b.full).toBe(false);
    expect(by.c.rsvpClosed).toBe(true);
    const g = mockPrisma.guest.groupBy.mock.calls[0][0];
    expect(g.by).toEqual(['partyId']);
    expect(g.where.partyId).toEqual({ in: ['a', 'b'] });
  });

  it('validates the body: until is an ISO date (capped), limit 1..500', async () => {
    expect((await post({ until: 'nope' })).status).toBe(400);
    expect((await post({ until: 5 })).status).toBe(400);
    expect((await post({ limit: 0 })).status).toBe(400);
    expect((await post({ limit: 501 })).status).toBe(400);
    expect((await post({ limit: 1.5 })).status).toBe(400);
    expect((await post({ until: '2099-01-01T00:00:00Z', limit: 5 })).status).toBe(200);
    const args = mockPrisma.party.findMany.mock.calls.at(-1)![0];
    expect(args.take).toBe(5);
    // A far-future until is capped (120 days), not honoured.
    await post({ until: '2999-01-01T00:00:00Z' });
    const capped = mockPrisma.party.findMany.mock.calls.at(-1)![0].where.date.lte as Date;
    expect(capped.getTime() - Date.now()).toBeLessThan(121 * 24 * 3600 * 1000);
  });
});
