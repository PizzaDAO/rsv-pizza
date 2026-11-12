/** Branded-series behavior at the converted call sites + the series listing rule. */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  magicLink: { findUnique: vi.fn(), create: vi.fn() },
  party: { findUnique: vi.fn(), findMany: vi.fn() },
  slugAlias: { findUnique: vi.fn(() => Promise.resolve(null)) },
  guest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  hostSurveyResponse: { findUnique: vi.fn(), upsert: vi.fn() },
  eventSeries: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
}));
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import authRoutes from './auth.routes.js';
import seriesRoutes from './series.routes.js';
import rsvpRoutes, { sendApprovalEmail } from './rsvp.routes.js';
import { buildSurveyEmail } from './survey.routes.js';
import { buildInviteEmail } from './v1/guests.js';
import { sendHostSurveyEmail } from '../services/hostSurveyEmail.js';
import { errorHandler } from '../middleware/error.js';
import { _resetSiteBrandCache } from '../lib/siteBrand.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', authRoutes);
  a.use('/api/rsvp', rsvpRoutes);
  a.use('/api/series', seriesRoutes);
  a.use(errorHandler);
  return a;
}

function lastResend() {
  const call = mockFetch.mock.calls.find((c) => c[0] === 'https://api.resend.com/emails');
  expect(call).toBeDefined();
  return JSON.parse(call![1].body as string);
}

const TEAM1_ROW = {
  id: 'series-team1',
  slug: 'team1',
  siteUrl: 'https://team1.rsv.pizza',
  brandName: 'Team1 Pizza',
  displayName: 'Team1',
  name: 'Team1 Pizza Parties',
};

