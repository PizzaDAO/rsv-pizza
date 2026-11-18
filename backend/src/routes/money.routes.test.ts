/**
 * Money-path hardening: public invoice pay is verified against Stripe, donations only link a
 * guest of the same party and are marked succeeded only by Stripe (server-side retrieve or signed
 * webhook).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import crypto from 'crypto';

const m = vi.hoisted(() => ({
  prisma: {
    invoice: { findUnique: vi.fn(), findFirst: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
    $executeRaw: vi.fn(async () => 0),
    $executeRawUnsafe: vi.fn(async () => 0),
    sponsor: { update: vi.fn() },
    party: { findUnique: vi.fn(), findFirst: vi.fn() },
    guest: { findFirst: vi.fn() },
    donation: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
  pi: vi.fn(),
}));
vi.mock('../config/database.js', () => ({ prisma: m.prisma }));
vi.mock('../middleware/auth.js', () => ({
  requireAuth: (_req: any, _res: any, next: any) => next(),
  isSuperAdmin: vi.fn(async () => false),
}));
vi.mock('../helpers/partyAccess.js', () => ({ canUserEditParty: vi.fn(), canUserAccessTab: vi.fn() }));
vi.mock('../lib/invoicePdf.js', () => ({ generateInvoicePdf: vi.fn() }));
vi.mock('../assets/wireDetailsPdf.js', () => ({ WIRE_DETAILS_PDF_B64: '' }));
vi.mock('../assets/w9Pdf.js', () => ({ W9_PDF_B64: '' }));
vi.mock('../lib/stripeVerify.js', async (orig) => ({
  ...(await orig<typeof import('../lib/stripeVerify.js')>()),
  retrievePaymentIntent: m.pi,
}));

import { invoicePublicRoutes } from './invoice.routes.js';
import donationRoutes from './donation.routes.js';
import stripeWebhook from './webhooks.stripe.routes.js';
import { errorHandler } from '../middleware/error.js';

const PARTY = '11111111-1111-1111-1111-111111111111';
const app = () => {
  const a = express();
  a.use('/api/webhooks/stripe', stripeWebhook);
  a.use(express.json());
  a.use('/api/invoice', invoicePublicRoutes);
  a.use('/api/parties', donationRoutes);
  a.use(errorHandler);
  return a;
};

const ok = (pi: any) => ({ ok: true, pi });
const fail = (reason: string) => ({ ok: false, reason });

beforeEach(() => {
  vi.clearAllMocks();
  m.prisma.$transaction.mockImplementation(async (cb: any) => cb(m.prisma));
});

describe('POST /api/invoice/:token/pay', () => {
  const invoice = (over: any = {}) => ({ id: 'inv1', sponsorId: 's1', total: 5000, currency: 'usd', status: 'issued', paymentRef: null, ...over });
  const goodPi = { id: 'pi_1', status: 'succeeded', amount: 5000, amount_received: 5000, currency: 'usd', metadata: { invoiceId: 'inv1' } };
  const pay = (body: object) => request(app()).post('/api/invoice/tok/pay').send(body);

  it.each([
    ['not found at Stripe', fail('not_found')],
    ['not succeeded', ok({ ...goodPi, status: 'requires_payment_method' })],
    ['other invoice', ok({ ...goodPi, metadata: { invoiceId: 'inv2' } })],
    ['no metadata', ok({ ...goodPi, metadata: {} })],
  ])('402s when Stripe positively says %s', async (_n, res) => {
    m.prisma.invoice.findUnique.mockResolvedValue(invoice());
    m.pi.mockResolvedValue(res);
    const r = await pay({ paymentMethod: 'stripe', paymentRef: 'pi_x', paidAmount: 1 });
    expect(r.status).toBe(402);
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(m.prisma.sponsor.update).not.toHaveBeenCalled();
  });

  it.each([
    ['unconfigured', fail('unconfigured')],
    ['unreachable', fail('unreachable')],
    ['amount mismatch', ok({ ...goodPi, amount: 100 })],
    ['currency mismatch', ok({ ...goodPi, currency: 'eur' })],
  ])('parks the claim as pending_verification when %s', async (_n, res) => {
    m.prisma.invoice.findUnique.mockResolvedValue(invoice());
    m.pi.mockResolvedValue(res);
    m.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    const r = await pay({ paymentMethod: 'stripe', paymentRef: 'pi_1' });
    expect(r.status).toBe(200);
    expect(r.body.pendingVerification).toBe(true);
    expect(m.prisma.invoice.updateMany.mock.calls[0][0].data).toEqual({ status: 'pending_verification', paymentMethod: 'stripe', paymentRef: 'pi_1' });
    expect(m.prisma.sponsor.update).not.toHaveBeenCalled();
  });

  it('marks paid using Stripe values (not client values) and the sponsor paid', async () => {
    m.prisma.invoice.findUnique.mockResolvedValue(invoice());
    m.pi.mockResolvedValue(ok(goodPi));
    m.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    const r = await pay({ paymentMethod: 'stripe', paymentRef: 'pi_1', paidAmount: 1 });
    expect(r.status).toBe(200);
    const call = m.prisma.invoice.updateMany.mock.calls[0][0];
    expect(call.where.status).toEqual({ in: ['issued', 'viewed'] });
    expect(call.data).toMatchObject({ status: 'paid', paidAmount: 5000, paymentRef: 'pi_1' });
    expect(m.prisma.sponsor.update).toHaveBeenCalledOnce();
  });

  it('is idempotent: replay of the same ref returns the invoice without re-applying', async () => {
    m.prisma.invoice.findUnique.mockResolvedValue(invoice({ status: 'paid', paymentRef: 'pi_1' }));
    const r = await pay({ paymentMethod: 'stripe', paymentRef: 'pi_1' });
    expect(r.status).toBe(200);
    expect(m.prisma.invoice.updateMany).not.toHaveBeenCalled();
    expect(m.pi).not.toHaveBeenCalled();
  });

  it('a different ref on a paid invoice is rejected', async () => {
    m.prisma.invoice.findUnique.mockResolvedValue(invoice({ status: 'paid', paymentRef: 'pi_1' }));
    expect((await pay({ paymentMethod: 'stripe', paymentRef: 'pi_2' })).status).toBe(400);
  });

  it('crypto claims are recorded as pending_verification, never paid', async () => {
    m.prisma.invoice.findUnique.mockResolvedValue(invoice());
    m.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    const r = await pay({ paymentMethod: 'crypto', paymentRef: '0xabc', chainId: 8453, tokenSymbol: 'USDC', paidAmount: 5000 });
    expect(r.status).toBe(200);
    const call = m.prisma.invoice.updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('pending_verification');
    expect(call.data.paidAt).toBeUndefined();
    expect(call.data.paymentRef).toBe('0xabc | chain:8453 | token:USDC');
    expect(m.prisma.sponsor.update).not.toHaveBeenCalled();
  });
});

describe('POST /api/parties/:id/donations', () => {
  const body = { amount: 25, paymentIntentId: 'pi_d1', donorName: 'Ann' };
  const goodPi = { id: 'pi_d1', status: 'succeeded', amount: 2500, currency: 'usd', latest_charge: 'ch_1', metadata: { type: 'donation', partyId: PARTY } };
  beforeEach(() => {
    m.prisma.party.findUnique.mockResolvedValue({ id: PARTY, donationEnabled: true, cancelledAt: null });
    m.prisma.donation.findFirst.mockResolvedValue(null);
    m.prisma.donation.create.mockImplementation(async ({ data }: any) => ({ id: 'd1', ...data }));
  });

  it('drops a guestId from another party (donation still recorded)', async () => {
    m.prisma.guest.findFirst.mockResolvedValue(null);
    m.pi.mockResolvedValue(fail('unconfigured'));
    const r = await request(app()).post(`/api/parties/${PARTY}/donations`).send({ ...body, guestId: 'other-guest' });
    expect(r.status).toBe(201);
    expect(m.prisma.guest.findFirst.mock.calls[0][0].where).toEqual({ id: 'other-guest', partyId: PARTY });
    expect(m.prisma.donation.create.mock.calls[0][0].data.guestId).toBeNull();
  });

  it('links a guest of the same party', async () => {
    m.prisma.guest.findFirst.mockResolvedValue({ id: 'g1' });
    m.pi.mockResolvedValue(fail('unconfigured'));
    const r = await request(app()).post(`/api/parties/${PARTY}/donations`).send({ ...body, guestId: 'g1' });
    expect(r.status).toBe(201);
    expect(m.prisma.donation.create.mock.calls[0][0].data.guestId).toBe('g1');
  });

  it('marks succeeded only when Stripe confirms the intent with the same amount', async () => {
    m.pi.mockResolvedValue(ok(goodPi));
    const r = await request(app()).post(`/api/parties/${PARTY}/donations`).send(body);
    expect(r.status).toBe(201);
    expect(m.prisma.donation.create.mock.calls[0][0].data).toMatchObject({ status: 'succeeded', chargeId: 'ch_1' });
  });

  it.each([
    ['amount mismatch', { amount: 100 }],
    ['not succeeded', { status: 'processing' }],
    ['other party', { metadata: { type: 'donation', partyId: 'zzz' } }],
    ['not a donation intent', { metadata: { type: 'invoice_payment', partyId: PARTY } }],
  ])('stays pending on %s', async (_n, over) => {
    m.pi.mockResolvedValue(ok({ ...goodPi, ...over }));
    const r = await request(app()).post(`/api/parties/${PARTY}/donations`).send(body);
    expect(r.status).toBe(201);
    expect(m.prisma.donation.create.mock.calls[0][0].data.status).toBe('pending');
  });

  it('stays pending when Stripe is unreachable / unconfigured', async () => {
    m.pi.mockResolvedValue(fail('unconfigured'));
    await request(app()).post(`/api/parties/${PARTY}/donations`).send(body);
    expect(m.prisma.donation.create.mock.calls[0][0].data.status).toBe('pending');
  });

  it('a client cannot self-assert succeeded without a payment intent', async () => {
    await request(app()).post(`/api/parties/${PARTY}/donations`).send({ amount: 10, status: 'succeeded' });
    expect(m.prisma.donation.create.mock.calls[0][0].data.status).toBe('pending');
  });

  it('is idempotent when the webhook already created the row', async () => {
    m.pi.mockResolvedValue(ok(goodPi));
    m.prisma.donation.findFirst.mockResolvedValue({ id: 'd9', partyId: PARTY, status: 'succeeded', donorName: null, donorEmail: null, message: null, guestId: null });
    m.prisma.donation.update.mockImplementation(async ({ data }: any) => ({ id: 'd9', ...data }));
    const r = await request(app()).post(`/api/parties/${PARTY}/donations`).send(body);
    expect(r.status).toBe(200);
    expect(m.prisma.donation.create).not.toHaveBeenCalled();
  });
});

describe('POST /api/webhooks/stripe', () => {
  const SECRET = 'whsec_route_test_secret';
  const post = (payload: object, secret = SECRET) => {
    const raw = JSON.stringify(payload);
    const t = Math.floor(Date.now() / 1000);
    const sig = crypto.createHmac('sha256', secret).update(`${t}.${raw}`).digest('hex');
    return request(app()).post('/api/webhooks/stripe').set('Content-Type', 'application/json').set('stripe-signature', `t=${t},v1=${sig}`).send(raw);
  };
  const evt = (type: string, over: any = {}) => ({
    type,
    data: { object: { id: 'pi_w1', amount: 2500, currency: 'usd', latest_charge: 'ch_w', metadata: { type: 'donation', partyId: PARTY }, ...over } },
  });
  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    m.prisma.donation.findFirst.mockResolvedValue(null);
    m.prisma.party.findUnique.mockResolvedValue({ id: PARTY });
    m.prisma.donation.create.mockResolvedValue({ id: 'new' });
  });
  afterEach(() => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
  });

  it('503s when the secret is not configured, 401s on bad signature', async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect((await post(evt('payment_intent.succeeded'))).status).toBe(503);
    process.env.STRIPE_WEBHOOK_SECRET = SECRET;
    expect((await post(evt('payment_intent.succeeded'), 'wrong')).status).toBe(401);
    expect(m.prisma.donation.create).not.toHaveBeenCalled();
  });

  it('creates a succeeded donation for a redirect payment with no existing row', async () => {
    const r = await post(evt('payment_intent.succeeded'));
    expect(r.status).toBe(200);
    expect(m.prisma.donation.create.mock.calls[0][0].data).toMatchObject({ status: 'succeeded', amount: 25, paymentIntentId: 'pi_w1', partyId: PARTY, isAnonymous: true });
    expect((m.prisma.$executeRawUnsafe.mock.calls as unknown[][])[0][0]).toContain('SET LOCAL lock_timeout');
    expect(m.prisma.$executeRaw).toHaveBeenCalled();
  });

  it('stores receipt_email as donorEmail', async () => {
    await post(evt('payment_intent.succeeded', { receipt_email: 'd@example.org' }));
    expect(m.prisma.donation.create.mock.calls[0][0].data.donorEmail).toBe('d@example.org');
  });

  it('never touches a refunded donation', async () => {
    m.prisma.donation.findFirst.mockResolvedValue({ id: 'd1', status: 'refunded' });
    await post(evt('payment_intent.succeeded'));
    expect(m.prisma.donation.update).not.toHaveBeenCalled();
  });

  describe('invoice payments', () => {
    const inv = { id: 'inv1', sponsorId: 's1', total: 5000, currency: 'usd', status: 'pending_verification' };
    const ie = (over: any = {}) => evt('payment_intent.succeeded', { status: 'succeeded', amount: 5000, metadata: { type: 'invoice_payment', invoiceId: 'inv1' }, ...over });
    beforeEach(() => {
      m.prisma.invoice.findUnique.mockResolvedValue(inv);
      m.prisma.invoice.updateMany.mockResolvedValue({ count: 1 });
    });
    it('marks paid from pending_verification when amount matches', async () => {
      await post(ie());
      const c = m.prisma.invoice.updateMany.mock.calls[0][0];
      expect(c.where.status.in).toContain('pending_verification');
      expect(c.data.status).toBe('paid');
      expect(m.prisma.sponsor.update).toHaveBeenCalled();
    });
    it('parks as pending_verification on amount mismatch', async () => {
      await post(ie({ amount: 1 }));
      expect(m.prisma.invoice.updateMany.mock.calls[0][0].data.status).toBe('pending_verification');
      expect(m.prisma.sponsor.update).not.toHaveBeenCalled();
    });
  });

  it('updates an existing pending row to succeeded', async () => {
    m.prisma.donation.findFirst.mockResolvedValue({ id: 'd1', status: 'pending' });
    m.prisma.donation.update.mockResolvedValue({});
    await post(evt('payment_intent.succeeded'));
    expect(m.prisma.donation.update.mock.calls[0][0].data).toMatchObject({ status: 'succeeded', chargeId: 'ch_w' });
  });

  it('marks failed, but never downgrades a succeeded row', async () => {
    m.prisma.donation.findFirst.mockResolvedValue({ id: 'd1', status: 'succeeded' });
    await post(evt('payment_intent.payment_failed'));
    expect(m.prisma.donation.update).not.toHaveBeenCalled();
    m.prisma.donation.findFirst.mockResolvedValue({ id: 'd1', status: 'pending' });
    m.prisma.donation.update.mockResolvedValue({});
    await post(evt('payment_intent.payment_failed'));
    expect(m.prisma.donation.update.mock.calls[0][0].data.status).toBe('failed');
  });

  it('ignores non-donation intents', async () => {
    const r = await post(evt('payment_intent.succeeded', { metadata: { type: 'invoice_payment', invoiceId: 'x' } }));
    expect(r.status).toBe(200);
    expect(m.prisma.donation.create).not.toHaveBeenCalled();
  });
});
