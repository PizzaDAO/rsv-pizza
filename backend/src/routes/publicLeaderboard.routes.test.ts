import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  party: {
    findMany: vi.fn(),
  },
}));

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

import publicLeaderboardRouter, {
  __testing,
} from './publicLeaderboard.routes.js';
import { errorHandler } from '../middleware/error.js';

function createTestApp() {
  const app = express();
  app.use(express.json());
  app.use('/api/leaderboard', publicLeaderboardRouter);
  app.use(errorHandler);
  return app;
}

function makeParty(overrides: Partial<any> = {}) {
  const defaults: any = {
    id: '00000000-0000-0000-0000-00000000000a',
    name: 'Global Pizza Party Test',
    customUrl: null,
    inviteCode: 'invite-' + (overrides.id ?? 'a'),
    city: 'Lagos',
    country: 'Nigeria',
    eventImageUrl: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    date: new Date('2026-05-10T00:00:00Z'),
    coHosts: [],
    user: null,
    guests: [],
    photos: [],
  };
  // Explicit spread so callers can override with `null` (the `??` form swaps
  // null for the default).
  return { ...defaults, ...overrides };
}

function guest(submittedVia: string, opts: Partial<any> = {}) {
  return {
    submittedVia,
    status: opts.status ?? 'CONFIRMED',
    approved: opts.approved ?? null,
    checkedInAt: opts.checkedInAt ?? null,
  };
}

