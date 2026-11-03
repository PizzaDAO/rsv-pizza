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
  id: 'cart_1', pizzeria_id: 'pzl_osm_n1', version: 2, fulfillment: {}, lines: [{ id: 'l1', quantity: 10 }], issues: [], ready_for_quote: true, ...over,
});

let n = 0; // cart ids stay unique across fakes within a test
function pizzaMcp(over: Record<string, any> = {}) {
  // stateful: every cart gets its own id and remembers its shop; every quote names its cart
  const carts = new Map<string, any>();
  return makeFakePizzaMcp({
    'GET /pizzerias': () => ({ json: { pizzerias: [{ id: 'pzl_osm_n1', name: "Sal's", tier: 'listing' }] } }),
    'GET /pizzerias/:id/menu': () => ({ json: { categories: [] } }),
    'GET /pizzerias/:id': (c) => {
      const id = c.path.split('/').pop()!;
      return { json: { id, name: id === 'pz_abc' ? 'Tony' : id === 'pzl_osm_n2' ? "Luigi's" : "Sal's", tier: id.startsWith('pz_') ? 'native' : 'listing', ordering: { channel: id.startsWith('pz_') ? 'api' : 'ai_phone' } } };
    },
    'POST /pizzerias/:id/menu/resolve': () => ({
      json: {
        ready_to_add: true, ambiguities: [], unmatched: [], assumptions: [],
        lines: [{ line: { item_id: 'it1', size_id: 's16', quantity: 1, options: [{ option_id: 'pep', placement: 'whole' }], notes: null, dietary_firm: [] }, item_name: 'Pie', size_name: 'L', summary: '', confidence: 1, needs: [] }],
      },
    }),
    'POST /carts': (c) => {
      const cart = cartView({ id: `cart_${++n}`, pizzeria_id: c.body.pizzeria_id });
      carts.set(cart.id, cart);
      return { json: cart };
    },
    'PATCH /carts/:id': (c) => ({ json: { ...carts.get(c.path.split('/').pop()!), version: 3 } }),
    'GET /carts/:id': (c) => ({ json: carts.get(c.path.split('/').pop()!) ?? cartView() }),
    'POST /carts/:id/quote': (c) => {
      const cartId = c.path.split('/')[2];
      return { json: { quote_id: `q_${cartId}`, cart_id: cartId, price_ceiling_cents: 21000, binding: false, read_back: '10 large pepperoni' } };
    },
    'POST /orders': (c) => ({
      status: 201,
      json: {
        order: opopOrder({ id: `ord_${c.body.quote_id}`, pizzeria_id: carts.get(c.body.quote_id.replace('q_', ''))?.pizzeria_id ?? 'pzl_osm_n1', status: 'awaiting_approval', next_action: { type: 'open_url', url: 'https://api.openpizza.xyz/confirm/c1', message: 'approve' } }),
        next_action: { type: 'open_url', url: 'https://api.openpizza.xyz/confirm/c1', message: 'approve' },
      },
    }),
    'POST /orders/:id/cancel': (c) => ({ json: opopOrder({ id: c.path.split('/')[2], status: 'canceled' }, 5) }),
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
  n = 0;
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
    ['post', '/orders/ord_1/cancel', {}],
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
    expect(cfg.body).toEqual({ enabled: false, capCents: null, remainingCapCents: null, blockedReason: null, location: null });
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

const buildCart = async (over: any = {}, who: any = host, shopId = 'pzl_osm_n1') => {
  const r = await request(app())
    .post(`${base}/cart`)
    .set(who)
    .send({ shopId, pickupAt: pickupAt(), recommendations: [rec], ...over });
  return r.body;
};
const placeFrom = (c: any, over: any = {}, who: any = host) =>
  request(app())
    .post(`${base}/orders`)
    .set(who)
    .send(orderBody({ quoteId: c.quote.quote_id, cartId: c.cart.id, shopId: c.cart.pizzeria_id, recommendationVersion: c.recommendationVersion, ...over }));

describe('cart', () => {
  it('resolves each recommendation, builds the cart (pickup only) and quotes with the REMAINING budget', async () => {
    const res = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() });
    expect(res.status).toBe(200);
    expect(res.body.quote.quote_id).toBe('q_cart_1');
    expect(res.body.issues).toEqual([]);
    expect(res.body.capCents).toBe(25000);
    expect(res.body.remainingCapCents).toBe(25000);

    const resolve = mcp.calls.find((c) => c.path.endsWith('/menu/resolve'))!;
    expect(resolve.body.text).toBe('10 16in pizza with Pepperoni');
    const cart = mcp.calls.find((c) => c.method === 'POST' && c.path === '/carts')!;
    expect(cart.body.ops[0]).toMatchObject({ op: 'add_line', item_id: 'it1', quantity: 10, client_line_ref: 'rec-1' });
    expect(cart.body.ops[1]).toMatchObject({ op: 'set_fulfillment', type: 'pickup' });
    expect(mcp.calls.find((c) => c.path.endsWith('/quote'))!.body).toEqual({ max_total_cents: 25000 });
    // the cart is bound to this party + host + shop, with its quote
    expect(fake.carts.get('cart_1')).toMatchObject({ partyId: PARTY_ID, userId: 'host1', shopId: 'pzl_osm_n1', quoteIds: ['q_cart_1'] });
  });

  it('the quote budget is the cap minus eligible receipts minus open order ceilings (money cap)', async () => {
    fake.docs.push({ id: 'd1', partyId: PARTY_ID, kind: 'receipt', source: 'upload', ocrAmount: { toString: () => '60.00' }, isDuplicate: false, ineligible: false });
    fake.docs.push({ id: 'd2', partyId: PARTY_ID, kind: 'receipt', source: 'upload', ocrAmount: { toString: () => '40.00' }, isDuplicate: true, ineligible: false }); // duplicate: not counted
    fake.docs.push({ id: 'd3', partyId: PARTY_ID, kind: 'receipt', source: 'ai_call', ocrAmount: null, pizzaOrderId: 'x' }); // draft: not counted
    await fake.db.pizzaOrder.create({ data: { partyId: PARTY_ID, userId: 'host1', opopOrderId: 'ord_old', tier: 'listing', shopId: 'pzl_osm_n1', shopName: "Sal's", status: 'calling', ceilingCents: 5000 } });
    await fake.db.pizzaOrder.create({ data: { partyId: PARTY_ID, userId: 'host1', opopOrderId: 'ord_dead', tier: 'listing', shopId: 'pzl_osm_n1', shopName: "Sal's", status: 'refused', ceilingCents: 9000 } }); // free: not counted
    const res = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() });
    expect(res.body.remainingCapCents).toBe(25000 - 6000 - 5000);
    expect(mcp.calls.find((c) => c.path.endsWith('/quote'))!.body).toEqual({ max_total_cents: 14000 });
  });

  it('a null or $0 reimbursement cap refuses ordering (it does not mean "no cap")', async () => {
    for (const cap of [null, 0]) {
      setParty({ reimbursementCapUsd: cap });
      const res = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() });
      expect(res.status, String(cap)).toBe(422);
      expect(res.body.error.code).toBe('NO_REIMBURSEMENT_CAP');
      const cfg = await request(app()).get(`${base}/config`).set(host);
      expect(cfg.body).toMatchObject({ enabled: true, capCents: null, remainingCapCents: null, blockedReason: 'NO_REIMBURSEMENT_CAP' });
    }
    expect(mcp.calls.filter((c) => c.path.includes('/carts'))).toHaveLength(0);
  });

  it('a spent budget refuses with CAP_EXHAUSTED', async () => {
    fake.docs.push({ id: 'd1', partyId: PARTY_ID, kind: 'receipt', source: 'upload', ocrAmount: { toString: () => '250.00' }, isDuplicate: false, ineligible: false });
    const res = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() });
    expect(res.body.error.code).toBe('CAP_EXHAUSTED');
  });

  it('an unmatched topping is a choice, not a dead end: the other lines are kept and no quote is made until the host answers', async () => {
    mcp = pizzaMcp({
      'GET /pizzerias/:id/menu': () => ({ json: { categories: [{ items: [{ sizes: [{ diameter_in: 14 }, { diameter_in: 16 }], option_groups: [{ role: 'topping', options: [{ name: 'Pepperoni' }, { name: 'Mushrooms' }] }] }] }] } }),
    });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const jal = { ...rec, id: 'rec-2', quantity: 3, size: { diameter: 18 }, toppings: [{ name: 'Jalapeños' }, { name: 'Mushroom' }] };
    const first = await buildCart({ recommendations: [rec, jal] });
    expect(first.cart.lines).toHaveLength(1); // the pepperoni pizza is kept
    expect(first.quote).toBeNull();
    expect(first.issues).toHaveLength(1);
    expect(first.issues[0]).toMatchObject({ ref: 'rec-2', kind: 'topping_unavailable', unmatched: ['Jalapeños'] });
    expect(first.issues[0].ask_user).toBe("This shop doesn't list Jalapeños.");
    expect(first.issues[0].choices.map((c: any) => c.id)).toEqual(['omit_toppings', 'drop_line']);
    expect(JSON.stringify(first.issues)).not.toMatch(/pz[l]?_|gen-|candidates/); // no raw ids

    const omit = await buildCart({ recommendations: [rec, jal], decisions: { 'rec-2': 'omit_toppings' } });
    expect(omit.issues).toEqual([]);
    expect(omit.quote).toBeTruthy();
    expect(omit.notices.join(' ')).toMatch(/leaving off Jalape/);
    expect(omit.notices.join(' ')).toMatch(/no 18" pizza.*16"/); // size mapped, and said so
    const texts = mcp.calls.filter((c) => c.path.endsWith('/menu/resolve')).map((c) => c.body.text);
    expect(texts).toContain('3 16in pizza with Mushrooms');

    const drop = await buildCart({ recommendations: [rec, jal], decisions: { 'rec-2': 'drop_line' } });
    expect(drop.quote).toBeTruthy();
    expect(drop.dropped).toEqual([{ ref: 'rec-2', label: expect.any(String) }]);
    expect(drop.cart.lines).toHaveLength(1);
  });

  it('a line the resolver cannot match offers "skip", with no raw candidate ids', async () => {
    mcp = pizzaMcp({
      'POST /pizzerias/:id/menu/resolve': () => ({ json: { lines: [], ready_to_add: false, unmatched: [], assumptions: [], ambiguities: [{ kind: 'size', message: 'm', ask_user: 'What size?', candidates: ['gen-size-s', 'gen-size-m'] }] } }),
    });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const res = await buildCart();
    expect(res.cart).toBeNull();
    expect(res.issues[0]).toMatchObject({ ref: 'rec-1', kind: 'unresolved' });
    expect(res.issues[0].choices.map((c: any) => c.id)).toEqual(['drop_line']);
    expect(JSON.stringify(res)).not.toContain('gen-size');
  });

  it('rejects a missing/near pickup time and over-cap pizza counts', async () => {
    const soon = new Date(Date.now() + 60_000).toISOString();
    expect((await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: soon })).body.error.code).toBe('PICKUP_TIME_REQUIRED');
    const big = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [{ ...rec, quantity: 31 }], pickupAt: pickupAt() });
    expect(big.status).toBe(400);
    expect(big.body.error.code).toBe('TOO_MANY_PIZZAS');
    const frac = await request(app()).post(`${base}/cart`).set(host).send({ shopId: 'pzl_osm_n1', recommendations: [{ ...rec, quantity: 2.5 }], pickupAt: pickupAt() });
    expect(frac.status).toBe(400);
  });

  it('host edits: allows line/pickup edits, refuses added lines and delivery', async () => {
    const c = await buildCart();
    const ok = await request(app()).patch(`${base}/cart/${c.cart.id}`).set(host).send({ ops: [{ op: 'update_line', line_id: 'l1', quantity: 8 }] });
    expect(ok.status).toBe(200);
    expect(ok.body.cart.version).toBe(3);
    expect((await request(app()).patch(`${base}/cart/${c.cart.id}`).set(host).send({ ops: [{ op: 'add_line', item_id: 'x' }] })).status).toBe(400);
    const del = await request(app()).patch(`${base}/cart/${c.cart.id}`).set(host).send({ ops: [{ op: 'set_fulfillment', type: 'delivery', address: { line1: 'x', city: 'y' } }] });
    expect(del.body.error.code).toBe('DELIVERY_NOT_SUPPORTED');
  });

  it('PATCH enforces the 30-pizza limit that POST enforces (35 pizzas was accepted)', async () => {
    const c = await buildCart();
    const res = await request(app()).patch(`${base}/cart/${c.cart.id}`).set(host).send({ ops: [{ op: 'update_line', line_id: 'l1', quantity: 35 }] });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('TOO_MANY_PIZZAS');
    expect(mcp.calls.find((x) => x.method === 'PATCH')).toBeUndefined();
  });

  it("a host cannot edit or order from another host's cart", async () => {
    const c = await buildCart();
    expect((await request(app()).patch(`${base}/cart/${c.cart.id}`).set(cohostEditor).send({ ops: [{ op: 'remove_line', line_id: 'l1' }] })).status).toBe(404);
    expect((await placeFrom(c, {}, cohostEditor)).status).toBe(404);
  });
});

