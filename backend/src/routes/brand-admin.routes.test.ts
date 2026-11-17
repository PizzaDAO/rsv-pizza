import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeFakeDb, matches } from '../testutil/fakeSeriesAdminDb.js';
import { memoryRateStore } from '../lib/authRateLimit.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const CA1 = 'c0000000-0000-4000-8000-0000000000a1';
const CB1 = 'c0000000-0000-4000-8000-0000000000b1';
const CG1 = 'c0000000-0000-4000-8000-0000000000e1';
const PA1 = 'd0000000-0000-4000-8000-0000000000a1';
const PB1 = 'd0000000-0000-4000-8000-0000000000b1';
const MISSING = 'c0000000-0000-4000-8000-0000000000ff';

const m = vi.hoisted(() => ({
  fake: null as any,
  actor: { email: 'brand@partner.com', userId: 'u-brand' },
  superAdmins: new Set<string>(['boss@example.com']),
  notifyHost: vi.fn(),
  invalidate: vi.fn(),
  statusAudit: vi.fn(),
  state: null as any,
}));

vi.mock('../config/database.js', () => ({
  prisma: new Proxy({}, { get: (_t, k) => (m.state ? m.state.db[k as string] : undefined) }),
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = m.actor.userId; req.userEmail = m.actor.email; next(); },
  isSuperAdmin: async (e?: string) => !!e && m.superAdmins.has(e.toLowerCase()),
  AuthRequest: {},
}));
vi.mock('../services/partyStatusEmailNotify.js', () => ({ emailHostOfStatusChange: (...a: any[]) => m.notifyHost(...a) }));
vi.mock('../helpers/statusAudit.js', () => ({ writeStatusAudit: (...a: any[]) => m.statusAudit(...a) }));
vi.mock('../lib/siteBrand.js', () => ({ brandedSiteForParty: async () => null, invalidateSiteBrandCache: () => m.invalidate() }));
vi.mock('../lib/resendSend.js', () => ({ sendBrandedEmail: vi.fn() }));
vi.mock('../config/secrets.js', () => ({ getJwtSecret: () => 'test-secret' }));

import { Prisma } from '@prisma/client';
import router from './brand-admin.routes.js';
import adminSeries from './admin-series.routes.js';
import { requireSeriesAdmin } from '../lib/seriesAccess.js';
import { setInviteLimitStore } from '../lib/seriesInviteLimit.js';
import { BRAND_ADMIN_FIELDS } from '../lib/seriesBrandSettings.js';
import { errorHandler } from '../middleware/error.js';

const app = express();
app.use(express.json());
app.use('/api/brand-admin', router);
app.use('/api/admin/series', adminSeries);
app.use(errorHandler);

const as = (email: string, userId = `u-${email}`) => { m.actor = { email, userId }; };

function seriesRow(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, slug: id === A ? 'acme' : 'other', name: 'Internal Name', displayName: 'Acme', brandName: 'Acme Pizza',
    isActive: true, siteUrl: 'https://acme.example.org', siteAliases: [], tagline: null, metaDescription: null,
    supportEmail: null, description: 'Old description', nameTemplate: null, hideGuests: false, photosEnabled: true,
    photosPublic: true, eventDate: null, eventStartTime: null, eventEndTime: null, emailFromName: null, emailReplyTo: null,
    emailFromAddress: null, emailDomain: null, emailDomainVerifiedAt: null,
    requireApproval: true, createFlow: 'meetup', themeClass: 'acme-theme', logoUrl: null, ogImageUrl: null,
    flyerTemplateKey: null, eventType: null, publicTags: ['t'], internalTags: ['i'], fundingWalletAddress: '0xSECRETWALLET',
    resendDomainId: 'dom_123', pendingDomainToken: 'tok', configVersion: 1, ...extra,
  };
}

