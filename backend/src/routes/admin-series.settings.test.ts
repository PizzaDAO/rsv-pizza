import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({
  prisma: {
    eventSeries: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    seriesAudit: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../services/partyStatusEmailNotify.js', () => ({ emailHostOfStatusChange: vi.fn() }));
vi.mock('../helpers/statusAudit.js', () => ({ writeStatusAudit: vi.fn() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = 'u1'; req.userEmail = 'boss@example.com'; next(); },
  isSuperAdmin: async () => true,
  AuthRequest: {},
}));

import router from './admin-series.routes.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/admin/series', router);
app.use(errorHandler);

const BEFORE = {
  id: 's1', slug: 'acme', name: 'Acme', displayName: 'Acme', isActive: true, siteUrl: 'https://acme.rsv.pizza',
  siteAliases: [], brandName: 'Acme Pizza', emailFromAddress: null, emailFromName: null, emailReplyTo: null,
  emailDomain: null, emailDomainVerifiedAt: null, configVersion: 1,
};

const patch = (body: unknown) => request(app).patch('/api/admin/series/s1').send(body as object);
const lastUpdateData = () => m.prisma.eventSeries.update.mock.calls.at(-1)![0].data;

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.$transaction.mockImplementation(async (fn: any) => fn(m.prisma));
  m.prisma.eventSeries.findUnique.mockResolvedValue({ ...BEFORE });
  m.prisma.eventSeries.update.mockImplementation(async ({ data }: any) => ({ ...BEFORE, ...data, configVersion: 2 }));
  m.prisma.eventSeries.create.mockImplementation(async ({ data }: any) => ({ id: 's2', ...data }));
});

