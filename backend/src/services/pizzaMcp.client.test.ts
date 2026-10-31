import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import crypto from 'node:crypto';
import { PizzaMcpClient, orderIdempotencyKey, problemToAppError } from './pizzaMcp.client.js';
import { AppError } from '../middleware/error.js';
import { generateSigningKeyPem, makeFakePizzaMcp } from '../testutil/pizzaFakes.js';

const actor = { userId: 'u1', email: 'h@x.com', partyId: 'p1' };
let saved: Record<string, string | undefined>;
beforeEach(() => {
  saved = { k: process.env.PIZZA_MCP_SIGNING_KEY, u: process.env.PIZZA_MCP_URL };
  process.env.PIZZA_MCP_SIGNING_KEY = generateSigningKeyPem();
  process.env.PIZZA_MCP_URL = 'https://api.openpizza.xyz';
});
afterEach(() => {
  saved.k === undefined ? delete process.env.PIZZA_MCP_SIGNING_KEY : (process.env.PIZZA_MCP_SIGNING_KEY = saved.k);
  saved.u === undefined ? delete process.env.PIZZA_MCP_URL : (process.env.PIZZA_MCP_URL = saved.u);
});

describe('orderIdempotencyKey', () => {
  it('is sha256(partyId + recommendationVersion + shopId), hex', () => {
    expect(orderIdempotencyKey('p', 'v', 's')).toBe(crypto.createHash('sha256').update('pvs').digest('hex'));
    expect(orderIdempotencyKey('p', 'v', 's')).toHaveLength(64);
  });
  it('differs per shop and recommendation version; a re-order attempt gets a fresh key', () => {
    const k = orderIdempotencyKey('p', 'v', 's');
    expect(orderIdempotencyKey('p', 'v2', 's')).not.toBe(k);
    expect(orderIdempotencyKey('p', 'v', 's2')).not.toBe(k);
    expect(orderIdempotencyKey('p', 'v', 's', 1)).not.toBe(k);
  });
});

describe('PizzaMcpClient', () => {
  it('sends a fresh valid bearer per request, query params and the Idempotency-Key', async () => {
    const fake = makeFakePizzaMcp({
      'GET /pizzerias': () => ({ json: { pizzerias: [] } }),
      'POST /orders': () => ({ json: { order: { id: 'ord_1' } } }),
    });
    const c = new PizzaMcpClient({ fetchImpl: fake.fetchImpl });
    await c.findShops(actor, { near: '42.36,-71.06', radius_km: 5 });
    await c.placeOrder(actor, { quote_id: 'q', payment_mode: 'pay_at_pickup', contact: { name: 'A', phone: '+16175550123' } }, 'key-123456789');
    expect(fake.calls[0].query).toMatchObject({ near: '42.36,-71.06', radius_km: '5', fulfillment: 'pickup' });
    expect(fake.calls[0].claims.sub).toBe('rsvpizza:u1');
    expect(fake.calls[1].headers['idempotency-key']).toBe('key-123456789');
    expect(fake.calls[1].claims.jti).not.toBe(fake.calls[0].claims.jti);
  });

  it('maps an OPOP problem to an AppError, keeping code and ask_user', async () => {
    const fake = makeFakePizzaMcp({
      'POST /orders': () => ({
        status: 422,
        json: { code: 'SPEND_LIMIT_EXCEEDED', title: 'x', detail: 'Over the limit', status: 422, retryable: false, ask_user: 'Lower it?' },
      }),
    });
    const c = new PizzaMcpClient({ fetchImpl: fake.fetchImpl });
    const err = await c.placeOrder(actor, { quote_id: 'q', payment_mode: 'pay_at_pickup', contact: { name: 'A', phone: '+16175550123' } }, 'key-123456789').catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ statusCode: 422, code: 'SPEND_LIMIT_EXCEEDED', message: 'Over the limit' });
    expect(err.data.opop.ask_user).toBe('Lower it?');
  });

  it('never forwards a 401/INSUFFICIENT_SCOPE to the browser (would log the host out)', () => {
    expect(problemToAppError(401, { code: 'UNAUTHENTICATED', title: 't', status: 401 })).toMatchObject({ statusCode: 502, code: 'PIZZA_MCP_AUTH' });
    expect(problemToAppError(403, { code: 'INSUFFICIENT_SCOPE', title: 't', status: 403 })).toMatchObject({ statusCode: 502, code: 'PIZZA_MCP_AUTH' });
    expect(problemToAppError(500, { code: 'INTERNAL', title: 't', status: 500 })).toMatchObject({ statusCode: 502, code: 'PIZZA_MCP_UNAVAILABLE' });
    expect(problemToAppError(404, 'not json')).toMatchObject({ statusCode: 404, code: 'PIZZA_MCP_ERROR' });
  });

  it('maps a network failure and an unconfigured client to AppErrors', async () => {
    const down = new PizzaMcpClient({ fetchImpl: (async () => { throw new TypeError('fetch failed'); }) as any });
    await expect(down.getOrder(actor, 'ord_1')).rejects.toMatchObject({ statusCode: 502, code: 'PIZZA_MCP_UNAVAILABLE' });
    delete process.env.PIZZA_MCP_SIGNING_KEY;
    const fake = makeFakePizzaMcp({});
    await expect(new PizzaMcpClient({ fetchImpl: fake.fetchImpl }).getOrder(actor, 'ord_1')).rejects.toMatchObject({ statusCode: 503, code: 'PIZZA_MCP_NOT_CONFIGURED' });
    expect(fake.calls).toHaveLength(0);
  });
});
