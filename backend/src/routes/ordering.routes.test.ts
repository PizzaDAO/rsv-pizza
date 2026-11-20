import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const m = vi.hoisted(() => ({ editors: new Set<string>() }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-id']) return res.status(401).json({ error: 'unauth' });
    req.userId = req.headers['x-user-id'];
    next();
  },
}));
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: async (_p: string, userId?: string) => !!userId && m.editors.has(userId),
}));

import router from './ordering.routes.js';
import { errorHandler } from '../middleware/error.js';
import { clearPizzeriaCache, searchPizzerias, PizzeriaSearchError } from '../lib/pizzeriaSearch.js';

const app = () => {
  const a = express();
  a.use(express.json());
  a.use('/api/ordering', router);
  a.use(errorHandler);
  return a;
};

const PARTY = '11111111-2222-3333-4444-555555555555';
const order = {
  partyId: PARTY,
  locationId: 'LOC123',
  customerName: 'Host',
  fulfillmentType: 'PICKUP',
  items: [{ name: 'Cheese', quantity: 2, size: 'Large', toppings: ['basil'], dietaryNotes: [], priceEstimate: 18 }],
};

const fetchMock = vi.fn();
const json = (data: any, ok = true, status = 200) => ({ ok, status, json: async () => data });

beforeEach(() => {
  m.editors.clear();
  m.editors.add('host');
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  clearPizzeriaCache();
  delete process.env.MAP_PROVIDER;
  delete process.env.GOOGLE_PLACES_API_KEY;
  delete process.env.BLAND_API_KEY;
  process.env.SQUARE_ACCESS_TOKEN = 'sq-token';
  delete process.env.SQUARE_ENVIRONMENT;
});
afterEach(() => vi.unstubAllGlobals());

