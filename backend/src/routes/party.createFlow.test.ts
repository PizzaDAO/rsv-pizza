import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  party: { create: vi.fn(), count: vi.fn(), findMany: vi.fn() },
  guest: { create: vi.fn() },
  user: { findUnique: vi.fn() },
  eventSeries: { findFirst: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));
vi.mock('./rsvp.routes.js', () => ({ sendApprovalEmail: vi.fn(), sendPromotionEmail: vi.fn() }));
vi.mock('../lib/privateConfig.js', () => ({
  getReimbursementRules: vi.fn(),
  getOperationalLimits: vi.fn(async () => ({ importHardCap: 2000, photoPerUserPerEvent: 30 })),
  getGppGlobalEditors: vi.fn(async () => []),
}));
vi.mock('../lib/autoPopulatePizzerias.js', () => ({ autoPopulatePizzerias: vi.fn(async () => undefined) }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.userId = 'u1';
    req.userEmail = 'host@example.com';
    next();
  },
  optionalAuth: (_req: any, _res: any, next: any) => next(),
  isSuperAdmin: async () => false,
  AuthRequest: {},
}));

import partyRoutes from './party.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/parties', partyRoutes);
app.use(errorHandler);

const base = {
  id: 'series-x', publicTags: ['Tag'], displayName: 'Doge Day', brandName: 'Doge Day', nameTemplate: null,
  requireApproval: false, hideGuests: false, photosEnabled: true, photosPublic: true,
  ogImageUrl: 'https://cdn.example.com/og.png', description: 'Series description',
  flyerTemplateKey: null, eventDate: null, eventStartTime: null, eventEndTime: null,
};
const DOGE = { ...base, slug: 'doge', createFlow: 'global_day', eventDate: new Date('2027-11-02T00:00:00.000Z') };
const TEAM1 = { ...base, id: 'series-t1', slug: 'team1', displayName: 'Team1', brandName: 'Team1 Pizza', createFlow: 'meetup', ogImageUrl: null, description: null };
const MONAD = { ...base, id: 'series-m', slug: 'monad', displayName: 'Monad', brandName: 'Monad Pizza', createFlow: 'hackathon', flyerTemplateKey: 'monad' };

let seriesRow: any;
async function post(body: Record<string, unknown>) {
  mockPrisma.eventSeries.findFirst.mockResolvedValue(seriesRow);
  return request(app).post('/api/parties').send(body);
}
const created = () => mockPrisma.party.create.mock.calls[0][0].data;

beforeEach(() => {
  vi.clearAllMocks();
  mockPrisma.user.findUnique.mockResolvedValue({ name: 'Host' });
  mockPrisma.party.count.mockResolvedValue(0);
  mockPrisma.party.findMany.mockResolvedValue([]);
  mockPrisma.party.create.mockResolvedValue({ id: 'p1', name: 'P', inviteCode: 'abc', userId: 'u1', user: { name: 'Host' } });
  mockPrisma.guest.create.mockResolvedValue({ id: 'g' });
});

