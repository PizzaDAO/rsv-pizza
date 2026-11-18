import { prisma } from '../config/database.js';
import type { StripePaymentIntent } from './stripeVerify.js';

export type IntentVerdict = 'verified' | 'amount_mismatch' | 'reject';

/** Compare a Stripe intent with an invoice. 'reject' = Stripe positively says it is not a paid intent for this invoice. */
export function judgeInvoiceIntent(
  invoice: { id: string; total: number; currency: string | null },
  pi: StripePaymentIntent
): IntentVerdict {
  if (pi.status !== 'succeeded' || pi.metadata?.invoiceId !== invoice.id) return 'reject';
  if (pi.amount !== invoice.total || (pi.currency || '').toLowerCase() !== (invoice.currency || 'usd').toLowerCase()) {
    return 'amount_mismatch';
  }
  return 'verified';
}

/** Atomically move an invoice to paid (and its sponsor). Returns true if this call did the transition. */
export async function markInvoicePaidFromIntent(
  invoice: { id: string; sponsorId: string },
  pi: StripePaymentIntent,
  fromStatuses: string[]
): Promise<boolean> {
  const r = await prisma.invoice.updateMany({
    where: { id: invoice.id, status: { in: fromStatuses } },
    data: {
      status: 'paid',
      paidAt: new Date(),
      paidAmount: pi.amount_received ?? pi.amount,
      paymentMethod: 'stripe',
      paymentRef: pi.id,
    },
  });
  if (r.count === 1) {
    await prisma.sponsor.update({ where: { id: invoice.sponsorId }, data: { status: 'paid' } });
    return true;
  }
  return false;
}

/** Atomically record a Stripe claim for host review. Logs the intent id if nothing matched so it is never lost. */
export async function markInvoicePendingFromIntent(
  invoice: { id: string },
  piId: string,
  fromStatuses: string[],
  reason: string
): Promise<boolean> {
  console.warn(`[invoice-pay] ${reason}: invoice ${invoice.id} intent ${piId} -> pending_verification`);
  const r = await prisma.invoice.updateMany({
    where: { id: invoice.id, status: { in: fromStatuses } },
    data: { status: 'pending_verification', paymentMethod: 'stripe', paymentRef: piId },
  });
  if (r.count !== 1) {
    console.warn(`[invoice-pay] pending_verification update matched 0 rows: invoice ${invoice.id} intent ${piId}`);
    return false;
  }
  return true;
}
