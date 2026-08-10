import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import Stripe from 'https://esm.sh/stripe@14.11.0?target=deno';

const STRIPE_SECRET_KEY = Deno.env.get('STRIPE_SECRET_KEY') || '';
const STRIPE_ISSUING_CARDHOLDER_ID = Deno.env.get('STRIPE_ISSUING_CARDHOLDER_ID') || '';
const STRIPE_PAYMENT_METHOD_CONFIG = Deno.env.get('STRIPE_PAYMENT_METHOD_CONFIG') || '';

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

interface CreateOrderPaymentRequest {
  action: 'create_order_payment';
  amount: number; // in cents
  orderId: string;
  partyId: string;
  pizzeriaName: string;
  customerEmail?: string;
}

interface RefundPaymentRequest {
  action: 'refund_payment';
  paymentIntentId: string;
  reason?: string;
}

type StripeRequest =
  | CreatePaymentIntentRequest
  | CreateVirtualCardRequest
  | GetVirtualCardRequest
  | CapturePaymentRequest
  | CreateCustomerRequest
  | GetSetupIntentRequest
  | CreateDonationIntentRequest
  | GetDonationStatusRequest
  | CreateOrderPaymentRequest
  | RefundPaymentRequest;

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
          payment_method_options: {
            card: {
              request_three_d_secure: 'any',
            },
          },
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
          payment_method_types: ['card'],
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
        // Use automatic_payment_methods to support cards, Klarna, Amazon Pay, etc.
        const donationIntent = await stripe.paymentIntents.create({
          amount: request.amount,
          currency: request.currency || 'usd',
          capture_method: 'automatic', // Immediate capture for donations
          automatic_payment_methods: { enabled: true },
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

      case 'create_order_payment': {
        // Sanitize pizzeria name for statement descriptor (alphanumeric + spaces only, max 22 chars)
        const sanitizedPizzeriaName = request.pizzeriaName
          .replace(/[^a-zA-Z0-9 ]/g, '')
          .trim()
          .substring(0, 22);

        // Build PaymentIntent params
        const orderPaymentParams: Record<string, unknown> = {
          amount: request.amount,
          currency: 'usd',
          capture_method: 'automatic',
          payment_method_options: {
            card: {
              request_three_d_secure: 'any',
            },
          },
          receipt_email: request.customerEmail,
          statement_descriptor_suffix: sanitizedPizzeriaName,
          metadata: {
            type: 'order_payment',
            orderId: request.orderId,
            partyId: request.partyId,
            pizzeriaName: request.pizzeriaName,
          },
        };

        // Only include payment_method_configuration if the env var is set
        if (STRIPE_PAYMENT_METHOD_CONFIG) {
          orderPaymentParams.payment_method_configuration = STRIPE_PAYMENT_METHOD_CONFIG;
        } else {
          // Fallback: just enable cards via automatic_payment_methods
          orderPaymentParams.automatic_payment_methods = { enabled: true };
        }

        const orderPaymentIntent = await stripe.paymentIntents.create(orderPaymentParams as Stripe.PaymentIntentCreateParams);

        return new Response(
          JSON.stringify({
            success: true,
            paymentIntentId: orderPaymentIntent.id,
            clientSecret: orderPaymentIntent.client_secret,
            status: orderPaymentIntent.status,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      case 'refund_payment': {
        const refund = await stripe.refunds.create({
          payment_intent: request.paymentIntentId,
          reason: (request.reason as Stripe.RefundCreateParams.Reason) || 'requested_by_customer',
        });

        return new Response(
          JSON.stringify({
            success: true,
            refundId: refund.id,
            status: refund.status,
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
