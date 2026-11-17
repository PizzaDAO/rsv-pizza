import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { matches } from '../testutil/fakeSeriesAdminDb.js';
import { memoryRateStore } from '../lib/authRateLimit.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const m = vi.hoisted(() => ({
  actor: { email: 'brand@partner.example.org', userId: 'u1' },
  superAdmins: new Set<string>(['boss@example.org']),
  state: null as any,
  invalidate: vi.fn(),
}));

vi.mock('../config/database.js', () => ({ prisma: new Proxy({}, { get: (_t, k) => (m.state ? m.state.db[k as string] : undefined) }) }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, _res: any, next: any) => { req.userId = m.actor.userId; req.userEmail = m.actor.email; next(); },
  isSuperAdmin: async (e?: string) => !!e && m.superAdmins.has(e.toLowerCase()),
  AuthRequest: {},
}));
vi.mock('../lib/siteBrand.js', () => ({ invalidateSiteBrandCache: () => m.invalidate() }));
vi.mock('../config/secrets.js', () => ({ getJwtSecret: () => 'test-secret' }));

import router from './brand-admin.routes.js';
import { domainsCronRouter } from './brand-admin.domain.routes.js';
import { errorHandler } from '../middleware/error.js';
import { setInviteLimitStore } from '../lib/seriesInviteLimit.js';
import { setDomainAdaptersForTest, DomainApiError, type VercelAdapter, type ResendAdapter, type DnsAdapter, type ResendDomain } from '../lib/domainAdapters.js';
import { normalizePartnerHost } from '../lib/domainHost.js';
import { brandProjectFor } from '../lib/domainService.js';

const app = express();
app.use(express.json());
app.use('/api/brand-admin', router);
app.use('/api/cron', domainsCronRouter);
app.use(errorHandler);

function buildState() {
  const series: Record<string, any> = {
    [A]: { id: A, slug: 'acme', isActive: true, siteUrl: 'https://acme.rsv-old.example.org', siteAliases: [], configVersion: 1, pendingDomain: null, pendingDomainToken: null, pendingDomainStatus: null, pendingDomainCheckedAt: null, emailFromAddress: null, emailDomain: null, resendDomainId: null, emailDomainVerifiedAt: null },
    [B]: { id: B, slug: 'other', isActive: true, siteUrl: 'https://other.example.org', siteAliases: ['https://old-other.example.org'], configVersion: 1, pendingDomain: 'events.taken.example.org', pendingDomainToken: 'tok-other', pendingDomainStatus: 'requested', pendingDomainCheckedAt: null, emailFromAddress: 'hi@mail.other.example.org', emailDomain: 'mail.other.example.org', resendDomainId: 'rd-other', emailDomainVerifiedAt: new Date('2026-01-01') },
  };
  const admins = [{ id: 'mem', seriesId: A, email: 'brand@partner.example.org', status: 'active' }];
  const audit: any[] = [];
  const writes = vi.fn();
  const all = () => Object.values(series);
  const apply = (row: any, data: any) => {
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v === 'object' && 'increment' in (v as any)) row[k] = (row[k] ?? 0) + (v as any).increment;
      else row[k] = v;
    }
  };
  const db: any = {
    seriesAdmin: { findFirst: async ({ where }: any) => admins.find((r) => r.seriesId === where.seriesId && r.email === where.email && r.status === 'active') ?? null },
    eventSeries: {
      findUnique: async ({ where }: any) => (series[where.id] ? { id: where.id } : null),
      findFirst: async ({ where }: any) => (all().find((r) => matches(r, where)) ? { ...all().find((r) => matches(r, where)) } : null),
      findMany: async ({ where, select }: any) => all().filter((r) => matches(r, where)).map((r) => (select ? Object.fromEntries(Object.keys(select).map((k) => [k, r[k]])) : { ...r })),
      count: async ({ where }: any) => all().filter((r) => matches(r, where)).length,
      update: async ({ where, data }: any) => { writes(); apply(series[where.id], data); return { ...series[where.id] }; },
      updateMany: async ({ where, data }: any) => {
        const hit = all().filter((r) => matches(r, where));
        hit.forEach((r) => { writes(); apply(r, data); });
        return { count: hit.length };
      },
    },
    seriesAudit: {
      create: async ({ data }: any) => { audit.push({ ...data, createdAt: new Date(Date.now() + audit.length) }); return data; },
      findFirst: async ({ where }: any) => [...audit].reverse().find((r) => matches(r, where)) ?? null,
    },
    $transaction: async (fn: any) => fn(db),
  };
  return { db, series, audit, writes };
}

