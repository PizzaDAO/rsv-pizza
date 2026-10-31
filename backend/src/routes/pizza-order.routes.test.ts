import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeFakeDb, makeFakePizzaMcp, generateSigningKeyPem, opopOrder, PARTY_ID, OTHER_PARTY_ID, FakeDb } from '../testutil/pizzaFakes.js';

const m = vi.hoisted(() => ({ fake: null as any, party: null as any, notify: vi.fn() }));
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
vi.mock('../services/pizzaOrderNotify.js', () => ({ notifyHostOfOrder: m.notify }));

import router from './pizza-order.routes.js';
import { errorHandler } from '../middleware/error.js';
import { PizzaMcpClient, setPizzaMcpClientForTests, orderIdempotencyKey } from '../services/pizzaMcp.client.js';

const host = { 'x-user-id': 'host1', 'x-user-email': 'host@x.com' };
const stranger = { 'x-user-id': 'bad1', 'x-user-email': 'bad@x.com' };
const cohostEditor = { 'x-user-id': 'co1', 'x-user-email': 'co@x.com' };
const cohostViewer = { 'x-user-id': 'co2', 'x-user-email': 'view@x.com' };
const base = `/api/parties/${PARTY_ID}/pizza`;

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/parties', router);
  a.use(errorHandler);
  return a;
};

const rec = {
  id: 'rec-1', quantity: 10, size: { diameter: 16, name: 'Large' }, style: { name: 'New York' },
  toppings: [{ name: 'Pepperoni' }], dietaryRestrictions: [],
};
const pickupAt = () => new Date(Date.now() + 3 * 3600_000).toISOString();

const cartView = (over: any = {}) => ({
  id: 'cart_1', pizzeria_id: 'pzl_osm_n1', version: 2, fulfillment: {}, lines: [{ id: 'l1' }], issues: [], ready_for_quote: true, ...over,
});
const quoteView = { quote_id: 'q_1', cart_id: 'cart_1', price_ceiling_cents: 21000, binding: false, read_back: '10 large pepperoni' };

function pizzaMcp(over: Record<string, any> = {}) {
  return makeFakePizzaMcp({
    'GET /pizzerias': () => ({ json: { pizzerias: [{ id: 'pzl_osm_n1', name: "Sal's", tier: 'listing' }] } }),
    'GET /pizzerias/:id/menu': () => ({ json: { categories: [] } }),
    'GET /pizzerias/:id': () => ({ json: { id: 'pzl_osm_n1', name: "Sal's", tier: 'listing', ordering: { channel: 'ai_phone' } } }),
    'POST /pizzerias/:id/menu/resolve': () => ({
      json: {
        ready_to_add: true, ambiguities: [], unmatched: [], assumptions: [],
        lines: [{ line: { item_id: 'it1', size_id: 's16', quantity: 1, options: [{ option_id: 'pep', placement: 'whole' }], notes: null, dietary_firm: [] }, item_name: 'Pie', size_name: 'L', summary: '', confidence: 1, needs: [] }],
      },
    }),
    'POST /carts': () => ({ json: cartView() }),
    'PATCH /carts/:id': () => ({ json: cartView({ version: 3 }) }),
    'GET /carts/:id': () => ({ json: cartView() }),
    'POST /carts/:id/quote': () => ({ json: quoteView }),
    'POST /orders': () => ({
      status: 201,
      json: {
        order: opopOrder({ status: 'awaiting_approval', next_action: { type: 'open_url', url: 'https://api.openpizza.xyz/confirm/c1', message: 'approve' } }),
        next_action: { type: 'open_url', url: 'https://api.openpizza.xyz/confirm/c1', message: 'approve' },
      },
    }),
    'GET /orders/:id': () => ({ json: opopOrder({ status: 'calling' }, 3) }),
    ...over,
  });
}

let fake: FakeDb;
let mcp: ReturnType<typeof pizzaMcp>;
const saved: Record<string, string | undefined> = {};
const ENV = ['PIZZA_MCP_SIGNING_KEY', 'PIZZA_MCP_URL', 'PIZZA_ORDERING_PARTY_IDS'];

