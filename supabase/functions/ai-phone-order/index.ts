import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const BLAND_API_KEY = Deno.env.get('BLAND_API_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface OrderItem {
  name: string;
  quantity: number;
  size: string;
  toppings: string[];
  dietaryNotes: string[];
}

interface PhoneOrderRequest {
  pizzeriaName: string;
  pizzeriaPhone: string;
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryAddress?: string;
  scheduledTime?: string;
}

// Generate the order script for the AI
function generateOrderScript(request: PhoneOrderRequest): string {
  const { pizzeriaName, items, customerName, fulfillmentType, deliveryAddress, scheduledTime } = request;

  let itemsDescription = items.map(item => {
    let desc = `${item.quantity} ${item.size} ${item.name}`;
    if (item.toppings.length > 0) {
      desc += ` with ${item.toppings.join(', ')}`;
    }
    if (item.dietaryNotes.length > 0) {
      desc += `. Please note: ${item.dietaryNotes.join(', ')}`;
    }
    return desc;
  }).join('. ');

  let script = `Hi, I'd like to place an order for ${fulfillmentType}. `;
  script += `The order is: ${itemsDescription}. `;
  script += `The name for the order is ${customerName}. `;

  if (fulfillmentType === 'delivery' && deliveryAddress) {
    script += `The delivery address is ${deliveryAddress}. `;
  }

  if (scheduledTime) {
    script += `I'd like this for ${scheduledTime}. `;
  }

  return script;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!BLAND_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Bland AI API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const request: PhoneOrderRequest = await req.json();

    if (!request.pizzeriaPhone || !request.items || request.items.length === 0) {
      return new Response(
        JSON.stringify({ error: 'pizzeriaPhone and items are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean phone number (remove non-digits except leading +)
    const cleanPhone = request.pizzeriaPhone.replace(/[^\d+]/g, '');

    // Generate the task/script for the AI
    const orderScript = generateOrderScript(request);

    // Call Bland AI to initiate the phone call
    const blandResponse = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        'Authorization': BLAND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: cleanPhone,
        task: orderScript,
        voice: 'maya', // Natural female voice
        first_sentence: `Hi, I'd like to place an order for ${request.fulfillmentType} please.`,
        wait_for_greeting: true,
        record: true,
        max_duration: 5, // 5 minutes max
        model: 'enhanced',
        language: 'en',
        answered_by_enabled: true,
        // Webhook for status updates (optional)
        // webhook: 'https://your-webhook-url.com/bland-callback',
        metadata: {
          customerName: request.customerName,
          customerPhone: request.customerPhone,
          pizzeriaName: request.pizzeriaName,
          itemCount: request.items.length,
        },
      }),
    });

    const blandData = await blandResponse.json();

    if (!blandResponse.ok) {
      console.error('Bland AI error:', blandData);
      return new Response(
        JSON.stringify({ error: blandData.message || 'Failed to initiate call' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    return new Response(
      JSON.stringify({
        success: true,
        callId: blandData.call_id,
        status: blandData.status,
        message: `AI is calling ${request.pizzeriaName} to place your order. You'll receive a confirmation when complete.`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Phone order error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
