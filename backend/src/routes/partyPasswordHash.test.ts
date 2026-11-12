/**
 * party-password-hash: end-to-end over the real routers with an in-memory `parties` table.
 * Set -> stored as bcrypt -> verify OK; wrong fails; legacy plaintext still verifies; PATCH
 * without a password keeps it; PATCH null clears it; report/venue-report republish without a
 * password keeps it; no API response ever carries a password or hash.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';

const JWT_SECRET = 'test-secret';

const db = vi.hoisted(() => ({ parties: [] as Record<string, any>[], seq: 0 }));

const mockPrisma = vi.hoisted(() => {
  const UNIQUE_KEYS = ['id', 'inviteCode', 'customUrl', 'reportPublicSlug', 'venueReportSlug'];
  const matches = (row: Record<string, any>, where: Record<string, any> = {}) =>
    Object.entries(where).every(([k, v]) => (UNIQUE_KEYS.includes(k) || typeof v !== 'object' ? row[k] === v : true));
  const shape = (row: Record<string, any> | undefined, args: any = {}) => {
    if (!row) return null;
    if (args.select) {
      const out: Record<string, any> = {};
      for (const [k, v] of Object.entries(args.select)) {
        if (!v) continue;
        out[k] = k in row ? row[k] : [];
      }
      return out;
    }
    const out: Record<string, any> = { ...row };
    if (args.include) for (const k of Object.keys(args.include)) if (!(k in out)) out[k] = k === 'user' ? { name: 'Host' } : [];
    return out;
  };
  const party = {
    findUnique: vi.fn(async (args: any) => shape(db.parties.find((r) => matches(r, args.where)), args)),
    findFirst: vi.fn(async (args: any) => shape(db.parties.find((r) => matches(r, args.where)), args)),
    findMany: vi.fn(async (args: any) => db.parties.filter((r) => matches(r, args?.where)).map((r) => shape(r, args))),
    count: vi.fn(async () => db.parties.length),
    create: vi.fn(async (args: any) => {
      db.seq += 1;
      const row = {
        id: `party-${db.seq}`, inviteCode: `inv${db.seq}`, customUrl: null, password: null,
        reportPassword: null, venueReportPassword: null, reportPublished: false, reportPublicSlug: null,
        venueReportPublished: false, venueReportSlug: null, coHosts: [], eventTags: [], userId: 'host-1',
        ...args.data,
      };
      db.parties.push(row);
      return shape(row, args);
    }),
    update: vi.fn(async (args: any) => {
      const row = db.parties.find((r) => matches(r, args.where));
      if (!row) throw new Error('not found');
      Object.assign(row, args.data);
      return shape(row, args);
    }),
  };
  // Any other model: harmless empty answers.
  const other = () =>
    new Proxy({}, {
      get: (_t, m: string) => vi.fn(async () => (m === 'findMany' ? [] : m === 'count' ? 0 : null)),
    });
  const base: Record<string, any> = { party };
  const prisma: any = new Proxy(base, {
    get: (t, k: string) => {
      if (k in t) return t[k];
      if (k === '$transaction') return async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(prisma));
      if (k.startsWith('$')) return vi.fn(async () => []);
      t[k] = other();
      return t[k];
    },
  });
  return prisma;
});

vi.mock('../config/database.js', () => ({ prisma: mockPrisma }));

const webhookCalls = vi.hoisted(() => [] as any[]);
vi.mock('../services/webhook.service.js', async (importOriginal) => {
  const { redactPartySecrets } = await import('../lib/secretHash.js');
  return {
    // Mirror the real service's redaction so the test asserts on what would be sent.
    triggerWebhook: vi.fn(async (event: string, data: any) => {
      webhookCalls.push(event.startsWith('party.') ? redactPartySecrets(data) : data);
    }),
  };
});

vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: vi.fn(async () => true),
  canUserAccessTab: vi.fn(async () => true),
  isSuperAdmin: vi.fn(async () => false),
  VALID_TAB_IDS: [],
}));

vi.mock('../lib/autoPopulatePizzerias.js', () => ({ autoPopulatePizzerias: vi.fn(async () => {}) }));

const parseAuth = (req: any) => {
  const h = req.headers.authorization;
  if (h?.startsWith('Bearer ')) {
    try {
      const d = jwt.verify(h.split(' ')[1], JWT_SECRET) as any;
      req.userId = d.userId;
      req.userEmail = d.email;
    } catch { /* anonymous */ }
  }
};
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    parseAuth(req);
    if (!req.userId) return res.status(401).json({ error: 'Unauthorized' });
    next();
  },
  optionalAuth: (req: any, _res: any, next: any) => { parseAuth(req); next(); },
  // GET /api/parties/:id: super admin short-circuits the ownership check.
  isSuperAdmin: async (email?: string) => email === 'host@example.com',
  isAdmin: async () => false,
  isUnderboss: async () => false,
  isPaymentAdmin: async () => false,
  AuthRequest: {},
}));

