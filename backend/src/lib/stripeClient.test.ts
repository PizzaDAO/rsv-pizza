import { describe, it, expect, vi, afterEach } from 'vitest';
import { encodeForm, getStripe, StripeNotConfiguredError, StripeApiError } from './stripeClient.js';

describe('encodeForm', () => {
  it("uses Stripe's bracket notation", () => {
    const out = encodeForm({
      amount: 2160,
      receipt_email: undefined,
      spending_controls: { spending_limits: [{ amount: 2160, interval: 'all_time' }], allowed_categories: ['a', 'b'] },
      metadata: { partyId: 'p 1' },
      expand: ['number', 'cvc'],
    });
    expect(out).toEqual([
      'amount=2160',
      `${encodeURIComponent('spending_controls[spending_limits][0][amount]')}=2160`,
      `${encodeURIComponent('spending_controls[spending_limits][0][interval]')}=all_time`,
      `${encodeURIComponent('spending_controls[allowed_categories][0]')}=a`,
      `${encodeURIComponent('spending_controls[allowed_categories][1]')}=b`,
      `${encodeURIComponent('metadata[partyId]')}=p%201`,
      `${encodeURIComponent('expand[0]')}=number`,
      `${encodeURIComponent('expand[1]')}=cvc`,
    ]);
  });
});

describe('getStripe', () => {
  const saved = process.env.STRIPE_SECRET_KEY;
  afterEach(() => {
    if (saved === undefined) delete process.env.STRIPE_SECRET_KEY;
    else process.env.STRIPE_SECRET_KEY = saved;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('throws a 503 when STRIPE_SECRET_KEY is unset', () => {
    delete process.env.STRIPE_SECRET_KEY;
    expect(() => getStripe()).toThrow(StripeNotConfiguredError);
    try {
      getStripe();
    } catch (e: any) {
      expect(e.statusCode).toBe(503);
    }
  });

  it('POSTs form-encoded with the bearer key and maps errors', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_x';
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ id: 'pi_1', client_secret: 's', status: 'x' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const pi = await getStripe().paymentIntents.create({ amount: 500, metadata: { type: 'donation' } });
    expect(pi.id).toBe('pi_1');
    const [url, init] = fetchMock.mock.calls[0] as any;
    expect(url).toBe('https://api.stripe.com/v1/payment_intents');
    expect(init.headers.Authorization).toBe('Bearer sk_test_x');
    expect(init.body).toBe(`amount=500&${encodeURIComponent('metadata[type]')}=donation`);

    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ error: { message: 'bad' } }), { status: 400 }));
    await expect(getStripe().paymentIntents.create({ amount: 1 })).rejects.toBeInstanceOf(StripeApiError);
  });
});
