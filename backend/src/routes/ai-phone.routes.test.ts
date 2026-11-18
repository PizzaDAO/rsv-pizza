import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

const PARTY_ID = '11111111-1111-4111-8111-111111111111';
const PAN = '4000009990000001';
const CVC = '739';

const m = vi.hoisted(() => ({
  calls: [] as any[],
  editors: new Set<string>(),
  count: 0,
}));

vi.mock('../config/database.js', () => ({
  prisma: {
    aIPhoneCall: {
      create: async ({ data }: any) => {
        const row = { id: `call_${m.calls.length + 1}`, createdAt: new Date(), ...data };
        m.calls.push(row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = m.calls.find((c) => c.id === where.id);
        Object.assign(row, data);
        return row;
      },
      count: async () => m.count,
      findUnique: async ({ where }: any) =>
        m.calls.find((c) => (where.id ? c.id === where.id : c.callId === where.callId)) ?? null,
    },
    order: { create: async () => ({ id: 'order_1' }) },
  },
}));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (req: any, res: any, next: any) => {
    if (!req.headers['x-user-id']) return res.status(401).json({ error: 'No token provided' });
    req.userId = req.headers['x-user-id'];
    req.userEmail = req.headers['x-user-email'];
    next();
  },
}));
vi.mock('../helpers/partyAccess.js', () => ({
  canUserEditParty: async (_partyId: string, userId?: string) => !!userId && m.editors.has(userId),
}));

import router from './ai-phone.routes.js';
import { errorHandler } from '../middleware/error.js';
import { setStripeClientForTests } from '../lib/stripeClient.js';

const host = { 'x-user-id': 'host1', 'x-user-email': 'host@example.org' };
const stranger = { 'x-user-id': 'bad1', 'x-user-email': 'bad@example.org' };

function app() {
  const a = express();
  a.use('/api/ai-phone/webhook', express.raw({ type: () => true }));
  a.use(express.json());
  a.use('/api/ai-phone', router);
  a.use(errorHandler);
  return a;
}

const items = [
  { name: 'Cheese', quantity: 2, size: '16" Large', toppings: [], dietaryNotes: [] },
  { name: 'Veggie', quantity: 1, size: '16" Large', toppings: ['peppers'], dietaryNotes: ['vegetarian'] },
];
const body = (over: Record<string, unknown> = {}) => ({
  partyId: PARTY_ID,
  pizzeriaName: "Sal's",
  pizzeriaPhone: '+1 (555) 010-0000',
  items,
  customerName: 'Alex',
  customerPhone: '555-010-1111',
  fulfillmentType: 'pickup',
  ...over,
});

let blandRequests: Array<{ url: string; body: any }> = [];
let blandCallDetails: any = {};
let stripe: any;

beforeEach(() => {
  m.calls = [];
  m.editors = new Set(['host1']);
  m.count = 0;
  blandRequests = [];
  blandCallDetails = {};
  process.env.BLAND_API_KEY = 'bland-test';
  process.env.STRIPE_ISSUING_CARDHOLDER_ID = 'ich_test';
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: any) => {
    blandRequests.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    if (url.endsWith('/calls') && init?.method === 'POST') {
      return new Response(JSON.stringify({ call_id: `bland_${blandRequests.length}`, status: 'queued' }), { status: 200 });
    }
    if (url.endsWith('/recording')) {
      return new Response('AUDIO', { status: 200, headers: { 'Content-Type': 'audio/mpeg' } });
    }
    return new Response(JSON.stringify(blandCallDetails), { status: 200 });
  }));
  stripe = {
    issuing: {
      cards: {
        list: vi.fn(async () => ({ data: [] })),
        create: vi.fn(async () => ({ id: 'ic_1' })),
        retrieve: vi.fn(async () => ({ id: 'ic_1', number: PAN, cvc: CVC, exp_month: 4, exp_year: 2029, last4: '0001' })),
        update: vi.fn(async () => ({})),
      },
    },
  };
  setStripeClientForTests(stripe);
});
afterEach(() => {
  setStripeClientForTests(null);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.BLAND_WEBHOOK_SECRET;
});

