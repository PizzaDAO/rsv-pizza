import { AppError } from '../middleware/error.js';

/**
 * sec-edge-functions: minimal fetch-based Stripe client (no SDK dependency). Every Stripe call
 * that moves money or reveals card data runs here, behind requireAuth / server-side validation,
 * never from the browser or from an anon-key-callable edge function.
 *
 * Env: STRIPE_SECRET_KEY (same name the old `stripe-payment` edge function read). Until it is set
 * on the backend, every caller fails closed with 503 STRIPE_NOT_CONFIGURED.
 */

const STRIPE_API = 'https://api.stripe.com/v1';

export class StripeNotConfiguredError extends AppError {
  constructor() {
    super('Card payments are not configured yet. Please try again later.', 503, 'STRIPE_NOT_CONFIGURED');
    this.name = 'StripeNotConfiguredError';
  }
}

export class StripeApiError extends AppError {
  constructor(message: string, public stripeStatus: number, public stripeCode?: string) {
    // card errors are the caller's problem (402); anything else is an upstream failure (502)
    super(message, stripeStatus === 402 ? 402 : 502, 'STRIPE_ERROR');
    this.name = 'StripeApiError';
  }
}

type Params = Record<string, unknown>;

/** application/x-www-form-urlencoded with Stripe's bracket notation for nested objects/arrays. */
export function encodeForm(params: Params, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item !== null && typeof item === 'object') out.push(...encodeForm(item as Params, `${key}[${i}]`));
        else out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(item))}`);
      });
    } else if (typeof v === 'object') {
      out.push(...encodeForm(v as Params, key));
    } else {
      out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
    }
  }
  return out;
}

async function call<T>(method: 'GET' | 'POST', path: string, params: Params = {}): Promise<T> {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new StripeNotConfiguredError();
  const form = encodeForm(params).join('&');
  const url = method === 'GET' && form ? `${STRIPE_API}${path}?${form}` : `${STRIPE_API}${path}`;
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(method === 'POST' ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
    },
    body: method === 'POST' ? form : undefined,
  });
  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    // never echo request params (could include card numbers in other contexts); message only
    const msg = data?.error?.message || `Stripe request failed (${res.status})`;
    console.error('Stripe API error', method, path.replace(/\/(ic|pi|cus|seti)_[A-Za-z0-9]+/g, '/$1_…'), res.status, data?.error?.code);
    throw new StripeApiError(msg, res.status, data?.error?.code);
  }
  return data as T;
}

export interface StripeList<T> {
  data: T[];
}
export interface PaymentIntentLike {
  id: string;
  client_secret: string | null;
  status: string;
}
export interface IssuingCardLike {
  id: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  number?: string;
  cvc?: string;
  metadata?: Record<string, string>;
}

/** The subset of Stripe this backend uses; tests inject a fake with the same shape. */
export interface StripeLike {
  paymentIntents: { create(p: Params): Promise<PaymentIntentLike> };
  setupIntents: { create(p: Params): Promise<{ client_secret: string | null }> };
  customers: {
    search(p: { query: string; limit?: number }): Promise<StripeList<{ id: string }>>;
    create(p: Params): Promise<{ id: string }>;
  };
  issuing: {
    cards: {
      list(p: Params): Promise<StripeList<IssuingCardLike>>;
      create(p: Params): Promise<IssuingCardLike>;
      retrieve(id: string, p?: { expand?: string[] }): Promise<IssuingCardLike>;
      update(id: string, p: Params): Promise<IssuingCardLike>;
    };
  };
}

const seg = (id: string) => encodeURIComponent(id);

const fetchClient: StripeLike = {
  paymentIntents: { create: (p) => call('POST', '/payment_intents', p) },
  setupIntents: { create: (p) => call('POST', '/setup_intents', p) },
  customers: {
    search: (p) => call('GET', '/customers/search', p),
    create: (p) => call('POST', '/customers', p),
  },
  issuing: {
    cards: {
      list: (p) => call('GET', '/issuing/cards', p),
      create: (p) => call('POST', '/issuing/cards', p),
      retrieve: (id, p = {}) => call('GET', `/issuing/cards/${seg(id)}`, p),
      update: (id, p) => call('POST', `/issuing/cards/${seg(id)}`, p),
    },
  },
};

let override: StripeLike | null = null;

/** Throws StripeNotConfiguredError (503) when STRIPE_SECRET_KEY is unset. */
export function getStripe(): StripeLike {
  if (override) return override;
  if (!process.env.STRIPE_SECRET_KEY) throw new StripeNotConfiguredError();
  return fetchClient;
}

/** Tests only: inject a fake client (pass null to reset). */
export function setStripeClientForTests(fake: unknown): void {
  override = fake as StripeLike | null;
}