/** Controllable adapters. */
function adapters() {
  const resendDomains = new Map<string, ResendDomain>();
  const f = {
    txt: [] as string[],
    cname: [] as string[],
    vercelDomains: new Map<string, { verified: boolean; redirect: string | null }>(),
    misconfigured: false,
    vercelError: null as any,
    resendStatus: 'not_started' as string,
    calls: [] as string[],
  };
  const dns: DnsAdapter = {
    resolveTxt: async (n) => { f.calls.push(`txt ${n}`); return f.txt; },
    resolveCname: async () => f.cname,
  };
  const vercel: VercelAdapter = {
    addProjectDomain: async (p, h) => {
      f.calls.push(`vercel.add ${p} ${h}`);
      if (f.vercelError) throw f.vercelError;
      f.vercelDomains.set(h, { verified: true, redirect: null });
      return { name: h, verified: true, verification: [], redirect: null };
    },
    getProjectDomain: async (_p, h) => { const d = f.vercelDomains.get(h); return d ? { name: h, verified: d.verified, verification: [], redirect: d.redirect } : null; },
    verifyProjectDomain: async (_p, h) => ({ name: h, verified: true, verification: [], redirect: null }),
    getDomainConfig: async () => ({ misconfigured: f.misconfigured, cnameTarget: 'abc123.vercel-dns-016.com' }),
    setRedirect: async (p, h, t) => {
      f.calls.push(`vercel.redirect ${p} ${h} -> ${t}`);
      if (f.vercelError) throw f.vercelError;
      const d = f.vercelDomains.get(h) ?? { verified: true, redirect: null };
      d.redirect = t; f.vercelDomains.set(h, d);
    },
  };
  let n = 0;
  const resend: ResendAdapter = {
    createDomain: async (name) => {
      f.calls.push(`resend.create ${name}`);
      const d: ResendDomain = { id: `rd-${++n}`, name, status: 'not_started', records: [
        { record: 'DKIM', name: `resend._domainkey.${name}`, type: 'TXT', value: 'p=KEY', ttl: 'Auto', status: 'not_started' },
        { record: 'SPF', name: `send.${name}`, type: 'MX', value: 'feedback-smtp.us-east-1.amazonses.com', ttl: 'Auto', status: 'not_started', priority: 10 },
        { record: 'SPF', name: `send.${name}`, type: 'TXT', value: 'v=spf1 include:amazonses.com ~all', ttl: 'Auto', status: 'not_started' },
      ] };
      resendDomains.set(d.id, d);
      return d;
    },
    getDomain: async (id) => { const d = resendDomains.get(id) ?? { id, name: m.state.series[A].emailDomain ?? 'x', status: 'not_started', records: [] }; return { ...d, status: f.resendStatus }; },
    verifyDomain: async (id) => { f.calls.push(`resend.verify ${id}`); },
    removeDomain: async (id) => { f.calls.push(`resend.remove ${id}`); resendDomains.delete(id); },
  };
  return { f, dns, vercel, resend, resendDomains };
}

let ad: ReturnType<typeof adapters>;
const as = (email: string) => { m.actor = { email, userId: `u-${email}` }; };
const S = (id = A) => m.state.series[id];
const audits = (action?: string) => m.state.audit.filter((a: any) => !action || a.action === action);