describe('branded call sites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    _resetSiteBrandCache();
    process.env.RESEND_API_KEY = 're_test';
    process.env.FRONTEND_URL = 'https://rsv.pizza';
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }), text: async () => '', headers: new Headers() });
    mockPrisma.eventSeries.findMany.mockResolvedValue([TEAM1_ROW]);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.magicLink.findUnique.mockResolvedValue(null);
    mockPrisma.magicLink.create.mockResolvedValue({});
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RESEND_API_KEY;
  });

  describe('magic link origin matching', () => {
    it('registered origin: link, subject, chrome and from are branded', async () => {
      const res = await request(app())
        .post('/api/auth/magic-link')
        .set('Origin', 'https://team1.rsv.pizza')
        .send({ email: 'guest@example.com' });
      expect(res.body.devLink).toMatch(/^https:\/\/team1\.rsv\.pizza\/auth\/verify\?token=/);
      const body = lastResend();
      expect(body.from).toBe('Team1 Pizza <noreply@rsv.pizza>');
      expect(body.subject).toMatch(/^Team1 Pizza Code \d{6}$/);
      expect(body.html).toContain('Sign In to Team1 Pizza');
      expect(body.html).not.toContain('RSV.Pizza');
    });

    it.each([
      'https://team1.rsv.pizza.evil.com',
      'https://evil.example.com',
      'https://team1.rsv.pizza@evil.com',
      'http://team1.rsv.pizza',
      'null',
    ])('spoofed/unknown origin %s never redirects the link', async (origin) => {
      const res = await request(app())
        .post('/api/auth/magic-link')
        .set('Origin', origin)
        .send({ email: 'guest@example.com' });
      expect(res.body.devLink).toMatch(/^https:\/\/rsv\.pizza\/auth\/verify\?token=/);
      const body = lastResend();
      expect(body.from).toBe('RSV.Pizza <noreply@rsv.pizza>');
      expect(body.subject).toMatch(/^RSV\.Pizza Code \d{6}$/);
    });

    it('origin of an inactive/unregistered series (not in cache) falls back', async () => {
      mockPrisma.eventSeries.findMany.mockResolvedValue([]); // inactive series are filtered by the query
      const res = await request(app())
        .post('/api/auth/magic-link')
        .set('Origin', 'https://team1.rsv.pizza')
        .send({ email: 'guest@example.com' });
      expect(res.body.devLink).toMatch(/^https:\/\/rsv\.pizza\//);
    });
  });

  it('RSVP confirmation for a branded party links to the brand site and sends from the brand', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p1', name: 'T1 Party', date: null, timezone: null, address: null, customUrl: 'my-t1',
      eventImageUrl: null, eventSeriesId: 'series-team1',
    });
    await request(app())
      .post('/api/rsvp/abc123/send-confirmation')
      .send({ guestId: 'g1', guestEmail: 'g@example.com', guestName: 'Gus' });
    const body = lastResend();
    expect(body.from).toBe('Team1 Pizza <noreply@rsv.pizza>');
    expect(body.html).toContain('href="https://team1.rsv.pizza/my-t1"');
    expect(body.html).toContain('https://team1.rsv.pizza/checkin/abc123/g1'.replace(/[/:]/g, (c) => encodeURIComponent(c)));
    expect(body.html).not.toContain('https://rsv.pizza');
  });

  it('approval email for a branded party', async () => {
    await sendApprovalEmail({
      guestEmail: 'g@example.com', guestName: 'Gus', guestId: 'g1', partyName: 'T1 Party', partyDate: null,
      partyTimezone: null, partyAddress: null, partyImageUrl: null, venueName: null, inviteCode: 'abc123',
      customUrl: null, eventSeriesId: 'series-team1',
    });
    const body = lastResend();
    expect(body.from).toBe('Team1 Pizza <noreply@rsv.pizza>');
    expect(body.html).toContain('https://team1.rsv.pizza/abc123');
  });

  it('survey / invite builders honor an explicit base URL and default to rsv.pizza', () => {
    const s = buildSurveyEmail({ name: 'P' }, { name: 'G', email: 'g@x.com' }, 'tok', 'https://team1.rsv.pizza');
    expect(s.html).toContain('https://team1.rsv.pizza/survey/tok');
    expect(buildSurveyEmail({ name: 'P' }, { name: 'G', email: 'g@x.com' }, 'tok').html).toContain('https://rsv.pizza/survey/tok');
    const party = { name: 'P', date: null, address: null, inviteCode: 'abc', customUrl: null, timezone: null };
    expect(buildInviteEmail(party, { name: 'G', email: 'g@x.com' }, undefined, 'https://monad.rsv.pizza').html).toContain('https://monad.rsv.pizza/abc');
    expect(buildInviteEmail(party, { name: 'G', email: 'g@x.com' }).html).toContain('https://rsv.pizza/abc');
  });

  it('host survey email for a branded party', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p1', name: 'T1 Party', customUrl: null, inviteCode: 'abc', eventImageUrl: null, estimatedAttendance: null,
      userId: 'u1', eventSeriesId: 'series-team1', user: { id: 'u1', email: 'h@example.com', name: 'Host' },
    });
    mockPrisma.hostSurveyResponse.findUnique.mockResolvedValue({ token: 'host-tok' });
    mockPrisma.hostSurveyResponse.upsert.mockResolvedValue({});
    expect(await sendHostSurveyEmail('p1')).toBe(true);
    const body = lastResend();
    expect(body.from).toBe('Team1 Pizza <noreply@rsv.pizza>');
    expect(body.html).toContain('https://team1.rsv.pizza/host-survey/host-tok');
  });

  describe('GET /api/series/:slug/events listing rule (D5)', () => {
    const rows: any[] = [];
    beforeEach(() => {
      mockPrisma.party.findMany.mockResolvedValue(rows);
    });

    it('branded series (site_url set): lists everything except rejected/hidden, incl. pending, never password-protected', async () => {
      mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 'series-team1', siteUrl: 'https://team1.rsv.pizza', isActive: true });
      const res = await request(app()).get('/api/series/team1/events');
      expect(res.status).toBe(200);
      const where = mockPrisma.party.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        eventSeriesId: 'series-team1',
        underbossStatus: { notIn: ['rejected', 'hidden'] },
        cancelledAt: null,
        password: null,
      });
    });

    it('inactive branded series falls back to the curated filter', async () => {
      mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 'series-team1', siteUrl: 'https://team1.rsv.pizza', isActive: false });
      await request(app()).get('/api/series/team1/events');
      const where = mockPrisma.party.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        eventSeriesId: 'series-team1',
        underbossStatus: { in: ['approved', 'listed'] },
        cancelledAt: null,
      });
    });

    it('GPP series (site_url NULL): filter is unchanged (approved/listed)', async () => {
      mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 'series-gpp', siteUrl: null, isActive: true });
      await request(app()).get('/api/series/gpp2026/events');
      const where = mockPrisma.party.findMany.mock.calls[0][0].where;
      expect(where).toEqual({
        eventSeriesId: 'series-gpp',
        underbossStatus: { in: ['approved', 'listed'] },
        cancelledAt: null,
      });
    });

    it('branded series: selects and returns venueName/address/guestCount (hidden guests -> null)', async () => {
      mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 'series-team1', siteUrl: 'https://team1.rsv.pizza', isActive: true });
      mockPrisma.party.findMany.mockResolvedValue([
        { id: 'a', name: 'A', customUrl: 'a', inviteCode: 'ia', city: 'X', country: 'US', region: null, date: null, latitude: null, longitude: null, eventImageUrl: null, underbossStatus: 'pending', venueName: 'Bar', address: '1 Main St', hideGuests: false, _count: { guests: 7 } },
        { id: 'b', name: 'B', customUrl: null, inviteCode: 'ib', city: 'Y', country: 'US', region: null, date: null, latitude: null, longitude: null, eventImageUrl: null, underbossStatus: 'pending', venueName: null, address: null, hideGuests: true, _count: { guests: 3 } },
      ]);
      const res = await request(app()).get('/api/series/team1/events');
      const select = mockPrisma.party.findMany.mock.calls[0][0].select;
      expect(select.venueName).toBe(true);
      expect(select.address).toBe(true);
      expect(res.body.events[0]).toMatchObject({ venueName: 'Bar', address: '1 Main St', guestCount: 7 });
      expect(res.body.events[1]).toMatchObject({ venueName: null, address: null, guestCount: null });
    });

    it('GPP series: output has no venueName/address/guestCount keys and select is unchanged', async () => {
      mockPrisma.eventSeries.findUnique.mockResolvedValue({ id: 'series-gpp', siteUrl: null, isActive: true });
      mockPrisma.party.findMany.mockResolvedValue([
        { id: 'g', name: 'G', customUrl: null, inviteCode: 'ig', city: 'X', country: 'US', region: 'na', date: null, latitude: 1, longitude: 2, eventImageUrl: null, underbossStatus: 'approved' },
      ]);
      const res = await request(app()).get('/api/series/gpp2026/events');
      const select = mockPrisma.party.findMany.mock.calls[0][0].select;
      expect(Object.keys(select).sort()).toEqual(['city','country','customUrl','date','eventImageUrl','id','inviteCode','latitude','longitude','name','region','underbossStatus']);
      expect(Object.keys(res.body.events[0]).sort()).toEqual(['city','community','country','date','eventImageUrl','id','latitude','longitude','name','region','slug']);
    });
  });
});
