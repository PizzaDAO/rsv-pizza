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

  return `You are an AI assistant calling a pizza shop to place an order on behalf of a customer. You've already told them you're an AI. Be friendly, polite, and efficient — like a helpful assistant, not a telemarketer.

## Key Rules
- **Be brief.** Pizza shops are busy. Don't ramble or ask unnecessary questions.
- **Just order.** Don't ask about specials, recommendations, or popular items. Just tell them what you want.
- **One thing at a time.** Give your order item by item if they're writing it down. Let them lead the pace.
- **Listen and respond naturally.** If they ask a question, answer it directly. If they repeat the order back, confirm or correct.
- **Be honest.** You're an AI. If they ask, confirm it. Never pretend to be human.
- **Dietary restrictions are firm.** Never substitute vegetarian, vegan, or gluten-free items with non-compliant options.
- **Be flexible on small stuff.** If a topping or size isn't available, accept a substitute or skip it — don't make it a big deal.

## Order Details
- Name for the order: ${customerName}
- Phone: ${customerPhone}
- ${fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'}${fulfillmentType === 'delivery' && deliveryAddress ? ` to ${deliveryAddress}` : ''}

## What to Order (${totalPizzas} pizzas)
- ${orderDescription}

## How the Call Should Go

1. You've already introduced yourself as an AI assistant with a credit card ready to pay. If they seem hesitant, reassure them: "I know it's a little unusual, but I can place the order and pay by card right now — totally legit."
2. If they're okay with it, give them the order. If they ask for it all at once, list it out. If they take it one at a time, go one by one.
3. When they're done taking the order, give the name "${customerName}" and phone number ${customerPhone}.
4. Ask for the total and how long it'll be.${paymentInstructions}
5. Say thanks and hang up.

## If They Don't Want to Deal With a Bot
- Don't argue or push it. Just say "No worries, I understand. Thank you for your time!" and end the call politely.
- Don't try to pretend you're human if they ask.

That's it. Don't overcomplicate it.`;
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
        first_sentence: `Hi there! Just so you know, I'm an AI assistant calling on behalf of a customer. I have a credit card ready to pay and I'd like to place an order for ${request.fulfillmentType} — ${totalPizzas} pizza${totalPizzas > 1 ? 's' : ''}.`,
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