describe('POST /api/parties create-flow presets', () => {
  describe('global_day (Doge)', () => {
    const body = {
      seriesSlug: 'doge', city: 'Austin', address: 'Austin, TX, USA', timezone: 'America/Chicago',
      date: '2027-11-03T23:00:00Z', name: 'Hacked name', customUrl: undefined,
    };
    beforeEach(() => { seriesRow = DOGE; });

    it('applies the template name, locked date, city-only address, pinned apps, defaults, doge-<city> url', async () => {
      const res = await post(body);
      expect(res.status).toBe(201);
      const d = created();
      expect(d.name).toBe('Doge Day Austin'); // locked: client name ignored
      expect(d.date.toISOString()).toBe('2027-11-02T23:00:00.000Z'); // client day ignored; 18:00 CDT
      expect(d.endTime.toISOString()).toBe('2027-11-03T02:00:00.000Z'); // default 21:00 end
      expect(d.duration).toBe(3);
      expect(d.timezone).toBe('America/Chicago');
      expect(d.address).toBe('Austin, TX, USA');
      expect(d.addressIsCityDefault).toBe(true);
      expect(d.pinnedApps).toEqual(['checklist', 'venue']);
      expect(d.customUrl).toBe('doge-austin');
      expect(d.eventSeriesId).toBe('series-x');
      expect(d.eventTags).toEqual(['Tag']);
      expect(d.eventImageUrl).toBe('https://cdn.example.com/og.png');
      expect(d.description).toBe('Series description');
      expect(d.requireApproval).toBe(false);
    });

    it('date lock: any client date is replaced by 2027-11-02; times stay editable (HH:MM and ISO forms)', async () => {
      await post({ ...body, startTime: '17:30', endTime: '22:15' });
      expect(created().date.toISOString()).toBe('2027-11-02T22:30:00.000Z');
      expect(created().endTime.toISOString()).toBe('2027-11-03T03:15:00.000Z');
      mockPrisma.party.create.mockClear();
      await post({ ...body, date: '2031-05-05T23:30:00Z', endTime: '2031-05-06T01:00:00Z' }); // 18:30 -> 20:00 CDT
      expect(created().date.toISOString()).toBe('2027-11-02T23:30:00.000Z');
      expect(created().endTime.toISOString()).toBe('2027-11-03T01:00:00.000Z');
    });

    it('far timezone keeps the local day (+14h)', async () => {
      await post({ ...body, timezone: 'Pacific/Kiritimati', startTime: '18:00', endTime: '21:00' });
      expect(created().date.toISOString()).toBe('2027-11-02T04:00:00.000Z');
    });

    it('requires a valid timezone, a city/address, and end after start', async () => {
      expect((await post({ ...body, timezone: 'Mars/Base' })).status).toBe(400);
      expect((await post({ ...body, timezone: undefined })).status).toBe(400);
      expect((await post({ seriesSlug: 'doge', timezone: 'America/Chicago' })).status).toBe(400);
      expect((await post({ ...body, startTime: '20:00', endTime: '19:00' })).status).toBe(400);
      expect(mockPrisma.party.create).not.toHaveBeenCalled();
    });

    it('name_template column overrides the preset default', async () => {
      seriesRow = { ...DOGE, nameTemplate: '{series} 2027 {city}' };
      await post(body);
      expect(created().name).toBe('Doge Day 2027 Austin');
    });

    it('custom-URL collision: suffixes past taken candidates', async () => {
      mockPrisma.party.findMany.mockResolvedValue([{ customUrl: 'doge-austin' }, { customUrl: 'doge-austin-2' }]);
      await post(body);
      expect(created().customUrl).toBe('doge-austin-3');
      expect(mockPrisma.party.findMany.mock.calls[0][0].where.customUrl.in[0]).toBe('doge-austin');
    });

    it('same-city second party is allowed (no dedupe 4xx)', async () => {
      mockPrisma.party.findMany.mockResolvedValue([{ customUrl: 'doge-austin' }]);
      expect((await post(body)).status).toBe(201);
    });

    it('a venue pick (placeId) means not city-default', async () => {
      await post({ ...body, placeId: 'abc', venueName: 'Joes' });
      expect(created().addressIsCityDefault).toBe(false);
    });
  });

  describe('meetup (Team1)', () => {
    beforeEach(() => { seriesRow = TEAM1; });
    const body = { seriesSlug: 'team1', city: 'Austin', address: 'Austin, TX', date: '2027-03-04T18:30:00Z', timezone: 'America/Chicago' };

    it('template name when blank, host date kept, no forced locks, approval false', async () => {
      await post(body);
      const d = created();
      expect(d.name).toBe('Team1 Meetup Austin');
      expect(d.date.toISOString()).toBe('2027-03-04T18:30:00.000Z');
      expect(d.endTime).toBeNull();
      expect(d.pinnedApps).toEqual(['checklist', 'venue']);
      expect(d.customUrl).toBe('team1-austin');
      expect(d.requireApproval).toBe(false);
      expect(d.eventImageUrl).toBeNull();
    });

    it('host-edited name wins; explicit addressIsCityDefault honored; end validated', async () => {
      await post({ ...body, name: 'Fuji Fans', addressIsCityDefault: true, endTime: '2027-03-04T21:00:00Z' });
      expect(created().name).toBe('Fuji Fans');
      expect(created().addressIsCityDefault).toBe(true);
      expect(created().endTime.toISOString()).toBe('2027-03-04T21:00:00.000Z');
      expect((await post({ ...body, endTime: '2027-03-04T10:00:00Z' })).status).toBe(400);
    });

    it('requires a date', async () => {
      expect((await post({ ...body, date: undefined })).status).toBe(400);
    });
  });

  describe('hackathon (Monad)', () => {
    beforeEach(() => { seriesRow = MONAD; });
    const body = {
      seriesSlug: 'monad', name: 'Monad Blitz', city: 'Austin', address: 'Venue, Austin', timezone: 'America/Chicago',
      date: '2027-03-04T15:00:00Z', endTime: '2027-03-06T23:00:00Z', maxGuests: 150,
      externalLinks: [{ label: 'Devpost', url: 'https://x.devpost.com' }, { label: 'bad', url: 'javascript:alert(1)' }],
    };

    it('multi-day end time, requireApproval on, capacity, external links, pinned apps + flyer when a template exists', async () => {
      await post(body);
      const d = created();
      expect(d.name).toBe('Monad Blitz');
      expect(d.endTime.toISOString()).toBe('2027-03-06T23:00:00.000Z');
      expect(d.duration).toBe(56);
      expect(d.maxGuests).toBe(150);
      expect(d.requireApproval).toBe(true);
      expect(d.pinnedApps).toEqual(['checklist', 'venue', 'staffing', 'displays', 'flyer']);
      expect(d.externalLinks).toEqual([{ label: 'Devpost', url: 'https://x.devpost.com' }]);
    });

    it('explicit body requireApproval=false overrides the preset default', async () => {
      await post({ ...body, requireApproval: false });
      expect(created().requireApproval).toBe(false);
    });

    it('requires a name (no template), capacity, and caps the span at 14 days', async () => {
      expect((await post({ ...body, name: undefined })).status).toBe(400);
      expect((await post({ ...body, maxGuests: undefined })).status).toBe(400);
      expect((await post({ ...body, endTime: '2027-03-30T23:00:00Z' })).status).toBe(400);
      expect((await post({ ...body, endTime: '2027-03-04T14:00:00Z' })).status).toBe(400);
      expect(mockPrisma.party.create).not.toHaveBeenCalled();
    });
  });

  describe('rate limit (5 branded creates per account per day)', () => {
    beforeEach(() => { seriesRow = TEAM1; });
    const body = { seriesSlug: 'team1', city: 'Austin', address: 'Austin, TX', date: '2027-03-04T18:30:00Z' };

    it('429 at the limit, scoped to this user + branded series + last 24h', async () => {
      mockPrisma.party.count.mockResolvedValue(5);
      const res = await post(body);
      expect(res.status).toBe(429);
      expect(res.body.error.code).toBe('RATE_LIMITED');
      expect(mockPrisma.party.create).not.toHaveBeenCalled();
      const where = mockPrisma.party.count.mock.calls[0][0].where;
      expect(where.userId).toBe('u1');
      expect(where.eventSeries).toEqual({ is: { siteUrl: { not: null } } });
      expect(where.createdAt.gte).toBeInstanceOf(Date);
    });

    it('allowed under the limit', async () => {
      mockPrisma.party.count.mockResolvedValue(4);
      expect((await post(body)).status).toBe(201);
    });

    it('not applied to unbranded creates or NULL create_flow', async () => {
      mockPrisma.party.count.mockResolvedValue(99);
      seriesRow = { ...TEAM1, createFlow: null };
      expect((await post({ ...body, name: 'N' })).status).toBe(201);
      seriesRow = null;
      expect((await post({ name: 'N' })).status).toBe(201);
      expect(mockPrisma.party.count).not.toHaveBeenCalled();
    });
  });

  describe('NULL create_flow: current behavior, unchanged', () => {
    it('only eventSeriesId + tags are added; body fields pass through as before', async () => {
      seriesRow = { ...TEAM1, createFlow: null, nameTemplate: 'ignored {city}' };
      const res = await post({ seriesSlug: 'team1', name: 'My Party', city: 'Austin', address: 'X', date: '2027-03-04T18:30:00Z', maxGuests: 10 });
      expect(res.status).toBe(201);
      const d = created();
      expect(d.eventSeriesId).toBe('series-t1');
      expect(d.name).toBe('My Party');
      expect(d.customUrl).toBeNull();
      expect(d.endTime).toBeNull();
      expect(d.requireApproval).toBe(false);
      expect(d.description).toBeNull();
      expect(d.eventImageUrl).toBeNull();
      expect('pinnedApps' in d).toBe(false);
      expect('addressIsCityDefault' in d).toBe(false);
      expect('photosEnabled' in d).toBe(false);
      expect(mockPrisma.party.findMany).not.toHaveBeenCalled();
    });

    it('an unknown create_flow value behaves as NULL', async () => {
      seriesRow = { ...TEAM1, createFlow: 'bogus' };
      await post({ seriesSlug: 'team1', name: 'N' });
      expect('pinnedApps' in created()).toBe(false);
    });
  });
});
