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

interface PaymentCard {
  number: string;
  cvc: string;
  expMonth: number;
  expYear: number;
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
  paymentCard?: PaymentCard;
}

// Format card number for speaking (groups of 4)
function formatCardForSpeech(number: string): string {
  return number.replace(/(\d{4})/g, '$1 ').trim();
}

// Format expiration for speaking
function formatExpForSpeech(month: number, year: number): string {
  const monthStr = month.toString().padStart(2, '0');
  const yearStr = year.toString().slice(-2);
  return `${monthStr} slash ${yearStr}`;
}

// Build the AI agent prompt for ordering
function buildAgentPrompt(request: PhoneOrderRequest): string {
  const { items, customerName, customerPhone, fulfillmentType, deliveryAddress, partySize, paymentCard } = request;

  // Calculate totals
  const totalPizzas = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalGuests = partySize || items.reduce((sum, item) => sum + item.quantity * 2, 0);

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

  // Payment instructions
  let paymentInstructions = '';
  if (paymentCard) {
    const cardNumber = formatCardForSpeech(paymentCard.number);
    const expiration = formatExpForSpeech(paymentCard.expMonth, paymentCard.expYear);

    paymentInstructions = `

## Payment Instructions
You have a credit card to pay for this order. After confirming the order and getting the total:

1. **Ask to pay by card**: "I'd like to pay by credit card now, is that okay?"
2. **If they accept card payment over phone**:
   - Card number: ${cardNumber}
   - Expiration: ${expiration}
   - CVC/Security code: ${paymentCard.cvc}
   - Name on card: ${customerName}
   - Billing zip: Ask the customer or say "I'll need to check on that" if they require it

3. **If they don't accept card over phone**: Say "That's fine, we'll pay when we pick up" and continue with the order.

4. **IMPORTANT**: Read the card number slowly and clearly, pausing between each group of four digits. Be patient if they need you to repeat.

5. **Confirm payment**: Make sure they confirm the payment went through before ending the call.`;
  } else {
    paymentInstructions = `

## Payment
- Tell them you'll pay at ${fulfillmentType === 'pickup' ? 'pickup' : 'delivery'}.`;
  }

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
${paymentInstructions}

## Example Conversation Flow
- "Hi, I'd like to place a large order for ${fulfillmentType}. Do you have any specials for big orders?"
- [Listen to specials]
- "That sounds great! I'll take [adjusted order based on specials]. I also need [dietary-specific items]."
- "What's your most popular specialty pizza? I'd like to add one of those too."
- "Great, can I confirm the order? [repeat back]. The name is ${customerName}, phone ${customerPhone}."
- "What's the total?"${paymentCard ? '\n- "I\'d like to pay by card now if possible."' : ''}
- "How long will it be ready?"

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
        max_duration: 10, // 10 minutes max for orders with payment
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
          hasPaymentCard: !!request.paymentCard,
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

    const paymentNote = request.paymentCard
      ? ' The AI will also attempt to pay with your card.'
      : ' You\'ll pay at pickup.';

    return new Response(
      JSON.stringify({
        success: true,
        callId: blandData.call_id,
        status: blandData.status,
        message: `AI is calling ${request.pizzeriaName} to place your order for ${totalPizzas} pizzas. The AI will ask about specials and finalize the best order for your party.${paymentNote} You'll receive confirmation at ${request.customerPhone} when complete.`,
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
