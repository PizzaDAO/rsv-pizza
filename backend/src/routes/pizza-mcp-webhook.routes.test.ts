import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeFakeDb, opopOrder, PARTY_ID, FakeDb } from '../testutil/pizzaFakes.js';

const m = vi.hoisted(() => ({ fake: null as any, notify: vi.fn() }));
vi.mock('../config/database.js', () => ({ prisma: new Proxy({}, { get: (_t, k) => m.fake.db[k] }) }));
vi.mock('../services/pizzaOrderNotify.js', () => ({ notifyHostOfOrder: m.notify }));

import router from './pizza-mcp-webhook.routes.js';
import { errorHandler } from '../middleware/error.js';
import { signWebhook } from '../lib/webhookSignature.js';

const SECRET = 'whsec_test_secret_0123456789abcdef0123456789';
const app = () => {
  const a = express();
  a.use('/api/pizza-mcp', router);
  a.use(express.json());
  a.use(errorHandler);
  return a;
};

let n = 0;
function delivery(order: any, opts: { id?: string; secret?: string; ts?: number; createdAt?: string; raw?: string; clientRef?: any } = {}) {
  const id = opts.id ?? `evt_${++n}`;
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const raw =
    opts.raw ??
    JSON.stringify({
      id,
      type: 'order.updated',
      created_at: opts.createdAt ?? new Date().toISOString(),
      client_ref: opts.clientRef ?? { party_id: PARTY_ID, rsvp_user_id: 'u1' },
      order,
    });
  return { id, ts, raw, sig: signWebhook(opts.secret ?? SECRET, id, ts, raw) };
}
const post = (d: ReturnType<typeof delivery>, headers: Record<string, string> = {}) =>
  request(app())
    .post('/api/pizza-mcp/webhook')
    .set('Content-Type', 'application/json')
    .set({ 'Webhook-Id': d.id, 'Webhook-Timestamp': String(d.ts), 'Webhook-Signature': d.sig, ...headers })
    .send(d.raw);

let fake: FakeDb;
beforeEach(() => {
  fake = makeFakeDb();
  fake.parties.set(PARTY_ID, { id: PARTY_ID });
  fake.users.set('u1', { id: 'u1', email: 'host@x.com' });
  m.fake = fake;
  m.notify.mockReset();
  process.env.PIZZA_MCP_WEBHOOK_SECRET = SECRET;
});
afterEach(() => {
  delete process.env.PIZZA_MCP_WEBHOOK_SECRET;
});

describe('POST /api/pizza-mcp/webhook: signature', () => {
  it('accepts a correctly signed delivery and upserts the order', async () => {
    const res = await post(delivery(opopOrder({ status: 'calling' })));
    expect(res.status).toBe(200);
    expect(fake.byOpop('ord_1')).toMatchObject({ status: 'calling', partyId: PARTY_ID, userId: 'u1' });
  });

  it('rejects a forged signature (wrong secret) and changes nothing', async () => {
    const res = await post(delivery(opopOrder(), { secret: 'whsec_attacker' }));
    expect(res.status).toBe(401);
    expect(fake.orders.size).toBe(0);
    expect(fake.events.size).toBe(0);
  });

  it('rejects a body tampered after signing', async () => {
    const d = delivery(opopOrder({ status: 'calling' }));
    const res = await post({ ...d, raw: d.raw.replace('"calling"', '"confirmed_by_shop"') });
    expect(res.status).toBe(401);
    expect(fake.orders.size).toBe(0);
  });

  it('rejects missing headers, a malformed signature and a stale timestamp', async () => {
    const d = delivery(opopOrder());
    expect((await post(d, { 'Webhook-Signature': '' })).status).toBe(401);
    expect((await post(d, { 'Webhook-Signature': 'v1=deadbeef' })).status).toBe(401);
    const old = delivery(opopOrder(), { ts: Math.floor(Date.now() / 1000) - 3600 });
    expect((await post(old)).status).toBe(401);
    expect(fake.orders.size).toBe(0);
  });

  it('verifies the RAW bytes: a re-serialised body with the same JSON fails', async () => {
    const d = delivery(opopOrder());
    const reserialised = JSON.stringify(JSON.parse(d.raw), null, 2);
    expect((await post({ ...d, raw: reserialised })).status).toBe(401);
  });

  it('fails closed when no secret is configured', async () => {
    delete process.env.PIZZA_MCP_WEBHOOK_SECRET;
    expect((await post(delivery(opopOrder()))).status).toBe(503);
    expect(fake.orders.size).toBe(0);
  });

  it('accepts either secret while rotating', async () => {
    process.env.PIZZA_MCP_WEBHOOK_SECRET = `whsec_new_secret,${SECRET}`;
    expect((await post(delivery(opopOrder()))).status).toBe(200);
  });
});

