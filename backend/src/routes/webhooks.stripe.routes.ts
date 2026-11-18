import { Router, Request, Response, NextFunction } from 'express';
import express from 'express';
import { prisma } from '../config/database.js';
import { verifyStripeSignature, chargeIdOf, StripePaymentIntent } from '../lib/stripeVerify.js';

/**
 * Stripe webhook (donations). Mounted BEFORE express.json() (needs the raw bytes Stripe signed).
 * Handles payment_intent.succeeded / payment_intent.payment_failed for intents with
 * metadata.type === 'donation'. Upserts the donation by paymentIntentId, so redirect-based
 * methods (which never reach the client success handler) still get a row.
 * Prod step: Stripe dashboard -> Developers -> Webhooks -> endpoint
 * https://<api-host>/api/webhooks/stripe, events payment_intent.succeeded + payment_intent.payment_failed,
 * and set STRIPE_WEBHOOK_SECRET to the endpoint's signing secret.
 */
const router = Router();

export async function applyDonationIntentEvent(type: string, pi: StripePaymentIntent) {
  if (pi.metadata?.type !== 'donation') return 'ignored';
  const partyId = pi.metadata?.partyId;
  if (!partyId) return 'ignored';
  const status = type === 'payment_intent.succeeded' ? 'succeeded' : type === 'payment_intent.payment_failed' ? 'failed' : null;
  if (!status) return 'ignored';

  const existing = await prisma.donation.findFirst({ where: { paymentIntentId: pi.id }, select: { id: true, status: true } });
  const chargeId = chargeIdOf(pi);
  if (existing) {
    // Never downgrade a succeeded/refunded donation to failed.
    if (status === 'failed' && existing.status !== 'pending') return 'noop';
    await prisma.donation.update({
      where: { id: existing.id },
      data: { status, ...(chargeId && { chargeId }) },
    });
    return 'updated';
  }
  const party = await prisma.party.findUnique({ where: { id: partyId }, select: { id: true } });
  if (!party) return 'ignored';
  await prisma.donation.create({
    data: {
      amount: pi.amount / 100,
      currency: pi.currency || 'usd',
      status,
      paymentIntentId: pi.id,
      chargeId,
      donorName: pi.metadata?.donorName || null,
      isAnonymous: false,
      paymentMethod: 'stripe',
      partyId,
    },
  });
  return 'created';
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
    const result = await applyDonationIntentEvent(event.type, pi);
    res.status(200).json({ ok: true, result });
  } catch (error) {
    next(error);
  }
});

export default router;
