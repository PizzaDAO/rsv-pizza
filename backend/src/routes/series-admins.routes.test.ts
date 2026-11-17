import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeFakeDb } from '../testutil/fakeSeriesAdminDb.js';
import { memoryRateStore } from '../lib/authRateLimit.js';

const S1 = '11111111-1111-4111-8111-111111111111';
const X1 = '00000000-0000-4000-8000-0000000000a0';
const ALIVE = '00000000-0000-4000-8000-0000000000a1';
const AD1 = '00000000-0000-4000-8000-0000000000a2';
const AD2 = '00000000-0000-4000-8000-0000000000a3';
const BD1 = '00000000-0000-4000-8000-0000000000b1';
const BD2 = '00000000-0000-4000-8000-0000000000b2';
const S2 = '22222222-2222-4222-8222-222222222222';

const m = vi.hoisted(() => ({
  fake: null as any,
  actor: { email: 'boss@example.com', userId: 'u-boss' },
  superAdmins: new Set<string>(['boss@example.com']),
  send: vi.fn(),
  site: { url: 'https://acme.example.org', name: 'Acme Pizza', fromEmail: 'Acme <noreply@example.org>' } as any,
}));

vi.mock('../config/database.js', () => ({
  prisma: new Proxy({}, { get: (_t, k) => (m.fake ? m.fake.db[k as string] : undefined) }),
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = m.actor.userId; req.userEmail = m.actor.email; next(); },
  isSuperAdmin: async (e?: string) => !!e && m.superAdmins.has(e.toLowerCase()),
  AuthRequest: {},
}));
vi.mock('../lib/siteBrand.js', () => ({ brandedSiteForParty: async () => m.site }));
vi.mock('../lib/resendSend.js', () => ({ sendBrandedEmail: (...a: any[]) => m.send(...a) }));
vi.mock('../services/partyStatusEmailNotify.js', () => ({ emailHostOfStatusChange: vi.fn() }));
vi.mock('../helpers/statusAudit.js', () => ({ writeStatusAudit: vi.fn() }));
vi.mock('../config/secrets.js', () => ({ getJwtSecret: () => 'test-secret' }));

import adminSeries from './admin-series.routes.js';
import brandAdmin from './brand-admin.routes.js';
import { requireSeriesAdmin } from '../lib/seriesAccess.js';
import { setInviteLimitStore, INVITE_ACCEPT_LIMIT } from '../lib/seriesInviteLimit.js';
import { hashInviteToken, INVITE_TTL_MS } from '../lib/seriesInvites.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/admin/series', adminSeries);
app.use('/api/brand-admin', brandAdmin);
// A probe route behind the access guard, to test membership + revoke.
app.get('/api/brand-admin/:seriesId/probe', (req, _res, next) => { (req as any).userEmail = m.actor.email; next(); }, requireSeriesAdmin, (req: any, res) => res.json(req.seriesAdmin));
app.use(errorHandler);

const as = (email: string, userId = `u-${email}`) => { m.actor = { email, userId }; };
const invite = (body: object, seriesId = S1) => request(app).post(`/api/admin/series/${seriesId}/admins`).send(body);
const rawTokenFromEmail = () => {
  const html: string = m.send.mock.calls.at(-1)![0].payload.html;
  return /token=([A-Za-z0-9_-]+)/.exec(html)![1];
};

beforeEach(() => {
  vi.clearAllMocks();
  process.env.RESEND_API_KEY = 'test-key';
  m.fake = makeFakeDb({ seriesIds: [S1, S2] });
  m.actor = { email: 'boss@example.com', userId: 'u-boss' };
  m.send.mockResolvedValue({ ok: true, status: 200 });
  setInviteLimitStore(memoryRateStore());
});

