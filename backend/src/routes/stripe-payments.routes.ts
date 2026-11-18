import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../config/database.js';
import { requireAuth, AuthRequest } from '../middleware/auth.js';
import { AppError } from '../middleware/error.js';
import { getStripe, StripeNotConfiguredError } from '../lib/stripeClient.js';

/**
 * sec-edge-functions: Stripe PaymentIntent / SetupIntent creation, moved off the `stripe-payment`
 * edge function (which took the amount, currency and metadata from the browser for anyone
 * holding the anon key). Here the server decides:
 *   - donations: party must exist, have donations on and not be cancelled; USD only; amount is a
 *     whole number of cents between DONATION_MIN_CENTS and DONATION_MAX_CENTS; metadata is ours.
 *   - invoices: amount and currency come from the invoice row (looked up by its view token), only
 *     for issued/viewed invoices.
 *   - setup intents: login required; the Stripe customer is found/created for the caller only.
 *
 * Mounted at /api/stripe-payments.
 */
const router = Router();

export const DONATION_MIN_CENTS = 50; // Stripe's USD minimum, same as the form's
export function donationMaxCents(): number {
  const n = Number.parseInt(process.env.DONATION_MAX_CENTS || '', 10);
  return Number.isFinite(n) && n > 0 ? n : 1_000_000; // $10,000
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

function cleanEmail(v: unknown): string | undefined {
  return typeof v === 'string' && v.length <= 254 && EMAIL_RE.test(v.trim()) ? v.trim() : undefined;
}

function stripeOr503(): ReturnType<typeof getStripe> {
  try {
    return getStripe();
  } catch (err) {
    if (err instanceof StripeNotConfiguredError) {
      throw new AppError('Card payments are not available', 503, 'STRIPE_NOT_CONFIGURED');
    }
    throw err;
  }
}

// POST /api/stripe-payments/donation-intent  (public: guests donate without an account)
router.post('/donation-intent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { partyId, amount, currency, customerEmail, customerName } = req.body || {};

    if (typeof partyId !== 'string' || !UUID_RE.test(partyId)) {
      throw new AppError('partyId is required', 400, 'VALIDATION_ERROR');
    }
    if (currency !== undefined && String(currency).toLowerCase() !== 'usd') {
      throw new AppError('Only USD donations are supported', 400, 'VALIDATION_ERROR');
    }
    if (!Number.isInteger(amount) || amount < DONATION_MIN_CENTS || amount > donationMaxCents()) {
      throw new AppError(
        `Donation must be between $${(DONATION_MIN_CENTS / 100).toFixed(2)} and $${(donationMaxCents() / 100).toFixed(2)}`,
        400,
        'INVALID_AMOUNT'
      );
    }

    const party = await prisma.party.findUnique({
      where: { id: partyId },
      select: { id: true, donationEnabled: true, cancelledAt: true },
    });
    if (!party) throw new AppError('Party not found', 404, 'NOT_FOUND');
    if (party.cancelledAt) throw new AppError('This event has been cancelled', 410, 'EVENT_CANCELLED');
    if (!party.donationEnabled) {
      throw new AppError('Donations are not enabled for this event', 400, 'DONATIONS_DISABLED');
    }

    const donorName = typeof customerName === 'string' ? customerName.trim().slice(0, 100) : '';
    const stripe = stripeOr503();
    const intent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      capture_method: 'automatic',
      automatic_payment_methods: { enabled: true },
      receipt_email: cleanEmail(customerEmail),
      metadata: { type: 'donation', partyId: party.id, donorName },
    });

    res.json({
      success: true,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/stripe-payments/invoice-intent  (public, gated by the invoice view token)
router.post('/invoice-intent', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { viewToken } = req.body || {};
    if (typeof viewToken !== 'string' || !viewToken || viewToken.length > 200) {
      throw new AppError('viewToken is required', 400, 'VALIDATION_ERROR');
    }

    const invoice = await prisma.invoice.findUnique({
      where: { viewToken },
      select: { id: true, invoiceNumber: true, partyId: true, total: true, currency: true, status: true, billToEmail: true },
    });
    if (!invoice) throw new AppError('Invoice not found', 404, 'NOT_FOUND');
    if (!['issued', 'viewed'].includes(invoice.status)) {
      throw new AppError(
        invoice.status === 'paid' ? 'This invoice has already been paid' : `Cannot pay an invoice with status "${invoice.status}"`,
        400,
        'INVALID_STATUS'
      );
    }
    const currency = (invoice.currency || 'usd').toLowerCase();
    if (!/^[a-z]{3}$/.test(currency)) throw new AppError('Invoice currency is invalid', 400, 'VALIDATION_ERROR');
    if (!Number.isInteger(invoice.total) || invoice.total < DONATION_MIN_CENTS) {
      throw new AppError('Invoice total is too small for card payment', 400, 'INVALID_AMOUNT');
    }

    const stripe = stripeOr503();
    const intent = await stripe.paymentIntents.create({
      amount: invoice.total,
      currency,
      capture_method: 'automatic',
      automatic_payment_methods: { enabled: true },
      receipt_email: cleanEmail(invoice.billToEmail),
      metadata: {
        type: 'invoice_payment',
        invoiceId: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        partyId: invoice.partyId,
      },
    });

    res.json({
      success: true,
      paymentIntentId: intent.id,
      clientSecret: intent.client_secret,
      status: intent.status,
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/stripe-payments/setup-intent  (login required) - save a card for the caller
router.post('/setup-intent', requireAuth, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const stripe = stripeOr503();

    let customerId: string | null = null;
    try {
      const found = await stripe.customers.search({
        query: `metadata['rsvpizzaUserId']:'${userId.replace(/['\\]/g, '')}'`,
        limit: 1,
      });
      customerId = found.data[0]?.id ?? null;
    } catch (err) {
      console.warn('Stripe customer search failed, creating a new customer', (err as Error).message);
    }
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: req.userEmail,
        metadata: { source: 'rsvpizza', rsvpizzaUserId: userId },
      });
      customerId = customer.id;
    }

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
    });

    res.json({ success: true, customerId, clientSecret: setupIntent.client_secret });
  } catch (error) {
    next(error);
  }
});

export default router;
