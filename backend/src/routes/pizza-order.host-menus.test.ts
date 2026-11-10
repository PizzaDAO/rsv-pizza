/**
 * basil-14648 P2: the host-menu proxy (POST/DELETE /:partyId/pizza/shops/:shopId/menu/host) and the config switch.
 * rsv checks bytes and sizes before forwarding, forwards with the host's own token, stores nothing, and maps
 * pizza-mcp's problems through unchanged codes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeFakeDb, makeFakePizzaMcp, generateSigningKeyPem, PARTY_ID, FakeDb } from '../testutil/pizzaFakes.js';

const m = vi.hoisted(() => ({ fake: null as any, party: null as any }));
vi.mock('../config/database.js', () => ({
  prisma: new Proxy(
    {},
    {
      get: (_t, k) =>
        k === 'party'
          ? { findUnique: async ({ where }: any) => (m.party && m.party.id === where.id ? m.party : null) }
          : m.fake.db[k],
    }
  ),
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-email']) return res.status(401).json({ error: 'unauth' });
    req.userId = req.headers['x-user-id'];
    req.userEmail = req.headers['x-user-email'];
    next();
  },
}));
vi.mock('../services/pizzaOrderNotify.js', () => ({ notifyHostOfOrder: vi.fn() }));

import router from './pizza-order.routes.js';
import { errorHandler } from '../middleware/error.js';
import { PizzaMcpClient, setPizzaMcpClientForTests } from '../services/pizzaMcp.client.js';
import { resetHostMenusCacheForTests } from '../lib/hostMenus.js';
import { sniffMenuMime, checkMenuUpload, checkMenuUrl } from '../lib/uploadSniff.js';

const host = { 'x-user-id': 'host1', 'x-user-email': 'host@x.com' };
const stranger = { 'x-user-id': 'bad1', 'x-user-email': 'bad@x.com' };
const cohostEditor = { 'x-user-id': 'co1', 'x-user-email': 'co@x.com' };
const cohostViewer = { 'x-user-id': 'co2', 'x-user-email': 'view@x.com' };
const base = `/api/parties/${PARTY_ID}/pizza`;
const menuPath = `${base}/shops/pzl_osm_n1/menu/host`;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', router);
  a.use(errorHandler);
  return a;
};

const pad = (head: number[], size = 64) => Buffer.concat([Buffer.from(head), Buffer.alloc(Math.max(0, size - head.length), 7)]);
const JPEG = pad([0xff, 0xd8, 0xff, 0xe0]);
const PNG = pad([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const WEBP = pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
const PDF = pad([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const TEXT = Buffer.from('<html><script>alert(1)</script></html>');

const result = {
  menu: { pizzeria_id: 'pzl_osm_n1', menu_id: 'lm_1', version: 'v1', currency: 'USD', as_of: '2026-11-09T12:00:00Z', provenance: 'host_provided', verified: false, notice: 'n', categories: [] },
  menu_id: 'lm_1',
  summary: { pizza_items: 14, priced_items: 12, price_range_cents: [1200, 2600], confidence: 0.8 },
};

type Out = { status?: number; json: unknown };
let fake: FakeDb;
let mcp: ReturnType<typeof makeFakePizzaMcp>;
let hostRoute: () => Out;
let deleteRoute: () => Out;
const saved: Record<string, string | undefined> = {};
const ENV = ['PIZZA_MCP_SIGNING_KEY', 'PIZZA_MCP_URL', 'PIZZA_ORDERING_PARTY_IDS', 'PIZZA_HOST_MENUS'];
const problem = (status: number, code: string, detail = code) => ({ status, json: { code, title: code, status, detail, retryable: false } });

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.PIZZA_MCP_SIGNING_KEY = generateSigningKeyPem();
  process.env.PIZZA_MCP_URL = 'https://api.openpizza.xyz';
  process.env.PIZZA_ORDERING_PARTY_IDS = PARTY_ID;
  process.env.PIZZA_HOST_MENUS = '1';
  resetHostMenusCacheForTests();
  fake = makeFakeDb();
  fake.users.set('host1', { id: 'host1', email: 'host@x.com' });
  m.fake = fake;
  m.party = {
    id: PARTY_ID, name: 'Pizza Party', userId: 'host1',
    coHosts: [{ email: 'co@x.com', canEdit: true }, { email: 'view@x.com', canEdit: false }],
    address: '1 Main St', latitude: 42.36, longitude: -71.06, customUrl: null, inviteCode: 'abc',
    reimbursementCapUsd: 250, eventTags: [],
  };
  hostRoute = () => ({ status: 201, json: result });
  deleteRoute = () => ({ json: { expired: 1 } });
  mcp = makeFakePizzaMcp({
    // a made-up shop id (the probe) is NOT_FOUND while pizza-mcp takes host menus
    'POST /pizzerias/:id/menu/host': (c) => (c.path.includes('pzl_probe_none') ? problem(404, 'NOT_FOUND') : hostRoute()),
    'DELETE /pizzerias/:id/menu/host': () => deleteRoute(),
  });
  setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
});
afterEach(() => {
  setPizzaMcpClientForTests(null);
  resetHostMenusCacheForTests();
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

const uploads = () => mcp.calls.filter((c) => c.method === 'POST' && !c.path.includes('pzl_probe_none'));
const storedNothing = () => {
  expect(fake.carts.size).toBe(0);
  expect(fake.orders.size).toBe(0);
  expect(fake.handoffs.size).toBe(0);
};

describe('uploadSniff', () => {
  it('types come from the first bytes only', () => {
    expect(sniffMenuMime(JPEG)).toBe('image/jpeg');
    expect(sniffMenuMime(PNG)).toBe('image/png');
    expect(sniffMenuMime(WEBP)).toBe('image/webp');
    expect(sniffMenuMime(PDF)).toBe('application/pdf');
    expect(sniffMenuMime(TEXT)).toBeNull();
    expect(sniffMenuMime(Buffer.from([0xff, 0xd8]))).toBeNull();
    // RIFF but not WEBP (a WAV file)
    expect(sniffMenuMime(pad([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x41, 0x56, 0x45]))).toBeNull();
  });

  it('limits: 3 photos, 1 PDF alone, 4 MB in total, no empty file', () => {
    expect(checkMenuUpload([JPEG, PNG, WEBP]).ok).toBe(true);
    expect(checkMenuUpload([PDF]).ok).toBe(true);
    expect(checkMenuUpload([])).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(checkMenuUpload([JPEG, JPEG, JPEG, JPEG])).toMatchObject({ ok: false, code: 'MENU_TOO_LARGE', status: 413 });
    expect(checkMenuUpload([PDF, JPEG])).toMatchObject({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE', status: 415 });
    expect(checkMenuUpload([PDF, PDF])).toMatchObject({ ok: false, code: 'UNSUPPORTED_MEDIA_TYPE' });
    expect(checkMenuUpload([Buffer.alloc(0)])).toMatchObject({ ok: false, code: 'VALIDATION_FAILED' });
    expect(checkMenuUpload([pad([0xff, 0xd8, 0xff], 4 * 1024 * 1024)]).ok).toBe(true);
    expect(checkMenuUpload([pad([0xff, 0xd8, 0xff], 4 * 1024 * 1024 + 1)])).toMatchObject({ ok: false, code: 'MENU_TOO_LARGE' });
    expect(checkMenuUpload([pad([0xff, 0xd8, 0xff], 2 * 1024 * 1024), pad([0xff, 0xd8, 0xff], 2 * 1024 * 1024 + 1)])).toMatchObject({ ok: false, code: 'MENU_TOO_LARGE' });
  });

  it('links: http(s) only, no credentials, at most 500 characters', () => {
    expect(checkMenuUrl(' https://sals.example/menu ')).toEqual({ ok: true, url: 'https://sals.example/menu' });
    expect(checkMenuUrl('http://sals.example/menu.pdf').ok).toBe(true);
    for (const bad of ['', 'javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.example/m', 'not a link', 'https://u:p@sals.example/', `https://x.example/${'a'.repeat(500)}`, 42]) {
      expect(checkMenuUrl(bad).ok, String(bad)).toBe(false);
    }
  });
});

describe('config: hostMenus only with rsv\'s switch AND pizza-mcp taking host menus', () => {
  it('rsv switch off: false, and pizza-mcp is never asked', async () => {
    delete process.env.PIZZA_HOST_MENUS;
    const r = await request(app()).get(`${base}/config`).set(host);
    expect(r.body).toMatchObject({ enabled: true, hostMenus: false });
    expect(mcp.calls).toHaveLength(0);
  });

  it('on at pizza-mcp: true, from one probe that reads, counts and stores nothing; the answer is cached', async () => {
    expect((await request(app()).get(`${base}/config`).set(host)).body.hostMenus).toBe(true);
    expect((await request(app()).get(`${base}/config`).set(host)).body.hostMenus).toBe(true);
    expect(mcp.calls).toHaveLength(1);
    expect(mcp.calls[0]).toMatchObject({ method: 'POST', path: '/pizzerias/pzl_probe_none/menu/host', body: {} });
  });

  it('off at pizza-mcp (FEATURE_DISABLED): false', async () => {
    mcp = makeFakePizzaMcp({ 'POST /pizzerias/:id/menu/host': () => problem(404, 'FEATURE_DISABLED') });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    expect((await request(app()).get(`${base}/config`).set(host)).body.hostMenus).toBe(false);
  });

  it('pizza-mcp down: false (never a guess), and the config still answers', async () => {
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: (async () => { throw new TypeError('down'); }) as typeof fetch }));
    const r = await request(app()).get(`${base}/config`).set(host);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ enabled: true, hostMenus: false });
  });

  it('a party outside the pilot: hostMenus false, nothing asked', async () => {
    process.env.PIZZA_ORDERING_PARTY_IDS = '';
    const r = await request(app()).get(`${base}/config`).set(host);
    expect(r.body).toMatchObject({ enabled: false, hostMenus: false });
    expect(mcp.calls).toHaveLength(0);
  });
});

describe('POST /shops/:shopId/menu/host', () => {
  it('rsv switch off: 404 FEATURE_DISABLED before the body is read, nothing forwarded', async () => {
    delete process.env.PIZZA_HOST_MENUS;
    const r = await request(app()).post(menuPath).set(host).attach('files[]', JPEG, { filename: 'm.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('FEATURE_DISABLED');
    expect(mcp.calls).toHaveLength(0);
  });

  it('not the host (404), a view-only co-host (404), no login (401): nothing forwarded', async () => {
    expect((await request(app()).post(menuPath).send({ url: 'https://sals.example/menu' })).status).toBe(401);
    expect((await request(app()).post(menuPath).set(stranger).send({ url: 'https://sals.example/menu' })).status).toBe(404);
    expect((await request(app()).post(menuPath).set(cohostViewer).send({ url: 'https://sals.example/menu' })).status).toBe(404);
    process.env.PIZZA_ORDERING_PARTY_IDS = '';
    expect((await request(app()).post(menuPath).set(host).send({ url: 'https://sals.example/menu' })).status).toBe(404);
    expect(mcp.calls).toHaveLength(0);
  });

  it('a native shop: 409 NOT_A_LISTING, nothing forwarded', async () => {
    const r = await request(app()).post(`${base}/shops/pz_abc/menu/host`).set(host).send({ url: 'https://sals.example/menu' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NOT_A_LISTING');
    expect(mcp.calls).toHaveLength(0);
  });

  it('photos: forwarded as multipart files[] with the type their bytes say, with the HOST\'s own token; only the summary comes back; nothing stored', async () => {
    const r = await request(app())
      .post(menuPath)
      .set(host)
      .attach('files[]', JPEG, { filename: 'page1.jpg', contentType: 'image/jpeg' })
      // a PNG that claims to be a PDF: the bytes decide
      .attach('files[]', PNG, { filename: 'page2.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    expect(r.body).toEqual({
      menuId: 'lm_1', provenance: 'host_provided', asOf: '2026-11-09T12:00:00Z',
      summary: { pizzaItems: 14, pricedItems: 12, priceRangeCents: [1200, 2600] },
    });
    // the menu itself (items, names) never reaches the browser
    expect(JSON.stringify(r.body)).not.toMatch(/categories/);
    const [call] = uploads();
    expect(call.path).toBe('/pizzerias/pzl_osm_n1/menu/host');
    expect(call.claims.sub).toBe('rsvpizza:host1'); // brand-check-ignore-line (OPOP subject prefix, fixed by the trust contract)
    expect(call.headers['content-type']).toBeUndefined(); // fetch sets the multipart boundary itself
    const form = call.body as FormData;
    const parts = form.getAll('files[]') as File[];
    expect(parts.map((p) => p.type)).toEqual(['image/jpeg', 'image/png']);
    expect(Buffer.from(await parts[0].arrayBuffer()).equals(JPEG)).toBe(true);
    expect(Buffer.from(await parts[1].arrayBuffer()).equals(PNG)).toBe(true);
    storedNothing();
  });

  it('a co-host with edit rights uploads with THEIR own token (the menu is theirs, not the host\'s)', async () => {
    const r = await request(app()).post(menuPath).set(cohostEditor).attach('files', PDF, { filename: 'menu.pdf', contentType: 'application/pdf' });
    expect(r.status).toBe(201);
    expect(uploads()[0].claims.sub).toBe('rsvpizza:co1'); // brand-check-ignore-line (OPOP subject prefix, fixed by the trust contract)
  });

  it('a file that is not a photo or PDF (whatever it claims): 415, nothing forwarded', async () => {
    const r = await request(app()).post(menuPath).set(host).attach('files[]', TEXT, { filename: 'menu.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(415);
    expect(r.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    expect(uploads()).toHaveLength(0);
  });

  it('4 MB + 1 byte: 413 MENU_TOO_LARGE, nothing forwarded', async () => {
    const big = pad([0xff, 0xd8, 0xff], 4 * 1024 * 1024 + 1);
    const r = await request(app()).post(menuPath).set(host).attach('files[]', big, { filename: 'big.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(413);
    expect(r.body.error.code).toBe('MENU_TOO_LARGE');
    expect(uploads()).toHaveLength(0);
  });

  it('a body past the 4.5 MB cap is refused while it streams (413), nothing forwarded', async () => {
    const huge = pad([0xff, 0xd8, 0xff], 5 * 1024 * 1024);
    const r = await request(app()).post(menuPath).set(host).attach('files[]', huge, { filename: 'huge.jpg', contentType: 'image/jpeg' });
    expect(r.status).toBe(413);
    expect(uploads()).toHaveLength(0);
  });

  it('4 photos (413) and a PDF with a photo (415): nothing forwarded', async () => {
    let req = request(app()).post(menuPath).set(host);
    for (let i = 0; i < 4; i++) req = req.attach('files[]', JPEG, { filename: `p${i}.jpg`, contentType: 'image/jpeg' });
    expect((await req).status).toBe(413);
    const mixed = await request(app()).post(menuPath).set(host)
      .attach('files[]', PDF, { filename: 'm.pdf', contentType: 'application/pdf' })
      .attach('files[]', JPEG, { filename: 'm.jpg', contentType: 'image/jpeg' });
    expect(mixed.status).toBe(415);
    expect(uploads()).toHaveLength(0);
  });

  it('a link: forwarded as JSON {url}; a bad link is refused here (URL_NOT_ALLOWED) and never forwarded', async () => {
    const ok = await request(app()).post(menuPath).set(host).send({ url: '  https://sals.example/menu  ' });
    expect(ok.status).toBe(201);
    expect(uploads()[0].body).toEqual({ url: 'https://sals.example/menu' });
    expect(uploads()[0].headers['content-type']).toBe('application/json');
    for (const url of ['javascript:alert(1)', 'https://user:pw@sals.example/', '']) {
      const bad = await request(app()).post(menuPath).set(host).send({ url });
      expect(bad.status, url).toBe(400);
      expect(bad.body.error.code).toBe('URL_NOT_ALLOWED');
    }
    expect(uploads()).toHaveLength(1);
  });

  it('neither files nor JSON: 415', async () => {
    const r = await request(app()).post(menuPath).set(host).set('content-type', 'text/plain').send('https://sals.example/menu');
    expect(r.status).toBe(415);
    expect(uploads()).toHaveLength(0);
  });

  it('pizza-mcp problems keep their codes (and its words for the next step)', async () => {
    const cases: Array<[Out, number, string]> = [
      [problem(422, 'MENU_UNREADABLE', "We couldn't read prices from that menu."), 422, 'MENU_UNREADABLE'],
      [problem(422, 'MENU_CURRENCY_MISMATCH'), 422, 'MENU_CURRENCY_MISMATCH'],
      [problem(422, 'URL_NOT_ALLOWED', 'That site asked us not to read it.'), 422, 'URL_NOT_ALLOWED'],
      [problem(413, 'MENU_TOO_LARGE'), 413, 'MENU_TOO_LARGE'],
      [problem(415, 'UNSUPPORTED_MEDIA_TYPE'), 415, 'UNSUPPORTED_MEDIA_TYPE'],
      [problem(429, 'RATE_LIMITED'), 429, 'RATE_LIMITED'],
      [problem(503, 'EXTRACTION_BUDGET_EXHAUSTED'), 502, 'EXTRACTION_BUDGET_EXHAUSTED'],
      [problem(503, 'EXTRACTION_UNAVAILABLE'), 502, 'EXTRACTION_UNAVAILABLE'],
      [problem(409, 'NOT_A_LISTING'), 409, 'NOT_A_LISTING'],
      // our own credentials: a server problem, never a 401/403 to the browser
      [problem(403, 'INSUFFICIENT_SCOPE'), 502, 'PIZZA_MCP_AUTH'],
    ];
    for (const [out, status, code] of cases) {
      hostRoute = () => out;
      const r = await request(app()).post(menuPath).set(host).send({ url: 'https://sals.example/menu' });
      expect(r.status, code).toBe(status);
      expect(r.body.error.code).toBe(code);
    }
    hostRoute = () => problem(422, 'MENU_UNREADABLE', "We couldn't read prices from that menu.");
    const r = await request(app()).post(menuPath).set(host).send({ url: 'https://sals.example/menu' });
    expect(r.body.error.message).toBe("We couldn't read prices from that menu.");
    storedNothing();
  });

  it('FEATURE_DISABLED from pizza-mcp: passed on, and the config stops offering it', async () => {
    expect((await request(app()).get(`${base}/config`).set(host)).body.hostMenus).toBe(true);
    hostRoute = () => problem(404, 'FEATURE_DISABLED');
    const r = await request(app()).post(menuPath).set(host).send({ url: 'https://sals.example/menu' });
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('FEATURE_DISABLED');
    expect((await request(app()).get(`${base}/config`).set(host)).body.hostMenus).toBe(false);
  });
});

describe('DELETE /shops/:shopId/menu/host', () => {
  it('forwards with the caller\'s token and says how many menus stopped applying', async () => {
    const r = await request(app()).delete(menuPath).set(host);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ expired: 1 });
    const call = mcp.calls.find((c) => c.method === 'DELETE')!;
    expect(call.path).toBe('/pizzerias/pzl_osm_n1/menu/host');
    expect(call.claims.sub).toBe('rsvpizza:host1'); // brand-check-ignore-line (OPOP subject prefix, fixed by the trust contract)
  });

  it('gated like the upload', async () => {
    expect((await request(app()).delete(menuPath).set(stranger)).status).toBe(404);
    delete process.env.PIZZA_HOST_MENUS;
    expect((await request(app()).delete(menuPath).set(host)).status).toBe(404);
    expect(mcp.calls).toHaveLength(0);
  });
});