describe('invite (super-admin only)', () => {
  it('403s a non-super-admin and writes nothing', async () => {
    as('someone@example.com');
    const res = await invite({ email: 'p@partner.com' });
    expect(res.status).toBe(403);
    expect(m.fake.admins).toHaveLength(0);
    expect(m.send).not.toHaveBeenCalled();
  });

  it('even an active brand admin cannot invite', async () => {
    m.fake.admins.push({ id: X1, seriesId: S1, email: 'brand@partner.com', status: 'active' });
    as('brand@partner.com');
    expect((await invite({ email: 'p@partner.com' })).status).toBe(403);
  });

  it('stores only the token hash, emails the raw token from the series site, audits', async () => {
    const res = await invite({ email: 'Partner@Partner.com', role: 'editor' });
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
    const row = m.fake.admins[0];
    const token = rawTokenFromEmail();
    expect(row.email).toBe('partner@partner.com');
    expect(row.inviteTokenHash).toBe(hashInviteToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain(token);
    expect(JSON.stringify(res.body)).not.toContain(row.inviteTokenHash);
    expect(row.status).toBe('invited');
    expect(row.inviteExpiresAt.getTime() - Date.now()).toBeGreaterThan(INVITE_TTL_MS - 5000);
    expect(row.inviteExpiresAt.getTime() - Date.now()).toBeLessThanOrEqual(INVITE_TTL_MS);
    const html: string = m.send.mock.calls[0][0].payload.html;
    expect(html).toContain('https://acme.example.org/brand-admin/accept?token=');
    expect(m.send.mock.calls[0][0].payload.to).toEqual(['partner@partner.com']);
    expect(m.fake.audit[0]).toMatchObject({ seriesId: S1, actorKind: 'super_admin', action: 'admin.invite', actorEmail: 'boss@example.com' });
    expect(JSON.stringify(m.fake.audit)).not.toContain(token);
  });

  it('escapes the brand name in the invite email', async () => {
    m.site = { ...m.site, name: '<img src=x onerror=alert(1)>' };
    await invite({ email: 'p@partner.com' });
    const html: string = m.send.mock.calls[0][0].payload.html;
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;img');
    m.site = { ...m.site, name: 'Acme Pizza' };
  });

  it('validates email and role', async () => {
    expect((await invite({ email: 'not-an-email' })).status).toBe(400);
    expect((await invite({})).status).toBe(400);
    expect((await invite({ email: 'p@partner.com', role: 'god' })).status).toBe(400);
    expect(m.fake.admins).toHaveLength(0);
  });

  it('400s when the series has no live branded site', async () => {
    const prev = m.site;
    m.site = null;
    expect((await invite({ email: 'p@partner.com' })).status).toBe(400);
    m.site = prev;
  });

  it('404s an unknown series', async () => {
    expect((await invite({ email: 'p@partner.com' }, '33333333-3333-4333-8333-333333333333')).status).toBe(404);
  });

  it('409s an already-active admin and re-invites a revoked one with a fresh token', async () => {
    await invite({ email: 'p@partner.com' });
    m.fake.admins[0].status = 'active';
    expect((await invite({ email: 'p@partner.com' })).status).toBe(409);
    m.fake.admins[0].status = 'revoked';
    const oldHash = m.fake.admins[0].inviteTokenHash;
    expect((await invite({ email: 'p@partner.com' })).status).toBe(201);
    expect(m.fake.admins).toHaveLength(1);
    expect(m.fake.admins[0].status).toBe('invited');
    expect(m.fake.admins[0].inviteTokenHash).not.toBe(oldHash);
  });

  it('reports emailSent:false (row kept) when Resend is not configured', async () => {
    delete process.env.RESEND_API_KEY;
    const res = await invite({ email: 'p@partner.com' });
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(false);
    expect(m.fake.admins).toHaveLength(1);
  });
});

describe('accept', () => {
  async function invited(email = 'p@partner.com') {
    await invite({ email });
    return rawTokenFromEmail();
  }
  const accept = (token: unknown) => request(app).post('/api/brand-admin/accept').send({ token });

  it('activates for the invited email, clears the hash, audits', async () => {
    const token = await invited();
    as('P@partner.com', 'u-p');
    const res = await accept(token);
    expect(res.status).toBe(200);
    expect(res.body.seriesId).toBe(S1);
    expect(m.fake.admins[0]).toMatchObject({ status: 'active', userId: 'u-p', inviteTokenHash: null, inviteExpiresAt: null });
    expect(m.fake.audit.at(-1)).toMatchObject({ action: 'admin.accept', actorKind: 'series_admin', seriesId: S1 });
  });

  it('is single use', async () => {
    const token = await invited();
    as('p@partner.com');
    expect((await accept(token)).status).toBe(200);
    const again = await accept(token);
    expect(again.status).toBe(400);
  });

  it('rejects another email without consuming the invite', async () => {
    const token = await invited();
    as('mallory@example.com');
    const res = await accept(token);
    expect(res.status).toBe(403);
    expect(res.body.error?.message ?? res.body.message ?? JSON.stringify(res.body)).toMatch(/different email/i);
    expect(m.fake.admins[0].status).toBe('invited');
    as('p@partner.com');
    expect((await accept(token)).status).toBe(200);
  });

  it('rejects an expired invite', async () => {
    const token = await invited();
    m.fake.admins[0].inviteExpiresAt = new Date(Date.now() - 1000);
    as('p@partner.com');
    expect((await accept(token)).status).toBe(400);
    expect(m.fake.admins[0].status).toBe('invited');
  });

  it('rejects a revoked invite and a resent (superseded) token', async () => {
    const first = await invited();
    const resend = await request(app).post(`/api/admin/series/${S1}/admins/${m.fake.admins[0].id}/resend`);
    expect(resend.status).toBe(200);
    as('p@partner.com');
    expect((await accept(first)).status).toBe(400); // old token superseded
    as('boss@example.com');
    const second = rawTokenFromEmail();
    await request(app).patch(`/api/admin/series/${S1}/admins/${m.fake.admins[0].id}`).send({ status: 'revoked' });
    as('p@partner.com');
    expect((await accept(second)).status).toBe(400);
  });

  it('rejects malformed tokens before any lookup', async () => {
    as('p@partner.com');
    expect((await accept('short')).status).toBe(400);
    expect((await accept(undefined)).status).toBe(400);
    expect((await accept({ $ne: 1 })).status).toBe(400);
  });

  it('rate limits to 10 attempts per hour', async () => {
    as('p@partner.com');
    const bad = 'A'.repeat(43);
    for (let i = 0; i < INVITE_ACCEPT_LIMIT; i++) expect((await accept(bad)).status).toBe(400);
    expect((await accept(bad)).status).toBe(429);
  });

  it('fails closed (503) when the rate store is down', async () => {
    setInviteLimitStore({ reserve: async () => { throw new Error('db down'); }, release: async () => {}, cleanup: async () => {} });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    as('p@partner.com');
    expect((await accept('A'.repeat(43))).status).toBe(503);
    err.mockRestore();
  });

  it('requires auth identity', async () => {
    as('', '');
    expect((await accept('A'.repeat(43))).status).toBe(401);
  });
});

describe('revoke, alerts and access', () => {
  it('revoke takes effect on the very next request', async () => {
    m.fake.admins.push({ id: ALIVE, seriesId: S1, email: 'brand@partner.com', status: 'active' });
    as('brand@partner.com');
    expect((await request(app).get(`/api/brand-admin/${S1}/probe`)).status).toBe(200);
    as('boss@example.com');
    const r = await request(app).patch(`/api/admin/series/${S1}/admins/${ALIVE}`).send({ status: 'revoked' });
    expect(r.status).toBe(200);
    expect(m.fake.audit.at(-1)).toMatchObject({ action: 'admin.revoke', actorKind: 'super_admin' });
    as('brand@partner.com');
    expect((await request(app).get(`/api/brand-admin/${S1}/probe`)).status).toBe(404);
  });

  it('a revoked or invited member is not a series admin; other series is a 404', async () => {
    m.fake.admins.push({ id: AD1, seriesId: S1, email: 'brand@partner.com', status: 'active' });
    m.fake.admins.push({ id: AD2, seriesId: S1, email: 'pending@partner.com', status: 'invited' });
    as('brand@partner.com');
    expect((await request(app).get(`/api/brand-admin/${S1}/probe`)).body).toMatchObject({ seriesId: S1, actorKind: 'series_admin' });
    expect((await request(app).get(`/api/brand-admin/${S2}/probe`)).status).toBe(404);
    as('pending@partner.com');
    expect((await request(app).get(`/api/brand-admin/${S1}/probe`)).status).toBe(404);
    expect((await request(app).get(`/api/brand-admin/not-a-uuid/probe`)).status).toBe(404);
  });

  it('an inactive series 404s its brand admin; super-admin passes for any existing series', async () => {
    m.fake = makeFakeDb({ seriesIds: [S1, S2], inactiveSeries: [S1] });
    m.fake.admins.push({ id: AD1, seriesId: S1, email: 'brand@partner.com', status: 'active' });
    as('brand@partner.com');
    expect((await request(app).get(`/api/brand-admin/${S1}/probe`)).status).toBe(404);
    as('boss@example.com');
    expect((await request(app).get(`/api/brand-admin/${S2}/probe`)).body.actorKind).toBe('super_admin');
    expect((await request(app).get(`/api/brand-admin/33333333-3333-4333-8333-333333333333/probe`)).status).toBe(404);
  });

  it("an admin id from another series is a 404 for revoke, resend and alerts (no write)", async () => {
    m.fake.admins.push({ id: BD1, seriesId: S2, email: 'other@partner.com', status: 'active', alertsEnabled: true });
    m.fake.admins.push({ id: BD2, seriesId: S2, email: 'inv@partner.com', status: 'invited' });
    const before = JSON.stringify(m.fake.admins);
    expect((await request(app).patch(`/api/admin/series/${S1}/admins/${BD1}`).send({ status: 'revoked' })).status).toBe(404);
    expect((await request(app).patch(`/api/admin/series/${S1}/admins/${BD1}`).send({ alertsEnabled: false })).status).toBe(404);
    expect((await request(app).post(`/api/admin/series/${S1}/admins/${BD2}/resend`)).status).toBe(404);
    expect(JSON.stringify(m.fake.admins)).toBe(before);
    expect(m.fake.audit).toHaveLength(0);
  });

  it('super-admin toggles alerts and lists admins', async () => {
    await invite({ email: 'p@partner.com' });
    const id = m.fake.admins[0].id;
    const r = await request(app).patch(`/api/admin/series/${S1}/admins/${id}`).send({ alertsEnabled: false });
    expect(r.status).toBe(200);
    expect(m.fake.admins[0].alertsEnabled).toBe(false);
    expect(m.fake.audit.at(-1)).toMatchObject({ action: 'admin.alerts' });
    const list = await request(app).get(`/api/admin/series/${S1}/admins`);
    expect(list.status).toBe(200);
  });

  it('non-uuid series or admin ids are a 404 before any query', async () => {
    expect((await request(app).get('/api/admin/series/not-a-uuid/admins')).status).toBe(404);
    expect((await request(app).patch(`/api/admin/series/${S1}/admins/zzz`).send({ alertsEnabled: false })).status).toBe(404);
    expect((await request(app).post(`/api/admin/series/${S1}/admins/zzz/resend`)).status).toBe(404);
  });

  it('a concurrent duplicate invite (unique violation) is a friendly 409', async () => {
    const orig = m.fake.db.seriesAdmin.create;
    m.fake.db.seriesAdmin.create = async () => { throw Object.assign(new Error('dup'), { code: 'P2002' }); };
    const res = await invite({ email: 'p@partner.com' });
    expect(res.status).toBe(409);
    m.fake.db.seriesAdmin.create = orig;
  });

  it('only revoked is an allowed status', async () => {
    await invite({ email: 'p@partner.com' });
    const r = await request(app).patch(`/api/admin/series/${S1}/admins/${m.fake.admins[0].id}`).send({ status: 'active' });
    expect(r.status).toBe(400);
    expect(m.fake.admins[0].status).toBe('invited');
  });
});
