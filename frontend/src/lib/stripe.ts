import { loadStripe, Stripe } from '@stripe/stripe-js';

const STRIPE_PUBLISHABLE_KEY = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY || '';
const SUPABASE_URL = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw';

// Singleton stripe instance
let stripePromise: Promise<Stripe | null> | null = null;

export function getStripe() {
  if (!stripePromise && STRIPE_PUBLISHABLE_KEY) {
    stripePromise = loadStripe(STRIPE_PUBLISHABLE_KEY);
  }
  return stripePromise;
}

// Helper to call Stripe Edge Function
async function callStripeFunction<T>(body: Record<string, unknown>): Promise<T> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/stripe-payment`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || 'Stripe request failed');
  }
  return data;
}

// Create a Stripe customer
export async function createStripeCustomer(email: string, name?: string): Promise<{ customerId: string }> {
  return callStripeFunction({
    action: 'create_customer',
    email,
    name,
  });
}

// Get a SetupIntent for saving payment method
export async function getSetupIntent(customerId: string): Promise<{ clientSecret: string }> {
  return callStripeFunction({
    action: 'get_setup_intent',
    customerId,
  });
}

// Create a pre-authorized payment intent
export async function createPaymentIntent(
  amount: number, // in cents
  customerId?: string,
  customerEmail?: string,
  metadata?: Record<string, string>
): Promise<{
  paymentIntentId: string;
  clientSecret: string;
  status: string;
}> {
  return callStripeFunction({
    action: 'create_payment_intent',
    amount,
    customerId,
    customerEmail,
    metadata,
  });
}

// Capture a pre-authorized payment
export async function capturePayment(
  paymentIntentId: string,
  amount?: number // Optional: capture different amount than authorized
): Promise<{
  paymentIntentId: string;
  status: string;
  amount: number;
}> {
  return callStripeFunction({
    action: 'capture_payment',
    paymentIntentId,
    amount,
  });
}

// Create a virtual card for order payment
export async function createVirtualCard(
  spendingLimit: number, // in cents
  orderId: string,
  pizzeriaName: string
): Promise<{
  cardId: string;
  last4: string;
  expMonth: number;
  expYear: number;
}> {
  return callStripeFunction({
    action: 'create_virtual_card',
    spendingLimit,
    orderId,
    pizzeriaName,
  });
}

// Get virtual card details (including full number for AI to use)
export async function getVirtualCardDetails(cardId: string): Promise<{
  cardId: string;
  number: string;
  cvc: string;
  expMonth: number;
  expYear: number;
  last4: string;
}> {
  return callStripeFunction({
    action: 'get_virtual_card',
    cardId,
  });
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