describe('POST /api/ai-phone/initiate', () => {
  it('401 without login', async () => {
    const res = await request(app()).post('/api/ai-phone/initiate').send(body());
    expect(res.status).toBe(401);
    expect(blandRequests).toHaveLength(0);
  });

  it('403 for a user who cannot edit the party (no call, no card)', async () => {
    const res = await request(app()).post('/api/ai-phone/initiate').set(stranger).send(body({ payWithCard: true }));
    expect(res.status).toBe(403);
    expect(blandRequests).toHaveLength(0);
    expect(stripe.issuing.cards.create).not.toHaveBeenCalled();
    expect(m.calls).toHaveLength(0);
  });

  it('owner: places the call without a card by default', async () => {
    const res = await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ estimatedTotal: 99_999_999 }));
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(stripe.issuing.cards.create).not.toHaveBeenCalled();
    expect(blandRequests[0].body.metadata.hasPaymentCard).toBe(false);
    // client-sent estimate ignored: 3 pizzas * $18 * 1.2
    expect(m.calls[0].estimatedTotal).toBe(6480);
  });

  it('owner + payWithCard: server-decided all-time limit, card goes to Bland, never to the browser', async () => {
    const res = await request(app())
      .post('/api/ai-phone/initiate')
      .set(host)
      .send(body({ payWithCard: true, spendingLimit: 10_000_000 }));
    expect(res.status).toBe(200);

    const createArgs = stripe.issuing.cards.create.mock.calls[0][0];
    expect(createArgs.spending_controls.spending_limits).toEqual([{ amount: 6480, interval: 'all_time' }]);
    expect(createArgs.metadata).toMatchObject({ userId: 'host1', partyId: PARTY_ID });

    const bland = blandRequests[0].body;
    expect(bland.task).toContain('4000 0099 9000 0001');
    expect(bland.metadata).toMatchObject({ hasPaymentCard: true, virtualCardId: 'ic_1' });

    const text = JSON.stringify(res.body);
    expect(text).not.toContain(PAN);
    expect(text).not.toContain(CVC);
  });

  it('caps card orders by pizza count', async () => {
    const res = await request(app())
      .post('/api/ai-phone/initiate')
      .set(host)
      .send(body({ payWithCard: true, items: [{ ...items[0], quantity: 50 }, { ...items[1], quantity: 1 }] }));
    expect(res.status).toBe(400);
    expect(stripe.issuing.cards.create).not.toHaveBeenCalled();
  });

  it('enforces the per-user daily card quota', async () => {
    stripe.issuing.cards.list.mockResolvedValue({
      data: [1, 2, 3].map((i) => ({ id: `ic_${i}`, metadata: { source: 'rsvpizza-ai-phone', userId: 'host1' } })),
    });
    const res = await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ payWithCard: true }));
    expect(res.status).toBe(429);
    expect(blandRequests).toHaveLength(0);
  });

  it('deactivates the card when Bland refuses the call', async () => {
    (globalThis.fetch as any).mockImplementationOnce(async () => new Response(JSON.stringify({ message: 'nope' }), { status: 400 }));
    const res = await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ payWithCard: true }));
    expect(res.status).toBe(500);
    expect(stripe.issuing.cards.update).toHaveBeenCalledWith('ic_1', { status: 'inactive' });
  });

  it('503 (not configured) when BLAND_API_KEY is unset, before any DB write', async () => {
    delete process.env.BLAND_API_KEY;
    const res = await request(app()).post('/api/ai-phone/initiate').set(host).send(body());
    expect(res.status).toBe(503);
    expect(res.body.error.code).toBe('BLAND_NOT_CONFIGURED');
    expect(m.calls).toHaveLength(0);
  });

  it('503 for card payment when Stripe Issuing is not configured, before any call or row', async () => {
    delete process.env.STRIPE_ISSUING_CARDHOLDER_ID;
    const res = await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ payWithCard: true }));
    expect(res.status).toBe(503);
    expect(m.calls).toHaveLength(0);
    expect(blandRequests).toHaveLength(0);
  });

  it('rate-limits calls per party', async () => {
    m.count = 10;
    const res = await request(app()).post('/api/ai-phone/initiate').set(host).send(body());
    expect(res.status).toBe(429);
    expect(blandRequests).toHaveLength(0);
  });

  it('validates the phone number and items', async () => {
    expect((await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ pizzeriaPhone: 'call me' }))).status).toBe(400);
    expect((await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ items: [{ ...items[0], quantity: 0 }] }))).status).toBe(400);
    expect((await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ partyId: 'x' }))).status).toBe(400);
  });
});