beforeEach(() => {
  vi.clearAllMocks();
  m.state = buildState();
  as('brand@partner.example.org');
  setInviteLimitStore(memoryRateStore());
  ad = adapters();
  setDomainAdaptersForTest({ dns: ad.dns, vercel: ad.vercel, resend: ad.resend });
  process.env.BRAND_VERCEL_PROJECTS = JSON.stringify({ acme: 'prj_acme', other: 'prj_other' });
  delete process.env.PARTNER_EMAIL_DOMAIN_LIMIT;
});
afterEach(() => {
  setDomainAdaptersForTest({});
  delete process.env.BRAND_VERCEL_PROJECTS;
});

const base = (p: string, id = A) => `/api/brand-admin/${id}${p}`;
const request_ = (host = 'events.partner.example.org') => request(app).put(base('/domain')).send({ domain: host });

describe('host validation', () => {
  const bad = ['example.org', 'partner.example.org/path', 'https://events.partner.example.org', '*.partner.example.org', 'events.partner.example.org:8080', '192.168.1.1', '10.0.0.1', '0x7f.1', 'partner.com', 'partner.co.uk', 'events.rsv.pizza', 'rsv.pizza', 'x.vercel.app', 'foo.pizzadao.org', 'a b.example.org', 'localhost', '', 'user@events.example.org'];
  it.each(bad)('rejects %j', (h) => {
    expect(() => normalizePartnerHost(h)).toThrow();
  });
  it('punycode-normalizes and lowercases', () => {
    expect(normalizePartnerHost('Events.Partner.Example.ORG.')).toBe('events.partner.example.org');
    expect(normalizePartnerHost('événements.example.org')).toBe('xn--vnements-90ab.example.org');
  });
  it('honors RESERVED_DOMAINS', () => {
    process.env.RESERVED_DOMAINS = 'bigcorp.example.org';
    expect(() => normalizePartnerHost('x.bigcorp.example.org')).toThrow();
    delete process.env.RESERVED_DOMAINS;
  });
});

describe('BRAND_VERCEL_PROJECTS', () => {
  it('maps a slug, and ignores bad JSON / odd values', () => {
    expect(brandProjectFor('acme')).toBe('prj_acme');
    expect(brandProjectFor('nope')).toBeNull();
    process.env.BRAND_VERCEL_PROJECTS = '{bad';
    expect(brandProjectFor('acme')).toBeNull();
    process.env.BRAND_VERCEL_PROJECTS = JSON.stringify({ acme: '../x?y' });
    expect(brandProjectFor('acme')).toBeNull();
  });
});

describe('web domain: request', () => {
  it('issues a token, shows the TXT and CNAME records, audits', async () => {
    const res = await request_();
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('requested');
    const txt = res.body.records.find((r: any) => r.purpose === 'ownership');
    expect(txt.name).toBe('_rsvpizza.events.partner.example.org');
    expect(txt.value).toBe(`rsvpizza-verify=${S().pendingDomainToken}`);
    expect(res.body.records.find((r: any) => r.type === 'CNAME').name).toBe('events.partner.example.org');
    expect(audits('domain.request')).toHaveLength(1);
    expect(ad.f.calls.filter((c) => c.startsWith('vercel'))).toEqual([]); // nothing attached yet
  });
  it.each(['example.org', 'https://x.example.org', 'events.rsv.pizza', '1.2.3.4', '*.example.org'])('rejects %s with 400 and no write', async (h) => {
    const res = await request_(h);
    expect(res.status).toBe(400);
    expect(S().pendingDomain).toBeNull();
    expect(audits()).toHaveLength(0);
  });
  it("refuses a host used by another series' site_url, alias or pending request (no takeover)", async () => {
    for (const h of ['other.example.org', 'old-other.example.org', 'events.taken.example.org']) {
      const res = await request_(h);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('DOMAIN_TAKEN');
    }
    expect(S().pendingDomain).toBeNull();
  });
  it('is idempotent for the same host (keeps the token) and re-issues for a new host', async () => {
    await request_();
    const t1 = S().pendingDomainToken;
    await request_();
    expect(S().pendingDomainToken).toBe(t1);
    expect(audits('domain.request')).toHaveLength(1);
    await request_('www2.partner.example.org');
    expect(S().pendingDomainToken).not.toBe(t1);
  });
  it('is locked once attached', async () => {
    S().pendingDomain = 'events.partner.example.org'; S().pendingDomainToken = 't'; S().pendingDomainStatus = 'attached';
    expect((await request_('new.partner.example.org')).status).toBe(409);
  });
  it('can be cancelled before attach, not after', async () => {
    await request_();
    expect((await request(app).delete(base('/domain'))).status).toBe(200);
    expect(S().pendingDomain).toBeNull();
    expect(audits('domain.cancel')).toHaveLength(1);
    S().pendingDomain = 'e.partner.example.org'; S().pendingDomainStatus = 'attached';
    expect((await request(app).delete(base('/domain'))).status).toBe(409);
  });
});

