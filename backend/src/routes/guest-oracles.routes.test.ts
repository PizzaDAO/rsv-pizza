/**
 * guest-oracles (guests-anon-exposure PR3): the two email-keyed endpoints that let an
 * unauthenticated caller test whether an email RSVP'd, or read/overwrite someone's
 * preferences, are now self-only.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret-guest-oracles';
const savedSecret = process.env.JWT_SECRET;
process.env.JWT_SECRET = JWT_SECRET;

const mockPrisma = vi.hoisted(() => ({
  party: { findUnique: vi.fn() },
  slugAlias: { findUnique: vi.fn(() => Promise.resolve(null)) },
  guest: { findFirst: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));

// Chainable supabase-js query builder stub that records every call.
const sb = vi.hoisted(() => {
  const calls: Array<[string, unknown[]]> = [];
  let result: { data: unknown; error: unknown } = { data: [], error: null };
  const builder: Record<string, unknown> = {};
  for (const m of ['from', 'select', 'ilike', 'eq', 'order', 'limit', 'upsert']) {
    builder[m] = (...args: unknown[]) => {
      calls.push([m, args]);
      return builder;
    };
  }
  builder.then = (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return {
    calls,
    builder,
    setResult(r: { data: unknown; error: unknown }) {
      result = r;
    },
  };
});
vi.mock('@supabase/supabase-js', () => ({ createClient: () => sb.builder }));

import rsvpRoutes from './rsvp.routes.js';
import preferencesRoutes from './preferences.routes.js';
import { errorHandler } from '../middleware/error.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/rsvp', rsvpRoutes);
  a.use('/api/preferences', preferencesRoutes);
  a.use(errorHandler);
  return a;
}

const token = (email: string) => jwt.sign({ userId: 'u1', email }, JWT_SECRET, { expiresIn: '1h' });
const auth = (email: string) => ({ Authorization: `Bearer ${token(email)}` });

const GUEST = { id: 'g1', name: 'Alice', email: 'alice@example.com', ethereumAddress: '0xabc', status: 'CONFIRMED' };

beforeEach(() => {
  vi.clearAllMocks();
  sb.calls.length = 0;
  sb.setResult({ data: [], error: null });
  mockPrisma.party.findUnique.mockResolvedValue({ id: 'p1' });
  mockPrisma.guest.findFirst.mockResolvedValue(GUEST);
});

afterAll(() => {
  if (savedSecret === undefined) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = savedSecret;
});

describe('GET /api/rsvp/:inviteCode/guest/:email', () => {
  it('returns 404 without touching the DB when logged out (no RSVP oracle)', async () => {
    const res = await request(app()).get('/api/rsvp/abc123/guest/alice%40example.com');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Guest not found' });
    expect(mockPrisma.guest.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 when logged in as a different email, even though the guest exists', async () => {
    const res = await request(app())
      .get('/api/rsvp/abc123/guest/alice%40example.com')
      .set(auth('mallory@example.com'));
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'Guest not found' });
    expect(mockPrisma.guest.findFirst).not.toHaveBeenCalled();
  });

  it('returns 404 for an invalid token', async () => {
    const res = await request(app())
      .get('/api/rsvp/abc123/guest/alice%40example.com')
      .set({ Authorization: 'Bearer not-a-jwt' });
    expect(res.status).toBe(404);
    expect(mockPrisma.guest.findFirst).not.toHaveBeenCalled();
  });

  it("returns the caller's own guest row (case-insensitive email match)", async () => {
    const res = await request(app())
      .get('/api/rsvp/abc123/guest/Alice%40Example.com')
      .set(auth('alice@example.com'));
    expect(res.status).toBe(200);
    expect(res.body.guest).toEqual(GUEST);
    expect(mockPrisma.guest.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { partyId: 'p1', email: 'alice@example.com' } })
    );
  });

  it('still 404s when the caller has not RSVPd', async () => {
    mockPrisma.guest.findFirst.mockResolvedValue(null);
    const res = await request(app())
      .get('/api/rsvp/abc123/guest/alice%40example.com')
      .set(auth('alice@example.com'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/preferences', () => {
  it('rejects logged-out callers with 401 and never queries', async () => {
    const res = await request(app()).get('/api/preferences?email=alice%40example.com');
    expect(res.status).toBe(401);
    expect(sb.calls).toHaveLength(0);
  });

  it("refuses to read someone else's preferences (403)", async () => {
    const res = await request(app())
      .get('/api/preferences?email=alice%40example.com')
      .set(auth('mallory@example.com'));
    expect(res.status).toBe(403);
    expect(sb.calls).toHaveLength(0);
  });

  it("returns the caller's own preferences, keyed on the JWT email", async () => {
    const prefs = { dietary_restrictions: ['vegan'], liked_toppings: [], disliked_toppings: [], liked_beverages: [], disliked_beverages: [] };
    sb.setResult({ data: [{ email: 'Alice@Example.com', ...prefs }], error: null });
    const res = await request(app())
      .get('/api/preferences?email=Alice%40Example.com')
      .set(auth('alice@example.com'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: prefs });
    expect(sb.calls).toContainEqual(['from', ['user_preferences']]);
    expect(sb.calls).toContainEqual(['ilike', ['email', 'alice@example.com']]);
  });

  it('works without an email query param (uses the JWT email)', async () => {
    const res = await request(app()).get('/api/preferences').set(auth('alice@example.com'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: null });
    expect(sb.calls).toContainEqual(['ilike', ['email', 'alice@example.com']]);
  });

  it("never returns another email's row even if the ILIKE pre-filter matches it", async () => {
    // e.g. a JWT email of `*@example.com`: PostgREST treats `*` like `%`.
    const prefs = { dietary_restrictions: ['vegan'], liked_toppings: [], disliked_toppings: [], liked_beverages: [], disliked_beverages: [] };
    sb.setResult({ data: [{ email: 'victim@example.com', ...prefs }], error: null });
    const res = await request(app()).get('/api/preferences').set(auth('*@example.com'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ preferences: null });
  });

  it('picks the exact-email row when the pre-filter also matched others', async () => {
    const mine = { dietary_restrictions: ['halal'], liked_toppings: [], disliked_toppings: [], liked_beverages: [], disliked_beverages: [] };
    sb.setResult({
      data: [
        { email: 'other@example.com', ...mine, dietary_restrictions: ['vegan'] },
        { email: ' Alice@example.com ', ...mine },
      ],
      error: null,
    });
    const res = await request(app()).get('/api/preferences').set(auth('alice@example.com'));
    expect(res.body).toEqual({ preferences: mine });
  });

  it('escapes LIKE wildcards so an email cannot match other rows', async () => {
    const res = await request(app()).get('/api/preferences').set(auth('a_b%c@example.com'));
    expect(res.status).toBe(200);
    expect(sb.calls).toContainEqual(['ilike', ['email', 'a\\_b\\%c@example.com']]);
  });
});

describe('POST /api/preferences', () => {
  const preferences = { dietary_restrictions: ['vegan'], liked_toppings: ['basil'] };

  it('rejects logged-out callers with 401 and never writes', async () => {
    const res = await request(app())
      .post('/api/preferences')
      .send({ email: 'alice@example.com', preferences });
    expect(res.status).toBe(401);
    expect(sb.calls).toHaveLength(0);
  });

  it("refuses to overwrite someone else's preferences (403)", async () => {
    const res = await request(app())
      .post('/api/preferences')
      .set(auth('mallory@example.com'))
      .send({ email: 'alice@example.com', preferences });
    expect(res.status).toBe(403);
    expect(sb.calls).toHaveLength(0);
  });

  it("upserts the caller's own row under the JWT email", async () => {
    const res = await request(app())
      .post('/api/preferences')
      .set(auth('alice@example.com'))
      .send({ email: 'Alice@Example.com', preferences });
    expect(res.status).toBe(200);
    const upsert = sb.calls.find(([m]) => m === 'upsert');
    expect(upsert).toBeDefined();
    const [row, opts] = upsert![1] as [Record<string, unknown>, unknown];
    expect(row.email).toBe('alice@example.com');
    expect(row.dietary_restrictions).toEqual(['vegan']);
    expect(row.disliked_toppings).toEqual([]);
    expect(opts).toEqual({ onConflict: 'email' });
  });

  it('400s without preferences', async () => {
    const res = await request(app()).post('/api/preferences').set(auth('alice@example.com')).send({});
    expect(res.status).toBe(400);
  });
});