function buildState() {
  const fake = makeFakeDb({ seriesIds: [A, B] });
  const series: Record<string, any> = { [A]: seriesRow(A), [B]: seriesRow(B, { brandName: 'Other Brand' }) };
  const audit: any[] = fake.audit;
  const checklist: any[] = [
    { id: CA1, seriesId: A, name: 'Book venue', dueDate: null, linkTab: null, sortOrder: 0, isAuto: false },
    { id: CB1, seriesId: B, name: 'B item', dueDate: null, linkTab: null, sortOrder: 0, isAuto: false },
    { id: CG1, seriesId: null, name: 'Global item', dueDate: null, linkTab: null, sortOrder: 0, isAuto: false },
  ];
  const parties: any[] = [
    { id: PA1, eventSeriesId: A, underbossStatus: 'pending', name: 'A event', cancelledAt: null },
    { id: PB1, eventSeriesId: B, underbossStatus: 'pending', name: 'B event', cancelledAt: null },
  ];
  const writes = vi.fn();
  // Real relation matching: `party: { eventSeriesId }` on checklist items resolves through the parties table.
  const rel = { party: (r: any) => parties.find((p) => p.id === r.partyId) } as any;
  const match = (row: any, where: any) => matches(row, where, rel);
  const sel = (row: any, select?: any) => (row && select ? Object.fromEntries(Object.keys(select).map((k) => [k, row[k] ?? null])) : row && { ...row });
  const db: any = fake.db;
  db.eventSeries = {
    findUnique: async ({ where }: any) => (series[where.id] ? { id: where.id } : null),
    findFirst: async ({ where, select }: any) => sel(Object.values(series).find((r: any) => match(r, where)), select),
    findMany: async ({ where }: any) => Object.values(series).filter((r: any) => match(r, where)),
    update: async ({ where, data }: any) => {
      writes('eventSeries.update', where, data);
      const row = series[where.id];
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'increment' in (v as any)) row[k] += (v as any).increment;
        else row[k] = v;
      }
      return { ...row };
    },
  };
  db.seriesAudit = {
    create: async ({ data }: any) => { writes('seriesAudit.create', data); audit.push({ id: `00000000-0000-4000-8000-${String(audit.length + 1).padStart(12, '0')}`, createdAt: new Date(), ...data }); return data; },
    findFirst: async ({ where, select }: any) => sel(audit.find((r) => r.id === where.id && r.seriesId === where.seriesId && where.action.in.includes(r.action)), select),
    findMany: async ({ where }: any) => audit.filter((r) => r.seriesId === where.seriesId && where.action.in.includes(r.action)).reverse(),
  };
  db.checklistDefault = {
    findMany: async ({ where }: any) => checklist.filter((r) => match(r, where)),
    findFirst: async ({ where, select }: any) => sel(checklist.find((r) => match(r, where)), select),
    count: async ({ where }: any) => checklist.filter((r) => match(r, where)).length,
    aggregate: async ({ where }: any) => ({ _max: { sortOrder: Math.max(-1, ...checklist.filter((r) => match(r, where)).map((r) => r.sortOrder)) } }),
    create: async ({ data, select }: any) => {
      writes('checklistDefault.create', data);
      const row = { id: `new${checklist.length}`, isAuto: false, ...data };
      checklist.push(row);
      return sel(row, select);
    },
    updateMany: async ({ where, data }: any) => {
      writes('checklistDefault.updateMany', where, data);
      const hit = checklist.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
    deleteMany: async ({ where }: any) => {
      writes('checklistDefault.deleteMany', where);
      const hit = checklist.filter((r) => match(r, where));
      hit.forEach((r) => checklist.splice(checklist.indexOf(r), 1));
      return { count: hit.length };
    },
  };
  const items: any[] = [
    { id: 'e0000000-0000-4000-8000-0000000000a1', partyId: PA1, isDefault: true, name: 'Book venue', dueDate: null, linkTab: null },
    { id: 'e0000000-0000-4000-8000-0000000000b1', partyId: PB1, isDefault: true, name: 'Book venue', dueDate: null, linkTab: null },
  ];
  db.checklistItem = {
    updateMany: async ({ where, data }: any) => {
      writes('checklistItem.updateMany', where, data);
      const hit = items.filter((r) => match(r, where));
      hit.forEach((r) => Object.assign(r, data));
      return { count: hit.length };
    },
  };
  const statusAudits: any[] = [];
  db.partyStatusAudit = {
    findFirst: async ({ where }: any) => [...statusAudits].reverse().find((r) => r.partyId === where.partyId) ?? null,
  };
  db.party = {
    findFirst: async ({ where, select }: any) => sel(parties.find((r) => match(r, where)), select),
    findMany: async ({ where }: any) => parties.filter((r) => match(r, where)),
    update: async ({ where, data }: any) => {
      writes('party.update', where, data);
      const row = parties.find((r) => r.id === where.id)!;
      Object.assign(row, data);
      return { id: row.id, underbossStatus: row.underbossStatus };
    },
  };
  return { fake, db, series, audit, checklist, parties, items, statusAudits, writes, admins: fake.admins };
}

const lastAudit = (s: any) => s.audit.at(-1);

beforeEach(() => {
  vi.clearAllMocks();
  m.state = buildState();
  m.statusAudit.mockImplementation((_tx: any, partyId: string, _o: any, newStatus: string, _email: string, actorKind: string, reason?: string) => {
    m.state.statusAudits.push({ partyId, newStatus, actorKind, reason: reason ?? null });
  });
  m.state.admins.push({ id: 'mem-a', seriesId: A, email: 'brand@partner.com', status: 'active', alertsEnabled: true, role: 'editor' });
  as('brand@partner.com');
  setInviteLimitStore(memoryRateStore());
});

