import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { SquareOrderRequest, SquareOrderResponse } from '../_shared/types.ts';

const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') || '';
const SQUARE_ENVIRONMENT = Deno.env.get('SQUARE_ENVIRONMENT') || 'sandbox'; // 'sandbox' or 'production'

const SQUARE_API_BASE = SQUARE_ENVIRONMENT === 'production'
  ? 'https://connect.squareup.com'
  : 'https://connect.squareupsandbox.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Generate a unique idempotency key
function generateIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 15)}`;
}

// Create an order in Square
async function createSquareOrder(request: SquareOrderRequest): Promise<SquareOrderResponse> {
  const idempotencyKey = generateIdempotencyKey();

  // Build line items from pizza order
  const lineItems = request.items.map((item, index) => ({
    uid: `pizza-${index}`,
    name: item.name,
    quantity: item.quantity.toString(),
    note: [
      `Size: ${item.size}`,
      item.toppings.length > 0 ? `Toppings: ${item.toppings.join(', ')}` : null,
      item.dietaryNotes.length > 0 ? `Dietary: ${item.dietaryNotes.join(', ')}` : null,
    ].filter(Boolean).join(' | '),
    // For ad-hoc items without catalog, we use base_price_money
    // In production, you'd map to actual catalog item IDs
    base_price_money: item.priceEstimate ? {
      amount: Math.round(item.priceEstimate * 100), // Convert to cents
      currency: 'USD',
    } : undefined,
  }));

  // Build fulfillment
  const fulfillment = {
    uid: 'fulfillment-1',
    type: request.fulfillmentType,
    state: 'PROPOSED',
    ...(request.fulfillmentType === 'PICKUP' ? {
      pickup_details: {
        recipient: {
          display_name: request.customerName,
          phone_number: request.customerPhone,
          email_address: request.customerEmail,
        },
        schedule_type: request.scheduledTime ? 'SCHEDULED' : 'ASAP',
        pickup_at: request.scheduledTime,
      },
    } : {
      delivery_details: {
        recipient: {
          display_name: request.customerName,
          phone_number: request.customerPhone,
          email_address: request.customerEmail,
          address: request.deliveryAddress ? {
            address_line_1: request.deliveryAddress,
          } : undefined,
        },
        schedule_type: request.scheduledTime ? 'SCHEDULED' : 'ASAP',
        deliver_at: request.scheduledTime,
      },
    }),
  };

  // Create order
  const orderResponse = await fetch(`${SQUARE_API_BASE}/v2/orders`, {
    method: 'POST',
    headers: {
      'Square-Version': '2024-01-18',
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      order: {
        location_id: request.locationId,
        line_items: lineItems,
        fulfillments: [fulfillment],
      },
    }),
  });

  const orderData = await orderResponse.json();

  if (!orderResponse.ok) {
    console.error('Square order creation failed:', orderData);
    return {
      success: false,
      error: orderData.errors?.[0]?.detail || 'Failed to create order',
    };
  }

  const orderId = orderData.order.id;

  // Create a payment link for the order
  const paymentLinkResponse = await fetch(`${SQUARE_API_BASE}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers: {
      'Square-Version': '2024-01-18',
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      idempotency_key: `${idempotencyKey}-payment`,
      payment_link: {
        order_id: orderId,
        description: `Pizza Party Order`,
      },
    }),
  });

  const paymentLinkData = await paymentLinkResponse.json();

  if (!paymentLinkResponse.ok) {
    console.error('Square payment link creation failed:', paymentLinkData);
    // Order was created but payment link failed - return order ID anyway
    return {
      success: true,
      orderId,
      error: 'Order created but payment link failed. Please pay at the restaurant.',
    };
  }

  return {
    success: true,
    orderId,
    checkoutUrl: paymentLinkData.payment_link?.url,
  };
}

// Get order status
async function getOrderStatus(orderId: string): Promise<any> {
  const response = await fetch(`${SQUARE_API_BASE}/v2/orders/${orderId}`, {
    headers: {
      'Square-Version': '2024-01-18',
      'Authorization': `Bearer ${SQUARE_ACCESS_TOKEN}`,
    },
  });

  return response.json();
}

// Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!SQUARE_ACCESS_TOKEN) {
      return new Response(
        JSON.stringify({ error: 'Square API not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const url = new URL(req.url);
    const path = url.pathname.split('/').pop();

    // GET /square-order?orderId=xxx - Get order status
    if (req.method === 'GET' && url.searchParams.has('orderId')) {
      const orderId = url.searchParams.get('orderId')!;
      const status = await getOrderStatus(orderId);
      return new Response(
        JSON.stringify(status),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // POST /square-order - Create new order
    if (req.method === 'POST') {
      const request: SquareOrderRequest = await req.json();

      if (!request.locationId) {
        return new Response(
          JSON.stringify({ error: 'locationId is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (!request.items || request.items.length === 0) {
        return new Response(
          JSON.stringify({ error: 'items are required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const result = await createSquareOrder(request);
      return new Response(
        JSON.stringify(result),
        {
          status: result.success ? 200 : 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      );
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Square order error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
