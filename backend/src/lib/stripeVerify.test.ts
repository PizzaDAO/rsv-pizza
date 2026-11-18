import { describe, it, expect, vi, afterEach } from 'vitest';
import crypto from 'crypto';
import { verifyStripeSignature, retrievePaymentIntent, chargeIdOf } from './stripeVerify.js';

const SECRET = 'whsec_test_0123456789';
const sign = (body: string, t: number, secret = SECRET) =>
  `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

describe('verifyStripeSignature', () => {
  const body = '{"id":"evt_1"}';
  const now = 1_700_000_000;
  it('accepts a valid signature', () => {
    expect(verifyStripeSignature(body, sign(body, now), SECRET, 300, now)).toBe(true);
  });
  it('rejects a wrong secret, tampered body, stale timestamp, and missing header', () => {
    expect(verifyStripeSignature(body, sign(body, now, 'other'), SECRET, 300, now)).toBe(false);
    expect(verifyStripeSignature(body + 'x', sign(body, now), SECRET, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, sign(body, now - 1000), SECRET, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, undefined, SECRET, 300, now)).toBe(false);
    expect(verifyStripeSignature(body, 't=abc,v1=zz', SECRET, 300, now)).toBe(false);
  });
});

describe('retrievePaymentIntent', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.STRIPE_SECRET_KEY;
  });
  it('returns null without a key or for malformed ids, never calling Stripe', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    expect(await retrievePaymentIntent('pi_123')).toBeNull();
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    expect(await retrievePaymentIntent('../customers')).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });
  it('fetches the intent with the secret key', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    const f = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ id: 'pi_1', status: 'succeeded', amount: 100, currency: 'usd' }) });
    vi.stubGlobal('fetch', f);
    const pi = await retrievePaymentIntent('pi_1');
    expect(pi?.status).toBe('succeeded');
    expect(f.mock.calls[0][0]).toBe('https://api.stripe.com/v1/payment_intents/pi_1');
  });
  it('chargeIdOf handles string and expanded', () => {
    expect(chargeIdOf({ id: 'pi', status: 's', amount: 1, currency: 'usd', latest_charge: 'ch_1' })).toBe('ch_1');
    expect(chargeIdOf({ id: 'pi', status: 's', amount: 1, currency: 'usd', latest_charge: { id: 'ch_2' } })).toBe('ch_2');
    expect(chargeIdOf({ id: 'pi', status: 's', amount: 1, currency: 'usd' })).toBeNull();
  });
});