describe('POST /api/pizza-mcp/webhook: replay and ordering', () => {
  it('a replayed Webhook-Id answers 200 and changes nothing (no second draft, no second email)', async () => {
    const d = delivery(opopOrder({ status: 'confirmed_by_shop', call: { attempts: 1, last_outcome: 'ok', shop_total_cents: 18740, ready_at_text: '6:30', changes: [], transcript_available: false } }, 3));
    expect((await post(d)).status).toBe(200);
    const after = JSON.stringify([...fake.orders.values()]);
    expect((await post(d)).status).toBe(200);
    expect(JSON.stringify([...fake.orders.values()])).toBe(after);
    expect(fake.docs).toHaveLength(1);
    expect(m.notify).toHaveBeenCalledTimes(1);
  });

  it('a failed handler leaves no Webhook-Id behind, so the retry is processed', async () => {
    const d = delivery(opopOrder({ status: 'calling' }));
    const real = fake.db.pizzaOrder.create;
    fake.db.pizzaOrder.create = async () => { throw new Error('db down'); };
    expect((await post(d)).status).toBe(500);
    expect(fake.events.has(d.id)).toBe(false); // rolled back with the transaction
    fake.db.pizzaOrder.create = real;
    expect((await post(d)).status).toBe(200);
    expect(fake.byOpop('ord_1')?.status).toBe('calling');
  });

  it('an older event arriving after a newer one does not regress the order', async () => {
    const newer = delivery(opopOrder({ status: 'confirmed_by_shop' }, 4), { createdAt: '2026-10-29T18:05:00.000Z' });
    const older = delivery(opopOrder({ status: 'calling' }, 2), { createdAt: '2026-10-29T18:01:00.000Z' });
    expect((await post(newer)).status).toBe(200);
    expect((await post(older)).status).toBe(200); // acknowledged, so pizza-mcp stops retrying it
    expect(fake.byOpop('ord_1')).toMatchObject({ status: 'confirmed_by_shop', timelineLen: 4 });
  });

  it('equal timeline length: the later created_at wins', async () => {
    await post(delivery(opopOrder({ status: 'calling' }, 2), { createdAt: '2026-10-29T18:05:00.000Z' }));
    await post(delivery(opopOrder({ status: 'awaiting_price_approval' }, 2), { createdAt: '2026-10-29T18:01:00.000Z' }));
    expect(fake.byOpop('ord_1')?.status).toBe('calling');
  });

  it('a signed body that is JSON null, an array or a scalar is acknowledged, not a 500', async () => {
    for (const raw of ['null', '[]', '7', '"x"']) {
      expect((await post(delivery(null, { raw }))).status, raw).toBe(200);
    }
    expect(fake.orders.size).toBe(0);
  });

  it('only ISO timestamps become ready_at (free text like "around 6" is not parsed as a date)', async () => {
    await post(delivery(opopOrder({ status: 'calling', promised_at: 'around 6' }, 2)));
    expect(fake.byOpop('ord_1')?.readyAt).toBeNull();
    await post(delivery(opopOrder({ status: 'calling', promised_at: '2026-10-30T22:30:00.000Z' }, 3)));
    expect(fake.byOpop('ord_1')?.readyAt?.toISOString()).toBe('2026-10-30T22:30:00.000Z');
  });

  it('acknowledges unknown event types and orders it cannot attribute', async () => {
    const other = JSON.stringify({ id: 'e', type: 'order.something', order: opopOrder() });
    const d1 = delivery(null, { raw: other });
    expect((await post(d1)).status).toBe(200);
    const d2 = delivery(opopOrder({ id: 'ord_x' }), { clientRef: { party_id: '33333333-3333-4333-8333-333333333333', rsvp_user_id: 'u1' } });
    expect((await post(d2)).status).toBe(200);
    expect(fake.orders.size).toBe(0);
  });
});