describe('Public leaderboard route — stromboli-71593', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __testing.cache.clear();
  });

  describe('GET /api/leaderboard scoring', () => {
    it('applies the documented weights: link=1, invite=0.3, checkIn=2, photo=0.5', async () => {
      // Party has 2 link RSVPs (1 of which also checked in), 1 invite RSVP, and
      // 4 approved photos. Expected score:
      //   1.0*2  +  0.3*1  +  2.0*1  +  0.5*4  =  2 + 0.3 + 2 + 2 = 6.3
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          guests: [
            guest('link'),
            guest('link', { checkedInAt: new Date() }),
            guest('invite'),
          ],
          photos: [{ id: '1' }, { id: '2' }, { id: '3' }, { id: '4' }],
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      expect(res.body.parties.rows).toHaveLength(1);
      const row = res.body.parties.rows[0];
      expect(row.breakdown).toEqual({
        linkRsvps: 2,
        inviteRsvps: 1,
        checkIns: 1,
        photos: 4,
      });
      expect(row.score).toBe(6.3);
    });

    it('weights invite RSVPs at 0.3 (vs link at 1.0)', async () => {
      // Party A: 10 invite RSVPs only → 0.3*10 = 3.0
      // Party B: 3 link RSVPs only    → 1.0*3  = 3.0  (tied)
      // Party C: 10 link RSVPs only   → 1.0*10 = 10.0 (top)
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({ id: 'a', guests: Array(10).fill(0).map(() => guest('invite')) }),
        makeParty({ id: 'b', guests: Array(3).fill(0).map(() => guest('link')) }),
        makeParty({ id: 'c', guests: Array(10).fill(0).map(() => guest('link')) }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      const rows = res.body.parties.rows;
      expect(rows[0].id).toBe('c');
      expect(rows[0].score).toBe(10);
      // A and B tie at 3.0 — tiebreaker is checkIns, linkRsvps, createdAt.
      // Both have 0 check-ins, but B has more link RSVPs (3 vs 0) so B ranks above A.
      expect(rows[1].id).toBe('b');
      expect(rows[2].id).toBe('a');
    });

    it('caps photo count at 100 per party', async () => {
      // 500 photos but only 100 should count → 0.5*100 = 50
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          guests: [],
          photos: Array(500).fill(0).map((_, i) => ({ id: String(i) })),
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      expect(res.body.parties.rows[0].breakdown.photos).toBe(100);
      expect(res.body.parties.rows[0].score).toBe(50);
    });

    it('excludes host-submitted guests, declined RSVPs, and INVITED rows from scoring', async () => {
      // Only the 2 real link RSVPs should count. Score = 1.0*2 = 2.0.
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          guests: [
            guest('link'),
            guest('link'),
            guest('host'), // host self-add, excluded
            guest('host-checkin'), // host check-in flow, excluded
            guest('link', { approved: false }), // declined
            guest('invite', { status: 'INVITED' }), // bulk invite not yet converted
          ],
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      const row = res.body.parties.rows[0];
      expect(row.breakdown.linkRsvps).toBe(2);
      expect(row.breakdown.inviteRsvps).toBe(0);
      expect(row.score).toBe(2);
    });

    it('hides score-0 parties from the parties tab', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({ id: 'a', guests: [guest('link')] }), // score 1.0
        makeParty({ id: 'b', guests: [] }), // score 0 — should be hidden
        makeParty({ id: 'c', guests: [guest('host')] }), // host only, score 0 — hidden
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      expect(res.body.parties.total).toBe(1);
      expect(res.body.parties.rows.map((r: any) => r.id)).toEqual(['a']);
    });
  });

  describe('GET /api/leaderboard scope filters', () => {
    it('passes underbossStatus=approved and eventType=gpp to Prisma', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      const call = mockPrisma.party.findMany.mock.calls[0][0];
      expect(call.where.underbossStatus).toBe('approved');
      expect(call.where.eventType).toBe('gpp');
    });

    it('adds a calendar-2026 date filter when window=year', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard?window=year');
      expect(res.status).toBe(200);
      const call = mockPrisma.party.findMany.mock.calls[0][0];
      expect(call.where.date).toBeDefined();
      expect(call.where.date.gte.getUTCFullYear()).toBe(2026);
      expect(call.where.date.gte.getUTCMonth()).toBe(0);
      expect(call.where.date.lt.getUTCFullYear()).toBe(2027);
      expect(res.body.window).toBe('year');
    });

    it('omits the date filter when window=all (default)', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      const call = mockPrisma.party.findMany.mock.calls[0][0];
      expect(call.where.date).toBeUndefined();
      expect(res.body.window).toBe('all');
    });

    it('asks Prisma to filter photos by status=approved', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      const app = createTestApp();
      await request(app).get('/api/leaderboard');
      const call = mockPrisma.party.findMany.mock.calls[0][0];
      expect(call.select.photos.where).toEqual({ status: 'approved' });
    });
  });

  describe('GET /api/leaderboard country aggregation', () => {
    it('sums party scores by country, case-insensitively', async () => {
      // 3 parties — two in nigeria/Nigeria spellings, one in usa
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          country: 'Nigeria',
          guests: Array(5).fill(0).map(() => guest('link')), // score 5
        }),
        makeParty({
          id: 'b',
          country: 'nigeria', // lowercase variant — should group with above
          guests: Array(3).fill(0).map(() => guest('link')), // score 3
        }),
        makeParty({
          id: 'c',
          country: 'United States',
          guests: Array(2).fill(0).map(() => guest('link')), // score 2
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      const countries = res.body.countries.rows;
      expect(countries).toHaveLength(2);
      expect(countries[0].country).toBe('Nigeria'); // most common spelling
      expect(countries[0].partyCount).toBe(2);
      expect(countries[0].score).toBe(8);
      expect(countries[0].countryCode).toBe('NG');
      expect(countries[1].country).toBe('United States');
      expect(countries[1].score).toBe(2);
      expect(countries[1].countryCode).toBe('US');
    });

    it('verifies country score equals SUM of constituent party scores', async () => {
      // 3 parties in Italy with scores 1.0, 2.0, 0.3 → 3.3
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          country: 'Italy',
          guests: [guest('link')], // 1.0
        }),
        makeParty({
          id: 'b',
          country: 'Italy',
          guests: [guest('link'), guest('link')], // 2.0
        }),
        makeParty({
          id: 'c',
          country: 'Italy',
          guests: [guest('invite')], // 0.3
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      const partyScoreSum = res.body.parties.rows.reduce(
        (s: number, r: any) => s + r.score,
        0,
      );
      const italyRow = res.body.countries.rows.find((c: any) => c.country === 'Italy');
      expect(italyRow.score).toBe(3.3);
      // partyScoreSum may not exactly equal 3.3 due to floating-point sum;
      // but country aggregation rounds to 1dp, so we compare rounded values.
      expect(Math.round(partyScoreSum * 10) / 10).toBe(3.3);
    });

    it('excludes parties with null country from the country board but not the party board', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          country: null,
          guests: [guest('link')], // score 1.0
        }),
        makeParty({
          id: 'b',
          country: 'France',
          guests: [guest('link'), guest('link')], // score 2.0
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      expect(res.body.parties.total).toBe(2);
      expect(res.body.countries.rows).toHaveLength(1);
      expect(res.body.countries.rows[0].country).toBe('France');
    });
  });

  describe('GET /api/leaderboard tiebreakers, ordering, and pagination', () => {
    it('breaks ties by check-in count, then link RSVPs, then earliest createdAt', async () => {
      // 3 parties all scoring 2.0:
      //   - A: 2 link RSVPs (no check-ins), createdAt=2026-03-01
      //   - B: 1 link + 1 invite + 0.5 photos (score = 1+0.3+0.5=1.8 — but let's tune)
      // Simpler: A=2 link, B=1 link + 0.5*2 photos, C=2 link with newer createdAt
      // We'll just exercise check-in tiebreaker:
      //   A: link RSVPs=2 (score 2.0), 0 check-ins
      //   B: link RSVPs=2 (score 2.0), 0 check-ins, older createdAt → wins
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          createdAt: new Date('2026-03-15T00:00:00Z'),
          guests: [guest('link'), guest('link')],
        }),
        makeParty({
          id: 'b',
          createdAt: new Date('2026-01-15T00:00:00Z'),
          guests: [guest('link'), guest('link')],
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.status).toBe(200);
      // Both score 2.0; B has earlier createdAt so B wins the tiebreaker.
      expect(res.body.parties.rows.map((r: any) => r.id)).toEqual(['b', 'a']);
    });

    it('respects limit and offset on the parties tab', async () => {
      const parties = Array(10)
        .fill(0)
        .map((_, i) =>
          makeParty({
            id: 'p' + i,
            inviteCode: 'invite-' + i,
            guests: Array(10 - i).fill(0).map(() => guest('link')),
          }),
        );
      mockPrisma.party.findMany.mockResolvedValue(parties);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard?limit=3&offset=2');
      expect(res.status).toBe(200);
      expect(res.body.parties.limit).toBe(3);
      expect(res.body.parties.offset).toBe(2);
      expect(res.body.parties.total).toBe(10);
      expect(res.body.parties.rows).toHaveLength(3);
      // Sorted desc by score (p0=10..p9=1). offset 2, limit 3 → p2, p3, p4.
      expect(res.body.parties.rows.map((r: any) => r.id)).toEqual(['p2', 'p3', 'p4']);
    });

    it('caps limit at 200', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard?limit=10000');
      expect(res.status).toBe(200);
      expect(res.body.parties.limit).toBe(200);
    });
  });

  describe('GET /api/leaderboard host name resolution', () => {
    it('uses the first visible co-host name when available', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          coHosts: [
            { name: 'Hidden Cohost', showOnEvent: false },
            { name: 'Visible Cohost', showOnEvent: true },
            { name: 'Second Visible' },
          ],
          user: { name: 'Account Owner' },
          guests: [guest('link')],
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.body.parties.rows[0].hostName).toBe('Visible Cohost');
    });

    it('falls back to party.user.name when no visible co-host has a name', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          coHosts: [{ name: 'Hidden', showOnEvent: false }],
          user: { name: 'Account Owner' },
          guests: [guest('link')],
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.body.parties.rows[0].hostName).toBe('Account Owner');
    });

    it('returns null hostName when no co-host and no user.name', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          coHosts: [],
          user: null,
          guests: [guest('link')],
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.body.parties.rows[0].hostName).toBeNull();
    });
  });

  describe('GET /api/leaderboard caching', () => {
    it('returns cached data on the second call within the TTL', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({ id: 'a', guests: [guest('link')] }),
      ]);
      const app = createTestApp();
      await request(app).get('/api/leaderboard');
      await request(app).get('/api/leaderboard');
      // findMany should only have been called once (second is a cache hit).
      expect(mockPrisma.party.findMany).toHaveBeenCalledTimes(1);
    });

    it('bypasses cache when ?nocache=1', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({ id: 'a', guests: [guest('link')] }),
      ]);
      const app = createTestApp();
      await request(app).get('/api/leaderboard');
      await request(app).get('/api/leaderboard?nocache=1');
      expect(mockPrisma.party.findMany).toHaveBeenCalledTimes(2);
    });

    it('sets Cache-Control: public, max-age=300', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.headers['cache-control']).toBe('public, max-age=300');
    });

    it('caches per-window separately (all vs year)', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({ id: 'a', guests: [guest('link')] }),
      ]);
      const app = createTestApp();
      await request(app).get('/api/leaderboard?window=all');
      await request(app).get('/api/leaderboard?window=year');
      // Different cache keys → two DB calls.
      expect(mockPrisma.party.findMany).toHaveBeenCalledTimes(2);
    });
  });

  describe('GET /api/leaderboard response shape', () => {
    it('includes party slug + URL on each row', async () => {
      mockPrisma.party.findMany.mockResolvedValue([
        makeParty({
          id: 'a',
          customUrl: 'lagos',
          inviteCode: 'fallback-code',
          guests: [guest('link')],
        }),
        makeParty({
          id: 'b',
          customUrl: null,
          inviteCode: 'just-a-code',
          guests: [guest('link')],
        }),
      ]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      const rows = res.body.parties.rows;
      const a = rows.find((r: any) => r.id === 'a');
      const b = rows.find((r: any) => r.id === 'b');
      expect(a.slug).toBe('lagos');
      expect(a.url).toBe('https://rsv.pizza/lagos');
      expect(b.slug).toBe('just-a-code');
      expect(b.url).toBe('https://rsv.pizza/just-a-code');
    });

    it('includes computedAt as an ISO string', async () => {
      mockPrisma.party.findMany.mockResolvedValue([]);
      const app = createTestApp();
      const res = await request(app).get('/api/leaderboard');
      expect(res.body.computedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    });
  });

  describe('scoreParty helper', () => {
    it('counts a checked-in guest with submittedVia=link as both linkRsvps and checkIns', () => {
      const { score, breakdown } = __testing.scoreParty({
        id: 'a',
        name: '',
        customUrl: null,
        inviteCode: '',
        city: null,
        country: null,
        eventImageUrl: null,
        createdAt: new Date(),
        date: null,
        coHosts: [],
        user: null,
        guests: [{ submittedVia: 'link', status: 'CONFIRMED', approved: null, checkedInAt: new Date() }],
        photos: [],
      } as any);
      // 1 link + 1 check-in = 1.0 + 2.0 = 3.0
      expect(breakdown).toEqual({ linkRsvps: 1, inviteRsvps: 0, checkIns: 1, photos: 0 });
      expect(score).toBe(3);
    });
  });
});