describe('PATCH /api/admin/series/:id sender + audit', () => {
  it('404s an unknown series', async () => {
    m.prisma.eventSeries.findUnique.mockResolvedValue(null);
    expect((await patch({ brandName: 'x' })).status).toBe(404);
    expect(m.prisma.seriesAudit.create).not.toHaveBeenCalled();
  });

  it('writes a series_audit row with actor, diff and pre-change snapshot', async () => {
    const res = await patch({ brandName: 'Acme Slice' });
    expect(res.status).toBe(200);
    expect(m.prisma.seriesAudit.create).toHaveBeenCalledTimes(1);
    const { data } = m.prisma.seriesAudit.create.mock.calls[0][0];
    expect(data).toMatchObject({ seriesId: 's1', actorEmail: 'boss@example.com', actorKind: 'super_admin', action: 'settings.update' });
    expect(data.changes).toEqual({ brandName: { old: 'Acme Pizza', new: 'Acme Slice' } });
    expect(data.snapshot.brandName).toBe('Acme Pizza');
    // secrets / server-only ids never enter the audit payload
    expect(JSON.stringify(data)).not.toMatch(/pendingDomainToken|resendDomainId/);
  });

  it('bumps config_version on a write', async () => {
    await patch({ brandName: 'Acme Slice' });
    expect(lastUpdateData().configVersion).toEqual({ increment: 1 });
  });

  it('accepts a valid sender and lowercases the addresses', async () => {
    const res = await patch({
      emailDomain: 'Mail.Partner.com', emailFromAddress: 'Events@Mail.Partner.com',
      emailFromName: 'Acme "Events" <x>', emailReplyTo: 'Hello@Partner.com',
    });
    expect(res.status).toBe(200);
    expect(lastUpdateData()).toMatchObject({
      emailDomain: 'mail.partner.com', emailFromAddress: 'events@mail.partner.com',
      emailFromName: 'Acme Events x', emailReplyTo: 'hello@partner.com',
    });
  });

  it.each([
    ['not an email', { emailFromAddress: 'nope', emailDomain: 'mail.partner.com' }],
    ['display-name form', { emailFromAddress: 'A <a@mail.partner.com>', emailDomain: 'mail.partner.com' }],
    ['bad reply-to', { emailReplyTo: 'a b@c.com' }],
    ['url as domain', { emailDomain: 'https://mail.partner.com' }],
    ['wildcard domain', { emailDomain: '*.partner.com' }],
    ['ip as domain', { emailDomain: '1.2.3.4' }],
    ['from address without a domain', { emailFromAddress: 'events@mail.partner.com' }],
    ['from address off the sending domain', { emailFromAddress: 'events@other.com', emailDomain: 'mail.partner.com' }],
    ['lookalike suffix domain', { emailFromAddress: 'events@evilmail.partner.com', emailDomain: 'mail.partner.com' }],
    ['http alias', { siteAliases: ['http://old.example.com'] }],
    ['alias with a path', { siteAliases: ['https://old.example.com/x'] }],
    ['alias equal to site url', { siteAliases: ['https://acme.rsv.pizza'] }],
    ['alias not an array', { siteAliases: 'https://old.example.com' }],
  ])('400s %s', async (_n, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(m.prisma.eventSeries.update).not.toHaveBeenCalled();
    expect(m.prisma.seriesAudit.create).not.toHaveBeenCalled();
  });

  it('allows an https alias origin and de-duplicates', async () => {
    const res = await patch({ siteAliases: ['https://Old.Example.com', 'https://old.example.com'] });
    expect(res.status).toBe(200);
    expect(lastUpdateData().siteAliases).toEqual(['https://old.example.com']);
  });

  it('ignores emailDomainVerifiedAt / resendDomainId / pendingDomain* in the body', async () => {
    const res = await patch({
      brandName: 'Acme Slice', emailDomainVerifiedAt: '2026-01-01T00:00:00Z', resendDomainId: 'dom_1',
      pendingDomain: 'x.example.com', pendingDomainToken: 'tok', pendingDomainStatus: 'live', configVersion: 99,
    });
    expect(res.status).toBe(200);
    const d = lastUpdateData();
    expect(d).not.toHaveProperty('emailDomainVerifiedAt');
    expect(d).not.toHaveProperty('resendDomainId');
    expect(d).not.toHaveProperty('pendingDomain');
    expect(d).not.toHaveProperty('pendingDomainToken');
    expect(d).not.toHaveProperty('pendingDomainStatus');
    expect(d.configVersion).toEqual({ increment: 1 });
  });

  it('resets email_domain_verified_at when the from address changes', async () => {
    m.prisma.eventSeries.findUnique.mockResolvedValue({
      ...BEFORE, emailDomain: 'mail.partner.com', emailFromAddress: 'events@mail.partner.com',
      emailDomainVerifiedAt: new Date('2026-05-01T00:00:00Z'),
    });
    await patch({ emailFromAddress: 'hello@mail.partner.com' });
    expect(lastUpdateData().emailDomainVerifiedAt).toBeNull();
  });

  it('resets email_domain_verified_at when the sending domain changes', async () => {
    m.prisma.eventSeries.findUnique.mockResolvedValue({
      ...BEFORE, emailDomain: 'mail.partner.com', emailFromAddress: 'events@mail.partner.com',
      emailDomainVerifiedAt: new Date('2026-05-01T00:00:00Z'),
    });
    await patch({ emailDomain: 'send.partner.com', emailFromAddress: 'events@send.partner.com' });
    expect(lastUpdateData().emailDomainVerifiedAt).toBeNull();
  });

  it('keeps verification when only the name / reply-to / unchanged sender is sent', async () => {
    m.prisma.eventSeries.findUnique.mockResolvedValue({
      ...BEFORE, emailDomain: 'mail.partner.com', emailFromAddress: 'events@mail.partner.com',
      emailDomainVerifiedAt: new Date('2026-05-01T00:00:00Z'),
    });
    await patch({ emailFromName: 'New Name', emailReplyTo: 'hi@partner.com', emailFromAddress: 'events@mail.partner.com', emailDomain: 'mail.partner.com' });
    expect(lastUpdateData()).not.toHaveProperty('emailDomainVerifiedAt');
  });

  it('a PATCH that leaves the sender alone (rsv.pizza-style brand) touches no sender field', async () => {
    await patch({ description: 'hello' });
    const d = lastUpdateData();
    for (const k of ['emailFromAddress', 'emailFromName', 'emailReplyTo', 'emailDomain', 'emailDomainVerifiedAt', 'siteAliases']) {
      expect(d).not.toHaveProperty(k);
    }
  });
});

describe('POST /api/admin/series', () => {
  const post = (body: unknown) => request(app).post('/api/admin/series').send(body as object);

  it('creates with default (unset) sender fields, never a verified timestamp, and audits', async () => {
    const res = await post({ slug: 'acme', name: 'Acme', emailDomainVerifiedAt: '2026-01-01T00:00:00Z', resendDomainId: 'x' });
    expect(res.status).toBe(201);
    const data = m.prisma.eventSeries.create.mock.calls[0][0].data;
    expect(data.emailFromAddress).toBeNull();
    expect(data.emailDomain).toBeNull();
    expect(data.siteAliases).toEqual([]);
    expect(data).not.toHaveProperty('emailDomainVerifiedAt');
    expect(data).not.toHaveProperty('resendDomainId');
    expect(m.prisma.seriesAudit.create.mock.calls[0][0].data).toMatchObject({ seriesId: 's2', action: 'series.create', actorKind: 'super_admin' });
  });

  it('validates the sender on create', async () => {
    expect((await post({ slug: 'acme', name: 'Acme', emailFromAddress: 'events@other.com', emailDomain: 'mail.partner.com' })).status).toBe(400);
    expect(m.prisma.eventSeries.create).not.toHaveBeenCalled();
  });
});
