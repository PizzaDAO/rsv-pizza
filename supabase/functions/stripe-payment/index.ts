import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const STRIPE_ISSUING_CARDHOLDER_ID = Deno.env.get('STRIPE_ISSUING_CARDHOLDER_ID') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Initialize Stripe
const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: '2023-10-16',
  httpClient: Stripe.createFetchHttpClient(),
});

interface CreatePaymentIntentRequest {
  action: 'create_payment_intent';
  amount: number; // in cents
  customerId?: string;
  customerEmail?: string;
  metadata?: Record<string, string>;
}

interface CreateVirtualCardRequest {
  action: 'create_virtual_card';
  spendingLimit: number; // in cents
  orderId: string;
  pizzeriaName: string;
}

interface GetVirtualCardRequest {
  action: 'get_virtual_card';
  cardId: string;
}

interface CapturePaymentRequest {
  action: 'capture_payment';
  paymentIntentId: string;
  amount?: number; // Optional: capture different amount than authorized
}

interface CreateCustomerRequest {
  action: 'create_customer';
  email: string;
  name?: string;
}

interface GetSetupIntentRequest {
  action: 'get_setup_intent';
  customerId: string;
}

interface CreateDonationIntentRequest {
  action: 'create_donation_intent';
  amount: number; // in cents
  currency?: string;
  customerEmail?: string;
  customerName?: string;
  partyId: string;
  metadata?: Record<string, string>;
}

interface GetDonationStatusRequest {
  action: 'get_donation_status';
  paymentIntentId: string;
}

type StripeRequest =
  | CreatePaymentIntentRequest
  | CreateVirtualCardRequest
  | GetVirtualCardRequest
  | CapturePaymentRequest
  | CreateCustomerRequest
  | GetSetupIntentRequest
  | CreateDonationIntentRequest
  | GetDonationStatusRequest;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!STRIPE_SECRET_KEY) {
      return new Response(
        JSON.stringify({ error: 'Stripe API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const request: StripeRequest = await req.json();

    switch (request.action) {
      case 'create_customer': {
        const customer = await stripe.customers.create({
          email: request.email,
          name: request.name,
          metadata: {
            source: 'rsvpizza',
          },
        });

        return new Response(
          JSON.stringify({ success: true, customerId: customer.id }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_setup_intent': {
        // Create a SetupIntent for collecting payment method
        const setupIntent = await stripe.setupIntents.create({
          customer: request.customerId,
          payment_method_types: ['card'],
          usage: 'off_session', // Allow charging later without customer present
        });

        return new Response(
          JSON.stringify({
            success: true,
            clientSecret: setupIntent.client_secret,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create_payment_intent': {
        // Create a payment intent with manual capture (pre-authorization)
        const paymentIntent = await stripe.paymentIntents.create({
          amount: request.amount,
          currency: 'usd',
          customer: request.customerId,
          capture_method: 'manual', // Pre-authorize, capture later
          metadata: request.metadata || {},
        });

        return new Response(
          JSON.stringify({
            success: true,
            paymentIntentId: paymentIntent.id,
            clientSecret: paymentIntent.client_secret,
            status: paymentIntent.status,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create_virtual_card': {
        if (!STRIPE_ISSUING_CARDHOLDER_ID) {
          return new Response(
            JSON.stringify({ error: 'Stripe Issuing cardholder not configured' }),
            { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Create a virtual card for this specific order
        const card = await stripe.issuing.cards.create({
          cardholder: STRIPE_ISSUING_CARDHOLDER_ID,
          type: 'virtual',
          currency: 'usd',
          status: 'active',
          spending_controls: {
            spending_limits: [
              {
                amount: request.spendingLimit,
                interval: 'per_authorization',
              },
            ],
            allowed_categories: ['eating_places_restaurants', 'fast_food_restaurants'],
          },
          metadata: {
            orderId: request.orderId,
            pizzeriaName: request.pizzeriaName,
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            cardId: card.id,
            last4: card.last4,
            expMonth: card.exp_month,
            expYear: card.exp_year,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_virtual_card': {
        // Retrieve full card details (including number and CVC)
        // Note: This requires expanded permissions
        const card = await stripe.issuing.cards.retrieve(request.cardId, {
          expand: ['number', 'cvc'],
        });

        return new Response(
          JSON.stringify({
            success: true,
            cardId: card.id,
            number: (card as any).number,
            cvc: (card as any).cvc,
            expMonth: card.exp_month,
            expYear: card.exp_year,
            last4: card.last4,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'capture_payment': {
        const captureParams: Stripe.PaymentIntentCaptureParams = {};
        if (request.amount) {
          captureParams.amount_to_capture = request.amount;
        }

        const paymentIntent = await stripe.paymentIntents.capture(
          request.paymentIntentId,
          captureParams
        );

        return new Response(
          JSON.stringify({
            success: true,
            paymentIntentId: paymentIntent.id,
            status: paymentIntent.status,
            amount: paymentIntent.amount_received,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'create_donation_intent': {
        // Create a payment intent for immediate capture (donation)
        const donationIntent = await stripe.paymentIntents.create({
          amount: request.amount,
          currency: request.currency || 'usd',
          capture_method: 'automatic', // Immediate capture for donations
          receipt_email: request.customerEmail,
          metadata: {
            type: 'donation',
            partyId: request.partyId,
            donorName: request.customerName || '',
            ...(request.metadata || {}),
          },
        });

        return new Response(
          JSON.stringify({
            success: true,
            paymentIntentId: donationIntent.id,
            clientSecret: donationIntent.client_secret,
            status: donationIntent.status,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'get_donation_status': {
        const donationStatus = await stripe.paymentIntents.retrieve(
          request.paymentIntentId
        );

        return new Response(
          JSON.stringify({
            success: true,
            paymentIntentId: donationStatus.id,
            status: donationStatus.status,
            amount: donationStatus.amount,
            chargeId: donationStatus.latest_charge,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      default:
        return new Response(
          JSON.stringify({ error: 'Invalid action' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
    }
  } catch (error) {
    console.error('Stripe payment error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