function setParty(over: any = {}) {
  m.party = {
    id: PARTY_ID, name: 'Pizza Party', userId: 'host1',
    coHosts: [{ email: 'co@x.com', canEdit: true }, { email: 'view@x.com', canEdit: false }],
    address: '1 Main St', latitude: 42.36, longitude: -71.06, customUrl: null, inviteCode: 'abc',
    reimbursementCapUsd: 250, eventTags: [], ...over,
  };
}

beforeEach(() => {
  for (const k of ENV) saved[k] = process.env[k];
  process.env.PIZZA_MCP_SIGNING_KEY = generateSigningKeyPem();
  process.env.PIZZA_MCP_URL = 'https://api.openpizza.xyz';
  process.env.PIZZA_ORDERING_PARTY_IDS = PARTY_ID;
  fake = makeFakeDb();
  fake.users.set('host1', { id: 'host1', email: 'host@x.com' });
  fake.parties.set(PARTY_ID, { id: PARTY_ID });
  m.fake = fake;
  m.notify.mockReset();
  setParty();
  mcp = pizzaMcp();
  setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
});
afterEach(() => {
  setPizzaMcpClientForTests(null);
  for (const k of ENV) (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]));
});

const orderBody = (over: any = {}) => ({
  quoteId: 'q_1', cartId: 'cart_1', shopId: 'pzl_osm_n1', recommendationVersion: 'v1',
  contact: { name: 'Sam W', phone: '+16175550123' },
  policy: { ceilingCents: 21000, substitution: 'exact' },
  ...over,
});