import partyRoutes from './party.routes.js';
import rsvpRoutes from './rsvp.routes.js';
import reportRoutes from './report.routes.js';
import venueReportRoutes from './venue-report.routes.js';
import { errorHandler } from '../middleware/error.js';
import { isBcryptHash } from '../lib/secretHash.js';

const app = express();
app.use(express.json());
app.use('/api/parties', venueReportRoutes);
app.use('/api/parties', reportRoutes);
app.use('/api/parties', partyRoutes);
app.use('/api/rsvp', rsvpRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/reports', venueReportRoutes);
app.use(errorHandler);

const token = jwt.sign({ userId: 'host-1', email: 'host@example.com' }, JWT_SECRET);
const auth = { Authorization: `Bearer ${token}` };

const SECRETS = ['cowabunga', 'legacy-plain', 'report-pw', 'venue-pw', 'new-pw'];
const responses: { route: string; body: unknown }[] = [];

function assertNoSecrets(route: string, body: unknown) {
  const text = JSON.stringify(body ?? null);
  expect(text, route).not.toMatch(/"(password|reportPassword|venueReportPassword)"\s*:/);
  expect(text, route).not.toMatch(/\$2[aby]\$\d{2}\$/);
  for (const s of SECRETS) expect(text, `${route} leaks ${s}`).not.toContain(s);
}

async function call(method: 'get' | 'post' | 'patch' | 'delete', url: string, body?: unknown, headers: Record<string, string> = auth) {
  let r = request(app)[method](url).set(headers);
  if (body !== undefined) r = r.send(body as object);
  const res = await r;
  responses.push({ route: `${method.toUpperCase()} ${url}`, body: res.body });
  return res;
}

const row = (id: string) => db.parties.find((p) => p.id === id)!;

beforeEach(() => {
  db.parties.length = 0;
  db.seq = 0;
  responses.length = 0;
  webhookCalls.length = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('party-password-hash end to end', () => {
  it('event password: set, hash, verify, wrong fails, PATCH keeps / replaces / clears', async () => {
    const created = await call('post', '/api/parties', { name: 'Pie Night', password: 'cowabunga' });
    expect(created.status).toBe(201);
    const id = created.body.party.id;
    expect(created.body.party.hasPassword).toBe(true);
    expect(isBcryptHash(row(id).password)).toBe(true);

    const code = row(id).inviteCode;
    const ok = await call('post', `/api/rsvp/${code}/verify-password`, { password: 'cowabunga' }, {});
    expect(ok.body.valid).toBe(true);
    const bad = await call('post', `/api/rsvp/${code}/verify-password`, { password: 'nope' }, {});
    expect(bad.body.valid).toBe(false);

    // PATCH without password keeps it.
    const hashBefore = row(id).password;
    const p1 = await call('patch', `/api/parties/${id}`, { name: 'Pie Night 2' });
    expect(p1.status).toBe(200);
    expect(row(id).password).toBe(hashBefore);
    expect(p1.body.party.hasPassword).toBe(true);

    // GET as host: flag only.
    const g = await call('get', `/api/parties/${id}`);
    expect(g.status).toBe(200);
    expect(g.body.party.hasPassword).toBe(true);

    // Replace.
    await call('patch', `/api/parties/${id}`, { password: 'new-pw' });
    expect(isBcryptHash(row(id).password)).toBe(true);
    expect((await call('post', `/api/rsvp/${code}/verify-password`, { password: 'new-pw' }, {})).body.valid).toBe(true);
    expect((await call('post', `/api/rsvp/${code}/verify-password`, { password: 'cowabunga' }, {})).body.valid).toBe(false);

    // PATCH null clears.
    const cleared = await call('patch', `/api/parties/${id}`, { password: null });
    expect(row(id).password).toBeNull();
    expect(cleared.body.party.hasPassword).toBe(false);
    expect((await call('post', `/api/rsvp/${code}/verify-password`, { password: 'new-pw' }, {})).body.valid).toBe(false);

    // List.
    const list = await call('get', '/api/parties');
    expect(list.status).toBe(200);

    for (const r of responses) assertNoSecrets(r.route, r.body);
    for (const w of webhookCalls) assertNoSecrets('webhook', w);
    expect(webhookCalls.length).toBeGreaterThan(0);
  });

  it('legacy plaintext event password still verifies until the backfill', async () => {
    db.parties.push({ id: 'legacy', inviteCode: 'legacy1', customUrl: null, password: 'legacy-plain', coHosts: [], userId: 'host-1' });
    expect((await call('post', '/api/rsvp/legacy1/verify-password', { password: 'legacy-plain' }, {})).body.valid).toBe(true);
    expect((await call('post', '/api/rsvp/legacy1/verify-password', { password: 'legacy-plaiN' }, {})).body.valid).toBe(false);
    const g = await call('get', '/api/parties/legacy');
    expect(g.body.party.hasPassword).toBe(true);
    for (const r of responses) assertNoSecrets(r.route, r.body);
  });

  it('report password: republish without a password keeps it; verify; null clears', async () => {
    const id = (await call('post', '/api/parties', { name: 'Recap' })).body.party.id;

    const pub = await call('post', `/api/parties/${id}/report/publish`, { password: 'report-pw' });
    expect(pub.status).toBe(200);
    expect(pub.body.hasPassword).toBe(true);
    expect(isBcryptHash(row(id).reportPassword)).toBe(true);
    const slug = row(id).reportPublicSlug;

    // Republish without re-sending the password: it must stay (this used to wipe it).
    const hash = row(id).reportPassword;
    const re = await call('post', `/api/parties/${id}/report/publish`, {});
    expect(re.body.hasPassword).toBe(true);
    expect(row(id).reportPassword).toBe(hash);

    expect((await call('get', `/api/reports/public/${slug}/check`, undefined, {})).body.requiresPassword).toBe(true);
    expect((await call('get', `/api/reports/public/${slug}?password=wrong`, undefined, {})).status).toBe(401);
    expect((await call('get', `/api/reports/public/${slug}`, undefined, {})).status).toBe(401);
    const good = await call('get', `/api/reports/public/${slug}?password=report-pw`, undefined, {});
    expect(good.status).toBe(200);

    // Host report view: flag only.
    const hostView = await call('get', `/api/parties/${id}/report`);
    expect(hostView.status).toBe(200);
    expect(hostView.body.report.hasReportPassword).toBe(true);

    // PATCH report returns the party: redacted.
    const patched = await call('patch', `/api/parties/${id}/report`, { reportRecap: 'great' });
    expect(patched.status).toBe(200);
    expect(patched.body.party.hasReportPassword).toBe(true);

    // Legacy plaintext report password still works.
    row(id).reportPassword = 'legacy-plain';
    expect((await call('get', `/api/reports/public/${slug}?password=legacy-plain`, undefined, {})).status).toBe(200);

    // Explicit null clears.
    const clr = await call('post', `/api/parties/${id}/report/publish`, { password: null });
    expect(clr.body.hasPassword).toBe(false);
    expect(row(id).reportPassword).toBeNull();

    for (const r of responses) assertNoSecrets(r.route, r.body);
  });

  it('venue report password: republish keeps, verify, legacy, clear', async () => {
    const id = (await call('post', '/api/parties', { name: 'Venue' })).body.party.id;

    await call('post', `/api/parties/${id}/venue-report/publish`, { password: 'venue-pw' });
    expect(isBcryptHash(row(id).venueReportPassword)).toBe(true);
    const slug = row(id).venueReportSlug;
    const hash = row(id).venueReportPassword;

    const re = await call('post', `/api/parties/${id}/venue-report/publish`, {});
    expect(re.body.hasPassword).toBe(true);
    expect(row(id).venueReportPassword).toBe(hash);

    const host = await call('get', `/api/parties/${id}/venue-report`);
    expect(host.status).toBe(200);
    expect(host.body.venueReport.hasPassword).toBe(true);

    expect((await call('get', `/api/reports/public/${slug}/venue?password=wrong`, undefined, {})).status).toBe(401);
    expect((await call('get', `/api/reports/public/${slug}/venue?password=venue-pw`, undefined, {})).status).toBe(200);

    row(id).venueReportPassword = 'legacy-plain';
    expect((await call('get', `/api/reports/public/${slug}/venue?password=legacy-plain`, undefined, {})).status).toBe(200);

    const clr = await call('post', `/api/parties/${id}/venue-report/publish`, { password: '' });
    expect(clr.body.hasPassword).toBe(false);
    expect(row(id).venueReportPassword).toBeNull();

    for (const r of responses) assertNoSecrets(r.route, r.body);
  });
});