describe('place order', () => {
  it('places a listing (phone) order with the right body, key and client_ref, and stores a PizzaOrder', async () => {
    const c = await buildCart();
    const res = await placeFrom(c);
    expect(res.status).toBe(201);
    expect(res.body.next_action.url).toBe('https://api.openpizza.xyz/confirm/c1');
    expect(res.body.order).toMatchObject({ opopOrderId: 'ord_q_cart_1', status: 'awaiting_approval', shopName: "Sal's", tier: 'listing', ceilingCents: 21000, isMine: true, cancelable: true });

    const call = mcp.calls.find((x) => x.method === 'POST' && x.path === '/orders')!;
    expect(call.headers['idempotency-key']).toMatch(/^[0-9a-f]{64}$/);
    expect(call.body).toMatchObject({
      quote_id: 'q_cart_1',
      payment_mode: 'pay_at_pickup',
      contact: { name: 'Sam W', phone: '+16175550123', email: 'host@x.com' },
      phone_order: { price_ceiling_cents: 21000, substitution_policy: 'exact', transfer_to_host: false },
      max_total_cents: 25000,
      client_ref: { party_id: PARTY_ID, rsvp_user_id: 'host1' },
    });
    expect(fake.byOpop('ord_q_cart_1')).toMatchObject({ userId: 'host1', partyId: PARTY_ID, quoteId: 'q_cart_1' });
  });

  it('contact.email is the signed-in host\'s own email; a browser-supplied email is ignored', async () => {
    const c = await buildCart();
    await placeFrom(c, { contact: { name: 'Sam W', phone: '+16175550123', email: 'attacker@evil.test' } });
    expect(mcp.calls.find((x) => x.path === '/orders' && x.method === 'POST')!.body.contact.email).toBe('host@x.com');
  });

  it('a double click replays the same order (200, replayed) and stores one row', async () => {
    const c = await buildCart();
    const first = await placeFrom(c);
    const second = await placeFrom(c);
    expect(second.status).toBe(200);
    expect(second.body.replayed).toBe(true);
    expect(second.body.order.opopOrderId).toBe(first.body.order.opopOrderId);
    expect(mcp.calls.filter((x) => x.method === 'POST' && x.path === '/orders')).toHaveLength(1);
    expect(fake.orders.size).toBe(1);
  });

  it('rebuilding the cart and ordering again does not 409 at pizza-mcp: it is refused here while the first order is live', async () => {
    const c1 = await buildCart();
    await placeFrom(c1);
    const c2 = await buildCart(); // same recommendations, new cart + quote
    const res = await placeFrom(c2);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'ORDER_IN_PROGRESS', existingOrderId: 'ord_q_cart_1' });
    expect(mcp.calls.filter((x) => x.method === 'POST' && x.path === '/orders')).toHaveLength(1);
  });

  it('a client-sent attempt cannot create a second live order; only an explicit allowAnother can', async () => {
    const c1 = await buildCart();
    await placeFrom(c1);
    const c2 = await buildCart();
    expect((await placeFrom(c2, { attempt: 1 })).status).toBe(409);
    const ok = await placeFrom(c2, { allowAnother: true, policy: { ceilingCents: 4000, substitution: 'exact' } }); // $250 cap - $210 open ceiling
    expect(ok.status).toBe(201);
    const keys = mcp.calls.filter((x) => x.method === 'POST' && x.path === '/orders').map((x) => x.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(2); // fresh server-derived key
  });

  it('a co-host cannot duplicate the host\'s live order', async () => {
    const c1 = await buildCart();
    await placeFrom(c1);
    const cc = await buildCart({}, cohostEditor);
    const res = await placeFrom(cc, {}, cohostEditor);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_IN_PROGRESS');
  });

  it('after a refusal (or an expired approval) the host can order again without confirming, with a new key', async () => {
    const c1 = await buildCart();
    await placeFrom(c1);
    fake.byOpop('ord_q_cart_1').status = 'refused';
    const c2 = await buildCart();
    const res = await placeFrom(c2);
    expect(res.status).toBe(201);
    // expired approval: awaiting_approval with nothing to open
    const row = fake.byOpop('ord_q_cart_2');
    row.nextAction = { type: 'none', message: 'expired' };
    const c3 = await buildCart();
    expect((await placeFrom(c3)).status).toBe(201);
    const keys = mcp.calls.filter((x) => x.method === 'POST' && x.path === '/orders').map((x) => x.headers['idempotency-key']);
    expect(new Set(keys).size).toBe(3);
  });

  it('a ceiling over the REMAINING budget is refused before pizza-mcp is asked', async () => {
    fake.docs.push({ id: 'd1', partyId: PARTY_ID, kind: 'receipt', source: 'upload', ocrAmount: { toString: () => '100.00' }, isDuplicate: false, ineligible: false });
    const c = await buildCart(); // remaining $150
    const res = await placeFrom(c, { policy: { ceilingCents: 15001, substitution: 'exact' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SPEND_LIMIT_EXCEEDED');
    expect(mcp.calls.find((x) => x.method === 'POST' && x.path === '/orders')).toBeUndefined();
    expect((await placeFrom(c, { policy: { ceilingCents: 15000, substitution: 'exact' } })).status).toBe(201);
    expect(mcp.calls.find((x) => x.path === '/orders' && x.method === 'POST')!.body.max_total_cents).toBe(15000);
  });

  it('a quote from another shop\'s cart is refused (Sal\'s cart with Luigi\'s quote)', async () => {
    mcp = pizzaMcp({
      'GET /pizzerias': () => ({ json: { pizzerias: [] } }),
    });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const sals = await buildCart({}, host, 'pzl_osm_n1');
    const luigi = await buildCart({ recommendations: [{ ...rec, id: 'rec-9' }] }, host, 'pzl_osm_n2');
    const res = await request(app()).post(`${base}/orders`).set(host).send(orderBody({ quoteId: luigi.quote.quote_id, cartId: sals.cart.id, shopId: 'pzl_osm_n1' }));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('QUOTE_MISMATCH');
    // shop id lie: Luigi's cart claimed as Sal's
    const lie = await request(app()).post(`${base}/orders`).set(host).send(orderBody({ quoteId: luigi.quote.quote_id, cartId: luigi.cart.id, shopId: 'pzl_osm_n1' }));
    expect(lie.body.error.code).toBe('CART_MISMATCH');
    expect(mcp.calls.find((x) => x.method === 'POST' && x.path === '/orders')).toBeUndefined();
  });

  it('a cart that was never built here (unknown to this party) cannot be ordered', async () => {
    const res = await request(app()).post(`${base}/orders`).set(host).send(orderBody());
    expect(res.status).toBe(404);
  });

  it('stores the shop the order actually went to (from pizza-mcp\'s order), not the request\'s', async () => {
    mcp = pizzaMcp({
      'POST /orders': () => ({ status: 201, json: { order: opopOrder({ id: 'ord_z', pizzeria_id: 'pzl_osm_n2', status: 'awaiting_approval' }), next_action: null } }),
    });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const c = await buildCart();
    const res = await placeFrom(c);
    expect(res.body.order).toMatchObject({ shopId: 'pzl_osm_n2', shopName: "Luigi's" });
  });

  it('validates the host contact; refuses a listing shop that has no call channel (handoff)', async () => {
    const c = await buildCart();
    expect((await placeFrom(c, { contact: { name: 'A', phone: '6175550123' } })).status).toBe(400);
    expect((await placeFrom(c, { contact: { name: '', phone: '+16175550123' } })).status).toBe(400);
    mcp = pizzaMcp({ 'GET /pizzerias/:id': () => ({ json: { id: 'pzl_osm_n1', name: "Sal's", tier: 'listing', ordering: { channel: 'handoff' } } }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const c2 = await buildCart();
    const res = await placeFrom(c2);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CALLS_NOT_AVAILABLE_HERE');
  });

  it('native shops order with a checkout link, no phone_order and no ceiling needed', async () => {
    const c = await buildCart({}, host, 'pz_abc');
    const res = await placeFrom(c, { policy: {} });
    expect(res.status).toBe(201);
    const call = mcp.calls.find((x) => x.path === '/orders' && x.method === 'POST')!;
    expect(call.body.payment_mode).toBe('checkout_link');
    expect(call.body.phone_order).toBeUndefined();
    expect(call.body.max_total_cents).toBe(25000);
    expect(res.body.order).toMatchObject({ tier: 'native', shopName: 'Tony', ceilingCents: null });
  });

  it('passes pizza-mcp problems (with ask_user) through to the client', async () => {
    mcp = pizzaMcp({ 'POST /orders': () => ({ status: 409, json: { code: 'OUTSIDE_CALL_WINDOW', title: 't', detail: 'Shops are closed', status: 409, retryable: false, ask_user: 'Pick a later time?' } }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const c = await buildCart();
    const res = await placeFrom(c);
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'OUTSIDE_CALL_WINDOW', message: 'Shops are closed', opop: { ask_user: 'Pick a later time?' } });
  });
});

describe('status and cancel', () => {
  async function place() {
    const c = await buildCart();
    await placeFrom(c);
    mcp.calls.length = 0;
    return 'ord_q_cart_1';
  }

  it('the placing host polls pizza-mcp as themselves and gets the approval link', async () => {
    const id = await place();
    const res = await request(app()).get(`${base}/orders/${id}`).set(host);
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('calling');
    expect(mcp.calls[0].claims.sub).toBe('rsvpizza:host1');
  });

  it('needs_review is terminal (no more polling); approval_timeout is not', async () => {
    const id = await place();
    fake.byOpop(id).status = 'needs_review';
    await request(app()).get(`${base}/orders/${id}`).set(host);
    expect(mcp.calls).toHaveLength(0);
    fake.byOpop(id).status = 'approval_timeout';
    await request(app()).get(`${base}/orders/${id}`).set(host);
    expect(mcp.calls).toHaveLength(1);
  });

  it('an awaiting_approval order with nothing to open is restartable, not cancelable', async () => {
    const id = await place();
    fake.byOpop(id).nextAction = { type: 'none', message: 'expired' };
    fake.byOpop(id).status = 'needs_review'; // stop the poll from overwriting the stored action
    fake.byOpop(id).status = 'awaiting_approval';
    const list = await request(app()).get(`${base}/orders`).set(host);
    expect(list.body.orders[0]).toMatchObject({ restartable: true, cancelable: false });
  });

  it('the host can cancel a live order; the draft state follows pizza-mcp', async () => {
    const id = await place();
    const res = await request(app()).post(`${base}/orders/${id}/cancel`).set(host).send({});
    expect(res.status).toBe(200);
    expect(res.body.order.status).toBe('canceled');
    expect(mcp.calls.find((x) => x.path.endsWith('/cancel'))!.claims.sub).toBe('rsvpizza:host1');
    expect(fake.byOpop(id).status).toBe('canceled');
  });

  it('only the placing host may cancel, and a confirmed order cannot be canceled here', async () => {
    const id = await place();
    expect((await request(app()).post(`${base}/orders/${id}/cancel`).set(cohostEditor).send({})).status).toBe(403);
    fake.byOpop(id).status = 'confirmed_by_shop';
    const res = await request(app()).post(`${base}/orders/${id}/cancel`).set(host).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANCEL_NOT_ALLOWED');
  });

  it('a co-host sees stored state but not the approval link, and we never mint a token as the host', async () => {
    const id = await place();
    const res = await request(app()).get(`${base}/orders/${id}`).set(cohostEditor);
    expect(res.status).toBe(200);
    expect(res.body.order.nextAction).toBeNull();
    expect(res.body.order.isMine).toBe(false);
    expect(mcp.calls).toHaveLength(0);
    const list = await request(app()).get(`${base}/orders`).set(cohostEditor);
    expect(list.body.orders[0].nextAction).toBeNull();
  });

  it("an order id from another party is a 404", async () => {
    const id = await place();
    fake.byOpop(id).partyId = OTHER_PARTY_ID;
    expect((await request(app()).get(`${base}/orders/${id}`).set(host)).status).toBe(404);
  });

  it('serves the last known state when pizza-mcp is down', async () => {
    const id = await place();
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: (async () => { throw new TypeError('down'); }) as any }));
    const res = await request(app()).get(`${base}/orders/${id}`).set(host);
    expect(res.status).toBe(200);
    expect(res.body.stale).toBe(true);
    expect(res.body.order.status).toBe('awaiting_approval');
  });

  it('exposes pizza-mcp\'s call.deferred when present, and tolerates its absence', async () => {
    const id = await place();
    fake.byOpop(id).lastView = { call: { attempts: 1, deferred: { until: '2026-10-30T22:00:00Z', reason: 'outside_window', message: 'Shops are closed until 5pm' } }, timeline: [] };
    fake.byOpop(id).status = 'canceled'; // terminal: no poll overwrites the view
    const res = await request(app()).get(`${base}/orders/${id}`).set(host);
    expect(res.body.order.call.deferred.message).toBe('Shops are closed until 5pm');
    fake.byOpop(id).lastView = null;
    expect((await request(app()).get(`${base}/orders/${id}`).set(host)).body.order.call).toBeNull();
  });

  it('responses carry no key material or tokens', async () => {
    const id = await place();
    const res = await request(app()).get(`${base}/orders/${id}`).set(host);
    expect(JSON.stringify(res.body)).not.toMatch(/PRIVATE KEY|whsec_|Bearer /);
  });
});

describe('budget release, double counting, cancel button, settling (final review)', () => {
  const mk = (over: Record<string, unknown>) =>
    fake.db.pizzaOrder.create({
      data: { partyId: PARTY_ID, userId: 'host1', opopOrderId: `ord_${Math.random().toString(36).slice(2, 8)}`, tier: 'listing', shopId: 'pzl_osm_n1', shopName: "Sal's", status: 'needs_review', ...over },
    });
  const cart = (who: any = host) =>
    request(app()).post(`${base}/cart`).set(who).send({ shopId: 'pzl_osm_n1', recommendations: [rec], pickupAt: pickupAt() });

  it('H2: a shop quote over the limit (needs_review, nothing ordered) does not hold the budget or block /cart', async () => {
    setParty({ reimbursementCapUsd: 100 });
    await mk({ ceilingCents: 10000, confirmedTotalCents: 15000 });
    const res = await cart();
    expect(res.status).toBe(200);
    expect(res.body.remainingCapCents).toBe(10000);
  });

  it('H2: an IVR / voicemail needs_review (no total) holds nothing', async () => {
    await mk({ ceilingCents: 5376, confirmedTotalCents: null });
    const res = await cart();
    expect(res.status).toBe(200);
    expect(res.body.remainingCapCents).toBe(25000);
  });

  it('H2: a needs_review that reached a total inside the limit holds the budget and blocks, until the host releases it', async () => {
    const o = await mk({ ceilingCents: 5000, confirmedTotalCents: 4000 });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 4000);
    const c = await buildCart();
    expect((await placeFrom(c)).body.error?.code).toBe('ORDER_IN_PROGRESS');

    const rel = await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' });
    expect(rel.status).toBe(200);
    expect(rel.body.order).toMatchObject({ released: true });
    expect((await cart()).body.remainingCapCents).toBe(25000);
    const c2 = await buildCart();
    expect((await placeFrom(c2)).status).toBe(201);
  });

  it('settle: any host may release; a confirmed order cannot be released (only receipt_uploaded); bad actions 400', async () => {
    const o = await mk({ ceilingCents: 5000, confirmedTotalCents: 4000 });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(cohostEditor).send({ action: 'nothing_ordered' })).status).toBe(200);
    const conf = await mk({ status: 'confirmed_by_shop', ceilingCents: 5000, confirmedTotalCents: 4000 });
    const r = await request(app()).post(`${base}/orders/${conf.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' });
    expect(r.status).toBe(409);
    expect((await request(app()).post(`${base}/orders/${conf.opopOrderId}/settle`).set(host).send({ action: 'x' })).status).toBe(400);
    const live = await mk({ status: 'calling' });
    expect((await request(app()).post(`${base}/orders/${live.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' })).status).toBe(409);
    expect((await request(app()).post(`${base}/orders/${conf.opopOrderId}/settle`).set(stranger).send({ action: 'receipt_uploaded' })).status).toBe(404);
  });

  const receipt = (usd: string, createdAt = new Date(Date.now() + 60_000), over: Record<string, unknown> = {}) =>
    fake.docs.push({ id: `d${fake.docs.length}`, partyId: PARTY_ID, kind: 'receipt', source: 'upload', ocrAmount: usd ? { toString: () => usd } : null, isDuplicate: false, ineligible: false, createdAt, ...over });
  const settleReceipt = (id: string, who: any = host) => request(app()).post(`${base}/orders/${id}/settle`).set(who).send({ action: 'receipt_uploaded' });

  it('L3: a confirmed order plus its later uploaded receipt counts once ($46.02 twice left $7.96 of $100)', async () => {
    setParty({ reimbursementCapUsd: 100 });
    await mk({ status: 'confirmed_by_shop', ceilingCents: 5376, confirmedTotalCents: 4602 });
    receipt('46.02');
    expect((await cart()).body.remainingCapCents).toBe(10000 - 4602);
  });

  it('a receipt older than the order does not cover it, by matching or by the button', async () => {
    setParty({ reimbursementCapUsd: 100 });
    const o = await mk({ status: 'confirmed_by_shop', ceilingCents: 5376, confirmedTotalCents: 4602 });
    receipt('46.02', new Date(Date.now() - 86400_000));
    expect((await cart()).body.remainingCapCents).toBe(10000 - 4602 - 4602);
    const r = await settleReceipt(o.opopOrderId);
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('NO_RECEIPT_FOUND');
    expect(fake.byOpop(o.opopOrderId).receiptCoveredAt).toBeUndefined();
  });

  it('L3: an unrelated receipt does not hide a confirmed order; the button pairs them but frees only what the receipt is worth', async () => {
    setParty({ reimbursementCapUsd: 100 });
    const o = await mk({ status: 'confirmed_by_shop', ceilingCents: 5376, confirmedTotalCents: 4602 });
    receipt('12.00');
    expect((await cart()).body.remainingCapCents).toBe(10000 - 1200 - 4602);
    expect((await settleReceipt(o.opopOrderId)).status).toBe(200);
    expect((await cart()).body.remainingCapCents).toBe(10000 - 4602); // not 10000 - 1200
  });

  it('receipt_uploaded with no receipt at all is refused and the hard ceiling stop holds', async () => {
    const o = await mk({ status: 'confirmed_by_shop', ceilingCents: 20000, confirmedTotalCents: 20000 });
    expect((await settleReceipt(o.opopOrderId)).body.error.code).toBe('NO_RECEIPT_FOUND');
    const c = await buildCart();
    expect(c.remainingCapCents).toBe(5000);
    const res = await placeFrom(c, { allowAnother: true, policy: { ceilingCents: 20000, substitution: 'exact' } });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('SPEND_LIMIT_EXCEEDED');
  });

  it('a small receipt plus the button cannot lift the hard ceiling stop', async () => {
    const o = await mk({ status: 'confirmed_by_shop', ceilingCents: 20000, confirmedTotalCents: 20000 });
    receipt('1.00');
    expect((await settleReceipt(o.opopOrderId)).status).toBe(200);
    const c = await buildCart();
    expect(c.remainingCapCents).toBe(5000);
    const res = await placeFrom(c, { allowAnother: true, policy: { ceilingCents: 5001, substitution: 'exact' } });
    expect(res.body.error.code).toBe('SPEND_LIMIT_EXCEEDED');
  });

  it('a duplicate or ineligible receipt does not satisfy the button; one OCR has not read does, and frees nothing until it has an amount', async () => {
    const o = await mk({ status: 'confirmed_by_shop', ceilingCents: 20000, confirmedTotalCents: null });
    receipt('150.00', undefined, { isDuplicate: true });
    receipt('150.00', undefined, { ineligible: true });
    expect((await settleReceipt(o.opopOrderId)).status).toBe(409);
    receipt('');
    expect((await settleReceipt(o.opopOrderId)).status).toBe(200);
    expect((await cart()).body.remainingCapCents).toBe(25000 - 20000);
    fake.docs[fake.docs.length - 1].ocrAmount = { toString: () => '150.00' };
    expect((await cart()).body.remainingCapCents).toBe(25000 - 15000);
  });

  it('receipt_uploaded works when the shop gave no total: the receipt replaces the ceiling hold, a co-host may do it', async () => {
    setParty({ reimbursementCapUsd: 400 });
    const o = await mk({ status: 'confirmed_by_shop', ceilingCents: 20000, confirmedTotalCents: null });
    receipt('150.00');
    expect((await cart()).body.remainingCapCents).toBe(40000 - 15000 - 20000); // counted twice until it is settled
    expect((await settleReceipt(o.opopOrderId, cohostEditor)).body.order.receiptCovered).toBe(true);
    expect((await cart()).body.remainingCapCents).toBe(40000 - 15000);
  });

  it('the orders list marks a confirmed order covered once a receipt matched by itself', async () => {
    await mk({ status: 'confirmed_by_shop', ceilingCents: 5000, confirmedTotalCents: 4000 });
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0].receiptCovered).toBe(false);
    receipt('40.00');
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0].receiptCovered).toBe(true);
  });

  it('CAP_EXHAUSTED names the order holding the budget, on /cart, /orders and /config', async () => {
    const o = await mk({ status: 'needs_review', ceilingCents: 25000, confirmedTotalCents: 25000 });
    const res = await cart();
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'CAP_EXHAUSTED', existingOrderId: o.opopOrderId, existingStatus: 'needs_review' });
    const cfg = await request(app()).get(`${base}/config`).set(host);
    expect(cfg.body).toMatchObject({ blockedReason: 'CAP_EXHAUSTED', heldOrderId: o.opopOrderId });
  });

  it('CAP_EXHAUSTED from receipts alone names no order; a held order reaches a co-host too', async () => {
    receipt('250.00');
    const res = await cart();
    expect(res.body.error.code).toBe('CAP_EXHAUSTED');
    expect(res.body.error.existingOrderId).toBeUndefined();
    expect((await request(app()).get(`${base}/config`).set(host)).body.heldOrderId).toBeNull();
    fake.docs.length = 0;
    const o = await mk({ status: 'confirmed_by_shop', userId: 'host1', confirmedTotalCents: 25000 });
    expect((await cart(cohostEditor)).body.error.existingOrderId).toBe(o.opopOrderId);
    const seen = await request(app()).get(`${base}/orders/${o.opopOrderId}`).set(cohostEditor);
    expect(seen.body.order).toMatchObject({ isMine: false, status: 'confirmed_by_shop', receiptCovered: false });
  });

  it('exposes blocking: what the backend would refuse a new order over', async () => {
    await mk({ status: 'needs_review', ceilingCents: 5000, confirmedTotalCents: 4000 });
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0].blocking).toBe(true);
    fake.orders.clear();
    await mk({ status: 'refused' });
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0].blocking).toBe(false);
  });

  it('L3: the cancel button shows only where pizza-mcp accepts a cancel', async () => {
    const deferred = { call: { deferred: { until: '2026-11-02T17:00:00Z', reason: 'outside_call_window', message: 'later' } } };
    const cases = [
      ['calling', {}, false],
      ['calling', { call: { deferred: null } }, false],
      ['calling', deferred, true],
      ['awaiting_price_approval', {}, false],
      ['awaiting_price_approval', deferred, false],
      ['awaiting_approval', {}, true],
      ['approval_timeout', {}, true],
    ] as const;
    for (const [status, lastView, want] of cases) {
      fake.orders.clear();
      await mk({ status, lastView, nextAction: { type: 'open_url', url: 'https://x' } });
      const list = await request(app()).get(`${base}/orders`).set(host);
      expect(list.body.orders[0].cancelable, `${status} ${JSON.stringify(lastView)}`).toBe(want);
    }
  });

  it('a deferred dial can be canceled; a live call is refused here without asking pizza-mcp', async () => {
    const o = await mk({ status: 'calling', lastView: { call: { deferred: { until: 'x', reason: 'retry', message: 'm' } } } });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/cancel`).set(host).send({})).body.order.status).toBe('canceled');
    expect(mcp.calls.filter((c) => c.path.endsWith('/cancel'))).toHaveLength(1);
    mcp.calls.length = 0;
    const live = await mk({ status: 'calling', lastView: { call: { deferred: null } } });
    const res = await request(app()).post(`${base}/orders/${live.opopOrderId}/cancel`).set(host).send({});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CANCEL_NOT_ALLOWED');
    expect(mcp.calls).toHaveLength(0);
  });

  it("the dial starting first is pizza-mcp's 409: the host gets it and the order stays as it was", async () => {
    mcp = pizzaMcp({ 'POST /orders/:id/cancel': () => ({ status: 409, json: { code: 'CANCEL_NOT_ALLOWED', title: 't', detail: 'The call is starting', status: 409, retryable: false } }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const o = await mk({ status: 'calling', lastView: { call: { deferred: { until: 'x', reason: 'retry', message: 'm' } } } });
    const res = await request(app()).post(`${base}/orders/${o.opopOrderId}/cancel`).set(host).send({});
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'CANCEL_NOT_ALLOWED', message: 'The call is starting' });
    expect(fake.byOpop(o.opopOrderId).status).toBe('calling');
  });

  it('L2: a fresh confirmation keeps being polled (it can still be downgraded); an old one stops', async () => {
    const o = await mk({ status: 'confirmed_by_shop', confirmedAt: new Date() });
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0].settling).toBe(true);
    await request(app()).get(`${base}/orders/${o.opopOrderId}`).set(host);
    expect(mcp.calls.filter((c) => c.path.startsWith('/orders/'))).toHaveLength(1);
    mcp.calls.length = 0;
    fake.byOpop(o.opopOrderId).status = 'confirmed_by_shop';
    fake.byOpop(o.opopOrderId).confirmedAt = new Date(Date.now() - 3600_000);
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0].settling).toBe(false);
    await request(app()).get(`${base}/orders/${o.opopOrderId}`).set(host);
    expect(mcp.calls).toHaveLength(0);
  });

  it('real polls stop 20 minutes after entering confirmed_by_shop, and no poll moves lastEventAt', async () => {
    const t0 = new Date('2026-11-01T18:00:00Z').getTime();
    vi.useFakeTimers({ toFake: ['Date'], now: t0 });
    try {
      mcp = pizzaMcp({ 'GET /orders/:id': () => ({ json: opopOrder({ id: 'ord_poll', status: 'confirmed_by_shop' }, 3) }) });
      setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
      const o = await mk({ opopOrderId: 'ord_poll', status: 'calling', timelineLen: 2, lastEventAt: new Date(t0) });
      const poll = async () => {
        mcp.calls.length = 0;
        const res = await request(app()).get(`${base}/orders/${o.opopOrderId}`).set(host);
        return { polled: mcp.calls.length, settling: res.body.order.settling };
      };

      expect(await poll()).toEqual({ polled: 1, settling: true }); // the poll that sees the confirmation
      expect(fake.byOpop('ord_poll').confirmedAt.getTime()).toBe(t0);

      for (let m = 5; m < 20; m += 5) {
        vi.setSystemTime(t0 + m * 60_000);
        expect(await poll(), `${m} minutes`).toEqual({ polled: 1, settling: true });
        // a poll is applied but never stamps lastEventAt with this server's clock (only webhook created_at does)
        expect(fake.byOpop('ord_poll').lastEventAt.getTime()).toBe(t0);
      }
      expect(fake.byOpop('ord_poll').confirmedAt.getTime()).toBe(t0);

      vi.setSystemTime(t0 + 20 * 60_000);
      expect(await poll()).toEqual({ polled: 0, settling: false });
      vi.setSystemTime(t0 + 25 * 60_000);
      expect(await poll()).toEqual({ polled: 0, settling: false });
    } finally {
      vi.useRealTimers();
    }
  });

  it('confirmedAt clears on a downgrade and restarts if the order is confirmed again', async () => {
    const { applyOrderUpdate } = await import('../services/pizzaOrderSync.js');
    const o = await mk({ opopOrderId: 'ord_re', status: 'calling' });
    await applyOrderUpdate(fake.db as any, opopOrder({ id: 'ord_re', status: 'confirmed_by_shop' }, 2) as any);
    expect(fake.byOpop(o.opopOrderId).confirmedAt).toBeInstanceOf(Date);
    await applyOrderUpdate(fake.db as any, opopOrder({ id: 'ord_re', status: 'needs_review' }, 3) as any);
    expect(fake.byOpop(o.opopOrderId).confirmedAt).toBeNull();
  });

  const oc = (nothing_ordered: boolean, reason: string) => ({ nothing_ordered, reason, message: `msg ${reason}` });
  const withOutcome = (o: ReturnType<typeof oc> | null) => ({ lastView: { outcome: o, call: {}, timeline: [] } });

  it('outcome.nothing_ordered === true holds no budget and offers no release, even with a total inside the limit', async () => {
    const o = await mk({ ceilingCents: 5000, confirmedTotalCents: 4000, ...withOutcome(oc(true, 'transcript_mismatch')) });
    expect((await cart()).body.remainingCapCents).toBe(25000);
    const list = await request(app()).get(`${base}/orders`).set(host);
    expect(list.body.orders[0]).toMatchObject({ releasable: false, outcome: { nothing_ordered: true, reason: 'transcript_mismatch' } });
    expect((await placeFrom(await buildCart())).status).toBe(201);
    expect(o.opopOrderId).toBeTruthy();
  });

  it('outcome.nothing_ordered === false on needs_review holds the budget and blocks, even with no total; the host releases it after checking', async () => {
    const o = await mk({ ceilingCents: 5376, confirmedTotalCents: null, ...withOutcome(oc(false, 'shop_answered_no_order')) });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 5376);
    expect((await placeFrom(await buildCart())).body.error?.code).toBe('ORDER_IN_PROGRESS');
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0].releasable).toBe(true);
    await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' });
    expect((await cart()).body.remainingCapCents).toBe(25000);
    expect((await placeFrom(await buildCart())).status).toBe(201);
  });

  it('ambiguous_dial (an order may exist) keeps the one-order block even on an unreachable status, until settled', async () => {
    const o = await mk({ status: 'unreachable', ceilingCents: 5000, ...withOutcome(oc(false, 'ambiguous_dial')) });
    const res = await placeFrom(await buildCart());
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('ORDER_IN_PROGRESS');
    const item = (await request(app()).get(`${base}/orders`).set(host)).body.orders[0];
    expect(item).toMatchObject({ releasable: true, outcome: { reason: 'ambiguous_dial', nothing_ordered: false } });
    await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' });
    expect((await placeFrom(await buildCart())).status).toBe(201);
  });

  it('approval_timeout with nothing_ordered true is still live: it holds budget, blocks and cannot be released', async () => {
    const o = await mk({ status: 'approval_timeout', ceilingCents: 15000, confirmedTotalCents: 18000, nextAction: { type: 'open_url', url: 'https://x' }, ...withOutcome(oc(true, 'price_approval_timeout')) });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 18000);
    expect((await placeFrom(await buildCart())).body.error?.code).toBe('ORDER_IN_PROGRESS');
    const item = (await request(app()).get(`${base}/orders`).set(host)).body.orders[0];
    expect(item).toMatchObject({ releasable: false, cancelable: true, blocking: true });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' })).status).toBe(409);
  });

  it('a refused order with nothing_ordered true stays free; unknown or malformed outcome falls back to the old rules', async () => {
    await mk({ status: 'refused', ceilingCents: 5000, ...withOutcome(oc(true, 'refused_ai')) });
    await mk({ status: 'needs_review', ceilingCents: 5000, confirmedTotalCents: null, lastView: { outcome: { nothing_ordered: 'maybe' } } }); // malformed -> unknown -> IVR rule: holds nothing
    expect((await cart()).body.remainingCapCents).toBe(25000);
    await mk({ status: 'needs_review', ceilingCents: 5000, confirmedTotalCents: 4000, lastView: {} }); // unknown + total in limit: holds
    expect((await cart()).body.remainingCapCents).toBe(25000 - 4000);
  });

  // pizza-mcp a0e10eb's reasons, plus one this code has never heard of: only nothing_ordered may decide.
  it.each([
    ['canceled', 'outcome_unclear'],
    ['unreachable', 'outcome_unclear'],
    ['needs_review', 'outcome_unclear'],
    ['needs_review', 'possible_opt_out'],
    ['canceled', 'price_approval_dropped'],
    ['unreachable', 'a_reason_added_next_year'],
    ['refused', 'a_reason_added_next_year'],
  ])('%s with %s and nothing_ordered false blocks, holds and can be released by any host', async (status, reason) => {
    const o = await mk({ status, ceilingCents: 5000, ...withOutcome(oc(false, reason)) });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 5000);
    expect((await placeFrom(await buildCart())).body.error?.code).toBe('ORDER_IN_PROGRESS');
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0]).toMatchObject({ blocking: true, releasable: true, released: false });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(cohostEditor).send({ action: 'nothing_ordered' })).body.order).toMatchObject({ released: true, blocking: false, releasable: false });
    expect((await cart()).body.remainingCapCents).toBe(25000);
    expect((await placeFrom(await buildCart())).status).toBe(201);
  });

  it('an unknown reason with nothing_ordered true is free: the boolean decides, not a list', async () => {
    await mk({ status: 'unreachable', ceilingCents: 5000, ...withOutcome(oc(true, 'a_reason_added_next_year')) });
    expect((await cart()).body.remainingCapCents).toBe(25000);
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0]).toMatchObject({ blocking: false, releasable: false });
  });

  it.each([true, false])('approval_timeout with nothing_ordered %s is never released: it holds, blocks and the settle is refused', async (no) => {
    const o = await mk({ status: 'approval_timeout', ceilingCents: 5000, nextAction: { type: 'open_url', url: 'https://x' }, ...withOutcome(oc(no, no ? 'price_approval_timeout' : 'price_approval_dropped')) });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 5000);
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0]).toMatchObject({ blocking: true, releasable: false, cancelable: true });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' })).status).toBe(409);
  });

  it('a confirmed order with a recorded opt-out stays confirmed, holding and not releasable', async () => {
    await mk({ status: 'confirmed_by_shop', confirmedTotalCents: 4000, confirmedAt: new Date(0), lastView: { outcome: null, call: {}, timeline: [] } });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 4000);
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0]).toMatchObject({ blocking: true, releasable: false, outcome: null });
  });

  it('a stuck calling order (no deferred dial) stays live for its whole hour: it holds, and cannot be canceled or released here', async () => {
    const o = await mk({ status: 'calling', ceilingCents: 5000, lastView: { outcome: null, call: { deferred: null }, timeline: [{ at: new Date(Date.now() - 59 * 60_000).toISOString(), status: 'calling' }] } });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 5000);
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0]).toMatchObject({ blocking: true, releasable: false, cancelable: false });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'nothing_ordered' })).status).toBe(409);
  });

  it('a transient deferral with a not_dialed row in attempts is a cancelable live order, passed through as is', async () => {
    await mk({ status: 'calling', ceilingCents: 5000, lastView: { outcome: null, call: { attempts: 2, last_outcome: 'not_dialed', deferred: { until: '2026-11-01T12:05:00Z', reason: 'transient', message: 'We hit a temporary problem.' } }, timeline: [] } });
    expect((await request(app()).get(`${base}/orders`).set(host)).body.orders[0]).toMatchObject({ blocking: true, cancelable: true, call: { deferred: { reason: 'transient' } } });
  });

  it('a canceled order that may exist takes the real receipt: counted once, still blocking until a host settles it', async () => {
    const o = await mk({ status: 'canceled', ceilingCents: 5000, createdAt: new Date(Date.now() - 3600_000), ...withOutcome(oc(false, 'outcome_unclear')) });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'receipt_uploaded' })).body.error.code).toBe('NO_RECEIPT_FOUND');
    receipt('30.00');
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'receipt_uploaded' })).body.order).toMatchObject({ receiptCovered: true, blocking: true });
    expect((await cart()).body.remainingCapCents).toBe(25000 - 3000);
  });

  it('receipt_uploaded is still refused on an ended order pizza-mcp is sure about', async () => {
    const o = await mk({ status: 'canceled', ...withOutcome(oc(true, 'canceled')) });
    expect((await request(app()).post(`${base}/orders/${o.opopOrderId}/settle`).set(host).send({ action: 'receipt_uploaded' })).status).toBe(409);
  });
});

describe('pizza-mcp 9ad5364', () => {
  const optOut422 = () => ({
    status: 422,
    json: {
      code: 'CALLS_NOT_AVAILABLE_HERE',
      title: 'Phone orders are not available for this shop',
      status: 422,
      detail: 'The shop may have asked not to be called, so calls to it are paused until someone has checked.',
      details: { reasons: ['possible_opt_out'] },
      retryable: false,
    },
  });

  it('place_order 422 CALLS_NOT_AVAILABLE_HERE (possible_opt_out): truthful copy with a way forward, no row, nothing blocks another shop', async () => {
    mcp = pizzaMcp({ 'POST /orders': (c: any) => (c.body.quote_id.includes('cart_1') ? optOut422() : { status: 201, json: { order: opopOrder({ id: 'ord_ok', pizzeria_id: 'pzl_osm_n2', status: 'awaiting_approval' }), next_action: null } }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const res = await placeFrom(await buildCart());
    expect(res.status).toBe(422);
    expect(res.body.error).toMatchObject({ code: 'CALLS_NOT_AVAILABLE_HERE', shopId: 'pzl_osm_n1' });
    expect(res.body.error.message).toBe(
      "We can't call Sal's for you right now. The shop may have asked not to be called, so calls to it are paused until someone has checked. Nothing was ordered. Pick another pizzeria, or call Sal's yourself."
    );
    expect(res.body.error.opop.details.reasons).toEqual(['possible_opt_out']);
    expect(fake.orders.size).toBe(0);
    const cfg = await request(app()).get(`${base}/config`).set(host);
    expect(cfg.body).toMatchObject({ remainingCapCents: 25000, blockedReason: null });
    // another pizzeria, no "allowAnother" needed
    const other = await placeFrom(await buildCart({}, host, 'pzl_osm_n2'));
    expect(other.status).toBe(201);
  });

  it('an order whose number was quarantined before the dial (unreachable, not_dialed, nothing_ordered true) holds and blocks nothing', async () => {
    await fake.db.pizzaOrder.create({
      data: {
        partyId: PARTY_ID, userId: 'host1', opopOrderId: 'ord_nd', tier: 'listing', shopId: 'pzl_osm_n1', shopName: "Sal's", status: 'unreachable', ceilingCents: 5000,
        lastView: { outcome: { nothing_ordered: true, reason: 'not_dialed', message: 'We did not call the shop: phone ordering is not available for it right now.' }, call: { attempts: 0, last_outcome: 'not_dialed' }, timeline: [] },
      },
    });
    const item = (await request(app()).get(`${base}/orders`).set(host)).body.orders[0];
    expect(item).toMatchObject({ blocking: false, releasable: false, outcome: { nothing_ordered: true, reason: 'not_dialed' } });
    expect((await request(app()).get(`${base}/config`).set(host)).body.remainingCapCents).toBe(25000);
    expect((await placeFrom(await buildCart())).status).toBe(201);
  });

  it('confirmed_by_shop downgraded to needs_review (nothing_ordered false) on the settling poll: draft removed, holds the ceiling, blocks, releasable', async () => {
    const c = await buildCart();
    const placed = await placeFrom(c);
    const id = placed.body.order.opopOrderId;
    const confirmed = opopOrder({ id, status: 'confirmed_by_shop', call: { attempts: 1, last_outcome: 'confirmed', shop_total_cents: 18000, ready_at_text: '6:30', changes: [], transcript_available: true } }, 3);
    mcp = pizzaMcp({ 'GET /orders/:id': () => ({ json: confirmed }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    expect((await request(app()).get(`${base}/orders/${id}`).set(host)).body.order).toMatchObject({ status: 'confirmed_by_shop', settling: true });
    expect(fake.docs).toHaveLength(1);
    const review = opopOrder({ id, status: 'needs_review', outcome: { nothing_ordered: false, reason: 'transcript_mismatch', message: 'The shop may have taken it.' }, call: confirmed.call }, 4);
    mcp = pizzaMcp({ 'GET /orders/:id': () => ({ json: review }) });
    setPizzaMcpClientForTests(new PizzaMcpClient({ fetchImpl: mcp.fetchImpl }));
    const g = (await request(app()).get(`${base}/orders/${id}`).set(host)).body.order;
    expect(g).toMatchObject({ status: 'needs_review', blocking: true, releasable: true, payoutDocumentId: null, outcome: { nothing_ordered: false } });
    expect(fake.docs).toHaveLength(0);
    expect((await request(app()).get(`${base}/config`).set(host)).body.remainingCapCents).toBe(25000 - 18000);
    expect((await placeFrom(await buildCart())).body.error?.code).toBe('ORDER_IN_PROGRESS');
  });
});
