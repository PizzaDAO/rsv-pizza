/** Partner sender (custom email domain): resolution matrix + one real call site (login code). */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const mockPrisma = vi.hoisted(() => ({
  user: { findUnique: vi.fn() },
  magicLink: { findUnique: vi.fn(), create: vi.fn(), count: vi.fn(() => Promise.resolve(0)) },
  eventSeries: { findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn(), updateMany: vi.fn() },
}));
process.env.JWT_SECRET ??= 'test-secret-partner-sender-0123456789';
vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import authRoutes from './auth.routes.js';
import { errorHandler } from '../middleware/error.js';
import { siteForParty, siteForOrigin, _resetSiteBrandCache } from '../lib/siteBrand.js';
import { resetCodeLimits } from '../lib/loginCode.js';

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/auth', authRoutes);
  a.use(errorHandler);
  return a;
};
const lastResend = () => {
  const call = mockFetch.mock.calls.find((c) => c[0] === 'https://api.resend.com/emails');
  expect(call).toBeDefined();
  return JSON.parse(call![1].body as string);
};

const ROW = {
  id: 'series-p',
  slug: 'p',
  siteUrl: 'https://p.rsv.pizza',
  brandName: 'Partner Pizza',
  displayName: 'Partner',
  name: 'Partner Pizza Parties',
  siteAliases: ['https://events.partner.com'],
  emailFromAddress: 'events@mail.partner.com',
  emailFromName: 'Partner Events',
  emailReplyTo: 'hello@partner.com',
  emailDomain: 'mail.partner.com',
  emailDomainVerifiedAt: new Date('2026-11-01T00:00:00Z'),
};
const FALLBACK = 'Partner Pizza <noreply@rsv.pizza>';
const resolve = async (row: Record<string, unknown>) => {
  _resetSiteBrandCache();
  mockPrisma.eventSeries.findMany.mockResolvedValue([{ ...ROW, ...row }]);
  return siteForParty({ eventSeriesId: 'series-p' }, 'https://rsv.pizza');
};

beforeEach(() => {
  vi.clearAllMocks();
  resetCodeLimits();
  _resetSiteBrandCache();
  process.env.RESEND_API_KEY = 're_test';
  process.env.FRONTEND_URL = 'https://rsv.pizza';
  mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'r1' }), text: async () => '', headers: new Headers() });
  mockPrisma.eventSeries.findMany.mockResolvedValue([ROW]);
  mockPrisma.user.findUnique.mockResolvedValue(null);
  mockPrisma.magicLink.findUnique.mockResolvedValue(null);
  mockPrisma.magicLink.create.mockResolvedValue({});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.RESEND_API_KEY;
});