describe('access: authentication, host/co-host, allowlist', () => {
  const endpoints: Array<[string, string, any?]> = [
    ['get', '/config'],
    ['get', '/shops'],
    ['get', '/shops/pzl_osm_n1/menu'],
    ['post', '/cart', { shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() }],
    ['patch', '/cart/cart_1', { ops: [{ op: 'remove_line', line_id: 'l1' }] }],
    ['post', '/orders', orderBody()],
    ['get', '/orders'],
    ['get', '/orders/ord_1'],
  ];

  it('401 without a login on every route', async () => {
    for (const [method, path, body] of endpoints) {
      const res = await (request(app()) as any)[method](base + path).send(body);
      expect(res.status, `${method} ${path}`).toBe(401);
    }
    expect(mcp.calls).toHaveLength(0);
  });

  it('404 for a signed-in user who is not host or co-host (wrong host), on every route, and pizza-mcp is never called', async () => {
    for (const [method, path, body] of endpoints) {
      const res = await (request(app()) as any)[method](base + path).set(stranger).send(body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    expect(mcp.calls).toHaveLength(0);
  });

  it('a co-host without edit rights is refused; one with edit rights is allowed', async () => {
    expect((await request(app()).get(`${base}/shops`).set(cohostViewer)).status).toBe(404);
    expect((await request(app()).get(`${base}/shops`).set(cohostEditor)).status).toBe(200);
  });

  it('a user whose email matches nothing and whose id is the owner id of a different party is refused', async () => {
    setParty({ userId: 'someone-else' });
    expect((await request(app()).get(`${base}/shops`).set(host)).status).toBe(404);
  });

  it('a party NOT on the allowlist is 404 on every route, even for its host; /config says disabled', async () => {
    process.env.PIZZA_ORDERING_PARTY_IDS = OTHER_PARTY_ID;
    for (const [method, path, body] of endpoints.filter(([, p]) => p !== '/config')) {
      const res = await (request(app()) as any)[method](base + path).set(host).send(body);
      expect(res.status, `${method} ${path}`).toBe(404);
    }
    const cfg = await request(app()).get(`${base}/config`).set(host);
    expect(cfg.status).toBe(200);
    expect(cfg.body).toEqual({ enabled: false, capCents: null, location: null });
    expect(mcp.calls).toHaveLength(0);
  });

  it('an empty or unset allowlist turns the feature off for everyone', async () => {
    for (const v of ['', undefined]) {
      v === undefined ? delete process.env.PIZZA_ORDERING_PARTY_IDS : (process.env.PIZZA_ORDERING_PARTY_IDS = v);
      expect((await request(app()).get(`${base}/shops`).set(host)).status).toBe(404);
      expect((await request(app()).get(`${base}/config`).set(host)).body.enabled).toBe(false);
    }
  });

  it('a non-uuid party id is a 404', async () => {
    expect((await request(app()).get('/api/parties/not-a-uuid/pizza/shops').set(host)).status).toBe(404);
  });

  it('allowlist match is case-insensitive and tolerates spaces', async () => {
    process.env.PIZZA_ORDERING_PARTY_IDS = ` ${OTHER_PARTY_ID} , ${PARTY_ID.toUpperCase()} `;
    expect((await request(app()).get(`${base}/config`).set(host)).body.enabled).toBe(true);
  });
});

describe('discovery and menu', () => {
  it('proxies shops using the party location and the host token', async () => {
    const res = await request(app()).get(`${base}/shops`).set(host);
    expect(res.status).toBe(200);
    expect(res.body.pizzerias[0].id).toBe('pzl_osm_n1');
    expect(mcp.calls[0].query).toMatchObject({ near: '42.36,-71.06' });
    expect(mcp.calls[0].claims).toMatchObject({ sub: 'rsvpizza:host1', email: 'host@x.com', party_id: PARTY_ID });
  });

  it('400 when the party has no location and no ?near', async () => {
    setParty({ latitude: null, longitude: null });
    expect((await request(app()).get(`${base}/shops`).set(host)).body.error.code).toBe('NEAR_REQUIRED');
  });

  it('rejects a malformed shop id before calling pizza-mcp', async () => {
    const res = await request(app()).get(`${base}/shops/..%2Fadmin/menu`).set(host);
    expect(res.status).toBe(400);
    expect(mcp.calls).toHaveLength(0);
  });
});

describe('cart', () => {
  it('resolves each recommendation, builds the cart (pickup only) and quotes with the reimbursement cap', async () => {
    const res = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() });
    expect(res.status).toBe(200);
    expect(res.body.quote.quote_id).toBe('q_1');
    expect(res.body.issues).toEqual([]);
    expect(res.body.capCents).toBe(25000);

    const resolve = mcp.calls.find((c) => c.path.endsWith('/menu/resolve'))!;
    expect(resolve.body.text).toBe('10 16in New York Pepperoni');
    const cart = mcp.calls.find((c) => c.method === 'POST' && c.path === '/carts')!;
    expect(cart.body.ops[0]).toMatchObject({ op: 'add_line', item_id: 'it1', quantity: 10, client_line_ref: 'rec-1' });
    expect(cart.body.ops[1]).toMatchObject({ op: 'set_fulfillment', type: 'pickup' });
    const quote = mcp.calls.find((c) => c.path.endsWith('/quote'))!;
    expect(quote.body).toEqual({ max_total_cents: 25000 });
  });

  it('surfaces an ambiguous line to the host and does not quote', async () => {
    mcp = pizzaMcp({
      'POST /pizzerias/:id/menu/resolve': () => ({
        json: { lines: [], ready_to_add: false, unmatched: [], assumptions: [], ambiguities: [{ kind: 'size', message: 'm', ask_user: 'Which size is 16in?', candidates: ['Large', 'XL'] }] },
      }),
    });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const res = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() });
    expect(res.status).toBe(200);
    expect(res.body.cart).toBeNull();
    expect(res.body.quote).toBeNull();
    expect(res.body.issues[0]).toMatchObject({ ref: 'rec-1', ask_user: 'Which size is 16in?', candidates: ['Large', 'XL'] });
  });

  it('rejects a missing/near pickup time and over-cap pizza counts', async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    expect((await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: soon })).body.error.code).toBe('PICKUP_TIME_REQUIRED');
    const big = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [{ ...rec, quantity: 31 }], pickupAt: pickupAt() });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('TOO_MANY_PIZZAS');
  });

  it('host edits: allows line/pickup edits, refuses added lines and delivery', async () => {
    const ok = await request(app()).patch(`${base}/cart/cart_1`).set(host).send({ ops: [{ op: 'update_line', line_id: 'l1', quantity: 8 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.cart.version).toBe(3);
    const add = await request(app()).patch(`${base}/cart/cart_1`).set(host).send({ ops: [{ op: 'add_line', item_id: 'x' }] });
    expect(add.status).toBe(400);
    const del = await request(app()).patch(`${base}/cart/cart_1`).set(host).send({ ops: [{ op: 'set_fulfillment', type: 'delivery', address: { line1: 'x', city: 'y' } }] });
    expect(del.body.error.code).toBe('DELIVERY_NOT_SUPPORTED');
  });
});

describe('place order', () => {
  it('places a listing (phone) order with the right body, key and client_ref, and stores a PizzaOrder', async () => {
    const res = await request(app()).post(`${base}/orders`).set(host).send(orderBody());
    expect(res.status).toBe(201);
    expect(res.body.next_action.url).toBe('https://api.openpizza.xyz/confirm/c1');
    expect(res.body.order).toMatchObject({ opopOrderId: 'ord_1', status: 'awaiting_approval', shopName: "Sal's", tier: 'listing', ceilingCents: 21000, isMine: true });

    const call = mcp.calls.find((c) => c.method === 'POST' && c.path === '/orders')!;
    expect(call.headers['idempotency-key']).toBe(orderIdempotencyKey(PARTY_ID, 'v1#cart2', 'pzl_osm_n1'));
    expect(call.body).toMatchObject({
      quote_id: 'q_1',
      payment_mode: 'pay_at_pickup',
      contact: { name: 'Sam W', phone: '+16175550123', email: 'host@x.com' },
      phone_order: { price_ceiling_cents: 21000, substitution_policy: 'exact', transfer_to_host: false },
      max_total_cents: 25000,
      client_ref: { party_id: PARTY_ID, rsvp_user_id: 'host1' },
    });
    expect(fake.byOpop('ord_1')).toMatchObject({ userId: 'host1', partyId: PARTY_ID });
  });

  it('a double click sends the same Idempotency-Key and stores one row', async () => {
    await request(app()).post(`${base}/orders`).set(host).send(orderBody());
    await request(app()).post(`${base}/orders`).set(host).send(orderBody());
    const keys = mcp.calls.filter((c) => c.path === '/orders').map((c) => c.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(1);
    expect(fake.orders.size).toBe(1);
  });

  it('a ceiling over the reimbursement cap is refused before pizza-mcp is asked', async () => {
    const res = await request(app()).post(`${base}/orders`).set(host).send(orderBody({ policy: { ceilingCents: 25001, substitution: 'exact' } }));
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SPEND_LIMIT_EXCEEDED');
    expect(mcp.calls.find((c) => c.path === '/orders')).toBeUndefined();
  });

  it('validates the host contact and refuses a cart for a different shop', async () => {
    expect((await request(app()).post(`${base}/orders`).set(host).send(orderBody({ contact: { name: 'A', phone: '6175550123' } }))).status).toBe(400);
    expect((await request(app()).post(`${base}/orders`).set(host).send(orderBody({ contact: { name: '', phone: '+16175550123' } }))).status).toBe(400);
    mcp = pizzaMcp({ 'GET /carts/:id': () => ({ json: cartView({ pizzeria_id: 'pzl_osm_other' }) }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    expect((await request(app()).post(`${base}/orders`).set(host).send(orderBody())).status).toBe(400);
  });

  it('refuses a listing shop that has no call channel (handoff)', async () => {
    mcp = pizzaMcp({ 'GET /pizzerias/:id': () => ({ json: { id: 'pzl_osm_n1', name: "Sal's", tier: 'listing', ordering: { channel: 'handoff' } } }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const res = await request(app()).post(`${base}/orders`).set(host).send(orderBody());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CALLS_NOT_AVAILABLE_HERE');
  });

  it('native shops order with a checkout link and no phone_order', async () => {
    mcp = pizzaMcp({
      'GET /pizzerias/:id': () => ({ json: { id: 'pz_abc', name: 'Tony', tier: 'native', ordering: { channel: 'api' } } }),
      'GET /carts/:id': () => ({ json: cartView({ pizzeria_id: 'pz_abc' }) }),
    });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const res = await request(app()).post(`${base}/orders`).set(host).send(orderBody({ shopId: 'pz_abc' }));
    expect(res.status).toBe(201);
    const call = mcp.calls.find((c) => c.path === '/orders')!;
    expect(call.body.payment_mode).toBe('checkout_link');
    expect(call.body.phone_order).toBeUndefined();
  });

  it('passes pizza-mcp problems (with ask_user) through to the client', async () => {
    mcp = pizzaMcp({ 'POST /orders': () => ({ status: 409, json: { code: 'OUTSIDE_CALL_WINDOW', title: 't', detail: 'Shops are closed', status: 409, retryable: false, ask_user: 'Pick a later time?' } }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const res = await request(app()).post(`${base}/orders`).set(host).send(orderBody());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'OUTSIDE_CALL_WINDOW', message: 'Shops are closed', opop: { ask_user: 'Pick a later time?' } });
  });
});

describe('status', () => {
  async function place() {
    await request(app()).post(`${base}/orders`).set(host).send(orderBody());
    mcp.calls.length = 0;
  }

  it('the placing host polls pizza-mcp as themselves and gets the approval link', async () => {
    await place();
    const res = await request(app()).get(`${base}/orders/ord_1`).set(host);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('calling');
    expect(mcp.calls[0].claims.sub).toBe('rsvpizza:host1');
  });

  it('a co-host sees stored state but not the approval link, and we never mint a token as the host', async () => {
    await place();
    const res = await request(app()).get(`${base}/orders/ord_1`).set(cohostEditor);
    expect(res.status).toBe(200);
    expect(res.body.order.nextAction).toBeNull();
    expect(res.body.order.isMine).toBe(false);
    expect(mcp.calls).toHaveLength(0);
    const list = await request(app()).get(`${base}/orders`).set(cohostEditor);
    expect(list.body.orders[0].nextAction).toBeNull();
  });

  it("an order id from another party is a 404 (cannot read another party's order through this party)", async () => {
    await place();
    fake.byOpop('ord_1').partyId = OTHER_PARTY_ID;
    expect((await request(app()).get(`${base}/orders/ord_1`).set(host)).status).toBe(404);
  });

  it('serves the last known state when pizza-mcp is down', async () => {
    await place();
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: (async () => { throw new TypeError('down'); }) as any }));
    const res = await request(app()).get(`${base}/orders/ord_1`).set(host);
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(res.body.order.status).toBe('awaiting_approval');
  });

  it('exposes deferred calls when the API provides them, and tolerates their absence', async () => {
    await place();
    fake.byOpop('ord_1').lastView = { call: { attempts: 1, deferred_calls: [{ at: '2026-10-30T22:00:00Z', reason: 'closed' }] }, timeline: [] };
    fake.byOpop('ord_1').status = 'canceled'; // terminal: no poll overwrites the view
    const res = await request(app()).get(`${base}/orders/ord_1`).set(host);
    expect(res.body.order.call.deferred_calls[0].reason).toBe('closed');
    fake.byOpop('ord_1').lastView = null;
    expect((await request(app()).get(`${base}/orders/ord_1`).set(host)).body.order.call).toBeNull();
  });

  it('responses carry no key material or tokens', async () => {
    await place();
    const res = await request(app()).get(`${base}/orders/ord_1`).set(host);
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|whsec_|Bearer /);
  });
});
