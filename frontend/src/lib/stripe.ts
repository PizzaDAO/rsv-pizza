import { loadStripe, Stripe } from '@stripe/stripe-js';

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();

// Singleton stripe instance
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe() {
  if (!stripePromise && STRIPE_PUBLISHABLE_KEY) {
    stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}

// sec-edge-functions: every Stripe server call goes through the backend
// (/api/stripe-payments/*), which validates amounts and sets metadata itself.
// Virtual cards, card reveal and payment capture are no longer callable from
// the browser at all: the backend issues the card for an AI call and reads it
// to the pizzeria directly.
async function callPaymentsApi<T>(path: string, body: Record<string, unknown>, auth = false): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = localStorage.getItem('authToken');
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${API_URL}/api/stripe-payments/${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    // backend errors are { error: { message, code } }; e.g. 503 STRIPE_NOT_CONFIGURED
    const msg =
      (data?.error && typeof data.error === 'object' && data.error.message) ||
      (typeof data?.error === 'string' && data.error) ||
      data?.message ||
      'Payment request failed';
    throw new Error(msg);
  }
  return data as T;
}

// Get a SetupIntent (and the caller's own Stripe customer) for saving a card. Login required.
export async function createSetupIntent(): Promise<{ customerId: string; clientSecret: string }> {
  return callPaymentsApi('setup-intent', {}, true);
}

// Create a donation PaymentIntent. The server checks the party and bounds the amount.
export async function createDonationIntent(params: {
  partyId: string;
  amount: number; // cents
  customerEmail?: string;
  customerName?: string;
}): Promise<{ paymentIntentId: string; clientSecret: string; status: string }> {
  return callPaymentsApi('donation-intent', { ...params, currency: 'usd' });
}

// Create an invoice PaymentIntent. Amount and currency come from the invoice on the server.
export async function createInvoiceIntent(
  viewToken: string
): Promise<{ paymentIntentId: string; clientSecret: string; status: string }> {
  return callPaymentsApi('invoice-intent', { viewToken });
}

// Estimate order total based on pizzas (rough estimate)
export function estimateOrderTotal(pizzaCount: number, avgPizzaPrice: number = 18): number {
  // Add 20% buffer for tax, fees, potential upsells
  const subtotal = pizzaCount * avgPizzaPrice;
  const buffer = subtotal * 0.2;
  return Math.ceil((subtotal + buffer) * 100); // Return in cents
}

// Format currency for display
export function formatCurrency(cents: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(cents / 100);
}

// Storage keys for customer info
const STORAGE_KEY_CUSTOMER_ID = 'rsvpizza_stripe_customer_id';
const STORAGE_KEY_CUSTOMER_EMAIL = 'rsvpizza_customer_email';
const STORAGE_KEY_HAS_PAYMENT_METHOD = 'rsvpizza_has_payment_method';

// Get stored customer ID
export function getStoredCustomerId(): string | null {
  return localStorage.getItem(STORAGE_KEY_CUSTOMER_ID);
}

// Store customer ID
export function storeCustomerId(customerId: string): void {
  localStorage.setItem(STORAGE_KEY_CUSTOMER_ID, customerId);
}

// Get stored customer email
export function getStoredCustomerEmail(): string | null {
  return localStorage.getItem(STORAGE_KEY_CUSTOMER_EMAIL);
}

// Store customer email
export function storeCustomerEmail(email: string): void {
  localStorage.setItem(STORAGE_KEY_CUSTOMER_EMAIL, email);
}

// Check if user has saved payment method
export function hasStoredPaymentMethod(): boolean {
  return localStorage.getItem(STORAGE_KEY_HAS_PAYMENT_METHOD) === 'true';
}

// Mark that user has saved payment method
export function setHasPaymentMethod(has: boolean): void {
  localStorage.setItem(STORAGE_KEY_HAS_PAYMENT_METHOD, has.toString());
}
