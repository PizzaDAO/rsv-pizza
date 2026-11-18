import { getStripe } from '../lib/stripeClient.js';
import { AppError } from '../middleware/error.js';

/**
 * sec-edge-functions: Stripe Issuing virtual cards for AI phone orders.
 *
 * Replaces the `create_virtual_card` / `get_virtual_card` actions of the old `stripe-payment`
 * edge function, which anyone holding the public anon key could call (any spending limit, and the
 * full PAN/CVC came back to the caller). Now:
 *   - only the backend creates cards, for a party the caller can edit (checked by the route);
 *   - the spending limit is computed here from the pizza count, with a hard cap, and is an
 *     ALL-TIME limit (the old per-authorization limit let one card be charged again and again);
 *   - the number/CVC are fetched here and handed straight to Bland; they are never returned to
 *     the browser, logged, or stored.
 */

export const CARD_SOURCE = 'rsvpizza-ai-phone';

/** Same estimate the frontend showed (estimateOrderTotal: $18/pizza + 20% buffer), in cents. */
export const PER_PIZZA_CENTS = 1800;
export const BUFFER_RATIO = 0.2;
export const MAX_PIZZAS_PER_CARD_ORDER = 50;

function intEnv(name: string, fallback: number): number {
  const n = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Hard cap on one card's all-time spend (default $500). */
export function maxCardLimitCents(): number {
  return intEnv('AI_PHONE_CARD_MAX_CENTS', 50_000);
}
/** Cards one user may get in 24 h (default 3). */
export function maxCardsPerUserPerDay(): number {
  return intEnv('AI_PHONE_CARD_MAX_PER_USER_PER_DAY', 3);
}
/** Cards across the whole site in 24 h (default 20). */
export function maxCardsPerDay(): number {
  return intEnv('AI_PHONE_CARD_MAX_PER_DAY', 20);
}

/** Server-decided spending limit for an order of `totalPizzas` pizzas. */
export function computeSpendingLimitCents(totalPizzas: number): number {
  if (!Number.isInteger(totalPizzas) || totalPizzas < 1) {
    throw new AppError('Order must contain at least one pizza', 400, 'VALIDATION_ERROR');
  }
  if (totalPizzas > MAX_PIZZAS_PER_CARD_ORDER) {
    throw new AppError(
      `Card payment is limited to ${MAX_PIZZAS_PER_CARD_ORDER} pizzas per order`,
      400,
      'CARD_LIMIT_EXCEEDED'
    );
  }
  const subtotal = totalPizzas * PER_PIZZA_CENTS;
  const estimate = Math.ceil(subtotal * (1 + BUFFER_RATIO));
  return Math.min(estimate, maxCardLimitCents());
}

export interface VirtualCardSecret {
  cardId: string;
  number: string;
  cvc: string;
  expMonth: number;
  expYear: number;
  last4: string;
}

function cardholderId(): string {
  const id = process.env.STRIPE_ISSUING_CARDHOLDER_ID;
  if (!id) throw new AppError('Card payments are not configured yet. Please try again later.', 503, 'CARD_NOT_CONFIGURED');
  return id;
}

/** 503 unless STRIPE_SECRET_KEY and STRIPE_ISSUING_CARDHOLDER_ID are both set. */
export function assertCardPaymentsConfigured(): void {
  getStripe();
  cardholderId();
}

/** Throws 429 when the per-user or site-wide 24 h card quota is used up. */
async function assertCardQuota(userId: string, cardholder: string): Promise<void> {
  const stripe = getStripe();
  const since = Math.floor(Date.now() / 1000) - 24 * 3600;
  const list = await stripe.issuing.cards.list({ cardholder, created: { gte: since }, limit: 100 });
  const ours = list.data.filter((c) => c.metadata?.source === CARD_SOURCE);
  if (ours.length >= maxCardsPerDay()) {
    throw new AppError('Card payments are temporarily unavailable. Try again later.', 429, 'CARD_QUOTA');
  }
  if (ours.filter((c) => c.metadata?.userId === userId).length >= maxCardsPerUserPerDay()) {
    throw new AppError('You have reached the daily limit for card-paid AI orders.', 429, 'CARD_QUOTA');
  }
}

export async function createOrderVirtualCard(opts: {
  userId: string;
  partyId: string;
  aiPhoneCallId: string;
  pizzeriaName: string;
  spendingLimitCents: number;
}): Promise<VirtualCardSecret> {
  const cardholder = cardholderId();
  await assertCardQuota(opts.userId, cardholder);

  const stripe = getStripe();
  const card = await stripe.issuing.cards.create({
    cardholder,
    type: 'virtual',
    currency: 'usd',
    status: 'active',
    spending_controls: {
      spending_limits: [{ amount: opts.spendingLimitCents, interval: 'all_time' }],
      allowed_categories: ['eating_places_restaurants', 'fast_food_restaurants'],
    },
    metadata: {
      source: CARD_SOURCE,
      userId: opts.userId,
      partyId: opts.partyId,
      aiPhoneCallId: opts.aiPhoneCallId,
      pizzeriaName: opts.pizzeriaName.slice(0, 200),
    },
  });

  return retrieveCardSecret(card.id);
}

/** Full card details, server-side only. Never send the result to a client. */
export async function retrieveCardSecret(cardId: string): Promise<VirtualCardSecret> {
  const stripe = getStripe();
  const card = (await stripe.issuing.cards.retrieve(cardId, { expand: ['number', 'cvc'] })) as unknown as {
    id: string;
    number?: string;
    cvc?: string;
    exp_month: number;
    exp_year: number;
    last4: string;
  };
  if (!card.number || !card.cvc) {
    throw new AppError('Card details unavailable', 502, 'CARD_DETAILS_UNAVAILABLE');
  }
  return {
    cardId: card.id,
    number: card.number,
    cvc: card.cvc,
    expMonth: card.exp_month,
    expYear: card.exp_year,
    last4: card.last4,
  };
}

/** Deactivate a card (used when the Bland call could not be started). Best effort. */
export async function deactivateCard(cardId: string): Promise<void> {
  try {
    await getStripe().issuing.cards.update(cardId, { status: 'inactive' });
  } catch (err) {
    console.error('Failed to deactivate virtual card', cardId, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Redaction: transcripts of card-paid calls contain the card read aloud.
// ---------------------------------------------------------------------------

const REDACTED = '[redacted]';

function digitsPattern(digits: string): string {
  // allow spaces / dashes between digits, as the prompt reads the number in groups of four
  return digits.split('').join('[\\s-]*');
}

/**
 * Removes card data from a transcript. Always masks anything shaped like a card number
 * (13-19 digits with optional separators); when the card is known, also masks its exact number,
 * CVC and expiry.
 */
export function redactCardData(
  text: string | null | undefined,
  card?: Pick<VirtualCardSecret, 'number' | 'cvc' | 'expMonth' | 'expYear'> | null
): string {
  if (!text) return '';
  let out = text;
  if (card) {
    const num = card.number.replace(/\D/g, '');
    if (num) out = out.replace(new RegExp(digitsPattern(num), 'g'), REDACTED);
    const cvc = card.cvc.replace(/\D/g, '');
    if (cvc) out = out.replace(new RegExp(`(?<!\\d)${digitsPattern(cvc)}(?!\\d)`, 'g'), REDACTED);
    const mm = String(card.expMonth).padStart(2, '0');
    const yy = String(card.expYear).slice(-2);
    out = out.replace(new RegExp(`(?<!\\d)0?${Number(mm)}\\s*(?:/|slash|-)\\s*(?:20)?${yy}(?!\\d)`, 'gi'), REDACTED);
  }
  out = out.replace(/(?<!\d)\d(?:[\s-]*\d){12,18}(?!\d)/g, REDACTED);
  return out;
}