describe('sender resolution matrix (siteBrand)', () => {
  it('verified + address on the domain: partner sender, fallback and series id attached', async () => {
    const s = await resolve({});
    expect(s).toMatchObject({
      url: 'https://p.rsv.pizza', fromEmail: 'Partner Events <events@mail.partner.com>',
      fallbackFrom: FALLBACK, seriesId: 'series-p', replyTo: 'hello@partner.com',
    });
  });

  it.each([
    ['Acme, Inc', 'Acme Inc'],
    ['support@paypal.com', 'supportpaypal.com'],
    ['A; B: (C) [D] "E" <F>', 'A B C D E F'],
  ])('From display name %j is stripped of RFC 5322 specials at send time', async (name, shown) => {
    const s = await resolve({ emailFromName: name });
    expect(s.fromEmail).toBe(`${shown} <events@mail.partner.com>`);
  });

  it('subdomain of the sending domain is fine; display name falls back to the brand name', async () => {
    const s = await resolve({ emailFromAddress: 'a@x.mail.partner.com', emailFromName: null });
    expect(s.fromEmail).toBe('Partner Pizza <a@x.mail.partner.com>');
  });

  it('not verified: today\'s exact sender (no fallback keys), reply_to still applied', async () => {
    const s = await resolve({ emailDomainVerifiedAt: null });
    expect(s.fromEmail).toBe(FALLBACK);
    expect(s).not.toHaveProperty('fallbackFrom');
    expect(s).not.toHaveProperty('seriesId');
    expect(s.replyTo).toBe('hello@partner.com');
  });

  it.each([
    ['no from address', { emailFromAddress: null }],
    ['no sending domain', { emailDomain: null }],
    ['address off the domain', { emailFromAddress: 'events@other.com' }],
    ['lookalike suffix', { emailFromAddress: 'events@evilmail.partner.com' }],
  ])('%s: falls back to the rsv.pizza sender', async (_n, row) => {
    expect((await resolve(row)).fromEmail).toBe(FALLBACK);
  });

  it('a brand with none of the new columns is byte-identical to before (no replyTo, no extra keys)', async () => {
    const s = await resolve({
      siteAliases: [], emailFromAddress: null, emailFromName: null, emailReplyTo: null, emailDomain: null, emailDomainVerifiedAt: null,
    });
    expect(s).toEqual({ url: 'https://p.rsv.pizza', name: 'Partner Pizza', fromEmail: FALLBACK });
  });

  it('a row missing the new fields entirely (older cache shape) behaves as unconfigured', async () => {
    _resetSiteBrandCache();
    mockPrisma.eventSeries.findMany.mockResolvedValue([{ id: 'series-p', slug: 'p', siteUrl: 'https://p.rsv.pizza', brandName: 'Partner Pizza', displayName: 'P', name: 'P' }]);
    expect(await siteForParty({ eventSeriesId: 'series-p' }, 'x')).toEqual({ url: 'https://p.rsv.pizza', name: 'Partner Pizza', fromEmail: FALLBACK });
  });

  it('alias origins resolve to the canonical site; they never shadow another series\' site_url', async () => {
    _resetSiteBrandCache();
    mockPrisma.eventSeries.findMany.mockResolvedValue([
      ROW,
      { ...ROW, id: 'series-q', slug: 'q', siteUrl: 'https://events.partner.com', siteAliases: [], brandName: 'Q' },
    ]);
    expect((await siteForOrigin('https://events.partner.com', 'x')).name).toBe('Q'); // q's own site_url wins
    _resetSiteBrandCache();
    mockPrisma.eventSeries.findMany.mockResolvedValue([ROW]);
    const viaAlias = await siteForOrigin('https://EVENTS.partner.com/', 'x');
    expect(viaAlias.url).toBe('https://p.rsv.pizza'); // canonical, not the alias
    expect((await siteForOrigin('https://nope.partner.com', 'https://rsv.pizza')).url).toBe('https://rsv.pizza');
  });
});

describe('login code call site', () => {
  it('verified partner: from + reply_to, and an alias origin links to the canonical site', async () => {
    const res = await request(app()).post('/api/auth/magic-link').set('Origin', 'https://events.partner.com').send({ email: 'guest@example.com' });
    expect(res.body.devLink).toMatch(/^https:\/\/p\.rsv\.pizza\/auth\/verify\?token=/);
    const body = lastResend();
    expect(body.from).toBe('Partner Events <events@mail.partner.com>');
    expect(body.reply_to).toBe('hello@partner.com');
  });

  it('unverified partner: rsv.pizza sender with reply_to', async () => {
    mockPrisma.eventSeries.findMany.mockResolvedValue([{ ...ROW, emailDomainVerifiedAt: null }]);
    await request(app()).post('/api/auth/magic-link').set('Origin', 'https://p.rsv.pizza').send({ email: 'guest@example.com' });
    const body = lastResend();
    expect(body.from).toBe(FALLBACK);
    expect(body.reply_to).toBe('hello@partner.com');
  });

  it('unconfigured brand: no reply_to key', async () => {
    mockPrisma.eventSeries.findMany.mockResolvedValue([{ ...ROW, siteAliases: [], emailFromAddress: null, emailReplyTo: null, emailDomain: null, emailDomainVerifiedAt: null }]);
    await request(app()).post('/api/auth/magic-link').set('Origin', 'https://p.rsv.pizza').send({ email: 'guest@example.com' });
    expect(lastResend()).not.toHaveProperty('reply_to');
  });

  it('Resend rejects the partner domain: retried from rsv.pizza, verified_at cleared', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 403, text: async () => 'The mail.partner.com domain is not verified', json: async () => ({}), clone() { return this; }, headers: new Headers() })
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({ id: 'r2' }), text: async () => '', headers: new Headers() });
    mockPrisma.eventSeries.updateMany.mockResolvedValue({ count: 1 });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app()).post('/api/auth/magic-link').set('Origin', 'https://p.rsv.pizza').send({ email: 'guest@example.com' });
    expect(res.status).toBe(200);
    const sends = mockFetch.mock.calls.filter((c) => c[0] === 'https://api.resend.com/emails').map((c) => JSON.parse(c[1].body));
    expect(sends.map((b) => b.from)).toEqual(['Partner Events <events@mail.partner.com>', FALLBACK]);
    expect(mockPrisma.eventSeries.updateMany).toHaveBeenCalledWith({ where: { id: 'series-p' }, data: { emailDomainVerifiedAt: null } });
  });
});