describe('POST /api/ordering/search-pizzerias (public)', () => {
  it('rejects missing / out-of-range / non-numeric input', async () => {
    for (const body of [{}, { lat: '40', lng: -74 }, { lat: 91, lng: 0 }, { lat: 1, lng: 200 }, { lat: 1, lng: 1, radius: 10_000_000 }, { lat: 1, lng: 1, radius: 'x' }]) {
      const r = await request(app()).post('/api/ordering/search-pizzerias').send(body);
      expect(r.status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('happy path (osm): maps Overpass elements, adds phone options, caches', async () => {
    process.env.BLAND_API_KEY = 'b';
    fetchMock.mockResolvedValue(
      json({
        elements: [
          { type: 'node', id: 1, lat: 40.0, lon: -74.0, tags: { name: 'Joe', phone: '+1555', 'addr:street': 'Main', 'addr:housenumber': '1' } },
          { type: 'node', id: 2, lat: 40.0, lon: -74.0, tags: {} }, // unnamed: dropped
        ],
      })
    );
    const r = await request(app()).post('/api/ordering/search-pizzerias').send({ lat: 40, lng: -74 });
    expect(r.status).toBe(200);
    expect(r.body.pizzerias).toHaveLength(1);
    expect(r.body.pizzerias[0]).toMatchObject({ id: 'osm/node/1', name: 'Joe', address: '1 Main' });
    expect(r.body.pizzerias[0].orderingOptions.map((o: any) => o.provider)).toEqual(['ai_phone', 'phone']);
    expect(fetchMock.mock.calls[0][0]).toContain('overpass');

    await request(app()).post('/api/ordering/search-pizzerias').send({ lat: 40, lng: -74 });
    expect(fetchMock).toHaveBeenCalledTimes(1); // cached
  });

  it('google provider without a key fails closed with 503', async () => {
    process.env.MAP_PROVIDER = 'google';
    const r = await request(app()).post('/api/ordering/search-pizzerias').send({ lat: 40, lng: -74 });
    expect(r.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('google provider happy path sends the key server-side', async () => {
    process.env.MAP_PROVIDER = 'google';
    process.env.GOOGLE_PLACES_API_KEY = 'gk';
    fetchMock.mockResolvedValue(
      json({ places: [{ id: 'p1', displayName: { text: 'Pie' }, location: { latitude: 40, longitude: -74 }, rating: 4.5, userRatingCount: 100, priceLevel: 'PRICE_LEVEL_MODERATE' }] })
    );
    const r = await request(app()).post('/api/ordering/search-pizzerias').send({ lat: 40, lng: -74, radius: 3000 });
    expect(r.status).toBe(200);
    expect(r.body.pizzerias[0]).toMatchObject({ id: 'p1', name: 'Pie', priceLevel: 2 });
    expect(fetchMock.mock.calls[0][1].headers['X-Goog-Api-Key']).toBe('gk');
  });

  it('upstream timeout is a 504 without upstream text', async () => {
    fetchMock.mockImplementation((_u: string, init: any) =>
      new Promise((_res, rej) => init.signal.addEventListener('abort', () => rej(Object.assign(new Error('secret upstream'), { name: 'AbortError' }))))
    );
    vi.useFakeTimers();
    try {
      const p = searchPizzerias(42, -74).then(
        () => null,
        (e) => e
      );
      await vi.advanceTimersByTimeAsync(13_000);
      const err = await p;
      expect(err).toBeInstanceOf(PizzeriaSearchError);
      expect(err.status).toBe(504);
      expect(err.message).not.toContain('secret');
    } finally {
      vi.useRealTimers();
    }
  });

  it('upstream failure is a 502 without leaking provider details', async () => {
    fetchMock.mockResolvedValue(json({}, false, 500));
    const r = await request(app()).post('/api/ordering/search-pizzerias').send({ lat: 41, lng: -74 });
    expect(r.status).toBe(502);
  });
});

describe('POST /api/ordering/square-order', () => {
  const post = (body: any, user: string | null = 'host') => {
    const r = request(app()).post('/api/ordering/square-order');
    if (user) r.set('x-user-id', user);
    return r.send(body);
  };

  it('requires sign-in', async () => {
    expect((await post(order, null)).status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires party editor access', async () => {
    const r = await post(order, 'stranger');
    expect(r.status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('validates input', async () => {
    const cases: any[] = [
      { ...order, partyId: 'nope' },
      { ...order, locationId: '../x' },
      { ...order, fulfillmentType: 'TELEPORT' },
      { ...order, customerName: '' },
      { ...order, customerEmail: 'not-an-email' },
      { ...order, fulfillmentType: 'DELIVERY' }, // no address
      { ...order, items: [] },
      { ...order, items: [{ ...order.items[0], quantity: 0 }] },
      { ...order, items: [{ ...order.items[0], quantity: 1.5 }] },
      { ...order, items: [{ ...order.items[0], priceEstimate: -1 }] },
      { ...order, items: [{ ...order.items[0], priceEstimate: 100000 }] },
      { ...order, items: Array(21).fill(order.items[0]) },
    ];
    for (const c of cases) expect((await post(c)).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('503 when Square is not configured', async () => {
    delete process.env.SQUARE_ACCESS_TOKEN;
    const r = await post(order);
    expect(r.status).toBe(503);
  });

  it('happy path creates the order and a payment link (sandbox by default)', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ order: { id: 'ord1' } }))
      .mockResolvedValueOnce(json({ payment_link: { url: 'https://sq.link/x' } }));
    const r = await post(order);
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ success: true, orderId: 'ord1', checkoutUrl: 'https://sq.link/x' });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://connect.squareupsandbox.com/v2/orders');
    expect(init.headers.Authorization).toBe('Bearer sq-token');
    const sent = JSON.parse(init.body);
    expect(sent.order.location_id).toBe('LOC123');
    expect(sent.order.line_items[0].base_price_money).toEqual({ amount: 1800, currency: 'USD' });
  });

  it('surfaces a Square order failure as 400', async () => {
    fetchMock.mockResolvedValueOnce(json({ errors: [{ detail: 'bad location' }] }, false, 400));
    const r = await post(order);
    expect(r.status).toBe(400);
    expect(r.body).toEqual({ success: false, error: 'bad location' });
  });

  it('still succeeds when only the payment link fails', async () => {
    fetchMock.mockResolvedValueOnce(json({ order: { id: 'ord2' } })).mockResolvedValueOnce(json({}, false, 500));
    const r = await post(order);
    expect(r.status).toBe(200);
    expect(r.body.orderId).toBe('ord2');
    expect(r.body.checkoutUrl).toBeUndefined();
  });
});