describe('route registry', () => {
  // Every route must sit behind requireSeriesAdmin, except the two documented unscoped ones.
  it('only /accept and /me are unscoped; everything else is under /:seriesId behind requireSeriesAdmin', () => {
    const stack = (router as any).stack as any[];
    const direct = stack.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`);
    expect(direct.sort()).toEqual(['GET /me', 'POST /accept']);
    const mounted = stack.filter((l) => !l.route);
    // the only non-route layers are the /:seriesId mount: requireAuth, then the scoped router
    expect(mounted).toHaveLength(2);
    const inner = (mounted[1].handle as any).stack as any[];
    expect(inner[0].handle).toBe(requireSeriesAdmin);
    const scopedRoutes = inner.filter((l) => l.route).map((l) => `${Object.keys(l.route.methods)[0].toUpperCase()} ${l.route.path}`).sort();
    expect(scopedRoutes).toEqual([
      'DELETE /checklist/:itemId', 'GET /audit', 'GET /checklist', 'GET /events', 'GET /settings',
      'PATCH /alerts', 'PATCH /checklist/:itemId', 'PATCH /events/:partyId/status', 'PATCH /settings',
      'POST /checklist', 'POST /revert',
    ]);
  });
});

describe('cross-tenant matrix: admin of A against series B', () => {
  const routes: Array<[string, string, object?]> = [
    ['get', `/${B}/settings`],
    ['patch', `/${B}/settings`, { tagline: 'x' }],
    ['get', `/${B}/audit`],
    ['post', `/${B}/revert`, { auditId: '33333333-3333-4333-8333-333333333333' }],
    ['get', `/${B}/checklist`],
    ['post', `/${B}/checklist`, { name: 'x' }],
    ['patch', `/${B}/checklist/${CB1}`, { name: 'x' }],
    ['delete', `/${B}/checklist/${CB1}`],
    ['get', `/${B}/events`],
    ['patch', `/${B}/events/${PB1}/status`, { status: 'approved' }],
    ['patch', `/${B}/alerts`, { alertsEnabled: false }],
  ];

  it.each(routes)('%s %s is a 404 with no write', async (method, path, body) => {
    const res = await (request(app) as any)[method](`/api/brand-admin${path}`).send(body ?? {});
    expect(res.status).toBe(404);
    expect(m.state.writes).not.toHaveBeenCalled();
    expect(m.state.audit).toHaveLength(0);
    expect(m.notifyHost).not.toHaveBeenCalled();
  });

  it('a made-up or non-uuid series id is also a 404', async () => {
    expect((await request(app).get('/api/brand-admin/33333333-3333-4333-8333-333333333333/settings')).status).toBe(404);
    expect((await request(app).get('/api/brand-admin/acme/settings')).status).toBe(404);
  });

  it('a signed-in non-member and a revoked member get 404 for their own series ids too', async () => {
    as('stranger@example.com');
    expect((await request(app).get(`/api/brand-admin/${A}/settings`)).status).toBe(404);
    m.state.admins[0].status = 'revoked';
    as('brand@partner.com');
    expect((await request(app).get(`/api/brand-admin/${A}/settings`)).status).toBe(404);
    expect(m.state.writes).not.toHaveBeenCalled();
  });
});

describe('settings', () => {
  const patch = (body: unknown, id = A) => request(app).patch(`/api/brand-admin/${id}/settings`).send(body as object);

  it('GET returns only editable fields and read-only context, never money/domain/tag data', async () => {
    const res = await request(app).get(`/api/brand-admin/${A}/settings`);
    expect(res.status).toBe(200);
    const json = JSON.stringify(res.body);
    expect(json).not.toMatch(/SECRETWALLET|dom_123|pendingDomainToken|internalTags|publicTags|themeClass/);
    expect(res.body.settings).toMatchObject({ brandName: 'Acme Pizza', slug: 'acme', requireApproval: true, createFlow: 'meetup' });
  });

  it('updates allowlisted fields, bumps config_version, audits as series_admin with a pre-change snapshot', async () => {
    const res = await patch({ brandName: "Acme & Co's Pizza!", tagline: 'Slices for all', supportEmail: 'Help@Partner.com', hideGuests: true });
    expect(res.status).toBe(200);
    expect(res.body.changed.sort()).toEqual(['brandName', 'hideGuests', 'supportEmail', 'tagline']);
    const row = m.state.series[A];
    expect(row).toMatchObject({ brandName: "Acme & Co's Pizza!", tagline: 'Slices for all', supportEmail: 'help@partner.com', hideGuests: true, configVersion: 2 });
    expect(lastAudit(m.state)).toMatchObject({ seriesId: A, actorKind: 'series_admin', actorEmail: 'brand@partner.com', action: 'settings.update' });
    expect(lastAudit(m.state).changes.brandName).toEqual({ old: 'Acme Pizza', new: "Acme & Co's Pizza!" });
    expect(lastAudit(m.state).snapshot.brandName).toBe('Acme Pizza');
    // other series untouched
    expect(m.state.series[B].brandName).toBe('Other Brand');
    expect(m.state.series[B].configVersion).toBe(1);
  });

  const superOnly: Array<[string, unknown]> = [
    ['slug', 'new'], ['name', 'x'], ['isActive', false], ['themeClass', 'evil'], ['logoUrl', 'https://evil.example/x.png'],
    ['ogImageUrl', 'https://evil.example/x.png'], ['flyerTemplateKey', 'gpp'], ['createFlow', 'hackathon'],
    ['requireApproval', false], ['eventType', 'x'], ['publicTags', ['a']], ['internalTags', ['a']],
    ['fundingWalletAddress', '0xdead'], ['siteUrl', 'https://evil.example'], ['siteAliases', ['https://evil.example']],
    ['emailFromAddress', 'x@evil.example'], ['emailDomain', 'evil.example'], ['emailDomainVerifiedAt', '2026-01-01'],
    ['resendDomainId', 'x'], ['pendingDomain', 'evil.example'], ['configVersion', 99], ['id', B], ['seriesId', B],
    ['flyerArt', {}], ['faviconUrl', 'x'], ['logoLightUrl', 'x'],
  ];
  it.each(superOnly)('rejects super-admin-only key %s with a 400 and no write', async (key, value) => {
    const res = await patch({ tagline: 'ok', [key]: value });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).toContain(key);
    expect(m.state.writes).not.toHaveBeenCalled();
    expect(m.state.series[A].tagline).toBeNull();
  });

  describe('themeTokens', () => {
    const TOK = {
      mode: 'dark', bg: '#0b0b10', surface: '#17171f', text: '#f5f5f7', textMuted: '#a8a8b3',
      accent: '#e6212f', onAccent: '#ffffff', border: '#2a2a35', radius: 'pill', fontHeading: 'kanit', fontBody: 'inter',
    };
    it('stores a valid token set (normalised) and audits it', async () => {
      as('brand@partner.com');
      const res = await patch({ themeTokens: { ...TOK, accent: '#E6212F' } });
      expect(res.status).toBe(200);
      expect(m.state.series[A].themeTokens).toEqual(TOK);
      expect(res.body.changed).toContain('themeTokens');
    });
    it.each([
      ['non-hex colour', { ...TOK, accent: 'red' }],
      ['css injection', { ...TOK, bg: '#000000; background:url(//evil.example.org)' }],
      ['unknown font', { ...TOK, fontBody: 'comic-sans' }],
      ['failing contrast', { ...TOK, textMuted: '#2a2a35' }],
      ['unknown key', { ...TOK, extra: 1 }],
      ['overrides from a brand admin', { ...TOK, overrides: { '--bg-card': '#1a1b1c' } }],
      ['oversize', { ...TOK, junk: 'x'.repeat(5000) }],
      ['a string', 'x'],
    ])('rejects %s with a 400 and no write', async (_n, themeTokens) => {
      as('brand@partner.com');
      const res = await patch({ themeTokens });
      expect(res.status).toBe(400);
      expect(m.state.writes).not.toHaveBeenCalled();
      expect(m.state.series[A].themeTokens).toBeUndefined();
    });
    it('returns accent-contrast warnings in the save response without blocking', async () => {
      as('brand@partner.com');
      const res = await patch({ themeTokens: { ...TOK, accent: '#0b0b11', onAccent: '#ffffff' } });
      expect(res.status).toBe(200);
      expect(res.body.warnings.join(' ')).toMatch(/accent on bg/);
    });
    it('rejects a mode that disagrees with bg and failing derived secondary text', async () => {
      as('brand@partner.com');
      const a = await patch({ themeTokens: { ...TOK, mode: 'dark', bg: '#ffffff', surface: '#f2f2f2', text: '#111111', textMuted: '#444444', border: '#dddddd' } });
      expect(a.status).toBe(400);
      expect(JSON.stringify(a.body)).toMatch(/mode is \\"dark\\" but bg is a light colour/);
      const b = await patch({ themeTokens: { ...TOK, mode: 'light', bg: '#767676', surface: '#767676', text: '#ffffff', textMuted: '#000000', accent: '#000000', border: '#dddddd' } });
      expect(b.status).toBe(400);
      expect(JSON.stringify(b.body)).toMatch(/secondary text/);
      expect(m.state.writes).not.toHaveBeenCalled();
    });
    it('jsonb key reordering is not a change: no write, no version bump, no audit', async () => {
      as('brand@partner.com');
      const reordered = Object.fromEntries(Object.entries(TOK).reverse());
      m.state.series[A].themeTokens = { ...reordered, overrides: { '--bg-card': '#1a1b1c' } };
      const v = m.state.series[A].configVersion;
      const res = await patch({ themeTokens: { ...TOK } });
      expect(res.status).toBe(200);
      expect(res.body.changed).toEqual([]);
      expect(m.state.writes).not.toHaveBeenCalled();
      expect(m.state.series[A].configVersion).toBe(v);
    });
    it('a save that does not mention hideHeaderName / hideHeroLogo keeps them; an explicit value changes only that flag', async () => {
      as('brand@partner.com');
      m.state.series[A].themeTokens = { ...TOK, hideHeaderName: true, hideHeroLogo: true };
      const a = await patch({ themeTokens: { ...TOK, accent: '#d92b3a' } });
      expect(a.status).toBe(200);
      expect(m.state.series[A].themeTokens.hideHeaderName).toBe(true);
      expect(m.state.series[A].themeTokens.hideHeroLogo).toBe(true);
      expect(m.state.series[A].themeTokens.accent).toBe('#d92b3a');
      const b = await patch({ themeTokens: { ...TOK, accent: '#d92b3a', hideHeaderName: false } });
      expect(b.status).toBe(200);
      expect(m.state.series[A].themeTokens.hideHeaderName).toBe(false);
      expect(m.state.series[A].themeTokens.hideHeroLogo).toBe(true);
    });
    it('a brand admin cannot clear tokens that carry overrides (400, overrides intact)', async () => {
      as('brand@partner.com');
      m.state.series[A].themeTokens = { ...TOK, overrides: { '--bg-card': '#1a1b1c' } };
      const res = await patch({ themeTokens: null });
      expect(res.status).toBe(400);
      expect(m.state.series[A].themeTokens.overrides).toEqual({ '--bg-card': '#1a1b1c' });
      expect(m.state.writes).not.toHaveBeenCalled();
    });
    it('revert keeps CURRENT overrides: never re-adds removed ones, never drops existing ones', async () => {
      as('brand@partner.com');
      // history: tokens WITH overrides, then a super-admin removed them, brand admin changes colour
      m.state.series[A].themeTokens = { ...TOK, overrides: { '--bg-card': '#1a1b1c' } };
      expect((await patch({ themeTokens: { ...TOK, accent: '#d92b3a' } })).status).toBe(200); // snapshot has overrides
      m.state.series[A].themeTokens = { ...TOK, accent: '#d92b3a' }; // super-admin removed overrides
      const hist = (await request(app).get(`/api/brand-admin/${A}/audit`)).body;
      const id = (hist.history ?? hist.entries ?? hist.audit ?? [])[0]?.id ?? m.state.audit[m.state.audit.length - 1].id;
      const rev = await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId: id });
      expect(rev.status).toBe(200);
      expect(m.state.series[A].themeTokens.overrides).toBeUndefined();
      expect(m.state.series[A].themeTokens.accent).toBe('#e6212f');
      // and the converse: overrides present now are kept through a revert
      m.state.series[A].themeTokens = { ...TOK, accent: '#d92b3a', overrides: { '--bg-card': '#222222' } };
      expect((await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId: id })).status).toBe(200);
      expect(m.state.series[A].themeTokens.overrides).toEqual({ '--bg-card': '#222222' });
    });
    it('a super-admin writes overrides through admin-series PATCH (validated); a brand admin cannot', async () => {
      as('boss@example.com');
      const withOv = { ...TOK, overrides: { '--bg-card': '#1a1b1c' } };
      const ok = await request(app).patch(`/api/admin/series/${A}`).send({ themeTokens: withOv });
      expect(ok.status).toBe(200);
      expect(m.state.series[A].themeTokens.overrides).toEqual({ '--bg-card': '#1a1b1c' });
      const badOv = await request(app).patch(`/api/admin/series/${A}`).send({ themeTokens: { ...TOK, overrides: { '--bg-card': 'url(//evil.example.org)' } } });
      expect(badOv.status).toBe(400);
      const badTok = await request(app).patch(`/api/admin/series/${A}`).send({ themeTokens: { ...TOK, bg: 'red' } });
      expect(badTok.status).toBe(400);
      // super-admin can also remove them (no carry-over on this route)
      expect((await request(app).patch(`/api/admin/series/${A}`).send({ themeTokens: TOK })).status).toBe(200);
      expect(m.state.series[A].themeTokens.overrides).toBeUndefined();
      as('brand@partner.com');
      expect((await patch({ themeTokens: withOv })).status).toBe(400);
    });
    it('null clears, and a brand admin save keeps super-admin overrides', async () => {
      as('brand@partner.com');
      m.state.series[A].themeTokens = { ...TOK, overrides: { '--bg-card': '#1a1b1c' } };
      expect((await patch({ themeTokens: { ...TOK, accent: '#d92b3a' } })).status).toBe(200);
      expect(m.state.series[A].themeTokens.overrides).toEqual({ '--bg-card': '#1a1b1c' });
      expect(m.state.series[A].themeTokens.accent).toBe('#d92b3a');
      delete m.state.series[A].themeTokens.overrides; // only a super-admin can remove them
      expect((await patch({ themeTokens: null })).status).toBe(200);
      expect(m.state.series[A].themeTokens).toBe(Prisma.DbNull); // the real client stores SQL NULL
    });
  });

  it('the allowlist contains none of the forbidden keys', () => {
    for (const [k] of superOnly) expect(BRAND_ADMIN_FIELDS as readonly string[]).not.toContain(k);
  });

  it.each([
    ['brandName', '<script>alert(1)</script>'], ['brandName', 'A'.repeat(41)], ['brandName', 'Bad "quote"'], ['displayName', ''],
    ['tagline', 'x'.repeat(81)], ['tagline', 'a<b'], ['tagline', 'line\nbreak'], ['metaDescription', 'y'.repeat(201)],
    ['description', 'z'.repeat(2001)], ['description', '<img src=x>'], ['supportEmail', 'not-an-email'], ['hideGuests', 'yes'],
    ['eventStartTime', '25:00'], ['eventDate', 'tomorrow'], ['nameTemplate', '{city}<b>'], ['emailReplyTo', 'a@b'],
  ])('rejects invalid %s', async (key, value) => {
    const res = await patch({ [key as string]: value });
    expect(res.status).toBe(400);
    expect(m.state.writes).not.toHaveBeenCalled();
  });

  it('a no-op patch writes nothing (no version bump, no audit)', async () => {
    const res = await patch({ brandName: 'Acme Pizza' });
    expect(res.status).toBe(200);
    expect(res.body.changed).toEqual([]);
    expect(m.state.writes).not.toHaveBeenCalled();
  });

  it('empty body is a 400; null clears an optional field', async () => {
    expect((await patch({})).status).toBe(400);
    expect((await patch({ description: null })).status).toBe(200);
    expect(m.state.series[A].description).toBeNull();
  });

  it('a super-admin may use the same route (actorKind super_admin)', async () => {
    as('boss@example.com');
    expect((await patch({ tagline: 'From boss' })).status).toBe(200);
    expect(lastAudit(m.state).actorKind).toBe('super_admin');
  });

  it('rate limits settings writes to 60 per hour and fails closed when the store is down', async () => {
    for (let i = 0; i < 60; i++) expect((await patch({ tagline: `t${i}` })).status).toBe(200);
    expect((await patch({ tagline: 'over' })).status).toBe(429);
    setInviteLimitStore({ reserve: async () => { throw new Error('down'); }, release: async () => {}, cleanup: async () => {} });
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await patch({ tagline: 'x' })).status).toBe(503);
    err.mockRestore();
  });
});

describe('audit history and revert', () => {
  it('history shows brand-field changes only; revert restores the snapshot through the validators', async () => {
    await request(app).patch(`/api/brand-admin/${A}/settings`).send({ tagline: 'One', description: 'New description' });
    // a super-admin changes the wallet in the same row: must not appear in the brand admin's history
    m.state.audit.push({
      id: 'au-super', seriesId: A, actorKind: 'super_admin', actorEmail: 'boss@example.com', action: 'settings.update',
      changes: { fundingWalletAddress: { old: null, new: '0xSECRETWALLET' } }, createdAt: new Date(),
    });
    const hist = await request(app).get(`/api/brand-admin/${A}/audit`);
    expect(hist.status).toBe(200);
    expect(JSON.stringify(hist.body)).not.toContain('SECRETWALLET');
    expect(hist.body.history).toHaveLength(1);
    expect(hist.body.history[0].snapshot).toBeUndefined();
    const auditId = hist.body.history[0].id;

    const rev = await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId });
    expect(rev.status).toBe(200);
    expect(m.state.series[A]).toMatchObject({ tagline: null, description: 'Old description' });
    expect(lastAudit(m.state)).toMatchObject({ action: 'revert', actorKind: 'series_admin' });
    expect(lastAudit(m.state).changes.revertedAuditId.new).toBe(auditId);
  });

  it('revert never writes non-allowlisted fields even if the snapshot holds them', async () => {
    m.state.audit.push({
      id: 'au-old', seriesId: A, actorKind: 'super_admin', actorEmail: 'boss@example.com', action: 'settings.update',
      changes: { tagline: { old: null, new: 'x' } },
      snapshot: { tagline: 'Snap', fundingWalletAddress: '0xEVIL', createFlow: 'hackathon', requireApproval: false, siteUrl: 'https://evil.example' },
      createdAt: new Date(),
    });
    const rev = await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId: 'au-old' }).catch((e) => e);
    // 'au-old' is not a uuid: a 404 up front
    expect(rev.status).toBe(404);
    m.state.audit[0].id = '44444444-4444-4444-8444-444444444444';
    const ok = await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId: '44444444-4444-4444-8444-444444444444' });
    expect(ok.status).toBe(200);
    expect(m.state.series[A]).toMatchObject({ tagline: 'Snap', fundingWalletAddress: '0xSECRETWALLET', createFlow: 'meetup', requireApproval: true, siteUrl: 'https://acme.example.org' });
  });

  it("an audit row of another series can't be used to revert (404)", async () => {
    m.state.audit.push({
      id: '55555555-5555-4555-8555-555555555555', seriesId: B, actorKind: 'super_admin', actorEmail: 'x', action: 'settings.update',
      changes: {}, snapshot: { tagline: 'B snapshot' }, createdAt: new Date(),
    });
    const before = m.state.audit.length;
    const res = await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId: '55555555-5555-4555-8555-555555555555' });
    expect(res.status).toBe(404);
    expect(m.state.series[A].tagline).toBeNull();
    expect(m.state.audit).toHaveLength(before);
  });
});

describe('checklist', () => {
  const base = `/api/brand-admin/${A}/checklist`;

  it('lists only this series (never the global template or another series)', async () => {
    const res = await request(app).get(base);
    expect(res.body.items.map((i: any) => i.id)).toEqual([CA1]);
  });

  it('creates in the caller series from the path, audited; seriesId / isAuto / autoRule in the body are rejected', async () => {
    const ok = await request(app).post(base).send({ name: 'Order pizza', dueDate: '2026-12-01', linkTab: 'pizza' });
    expect(ok.status).toBe(201);
    expect(m.state.checklist.find((i: any) => i.name === 'Order pizza').seriesId).toBe(A);
    expect(lastAudit(m.state)).toMatchObject({ action: 'checklist.create', actorKind: 'series_admin', seriesId: A });
    for (const extra of [{ seriesId: B }, { seriesId: null }, { isAuto: true }, { autoRule: 'hackathon_prizes_paid' }]) {
      const res = await request(app).post(base).send({ name: 'Nope', ...extra });
      expect(res.status).toBe(400);
    }
    expect(m.state.checklist.some((i: any) => i.name === 'Nope')).toBe(false);
  });

  it('validates name, date and link tab', async () => {
    expect((await request(app).post(base).send({})).status).toBe(400);
    expect((await request(app).post(base).send({ name: '<b>x</b>' })).status).toBe(400);
    expect((await request(app).post(base).send({ name: 'ok', dueDate: '12/01/2026' })).status).toBe(400);
    expect((await request(app).post(base).send({ name: 'ok', linkTab: 'https://evil.example' })).status).toBe(400);
  });

  it('edits and deletes this series items; another series item and a global default are untouchable (404)', async () => {
    expect((await request(app).patch(`${base}/${CA1}`).send({ name: 'Book the venue' })).status).toBe(200);
    expect(m.state.checklist.find((i: any) => i.id === CA1).name).toBe('Book the venue');
    m.state.writes.mockClear();
    const auditCount = m.state.audit.length;
    for (const id of [CB1, CG1, MISSING]) {
      expect((await request(app).patch(`${base}/${id}`).send({ name: 'hacked' })).status).toBe(404);
      expect((await request(app).delete(`${base}/${id}`)).status).toBe(404);
    }
    expect(m.state.checklist.map((i: any) => i.name)).toEqual(expect.arrayContaining(['B item', 'Global item']));
    expect(m.state.writes.mock.calls.filter((c: any[]) => c[0] === 'checklistDefault.deleteMany')).toHaveLength(0);
    expect(m.state.audit).toHaveLength(auditCount);
    expect((await request(app).delete(`${base}/${CA1}`)).status).toBe(200);
    expect(lastAudit(m.state)).toMatchObject({ action: 'checklist.delete', seriesId: A });
  });

  it('every checklist write is scoped by series id in the where clause', async () => {
    await request(app).patch(`${base}/${CA1}`).send({ sortOrder: 3 });
    await request(app).delete(`${base}/${CA1}`);
    const scopedWrites = m.state.writes.mock.calls.filter((c: any[]) => /checklistDefault\.(updateMany|deleteMany)/.test(c[0]));
    expect(scopedWrites.length).toBe(2);
    for (const c of scopedWrites) expect(c[1]).toMatchObject({ id: CA1, seriesId: A });
  });
});

describe('events and the PizzaDAO veto', () => {
  const ev = (partyId: string, status: string, id = A) => request(app).patch(`/api/brand-admin/${id}/events/${partyId}/status`).send({ status });

  it('lists only the series events', async () => {
    const res = await request(app).get(`/api/brand-admin/${A}/events?status=pending`);
    expect(res.body.events.map((e: any) => e.id)).toEqual([PA1]);
    expect((await request(app).get(`/api/brand-admin/${A}/events?status=bogus`)).status).toBe(400);
  });

  it("approves its own series' event: audited in series_audit and party_status_audit, host emailed", async () => {
    expect((await ev(PA1, 'approved')).status).toBe(200);
    expect(m.state.parties[0].underbossStatus).toBe('approved');
    expect(lastAudit(m.state)).toMatchObject({ action: 'event.status', actorKind: 'series_admin', seriesId: A });
    expect(m.statusAudit).toHaveBeenCalledWith(expect.anything(), PA1, 'pending', 'approved', 'brand@partner.com', 'admin', 'brand admin');
    expect(m.notifyHost).toHaveBeenCalledWith(PA1, 'approved');
  });

  it("another series' party (even through our own series id) is a 404 and untouched", async () => {
    const res = await ev(PB1, 'approved');
    expect(res.status).toBe(404);
    expect(m.state.parties[1].underbossStatus).toBe('pending');
    expect(m.state.writes.mock.calls.filter((c: any[]) => c[0] === 'party.update')).toHaveLength(0);
    expect(m.state.audit).toHaveLength(0);
  });

  it('only approved / rejected / hidden are settable', async () => {
    expect((await ev(PA1, 'pending')).status).toBe(400);
    expect((await ev(PA1, 'listed')).status).toBe(400);
  });

  it('a super-admin can overrule a brand-admin decision through the admin route', async () => {
    await ev(PA1, 'approved');
    m.notifyHost.mockClear();
    as('boss@example.com');
    const res = await request(app).patch(`/api/admin/series/${A}/events/${PA1}/status`).send({ status: 'rejected' });
    expect(res.status).toBe(200);
    expect(m.state.parties[0].underbossStatus).toBe('rejected');
    expect(lastAudit(m.state)).toMatchObject({ action: 'event.status', actorKind: 'super_admin' });
    expect(m.notifyHost).toHaveBeenCalledWith(PA1, 'rejected');
  });

  it("the super-admin route is still scoped: a party of another series is a 404", async () => {
    as('boss@example.com');
    const res = await request(app).patch(`/api/admin/series/${A}/events/${PB1}/status`).send({ status: 'approved' });
    expect(res.status).toBe(404);
  });
});

describe('own alerts toggle and /me', () => {
  it('a brand admin toggles only their own alerts, audited', async () => {
    m.state.admins.push({ id: 'mem-other', seriesId: A, email: 'other@partner.com', status: 'active', alertsEnabled: true, role: 'editor' });
    const res = await request(app).patch(`/api/brand-admin/${A}/alerts`).send({ alertsEnabled: false });
    expect(res.status).toBe(200);
    expect(m.state.admins.find((a: any) => a.id === 'mem-a').alertsEnabled).toBe(false);
    expect(m.state.admins.find((a: any) => a.id === 'mem-other').alertsEnabled).toBe(true);
    expect(lastAudit(m.state)).toMatchObject({ action: 'admin.alerts', actorKind: 'series_admin' });
    expect((await request(app).patch(`/api/brand-admin/${A}/alerts`).send({ alertsEnabled: 'no' })).status).toBe(400);
  });

  it('a super-admin without a membership has nothing to toggle (404)', async () => {
    as('boss@example.com');
    expect((await request(app).patch(`/api/brand-admin/${A}/alerts`).send({ alertsEnabled: false })).status).toBe(404);
  });

  it('/me lists the series the caller administers; a stranger gets an empty list', async () => {
    m.state.db.seriesAdmin.findMany = async () => [{ role: 'editor', alertsEnabled: true, series: { id: A, slug: 'acme', name: 'n', displayName: 'Acme', brandName: 'Acme Pizza', siteUrl: 'https://acme.example.org' } }];
    const me = await request(app).get('/api/brand-admin/me');
    expect(me.body.series).toEqual([expect.objectContaining({ id: A, actorKind: 'series_admin', role: 'editor' })]);
    m.state.db.seriesAdmin.findMany = async () => [];
    as('stranger@example.com');
    expect((await request(app).get('/api/brand-admin/me')).body.series).toEqual([]);
  });

  it('/me for a super-admin lists every active series', async () => {
    as('boss@example.com');
    const me = await request(app).get('/api/brand-admin/me');
    expect(me.body.series).toHaveLength(2);
    expect(me.body.series[0].actorKind).toBe('super_admin');
  });
});

describe('review hardening', () => {
  const settings = (body: unknown) => request(app).patch(`/api/brand-admin/${A}/settings`).send(body as object);
  const ev = (partyId: string, status: string) => request(app).patch(`/api/brand-admin/${A}/events/${partyId}/status`).send({ status });
  const base = `/api/brand-admin/${A}/checklist`;

  it.each(['PizzaDAO', 'Pizza-DAO Events', 'pizza dao', 'RSV.Pizza', 'R S V Pizza', 'The RSV Pizza Team'])( // brand-check-ignore-line (reserved-name test)
    'rejects reserved brand name %s (brandName, displayName and emailFromName)', async (n) => {
      expect((await settings({ brandName: n })).status).toBe(400);
      expect((await settings({ displayName: n })).status).toBe(400);
      expect((await settings({ emailFromName: n })).status).toBe(400);
      expect(m.state.writes).not.toHaveBeenCalled();
    });

  it('still accepts ordinary names', async () => {
    expect((await settings({ brandName: 'Slice Club', emailFromName: 'Slice Club Events' })).status).toBe(200);
  });

  it('invalidates the site-brand cache after a real change or revert, not after a no-op', async () => {
    await settings({ brandName: 'Acme Pizza' });
    expect(m.invalidate).not.toHaveBeenCalled();
    await settings({ brandName: 'Acme Slices' });
    expect(m.invalidate).toHaveBeenCalledTimes(1);
    const hist = await request(app).get(`/api/brand-admin/${A}/audit`);
    await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId: hist.body.history[0].id });
    expect(m.invalidate).toHaveBeenCalledTimes(2);
  });

  it('non-uuid child ids (item, party, audit) are 404s with no write', async () => {
    expect((await request(app).patch(`${base}/not-a-uuid`).send({ name: 'x' })).status).toBe(404);
    expect((await request(app).delete(`${base}/not-a-uuid`)).status).toBe(404);
    expect((await ev('not-a-uuid', 'approved')).status).toBe(404);
    expect((await request(app).post(`/api/brand-admin/${A}/revert`).send({ auditId: 'zz' })).status).toBe(404);
    expect(m.state.writes).not.toHaveBeenCalled();
  });

  it('automatic checklist defaults can be neither edited nor deleted by a brand admin (403)', async () => {
    m.state.checklist.find((i: any) => i.id === CA1).isAuto = true;
    expect((await request(app).patch(`${base}/${CA1}`).send({ name: 'Renamed' })).status).toBe(403);
    expect((await request(app).delete(`${base}/${CA1}`)).status).toBe(403);
    expect(m.state.checklist.find((i: any) => i.id === CA1).name).toBe('Book venue');
    expect(m.state.audit).toHaveLength(0);
  });

  it('due-date propagation reaches only this series seeded items (relation filter exercised)', async () => {
    expect((await request(app).patch(`${base}/${CA1}`).send({ dueDate: '2026-12-24' })).status).toBe(200);
    const [a, b] = m.state.items;
    expect(a.dueDate).toEqual(new Date('2026-12-24T00:00:00.000Z'));
    expect(b.dueDate).toBeNull();
  });

  it('an inactive series 404s its brand admin', async () => {
    m.state.fake.seriesState[A].isActive = false;
    expect((await request(app).get(`/api/brand-admin/${A}/settings`)).status).toBe(404);
  });

  describe('durable PizzaDAO veto', () => {
    it('a brand admin cannot change an event after a PizzaDAO actor set its status (409)', async () => {
      m.state.statusAudits.push({ partyId: PA1, newStatus: 'rejected', actorKind: 'admin', reason: null });
      const res = await ev(PA1, 'approved');
      expect(res.status).toBe(409);
      expect(JSON.stringify(res.body)).toContain("PizzaDAO has set this event's status");
      expect(m.state.parties.find((p: any) => p.id === PA1).underbossStatus).toBe('pending');
      expect(m.state.audit).toHaveLength(0);
    });

    it('same for an underboss, and after a super-admin overrules through the admin route', async () => {
      m.state.statusAudits.push({ partyId: PA1, newStatus: 'hidden', actorKind: 'underboss', reason: null });
      expect((await ev(PA1, 'approved')).status).toBe(409);
      m.state.statusAudits.length = 0;
      expect((await ev(PA1, 'approved')).status).toBe(200); // brand admin's own decision
      expect((await ev(PA1, 'rejected')).status).toBe(200); // and they may change their own
      as('boss@example.com');
      expect((await request(app).patch(`/api/admin/series/${A}/events/${PA1}/status`).send({ status: 'approved' })).status).toBe(200);
      as('brand@partner.com');
      expect((await ev(PA1, 'hidden')).status).toBe(409);
    });

    it('host or system rows do not block a brand admin', async () => {
      m.state.statusAudits.push({ partyId: PA1, newStatus: 'pending', actorKind: 'system', reason: null });
      m.state.statusAudits.push({ partyId: PA1, newStatus: 'pending', actorKind: 'owner', reason: null });
      expect((await ev(PA1, 'approved')).status).toBe(200);
    });
  });

  it('audit history names PizzaDAO staff by role, not email', async () => {
    m.state.audit.push({
      id: '00000000-0000-4000-8000-0000000000aa', seriesId: A, actorKind: 'super_admin', actorEmail: 'boss@example.com',
      action: 'settings.update', changes: { tagline: { old: null, new: 'x' } }, createdAt: new Date(),
    });
    const res = await request(app).get(`/api/brand-admin/${A}/audit`);
    expect(JSON.stringify(res.body)).not.toContain('boss@example.com');
    expect(res.body.history[0].actorEmail).toBe('PizzaDAO admin');
  });
});
