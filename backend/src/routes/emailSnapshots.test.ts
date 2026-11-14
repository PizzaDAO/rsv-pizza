/**
 * Regression snapshots: for a party / request with NO branded series, every converted
 * email (white-label PR 4) must be byte-identical to what rsv.pizza sent before the
 * change. The snapshot file was generated against origin/master (pre-change code) and
 * must NOT be regenerated with -u when the code changes.
 *
 * Deliberately imports nothing that only exists after the change.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  magicLink: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn(() => Promise.resolve(0)) },
  party: { findUnique: vi.fn() },
  slugAlias: { findUnique: vi.fn(() => Promise.resolve(null)) },
  guest: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), count: vi.fn(), aggregate: vi.fn() },
  hostSurveyResponse: { findUnique: vi.fn(), upsert: vi.fn() },
  eventSeries: { findMany: vi.fn(), findFirst: vi.fn() },
}));
process.env.JWT_SECRET ??= 'test-secret-rsvp-overwrite-fix-0123456789';
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));
vi.mock('../services/webhook.service.js', () => ({ triggerWebhook: vi.fn() }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import authRoutes from './auth.routes.js';
import rsvpRoutes, { sendApprovalEmail, sendPromotionEmail } from './rsvp.routes.js';
import { buildSurveyEmail } from './survey.routes.js';
import { buildInviteEmail } from './v1/guests.js';
import { sendHostSurveyEmail } from '../services/hostSurveyEmail.js';
import { errorHandler } from '../middleware/error.js';
import { signGuestToken } from '../lib/guestToken.js';
import { buildReminderHtml, buildReminderText, renderUnsubscribePage } from './reminder.routes.js';
import { _resetSiteBrandCache } from '../lib/siteBrand.js';
import { resetCodeLimits } from '../lib/loginCode.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', authRoutes);
  a.use('/api/rsvp', rsvpRoutes);
  a.use(errorHandler);
  return a;
}

function lastResend() {
  const call = mockFetch.mock.calls.find((c) => c[0] === 'https://api.resend.com/emails');
  expect(call).toBeDefined();
  return JSON.parse(call![1].body as string);
}

const PARTY = {
  id: 'p1',
  name: 'Snapshot Party',
  date: new Date('2026-06-15T18:00:00Z'),
  timezone: 'America/New_York',
  address: '123 Pizza St',
  customUrl: 'snap-party',
  eventImageUrl: 'https://cdn.example.com/flyer.png',
};

describe('no-series emails are byte-identical to pre-change output', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCodeLimits();
    process.env.RESEND_API_KEY = 're_test';
    process.env.FRONTEND_URL = 'https://rsv.pizza';
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ id: 'r1' }), text: async () => '', headers: new Headers() });
    mockPrisma.eventSeries.findMany.mockResolvedValue([]);
    mockPrisma.user.findUnique.mockResolvedValue(null);
    mockPrisma.magicLink.findUnique.mockResolvedValue(null);
    mockPrisma.magicLink.create.mockResolvedValue({});
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.RESEND_API_KEY;
  });

  it.each([
    ['no Origin header', undefined],
    ['unregistered Origin', 'https://team1.rsv.pizza'],
    ['spoofed Origin', 'https://evil.example.com'],
  ])('magic link (%s)', async (_l, origin) => {
    const req = request(app()).post('/api/auth/magic-link');
    if (origin) req.set('Origin', origin);
    const res = await req.send({ email: 'guest@example.com' });
    expect(res.status).toBe(200);
    const body = lastResend();
    expect(body).toMatchSnapshot();
    // devLink carries a random token; check link shape separately.
    expect(res.body.devLink).toMatch(/^https:\/\/rsv\.pizza\/auth\/verify\?token=[0-9a-f]{64}$/);
  });

  it('magic link falls back to localhost when FRONTEND_URL is unset', async () => {
    delete process.env.FRONTEND_URL;
    const res = await request(app()).post('/api/auth/magic-link').send({ email: 'guest@example.com' });
    expect(res.body.devLink).toMatch(/^http:\/\/localhost:5176\/auth\/verify\?token=/);
  });

  it('RSVP confirmation (send-confirmation)', async () => {
    mockPrisma.party.findUnique.mockResolvedValue(PARTY);
    mockPrisma.guest.findFirst.mockResolvedValue({ id: 'g1', name: 'Gus', email: 'guest@example.com' });
    const res = await request(app())
      .post('/api/rsvp/abc123/send-confirmation')
      // rsvp-overwrite-fix: needs the guest token; the email goes to the stored address.
      .send({ guestId: 'g1', guestToken: signGuestToken('g1') });
    expect(res.status).toBe(200);
    expect(lastResend()).toMatchSnapshot();
  });

  it('approval email', async () => {
    await sendApprovalEmail({
      guestEmail: 'guest@example.com', guestName: 'Gus', guestId: 'g1', partyName: PARTY.name,
      partyDate: PARTY.date, partyTimezone: PARTY.timezone, partyAddress: PARTY.address,
      partyImageUrl: PARTY.eventImageUrl, venueName: 'The Venue', inviteCode: 'abc123', customUrl: null,
    });
    expect(lastResend()).toMatchSnapshot();
  });

  it('waitlist promotion email', async () => {
    await sendPromotionEmail({
      guestEmail: 'guest@example.com', guestName: 'Gus', guestId: 'g1', partyName: PARTY.name,
      partyDate: PARTY.date, partyTimezone: PARTY.timezone, partyAddress: PARTY.address,
      partyImageUrl: PARTY.eventImageUrl, inviteCode: 'abc123', customUrl: 'snap-party',
    });
    expect(lastResend()).toMatchSnapshot();
  });

  it('guest survey email', () => {
    expect(
      buildSurveyEmail({ name: PARTY.name, eventImageUrl: PARTY.eventImageUrl }, { name: 'Gus Guest', email: 'g@example.com' }, 'tok-1'),
    ).toMatchSnapshot();
  });

  it('public API invite email', () => {
    expect(
      buildInviteEmail(
        { name: PARTY.name, date: PARTY.date, address: PARTY.address, inviteCode: 'abc123', customUrl: null, timezone: PARTY.timezone, eventImageUrl: PARTY.eventImageUrl },
        { name: 'Gus', email: 'g@example.com' },
        'See you there',
      ),
    ).toMatchSnapshot();
  });

  it('host survey email', async () => {
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p1', name: 'Global Pizza Party Snapville', customUrl: null, inviteCode: 'abc123',
      eventImageUrl: PARTY.eventImageUrl, estimatedAttendance: null, userId: 'u1',
      user: { id: 'u1', email: 'host@example.com', name: 'Hosty McHost' },
    });
    mockPrisma.hostSurveyResponse.findUnique.mockResolvedValue({ token: 'host-tok' });
    mockPrisma.hostSurveyResponse.upsert.mockResolvedValue({});
    expect(await sendHostSurveyEmail('p1')).toBe(true);
    expect(lastResend()).toMatchSnapshot();
  });
});

// White-label audit M3: brand copy only changes for a branded series; defaults keep the exact old literals.
describe('brand copy fallbacks (M3)', () => {
  const reminderParams = {
    guestName: 'Gus', whenText: 'Mon', addressText: '1 St', partyName: 'Snapshot Party',
    eventUrl: 'https://rsv.pizza/e', unsubUrl: 'https://api.rsv.pizza/u', venueName: null, address: null, imageUrl: null,
  };

  it('reminder footer keeps "on RSV.Pizza." by default and uses the site name when given', () => {
    expect(buildReminderHtml(reminderParams)).toContain("RSVP'd to Snapshot Party on RSV.Pizza.<br>");
    expect(buildReminderText(reminderParams)).toContain("RSVP'd to Snapshot Party on RSV.Pizza.");
    expect(buildReminderHtml({ ...reminderParams, siteName: 'Team1 Pizza' })).toContain("on Team1 Pizza.<br>");
    expect(buildReminderText({ ...reminderParams, siteName: 'Team1 Pizza' })).toContain('on Team1 Pizza.');
  });

  it('unsubscribe page keeps the rsv.pizza link by default', () => {
    const html = renderUnsubscribePage('T', 'M', true);
    expect(html).toContain('<p><a href="https://rsv.pizza">Back to RSV.Pizza</a></p>');
    const branded = renderUnsubscribePage('T', 'M', true, { url: 'https://team1.rsv.pizza', name: 'Team1 Pizza' });
    expect(branded).toContain('<a href="https://team1.rsv.pizza">Back to Team1 Pizza</a>');
    expect(branded).not.toContain('Back to RSV.Pizza');
  });

  it('guest survey: PizzaDAO wording by default, neutral when branded', () => {
    const args = [{ name: 'P' }, { name: 'G', email: 'g@x.com' }, 'tok'] as const;
    expect(buildSurveyEmail(...args).html).toContain('throw better PizzaDAO events.');
    expect(buildSurveyEmail(...args, 'https://team1.rsv.pizza', true).html).toContain('throw better events.');
  });

  it('host survey for a branded party: team signature, full-name subject, no PizzaDAO', async () => {
    vi.clearAllMocks();
    _resetSiteBrandCache();
    process.env.RESEND_API_KEY = 're_test';
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}), text: async () => '', headers: new Headers() });
    mockPrisma.eventSeries.findMany.mockResolvedValue([
      { id: 's-t1', slug: 'team1', siteUrl: 'https://team1.rsv.pizza', brandName: 'Team1 Pizza', displayName: 'T', name: 'T' },
    ]);
    mockPrisma.party.findUnique.mockResolvedValue({
      id: 'p1', name: 'Team1 Global Pizza Party Lisbon', customUrl: null, inviteCode: 'abc123',
      eventImageUrl: null, eventSeriesId: 's-t1', estimatedAttendance: null, userId: 'u1',
      user: { id: 'u1', email: 'host@example.com', name: 'Hosty McHost' },
    });
    mockPrisma.hostSurveyResponse.findUnique.mockResolvedValue({ token: 'host-tok' });
    mockPrisma.hostSurveyResponse.upsert.mockResolvedValue({});
    expect(await sendHostSurveyEmail('p1')).toBe(true);
    const body = lastResend();
    expect(body.subject).toBe('How did hosting Team1 Global Pizza Party Lisbon go? Tell us 🍕');
    expect(body.html).toContain('Best,<br>Team1 Pizza team</p>');
    expect(body.html).not.toContain('PizzaDAO');
    expect(body.html).not.toContain('Dread Pizza');
    _resetSiteBrandCache();
    delete process.env.RESEND_API_KEY;
  });
});
