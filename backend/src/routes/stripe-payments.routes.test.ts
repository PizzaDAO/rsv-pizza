import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';

const PARTY_ID = '22222222-2222-4222-8222-222222222222';

const m = vi.hoisted(() => ({ party: null as any, invoice: null as any }));

vi.mock('../config/database.js', () => ({
  prisma: {
    party: { findUnique: async ({ where }: any) => (m.party && m.party.id === where.id ? m.party : null) },
    invoice: { findUnique: async ({ where }: any) => (m.invoice && m.invoice.viewToken === where.viewToken ? m.invoice : null) },
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

import router, { emailHash } from './stripe-payments.routes.js';
import { errorHandler } from '../middleware/error.js';
import { setStripeClientForTests } from '../lib/stripeClient.js';

function app() {
  const a = express();
  a.use(express.json());
  a.use('/api/stripe-payments', router);
  a.use(errorHandler);
  return a;
}

let stripe: any;
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  m.party = { id: PARTY_ID, donationEnabled: true, cancelledAt: null };
  m.invoice = {
    id: 'inv_1', invoiceNumber: 'INV-1', partyId: PARTY_ID, total: 125_000, currency: 'usd',
    status: 'issued', billToEmail: 'billing@example.org', viewToken: 'tok_abc',
  };
  stripe = {
    paymentIntents: { create: vi.fn(async (p: any) => ({ id: 'pi_1', client_secret: 'pi_1_secret', status: 'requires_payment_method', ...p })) },
    customers: {
      search: vi.fn(async () => ({ data: [] })),
      create: vi.fn(async () => ({ id: 'cus_new' })),
    },
    setupIntents: { create: vi.fn(async () => ({ client_secret: 'seti_secret' })) },
  };
  setStripeClientForTests(stripe);
});
afterEach(() => {
  setStripeClientForTests(null);
  vi.restoreAllMocks();
});

describe('POST /donation-intent', () => {
  const post = (b: any) => request(app()).post('/api/stripe-payments/donation-intent').send(b);

  it('creates a USD intent with server-set metadata (client metadata ignored)', async () => {
    const res = await post({
      partyId: PARTY_ID, amount: 2500, customerName: 'Pat', customerEmail: 'pat@example.org',
      metadata: { type: 'invoice_payment', invoiceId: 'inv_victim' },
    });
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('pi_1_secret');
    const args = stripe.paymentIntents.create.mock.calls[0][0];
    expect(args).toMatchObject({ amount: 2500, currency: 'usd', receipt_email: 'pat@example.org' });
    expect(args.metadata).toEqual({ type: 'donation', partyId: PARTY_ID, donorName: 'Pat' });
  });

  it('rejects out-of-range, fractional and non-USD amounts', async () => {
    for (const b of [
      { amount: 49 }, { amount: 1_000_001 }, { amount: 12.5 }, { amount: '2500' }, { amount: 2500, currency: 'jpy' },
    ]) {
      const res = await post({ partyId: PARTY_ID, ...b });
      expect(res.status).toBe(400);
    }
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });

  it('rejects unknown, cancelled or donation-disabled parties', async () => {
    expect((await post({ partyId: '33333333-3333-4333-8333-333333333333', amount: 500 })).status).toBe(404);
    m.party.donationEnabled = false;
    expect((await post({ partyId: PARTY_ID, amount: 500 })).status).toBe(400);
    m.party.cancelledAt = new Date();
    expect((await post({ partyId: PARTY_ID, amount: 500 })).status).toBe(410);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('not configured', () => {
  it('fails closed with 503 when STRIPE_SECRET_KEY is unset', async () => {
    setStripeClientForTests(null);
    const saved = process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    try {
      const d = await request(app()).post('/api/stripe-payments/donation-intent').send({ partyId: PARTY_ID, amount: 500 });
      expect(d.status).toBe(503);
      expect(d.body.error.code).toBe('STRIPE_NOT_CONFIGURED');
      const i = await request(app()).post('/api/stripe-payments/invoice-intent').send({ viewToken: 'tok_abc' });
      expect(i.status).toBe(503);
      const s = await request(app()).post('/api/stripe-payments/setup-intent').set({ 'x-user-id': 'u1' });
      expect(s.status).toBe(503);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      if (saved !== undefined) process.env.STRIPE_SECRET_KEY = saved;
    }
  });
});

describe('POST /invoice-intent', () => {
  it('uses the amount and currency from the invoice, not the client', async () => {
    const res = await request(app())
      .post('/api/stripe-payments/invoice-intent')
      .send({ viewToken: 'tok_abc', amount: 50, currency: 'jpy' });
    expect(res.status).toBe(200);
    const args = stripe.paymentIntents.create.mock.calls[0][0];
    expect(args).toMatchObject({ amount: 125_000, currency: 'usd', receipt_email: 'billing@example.org' });
    expect(args.metadata).toEqual({ type: 'invoice_payment', invoiceId: 'inv_1', invoiceNumber: 'INV-1', partyId: PARTY_ID });
  });

  it('404s an unknown token and refuses paid invoices', async () => {
    expect((await request(app()).post('/api/stripe-payments/invoice-intent').send({ viewToken: 'nope' })).status).toBe(404);
    m.invoice.status = 'paid';
    expect((await request(app()).post('/api/stripe-payments/invoice-intent').send({ viewToken: 'tok_abc' })).status).toBe(400);
    expect(stripe.paymentIntents.create).not.toHaveBeenCalled();
  });
});

describe('POST /setup-intent', () => {
  it('401 without login', async () => {
    const res = await request(app()).post('/api/stripe-payments/setup-intent').send({ customerId: 'cus_victim' });
    expect(res.status).toBe(401);
    expect(stripe.setupIntents.create).not.toHaveBeenCalled();
  });

  it("uses the caller's own customer, never a client-supplied one", async () => {
    const res = await request(app())
      .post('/api/stripe-payments/setup-intent')
      .set({ 'x-user-id': 'u1', 'x-user-email': 'u1@example.org' })
      .send({ customerId: 'cus_victim' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ customerId: 'cus_new', clientSecret: 'seti_secret' });
    expect(stripe.customers.create).toHaveBeenCalledWith(
      { email: 'u1@example.org', metadata: { source: 'rsvpizza', rsvpizzaUserId: 'u1' } },
      { idempotencyKey: `rsvpizza-customer-u1-${emailHash('u1@example.org')}` }
    );
    expect(emailHash('u1@example.org')).toMatch(/^[0-9a-f]{12}$/);
    expect(emailHash('U1@example.org ')).toBe(emailHash('u1@example.org'));
    expect(emailHash('other@example.org')).not.toBe(emailHash('u1@example.org'));
    expect(stripe.setupIntents.create.mock.calls[0][0].customer).toBe('cus_new');
  });

  it('reuses an existing customer for the same user', async () => {
    stripe.customers.search.mockResolvedValue({ data: [{ id: 'cus_mine' }] });
    const res = await request(app()).post('/api/stripe-payments/setup-intent').set({ 'x-user-id': 'u1' });
    expect(res.body.customerId).toBe('cus_mine');
    expect(stripe.customers.create).not.toHaveBeenCalled();
  });
});
