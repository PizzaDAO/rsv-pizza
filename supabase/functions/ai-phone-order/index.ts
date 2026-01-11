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
  partySize?: number;
}

// Build the AI agent prompt for ordering
function buildAgentPrompt(request: PhoneOrderRequest): string {
  const { items, customerName, customerPhone, fulfillmentType, deliveryAddress, partySize } = request;

  // Calculate totals
  const totalPizzas = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalGuests = partySize || items.reduce((sum, item) => sum + item.quantity * 2, 0); // Estimate 2 people per pizza

  // Build the base order description
  const orderDescription = items.map(item => {
    let desc = `${item.quantity}x ${item.size} pizza`;
    if (item.toppings.length > 0) {
      desc += ` with ${item.toppings.join(', ')}`;
    }
    if (item.dietaryNotes.length > 0) {
      desc += ` (${item.dietaryNotes.join(', ')})`;
    }
    return desc;
  }).join('\n- ');

  return `You are a friendly assistant placing a pizza order for a party. You're ordering for ${totalGuests} people.

## Your Goal
Place a pizza order while being open to the pizzeria's suggestions and specials. You want to get the best value and variety for the party.

## Customer Information
- Name: ${customerName}
- Phone: ${customerPhone}
- Order Type: ${fulfillmentType}${fulfillmentType === 'delivery' && deliveryAddress ? `\n- Delivery Address: ${deliveryAddress}` : ''}

## Base Order (${totalPizzas} pizzas)
- ${orderDescription}

## Instructions

1. **Start by greeting and asking about specials**: "Hi, I'd like to place a large order for a party. Before I give you the details, do you have any specials or deals for large orders?"

2. **Be flexible with the order**: If they have good specials (like "buy 2 get 1 free" or a "party pack"), adjust the order to take advantage of them. The base order is a guide, not a strict requirement.

3. **Dietary restrictions are firm**: If an item has dietary notes (vegetarian, vegan, gluten-free), those MUST be respected. Don't substitute those items with non-compliant options.

4. **Ask about popular items**: "What's your most popular pizza?" or "Any house specialties you'd recommend?" - Consider swapping 1-2 of the basic pizzas for their recommendations.

5. **Confirm sizes**: If they don't have the exact size, accept their closest equivalent.

6. **Handle unavailable toppings gracefully**: If a topping isn't available, ask for a similar substitute or just skip it.

7. **Get the total and confirm**: Always confirm the final order and total price before completing.

8. **Provide contact info**: Give the customer phone number (${customerPhone}) for order confirmation.

## Example Conversation Flow
- "Hi, I'd like to place a large order for pickup. Do you have any specials for big orders?"
- [Listen to specials]
- "That sounds great! I'll take [adjusted order based on specials]. I also need [dietary-specific items]."
- "What's your most popular specialty pizza? I'd like to add one of those too."
- "Great, can I confirm the order? [repeat back]. The name is ${customerName}, phone ${customerPhone}."
- "What's the total and how long will it be ready?"

Remember: You're trying to get good value and variety. Don't be afraid to deviate from the base order if the pizzeria has better suggestions!`;
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

    if (!request.customerName || !request.customerPhone) {
      return new Response(
        JSON.stringify({ error: 'customerName and customerPhone are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Clean phone number (remove non-digits except leading +)
    const cleanPhone = request.pizzeriaPhone.replace(/[^\d+]/g, '');

    // Build the AI agent prompt
    const agentPrompt = buildAgentPrompt(request);

    // Calculate total pizzas for the greeting
    const totalPizzas = request.items.reduce((sum, item) => sum + item.quantity, 0);

    // Call Bland AI to initiate the phone call
    const blandResponse = await fetch('https://api.bland.ai/v1/calls', {
      method: 'POST',
      headers: {
        'Authorization': BLAND_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        phone_number: cleanPhone,
        task: agentPrompt,
        voice: 'maya', // Natural female voice
        first_sentence: `Hi there! I'd like to place a large order for ${request.fulfillmentType} - about ${totalPizzas} pizzas for a party. Do you have any specials or deals for large orders?`,
        wait_for_greeting: true,
        record: true,
        max_duration: 8, // 8 minutes max for larger orders with back-and-forth
        model: 'enhanced',
        language: 'en',
        answered_by_enabled: true,
        temperature: 0.7, // Allow some creativity in responses
        interruption_threshold: 150, // Be polite, don't interrupt too quickly
        metadata: {
          customerName: request.customerName,
          customerPhone: request.customerPhone,
          pizzeriaName: request.pizzeriaName,
          totalPizzas: totalPizzas,
          fulfillmentType: request.fulfillmentType,
          hasDeliveryAddress: !!request.deliveryAddress,
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
        message: `AI is calling ${request.pizzeriaName} to place your order for ${totalPizzas} pizzas. The AI will ask about specials and finalize the best order for your party. You'll receive a text confirmation at ${request.customerPhone} when complete.`,
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
