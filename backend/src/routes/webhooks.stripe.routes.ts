import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { prisma } from '../config/database.js';
import { verifyStripeSignature, chargeIdOf, StripePaymentIntent } from '../lib/stripeVerify.js';
import { withDonationLock } from '../lib/donationLock.js';
import { judgeInvoiceIntent, markInvoicePaidFromIntent, markInvoicePendingFromIntent } from '../lib/invoicePayment.js';

/**
 * Stripe webhook. Mounted BEFORE express.json() (needs the raw bytes Stripe signed).
 * Handles payment_intent.succeeded / payment_intent.payment_failed for:
 *  - metadata.type === 'donation': upserts the donation by paymentIntentId (redirect methods
 *    never reach the client success handler, so this creates their row).
 *  - metadata.type === 'invoice_payment': marks the invoice paid when amount/currency match,
 *    otherwise parks it as pending_verification for the host.
 * Prod step: Stripe dashboard -> Developers -> Webhooks -> endpoint
 * https://<api-host>/api/webhooks/stripe, events payment_intent.succeeded + payment_intent.payment_failed,
 * and set STRIPE_WEBHOOK_SECRET to the endpoint's signing secret.
 */
const router = Router();

export async function applyDonationIntentEvent(type: string, pi: StripePaymentIntent) {
  const partyId = pi.metadata?.partyId;
  if (!partyId) return 'ignored';
  const status = type === 'payment_intent.succeeded' ? 'succeeded' : type === 'payment_intent.payment_failed' ? 'failed' : null;
  if (!status) return 'ignored';
  const chargeId = chargeIdOf(pi);

  return withDonationLock(pi.id, async (tx) => {
    const existing = await tx.donation.findFirst({ where: { paymentIntentId: pi.id }, select: { id: true, status: true } });
    if (existing) {
      // Refunded rows are never touched; never downgrade a succeeded row to failed.
      if (existing.status === 'refunded') return 'noop';
      if (status === 'failed' && existing.status !== 'pending') return 'noop';
      if (existing.status === status) return 'noop';
      await tx.donation.update({
        where: { id: existing.id },
        data: { status, ...(chargeId && { chargeId }) },
      });
      return 'updated';
    }
    const party = await tx.party.findUnique({ where: { id: partyId }, select: { id: true } });
    if (!party) return 'ignored';
    await tx.donation.create({
      data: {
        amount: pi.amount / 100,
        currency: pi.currency || 'usd',
        status,
        paymentIntentId: pi.id,
        chargeId,
        donorName: pi.metadata?.donorName || null,
        donorEmail: pi.receipt_email || null,
        // No consent captured on this path: default to anonymous on public lists.
        isAnonymous: true,
        paymentMethod: 'stripe',
        partyId,
      },
    });
    return 'created';
  });
}

export async function applyInvoiceIntentEvent(type: string, pi: StripePaymentIntent) {
  const invoiceId = pi.metadata?.invoiceId;
  if (type !== 'payment_intent.succeeded' || !invoiceId) return 'ignored';
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    select: { id: true, sponsorId: true, total: true, currency: true, status: true },
  });
  if (!invoice) return 'ignored';
  const verdict = judgeInvoiceIntent(invoice, pi);
  if (verdict === 'reject') return 'ignored';
  if (verdict === 'verified') {
    const done = await markInvoicePaidFromIntent(invoice, pi, ['issued', 'viewed', 'pending_verification']);
    return done ? 'paid' : 'noop';
  }
  const parked = await markInvoicePendingFromIntent(invoice, pi.id, ['issued', 'viewed'], 'webhook amount/currency mismatch');
  return parked ? 'pending_verification' : 'noop';
}

router.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) {
      console.error('STRIPE_WEBHOOK_SECRET not configured - rejecting webhook');
      return res.status(503).json({ error: 'webhook secret not configured' });
    }
    const raw = req.body as Buffer;
    if (!Buffer.isBuffer(raw)) return res.status(400).json({ error: 'expected raw body' });
    if (!verifyStripeSignature(raw, req.header('stripe-signature'), secret)) {
      return res.status(401).json({ error: 'invalid signature' });
    }
    let event: { type?: string; data?: { object?: StripePaymentIntent } };
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return res.status(400).json({ error: 'invalid json' });
    }
    const pi = event.data?.object;
    if (!event.type || !pi?.id) return res.status(200).json({ ok: true, ignored: true });
    let result = 'ignored';
    if (pi.metadata?.type === 'donation') result = await applyDonationIntentEvent(event.type, pi);
    else if (pi.metadata?.type === 'invoice_payment') result = await applyInvoiceIntentEvent(event.type, pi);
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

export default router;
