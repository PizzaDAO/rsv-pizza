import crypto from 'crypto';

/**
 * Minimal server-side Stripe helpers (no SDK dependency): retrieve a PaymentIntent and verify
 * webhook signatures. Used so money state is never set from client-supplied values.
 *
 * Env: STRIPE_SECRET_KEY (API), STRIPE_WEBHOOK_SECRET (whsec_..., Stripe dashboard webhook).
 *
 * PaymentIntent metadata we rely on (set where the intent is created, supabase/functions/stripe-payment):
 *   - donations: metadata.type = 'donation', metadata.partyId = <party uuid>
 *   - invoices:  metadata.type = 'invoice_payment', metadata.invoiceId = <invoice uuid>
 */
export interface StripePaymentIntent {
  id: string;
  status: string;
  amount: number; // minor units
  amount_received?: number;
  currency: string;
  latest_charge?: string | { id: string } | null;
  metadata?: Record<string, string>;
}

export async function retrievePaymentIntent(id: string): Promise<StripePaymentIntent | null> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key || !/^pi_[A-Za-z0-9_]+$/.test(id)) return null;
  try {
    const r = await fetch(`https://api.stripe.com/v1/payment_intents/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as StripePaymentIntent;
  } catch {
    return null;
  }
}

export function chargeIdOf(pi: StripePaymentIntent): string | null {
  const c = pi.latest_charge;
  if (!c) return null;
  return typeof c === 'string' ? c : c.id || null;
}

/** Verify a Stripe-Signature header (t=...,v1=...) against the raw body. 5 minute tolerance. */
export function verifyStripeSignature(
  rawBody: Buffer | string,
  header: string | undefined,
  secret: string,
  toleranceSec = 300,
  nowSec = Math.floor(Date.now() / 1000)
): boolean {
  if (!header || !secret) return false;
  let t = '';
  const sigs: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=');
    if (k === 't') t = v;
    else if (k === 'v1' && v) sigs.push(v);
  }
  const ts = Number(t);
  if (!ts || sigs.length === 0 || Math.abs(nowSec - ts) > toleranceSec) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${t}.${typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8')}`)
    .digest('hex');
  const eb = Buffer.from(expected, 'hex');
  return sigs.some((s) => {
    const sb = Buffer.from(s, 'hex');
    return sb.length === eb.length && crypto.timingSafeEqual(sb, eb);
  });
}