describe('POST /api/pizza-mcp/webhook: draft receipt and notification', () => {
  const confirmed = (extra: any = {}, tl = 3) =>
    opopOrder(
      { status: 'confirmed_by_shop', call: { attempts: 1, last_outcome: 'confirmed', shop_total_cents: 18740, ready_at_text: 'about 6:30', changes: ['Swapped olives for onions'], transcript_available: true }, ...extra },
      tl
    );

  it('phone order confirmed_by_shop creates ONE draft PayoutDocument and notifies the host', async () => {
    await post(delivery(confirmed()));
    expect(fake.docs).toHaveLength(1);
    const doc = fake.docs[0];
    expect(doc).toMatchObject({
      partyId: PARTY_ID,
      kind: 'receipt',
      source: 'ai_call',
      ocrAmount: null, // never joins a payout sum next to the real receipt
      uploadedByUserId: 'u1',
      uploadedByEmail: 'host@x.com',
      url: 'pizza-order://ord_1',
    });
    expect(doc.ocrRaw).toMatchObject({ confirmed_total_cents: 18740, ready_at_text: 'about 6:30' });
    expect(fake.byOpop('ord_1')).toMatchObject({ confirmedTotalCents: 18740, readyAtText: 'about 6:30', payoutDocumentId: doc.id });
    expect(m.notify).toHaveBeenCalledTimes(1);

    // a later update (new event id) does not create a second draft or a second email
    await post(delivery(confirmed({ summary: 'again' }, 4)));
    expect(fake.docs).toHaveLength(1);
    expect(m.notify).toHaveBeenCalledTimes(1);
  });

  it('does not create a draft for non-final statuses', async () => {
    for (const status of ['awaiting_approval', 'calling', 'awaiting_price_approval', 'needs_review', 'refused', 'unreachable']) {
      await post(delivery(opopOrder({ status }, fake.orders.size + 2)));
    }
    expect(fake.docs).toHaveLength(0);
    expect(m.notify).not.toHaveBeenCalled();
  });

  it('native order creates the draft on payment_status paid, with source opop_native', async () => {
    const native = opopOrder({ id: 'ord_n', pizzeria_id: 'pz_abc', tier: undefined, status: 'placed', payment_status: 'paid', totals: { subtotal_cents: 0, discount_cents: 0, delivery_fee_cents: 0, service_fee_cents: 0, tax_cents: 0, tip_cents: 0, total_cents: 9900 } }, 3);
    await post(delivery(native));
    // the view carries no `tier`: the row's tier (from the shop id) decides
    expect(fake.docs[0]).toMatchObject({ source: 'opop_native' });
    expect(fake.byOpop('ord_n')?.confirmedTotalCents).toBe(9900);
  });

  it('a view whose tier says "listing" cannot turn a native row into a phone order', async () => {
    await post(delivery(opopOrder({ id: 'ord_n', pizzeria_id: 'pz_abc', status: 'held', payment_status: 'unpaid', tier: 'listing' }, 1)));
    await post(delivery(opopOrder({ id: 'ord_n', pizzeria_id: 'pz_abc', status: 'confirmed_by_shop', payment_status: 'unpaid', tier: 'listing' }, 2)));
    expect(fake.docs).toHaveLength(0);
  });

  it('persists pizza-mcp\'s outcome from the webhook so budget and copy can use it', async () => {
    const outcome = { nothing_ordered: false, reason: 'ambiguous_dial', message: 'We may have reached the shop.' };
    await post(delivery(opopOrder({ status: 'needs_review', outcome }, 2)));
    expect(fake.byOpop('ord_1').lastView.outcome).toEqual(outcome);
    await post(delivery(opopOrder({ status: 'needs_review', outcome: null }, 3)));
    expect(fake.byOpop('ord_1').lastView.outcome).toBeNull();
  });

  it('a downgrade after confirmation (needs_review) or a later cancel removes the draft', async () => {
    await post(delivery(confirmed({}, 3)));
    expect(fake.docs).toHaveLength(1);
    await post(delivery(opopOrder({ status: 'needs_review' }, 4)));
    expect(fake.docs).toHaveLength(0);
    expect(fake.byOpop('ord_1')).toMatchObject({ status: 'needs_review', payoutDocumentId: null });

    // confirmed again, then canceled
    await post(delivery(confirmed({}, 5)));
    expect(fake.docs).toHaveLength(1);
    await post(delivery(opopOrder({ status: 'canceled' }, 6)));
    expect(fake.docs).toHaveLength(0);
  });

  it('a re-quoted total updates the draft instead of leaving the old number', async () => {
    await post(delivery(confirmed({}, 3)));
    await post(delivery(confirmed({ call: { attempts: 1, last_outcome: 'confirmed', shop_total_cents: 19900, ready_at_text: 'about 7', changes: [], transcript_available: true } }, 4)));
    expect(fake.docs).toHaveLength(1);
    expect(fake.docs[0].ocrRaw.confirmed_total_cents).toBe(19900);
    expect(fake.docs[0].ocrSummary).toContain('$199.00');
  });

  it('a draft the host removed is not recreated by later updates', async () => {
    await post(delivery(confirmed({}, 3)));
    fake.docs.length = 0; // host removed it; payoutDocumentId stays set
    await post(delivery(confirmed({ summary: 'again' }, 4)));
    expect(fake.docs).toHaveLength(0);
  });

  it('a native order that is merely placed (unpaid) creates nothing', async () => {
    await post(delivery(opopOrder({ id: 'ord_n', tier: 'native', status: 'held', payment_status: 'unpaid' }, 2)));
    expect(fake.docs).toHaveLength(0);
  });
});