describe('GET /api/ai-phone/calls/:ref/live and /recording', () => {
  async function placeCall(payWithCard: boolean) {
    await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ payWithCard }));
    return m.calls[0];
  }

  it('401 without login, 403 for a stranger', async () => {
    const call = await placeCall(false);
    expect((await request(app()).get(`/api/ai-phone/calls/${call.callId}/live`)).status).toBe(401);
    expect((await request(app()).get(`/api/ai-phone/calls/${call.callId}/live`).set(stranger)).status).toBe(403);
    expect((await request(app()).get(`/api/ai-phone/calls/${call.id}/recording`).set(stranger)).status).toBe(403);
  });

  it('owner sees a card-paid call with the card masked and no recording', async () => {
    const call = await placeCall(true);
    blandCallDetails = {
      status: 'completed',
      concatenated_transcript: `assistant: Card number 4000 0099 9000 0001, expiration 04 slash 29, security code ${CVC}.`,
      metadata: { hasPaymentCard: true, virtualCardId: 'ic_1' },
    };
    const res = await request(app()).get(`/api/ai-phone/calls/${call.callId}/live`).set(host);
    expect(res.status).toBe(200);
    expect(res.body.transcript).not.toContain('0001');
    expect(res.body.transcript).not.toContain(CVC);
    expect(res.body.transcript).not.toMatch(/04 slash 29/);
    expect(res.body.recordingAvailable).toBe(false);

    const rec = await request(app()).get(`/api/ai-phone/calls/${call.id}/recording`).set(host);
    expect(rec.status).toBe(404);
  });

  it('owner gets the recording of a call without a card', async () => {
    const call = await placeCall(false);
    blandCallDetails = { status: 'completed', concatenated_transcript: 'hi', metadata: { hasPaymentCard: false } };
    const live = await request(app()).get(`/api/ai-phone/calls/${call.id}/live`).set(host);
    expect(live.body).toMatchObject({ status: 'completed', transcript: 'hi', recordingAvailable: true });
    const rec = await request(app()).get(`/api/ai-phone/calls/${call.id}/recording`).set(host);
    expect(rec.status).toBe(200);
    expect(rec.headers['content-type']).toContain('audio/mpeg');
  });

  it('404 for an unknown call', async () => {
    expect((await request(app()).get('/api/ai-phone/calls/nope/live').set(host)).status).toBe(404);
  });
});

describe('POST /api/ai-phone/:id/retry', () => {
  it('403 when the owner can no longer edit the party', async () => {
    await request(app()).post('/api/ai-phone/initiate').set(host).send(body());
    m.calls[0].status = 'failed';
    m.editors.clear();
    const res = await request(app()).post(`/api/ai-phone/${m.calls[0].id}/retry`).set(host);
    expect(res.status).toBe(403);
  });
});

describe('POST /api/ai-phone/webhook', () => {
  const SECRET = 'webhook-secret-for-tests-0123456789abcdef';

  it('rejects an unsigned webhook and leaves the call untouched', async () => {
    process.env.BLAND_WEBHOOK_SECRET = SECRET;
    await request(app()).post('/api/ai-phone/initiate').set(host).send(body());
    const call = m.calls[0];
    const payload = JSON.stringify({ call_id: call.callId, status: 'completed', completed: true, analysis: { order_confirmed: true, order_total: '$1' } });
    const res = await request(app()).post('/api/ai-phone/webhook').set('Content-Type', 'application/json').send(payload);
    expect(res.status).toBe(401);
    expect(call.status).toBe('initiated');
    expect(call.orderConfirmed).toBeUndefined();
  });

  it('accepts a signed webhook and strips card data before storing', async () => {
    process.env.BLAND_WEBHOOK_SECRET = SECRET;
    await request(app()).post('/api/ai-phone/initiate').set(host).send(body({ payWithCard: true }));
    const call = m.calls[0];
    const payload = JSON.stringify({
      call_id: call.callId,
      status: 'completed',
      completed: true,
      recording_url: 'https://bland.example.org/rec.mp3',
      concatenated_transcript: `Card number 4000 0099 9000 0001 code ${CVC}`,
      metadata: { hasPaymentCard: true, virtualCardId: 'ic_1' },
    });
    const sig = crypto.createHmac('sha256', SECRET).update(payload).digest('hex');
    const res = await request(app())
      .post('/api/ai-phone/webhook')
      .set('Content-Type', 'application/json')
      .set('X-Webhook-Signature', sig)
      .send(payload);
    expect(res.status).toBe(200);
    expect(call.status).toBe('completed');
    expect(call.transcript).not.toContain('0001');
    expect(call.transcript).not.toContain(CVC);
    expect(call.recordingUrl).toBeNull();
  });
});