describe('web domain: check', () => {
  it('requested -> dns_ok when the TXT matches, and back when it disappears', async () => {
    await request_();
    ad.f.txt = [`rsvpizza-verify=${S().pendingDomainToken}`];
    let res = await request(app).post(base('/domain/check'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('dns_ok');
    expect(res.body.checks.txtOk).toBe(true);
    expect(res.body.records.find((r: any) => r.type === 'CNAME').value).toBe('abc123.vercel-dns-016.com');
    ad.f.txt = [];
    res = await request(app).post(base('/domain/check'));
    expect(res.body.status).toBe('requested');
    expect(audits('domain.status')).toHaveLength(2);
  });
  it('a wrong TXT value does not count', async () => {
    await request_();
    ad.f.txt = ['rsvpizza-verify=wrong'];
    expect((await request(app).post(base('/domain/check'))).body.status).toBe('requested');
  });
  it('409 when nothing was requested', async () => {
    expect((await request(app).post(base('/domain/check'))).status).toBe(409);
  });
  it('attached -> ready once Vercel reports it configured', async () => {
    S().pendingDomain = 'events.partner.example.org'; S().pendingDomainToken = 'tk'; S().pendingDomainStatus = 'attached';
    ad.f.txt = ['rsvpizza-verify=tk'];
    ad.f.vercelDomains.set('events.partner.example.org', { verified: true, redirect: null });
    ad.f.misconfigured = true;
    expect((await request(app).post(base('/domain/check'))).body.status).toBe('attached');
    ad.f.misconfigured = false;
    const res = await request(app).post(base('/domain/check'));
    expect(res.body.status).toBe('ready');
    expect(res.body.checks.vercel).toMatchObject({ attached: true, configured: true });
  });
  it('is rate limited per user', async () => {
    await request_();
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await request(app).post(base('/domain/check'))).status;
    expect(last).toBe(429);
  });
});

describe('web domain: attach / cutover / rollback are super-admin only', () => {
  const pending = (status: string) => { Object.assign(S(), { pendingDomain: 'events.partner.example.org', pendingDomainToken: 'tk', pendingDomainStatus: status }); };

  it('a brand admin gets 403 on attach, cutover and rollback, with no write and no outside call', async () => {
    pending('dns_ok');
    ad.f.txt = ['rsvpizza-verify=tk'];
    for (const p of ['/domain/attach', '/domain/cutover', '/domain/rollback']) {
      const res = await request(app).post(base(p)).send({});
      expect(res.status).toBe(403);
    }
    expect(m.state.writes).not.toHaveBeenCalled();
    expect(ad.f.calls).toEqual([]);
  });

  it('attach needs a fresh TXT match: no TXT, no Vercel call', async () => {
    pending('dns_ok');
    as('boss@example.org');
    ad.f.txt = [];
    const res = await request(app).post(base('/domain/attach'));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('TXT_MISSING');
    expect(ad.f.calls.some((c) => c.startsWith('vercel.add'))).toBe(false);
    expect(S().pendingDomainStatus).toBe('requested');
  });

  it('attach is refused from `requested` too, and when the brand has no Vercel project', async () => {
    as('boss@example.org');
    pending('requested');
    ad.f.txt = [];
    expect((await request(app).post(base('/domain/attach'))).status).toBe(409);
    pending('dns_ok');
    ad.f.txt = ['rsvpizza-verify=tk'];
    delete process.env.BRAND_VERCEL_PROJECTS;
    const res = await request(app).post(base('/domain/attach'));
    expect(res.body.error.code).toBe('NO_PROJECT');
  });

  it('attach maps the series to its project, audits, and surfaces a Vercel refusal', async () => {
    pending('dns_ok');
    as('boss@example.org');
    ad.f.txt = ['rsvpizza-verify=tk'];
    ad.f.vercelError = new DomainApiError('vercel', 409, 'Domain is already in use');
    let res = await request(app).post(base('/domain/attach'));
    expect(res.status).toBe(409);
    expect(S().pendingDomainStatus).toBe('dns_ok');
    ad.f.vercelError = null;
    res = await request(app).post(base('/domain/attach'));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('attached');
    expect(ad.f.calls).toContain('vercel.add prj_acme events.partner.example.org');
    expect(audits('domain.attach')).toHaveLength(1);
    expect(audits('domain.attach')[0].actorKind).toBe('super_admin');
  });

  it('cutover: site_url moves, old origin becomes an alias, 308 redirect set, steps returned, audited', async () => {
    pending('ready');
    as('boss@example.org');
    ad.f.txt = ['rsvpizza-verify=tk'];
    ad.f.vercelDomains.set('events.partner.example.org', { verified: true, redirect: null });
    S().pendingDomainStatus = 'attached'; // the live check promotes it to ready
    const res = await request(app).post(base('/domain/cutover')).send({});
    expect(res.status).toBe(200);
    expect(S().siteUrl).toBe('https://events.partner.example.org');
    expect(S().siteAliases).toEqual(['https://acme.rsv-old.example.org']);
    expect(S().pendingDomainStatus).toBe('live');
    expect(S().configVersion).toBe(2);
    expect(ad.f.calls).toContain('vercel.redirect prj_acme acme.rsv-old.example.org -> events.partner.example.org');
    expect(res.body.steps.join(' ')).toMatch(/VITE_BRAND_DOMAIN/);
    expect(res.body.steps.join(' ')).not.toMatch(/redirect \(308\)/); // done automatically
    expect(audits('domain.cutover')).toHaveLength(1);
    expect(audits('domain.redirect')).toHaveLength(1);
    expect(m.invalidate).toHaveBeenCalled();
  });

  it('cutover lists the redirect as a manual step when Vercel refuses, and still cuts over', async () => {
    pending('attached');
    as('boss@example.org');
    ad.f.txt = ['rsvpizza-verify=tk'];
    ad.f.vercelDomains.set('events.partner.example.org', { verified: true, redirect: null });
    const orig = ad.vercel.setRedirect;
    ad.vercel.setRedirect = async () => { throw new DomainApiError('vercel', 404, 'nf'); };
    const res = await request(app).post(base('/domain/cutover')).send({});
    ad.vercel.setRedirect = orig;
    expect(res.status).toBe(200);
    expect(S().pendingDomainStatus).toBe('live');
    expect(res.body.steps.join(' ')).toMatch(/redirect \(308\)/);
  });

  it('cutover is refused while the checks fail (TXT gone / misconfigured)', async () => {
    pending('attached');
    as('boss@example.org');
    ad.f.vercelDomains.set('events.partner.example.org', { verified: true, redirect: null });
    ad.f.txt = [];
    expect((await request(app).post(base('/domain/cutover')).send({})).status).toBe(409);
    ad.f.txt = ['rsvpizza-verify=tk'];
    ad.f.misconfigured = true;
    expect((await request(app).post(base('/domain/cutover')).send({})).status).toBe(409);
    expect(S().siteUrl).toBe('https://acme.rsv-old.example.org');
  });

  it('cutover is idempotent, and rollback restores the old site_url, clears the redirect, is idempotent and never detaches', async () => {
    pending('attached');
    as('boss@example.org');
    ad.f.txt = ['rsvpizza-verify=tk'];
    ad.f.vercelDomains.set('events.partner.example.org', { verified: true, redirect: null });
    await request(app).post(base('/domain/cutover')).send({});
    expect((await request(app).post(base('/domain/cutover')).send({})).body.changed).toBe(false);
    expect(audits('domain.cutover')).toHaveLength(1);

    const res = await request(app).post(base('/domain/rollback'));
    expect(res.status).toBe(200);
    expect(S().siteUrl).toBe('https://acme.rsv-old.example.org');
    expect(S().siteAliases).toEqual(['https://events.partner.example.org']);
    expect(S().pendingDomainStatus).toBe('ready');
    expect(ad.f.vercelDomains.get('acme.rsv-old.example.org')?.redirect).toBeNull();
    expect(ad.f.calls.some((c) => /remove|detach|delete/i.test(c))).toBe(false);
    expect(audits('domain.rollback')).toHaveLength(1);

    const again = await request(app).post(base('/domain/rollback'));
    expect(again.body.changed).toBe(false);
    expect(audits('domain.rollback')).toHaveLength(1);
  });

  it('503 NOT_CONFIGURED when the Vercel secrets are missing; nothing is written', async () => {
    pending('dns_ok');
    as('boss@example.org');
    setDomainAdaptersForTest({ dns: ad.dns, vercel: null, resend: ad.resend });
    ad.f.txt = ['rsvpizza-verify=tk'];
    const res = await request(app).post(base('/domain/attach'));
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_CONFIGURED');
    expect(S().pendingDomainStatus).toBe('dns_ok');
    // the read still works and says what is missing
    const st = await request(app).get(base('/domain'));
    expect(st.status).toBe(200);
    expect(st.body.configured).toEqual({ vercel: false, resend: true });
  });

  it('never returns or logs secrets', async () => {
    process.env.VERCEL_DOMAINS_TOKEN = 'SECRET-VERCEL'; process.env.RESEND_ADMIN_KEY = 'SECRET-RESEND';
    await request_();
    const json = JSON.stringify((await request(app).get(base('/domain'))).body) + JSON.stringify((await request(app).get(base('/email-domain'))).body);
    expect(json).not.toMatch(/SECRET-/);
    delete process.env.VERCEL_DOMAINS_TOKEN; delete process.env.RESEND_ADMIN_KEY;
  });
});

describe('email domain', () => {
  const put = (b: object, id = A) => request(app).put(base('/email-domain', id)).send(b);
  const good = { emailDomain: 'mail.partner.example.org', emailFromAddress: 'events@mail.partner.example.org' };

  it('creates the Resend domain, stores its id, resets verification, shows the records', async () => {
    S().emailDomainVerifiedAt = new Date();
    const res = await put(good);
    expect(res.status).toBe(200);
    expect(S()).toMatchObject({ emailDomain: 'mail.partner.example.org', emailFromAddress: 'events@mail.partner.example.org', resendDomainId: 'rd-1', emailDomainVerifiedAt: null });
    expect(res.body.records).toHaveLength(3);
    expect(res.body.records.map((r: any) => r.type).sort()).toEqual(['MX', 'TXT', 'TXT']);
    expect(res.body.verified).toBe(false);
    expect(audits('email.domain_set')).toHaveLength(1);
    expect(m.invalidate).toHaveBeenCalled();
  });

  it.each([
    [{ emailDomain: 'example.org', emailFromAddress: 'a@example.org' }, 'apex'],
    [{ emailDomain: 'mail.rsv.pizza', emailFromAddress: 'a@mail.rsv.pizza' }, 'reserved'],
    [{ emailDomain: 'mail.partner.example.org', emailFromAddress: 'a@other.example.org' }, 'address off domain'],
    [{ emailDomain: 'mail.partner.example.org', emailFromAddress: 'Name <a@mail.partner.example.org>' }, 'display name'],
    [{ emailDomain: '*.partner.example.org', emailFromAddress: 'a@x.partner.example.org' }, 'wildcard'],
    [{ emailDomain: 'mail.partner.example.org' }, 'no address'],
  ] as Array<[Record<string, string>, string]>)('rejects %j (%s)', async (b) => {
    const res = await put(b);
    expect(res.status).toBe(400);
    expect(ad.f.calls.filter((c) => c.startsWith('resend'))).toEqual([]);
    expect(S().emailDomain).toBeNull();
  });

  it("refuses another series' sending domain (or a parent/child of it)", async () => {
    for (const d of ['mail.other.example.org', 'a.mail.other.example.org']) {
      expect((await put({ emailDomain: d, emailFromAddress: `x@${d}` })).status).toBe(409);
    }
  });

  it('fails clearly at the configured partner limit', async () => {
    process.env.PARTNER_EMAIL_DOMAIN_LIMIT = '1'; // series B already holds one
    const res = await put(good);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_DOMAIN_LIMIT');
    expect(ad.f.calls.filter((c) => c.startsWith('resend.create'))).toEqual([]);
  });

  it('changing the domain creates a new Resend domain, removes the old one, and resets verification', async () => {
    await put(good);
    S().emailDomainVerifiedAt = new Date();
    const res = await put({ emailDomain: 'send.partner.example.org', emailFromAddress: 'e@send.partner.example.org' });
    expect(res.status).toBe(200);
    expect(S().resendDomainId).toBe('rd-2');
    expect(S().emailDomainVerifiedAt).toBeNull();
    expect(ad.f.calls).toContain('resend.remove rd-1');
  });

  it('changing only the address on the same domain resets verification without a new Resend domain', async () => {
    await put(good);
    S().emailDomainVerifiedAt = new Date();
    await put({ ...good, emailFromAddress: 'other@mail.partner.example.org' });
    expect(S().resendDomainId).toBe('rd-1');
    expect(S().emailDomainVerifiedAt).toBeNull();
    expect(ad.f.calls.filter((c) => c.startsWith('resend.create'))).toHaveLength(1);
  });

  it('a Resend failure writes nothing', async () => {
    ad.resend.createDomain = async () => { throw new DomainApiError('resend', 403, 'nope'); };
    expect((await put(good)).status).toBe(409);
    expect(S().emailDomain).toBeNull();
    expect(audits()).toHaveLength(0);
  });

  it('503 NOT_CONFIGURED without the Resend admin key', async () => {
    setDomainAdaptersForTest({ dns: ad.dns, vercel: ad.vercel, resend: null });
    const res = await put(good);
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('NOT_CONFIGURED');
    expect(S().emailDomain).toBeNull();
    expect((await request(app).get(base('/email-domain'))).status).toBe(200);
  });

  it('check: verified sets email_domain_verified_at only when the address matches; failed clears it', async () => {
    await put(good);
    ad.f.resendStatus = 'pending';
    let res = await request(app).post(base('/email-domain/check'));
    expect(res.body.verified).toBe(false);
    expect(ad.f.calls).toContain('resend.verify rd-1');

    ad.f.resendStatus = 'verified';
    res = await request(app).post(base('/email-domain/check'));
    expect(res.body.verified).toBe(true);
    expect(S().emailDomainVerifiedAt).toBeInstanceOf(Date);
    expect(audits('email.verified')).toHaveLength(1);

    ad.f.resendStatus = 'temporary_failure';
    await request(app).post(base('/email-domain/check'));
    expect(S().emailDomainVerifiedAt).toBeInstanceOf(Date);

    ad.f.resendStatus = 'failed';
    res = await request(app).post(base('/email-domain/check'));
    expect(res.body.verified).toBe(false);
    expect(S().emailDomainVerifiedAt).toBeNull();
    expect(audits('email.verification_revoked')).toHaveLength(1);
  });

  it('check never verifies when the stored address is not on the domain', async () => {
    await put(good);
    S().emailFromAddress = 'x@elsewhere.example.org'; // simulate drift
    ad.f.resendStatus = 'verified';
    await request(app).post(base('/email-domain/check'));
    expect(S().emailDomainVerifiedAt).toBeNull();
  });

  it('check without a set-up domain is 409; checks are rate limited', async () => {
    expect((await request(app).post(base('/email-domain/check'))).status).toBe(409);
    await put(good);
    let last = 0;
    for (let i = 0; i < 31; i++) last = (await request(app).post(base('/email-domain/check'))).status;
    expect(last).toBe(429);
  });

  it('remove clears the sender and deletes the Resend domain', async () => {
    await put(good);
    expect((await request(app).delete(base('/email-domain'))).status).toBe(200);
    expect(S()).toMatchObject({ emailDomain: null, emailFromAddress: null, resendDomainId: null });
    expect(ad.f.calls).toContain('resend.remove rd-1');
  });
});

describe('cron', () => {
  const cron = (path: string, token = 's3cret') => request(app).get(`/api/cron/${path}`).set('Authorization', `Bearer ${token}`);
  beforeEach(() => { process.env.CRON_SECRET = 's3cret'; });
  afterEach(() => { delete process.env.CRON_SECRET; });

  it('requires CRON_SECRET', async () => {
    expect((await cron('recheck-domains', 'wrong')).status).toBe(401);
    expect((await cron('recheck-email-domains', 'wrong')).status).toBe(401);
    delete process.env.CRON_SECRET;
    expect((await request(app).get('/api/cron/recheck-domains')).status).toBe(401);
  });

  it('advances pending domains but never attaches', async () => {
    Object.assign(S(), { pendingDomain: 'events.partner.example.org', pendingDomainToken: 'tk', pendingDomainStatus: 'requested' });
    ad.f.txt = ['rsvpizza-verify=tk'];
    const res = await cron('recheck-domains');
    expect(res.status).toBe(200);
    expect(S().pendingDomainStatus).toBe('dns_ok');
    expect(ad.f.calls.some((c) => c.startsWith('vercel.add'))).toBe(false);
    expect(audits('domain.status')[0].actorKind).toBe('system');
  });

  it('clears email verification when Resend says the records are gone', async () => {
    Object.assign(S(), { emailDomain: 'mail.partner.example.org', emailFromAddress: 'e@mail.partner.example.org', resendDomainId: 'rd-9', emailDomainVerifiedAt: new Date() });
    ad.resend.getDomain = async (id) => ({ id, name: 'mail.partner.example.org', status: 'failed', records: [] });
    S(B).emailDomainVerifiedAt = null;
    const res = await cron('recheck-email-domains');
    expect(res.body).toEqual({ checked: 1, revoked: 1 });
    expect(S().emailDomainVerifiedAt).toBeNull();
    expect(audits('email.verification_revoked')[0].actorKind).toBe('system');
  });

  it('is a no-op without the Resend admin key', async () => {
    setDomainAdaptersForTest({ dns: ad.dns, vercel: ad.vercel, resend: null });
    S().emailDomainVerifiedAt = new Date(); S().resendDomainId = 'rd-9'; S().emailDomain = 'mail.partner.example.org';
    expect((await cron('recheck-email-domains')).body).toEqual({ checked: 0, revoked: 0 });
    expect(S().emailDomainVerifiedAt).toBeInstanceOf(Date);
  });
});

describe('tenant isolation', () => {
  const routes: Array<[string, string, object?]> = [
    ['get', '/domain'], ['put', '/domain', { domain: 'x.partner.example.org' }], ['delete', '/domain'], ['post', '/domain/check'],
    ['post', '/domain/attach'], ['post', '/domain/cutover'], ['post', '/domain/rollback'],
    ['get', '/email-domain'], ['put', '/email-domain', { emailDomain: 'mail.p.example.org', emailFromAddress: 'a@mail.p.example.org' }],
    ['delete', '/email-domain'], ['post', '/email-domain/check'],
  ];
  it.each(routes)('admin of A: %s %s on series B is a 404 with no write or outside call', async (method, path, b) => {
    const res = await (request(app) as any)[method](base(path, B)).send(b ?? {});
    expect(res.status).toBe(404);
    expect(m.state.writes).not.toHaveBeenCalled();
    expect(ad.f.calls).toEqual([]);
  });
});
