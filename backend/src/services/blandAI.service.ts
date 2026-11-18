import { prisma } from '../config/database.js';
import { brand } from '../config/brand.js';
import { AppError } from '../middleware/error.js';
import {
  assertCardPaymentsConfigured,
  computeSpendingLimitCents,
  createOrderVirtualCard,
  deactivateCard,
  redactCardData,
  retrieveCardSecret,
  PER_PIZZA_CENTS,
  BUFFER_RATIO,
  VirtualCardSecret,
} from './virtualCard.service.js';

const BLAND_API_URL = 'https://api.bland.ai/v1';

// Email notification functions
async function sendOrderConfirmedEmail(
  email: string,
  customerName: string,
  pizzeriaName: string,
  orderTotal: string | null,
  estimatedTime: string | null,
  fulfillmentType: string,
  partyName: string
) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.log('RESEND_API_KEY not set, skipping email notification');
    return;
  }

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Confirmed - RSV.Pizza</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">🍕 Order Confirmed!</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">Your AI phone order was successful</p>
        </div>

        <div style="background: #f0fff4; padding: 20px; border-radius: 12px; border-left: 4px solid #38a169; margin-bottom: 20px;">
          <h2 style="color: #38a169; margin: 0 0 10px 0;">✓ ${pizzeriaName} confirmed your order</h2>
          <p style="margin: 0; color: #2d3748;">For: <strong>${partyName}</strong></p>
        </div>

        <div style="background: #f9f9f9; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 15px 0; color: #1a1a2e;">Order Details</h3>
          ${orderTotal ? `<p style="margin: 5px 0;"><strong>Total:</strong> ${orderTotal}</p>` : ''}
          ${estimatedTime ? `<p style="margin: 5px 0;"><strong>Ready:</strong> ${estimatedTime}</p>` : ''}
          <p style="margin: 5px 0;"><strong>Type:</strong> ${fulfillmentType === 'pickup' ? 'Pickup' : 'Delivery'}</p>
        </div>

        <p style="color: #666; font-size: 14px; text-align: center;">
          You can view the full call transcript and recording in your RSV.Pizza dashboard.
        </p>
      </body>
    </html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: brand.fromEmail,
        to: [email],
        subject: `✓ Order Confirmed - ${pizzeriaName}`,
        html: emailHtml,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to send order confirmed email:', error);
    }
  } catch (error) {
    console.error('Error sending order confirmed email:', error);
  }
}

async function sendOrderFailedEmail(
  email: string,
  customerName: string,
  pizzeriaName: string,
  pizzeriaPhone: string,
  failureReason: string,
  partyName: string
) {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (!resendApiKey) {
    console.log('RESEND_API_KEY not set, skipping email notification');
    return;
  }

  const reasonText = {
    'no_answer': 'The pizzeria did not answer the phone.',
    'voicemail': 'The call went to voicemail.',
    'failed': 'The call could not be completed.',
    'not_confirmed': 'The pizzeria was unable to confirm the order.',
  }[failureReason] || 'The order could not be placed.';

  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Order Not Confirmed - RSV.Pizza</title>
      </head>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
        <div style="background: linear-gradient(135deg, #1a1a2e 0%, #16213e 100%); padding: 40px 20px; border-radius: 12px; text-align: center; margin-bottom: 30px;">
          <h1 style="color: #ffffff; font-size: 32px; margin: 0 0 10px 0;">🍕 Order Update</h1>
          <p style="color: rgba(255,255,255,0.8); font-size: 16px; margin: 0;">Action may be required</p>
        </div>

        <div style="background: #fff5f5; padding: 20px; border-radius: 12px; border-left: 4px solid #e53e3e; margin-bottom: 20px;">
          <h2 style="color: #e53e3e; margin: 0 0 10px 0;">Order Not Confirmed</h2>
          <p style="margin: 0; color: #2d3748;">${reasonText}</p>
        </div>

        <div style="background: #f9f9f9; padding: 20px; border-radius: 12px; margin-bottom: 20px;">
          <h3 style="margin: 0 0 15px 0; color: #1a1a2e;">What to do next</h3>
          <p style="margin: 5px 0;">You can try one of the following:</p>
          <ul style="margin: 10px 0; padding-left: 20px;">
            <li>Retry the AI call from your dashboard</li>
            <li>Call <strong>${pizzeriaName}</strong> directly at <a href="tel:${pizzeriaPhone}" style="color: #3182ce;">${pizzeriaPhone}</a></li>
          </ul>
        </div>

        <div style="background: #ebf8ff; padding: 15px; border-radius: 8px; text-align: center;">
          <p style="margin: 0; color: #2b6cb0;">
            <strong>Party:</strong> ${partyName}<br>
            <strong>Pizzeria:</strong> ${pizzeriaName}
          </p>
        </div>
      </body>
    </html>
  `;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${resendApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: brand.fromEmail,
        to: [email],
        subject: `⚠️ Order Update - ${pizzeriaName}`,
        html: emailHtml,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Failed to send order failed email:', error);
    }
  } catch (error) {
    console.error('Error sending order failed email:', error);
  }
}

export interface OrderItem {
  name: string;
  quantity: number;
  size: string;
  toppings: string[];
  dietaryNotes: string[];
}

export interface InitiateCallRequest {
  partyId: string;
  userId: string;
  pizzeriaName: string;
  pizzeriaPhone: string;
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryAddress?: string;
  partySize?: number;
  /**
   * sec-edge-functions: when true the backend issues a virtual card (server-decided limit) and
   * reads it to the pizzeria through Bland. The card details never leave the server.
   */
  payWithCard?: boolean;
}

export interface CallResponse {
  success: boolean;
  callId?: string;
  aiPhoneCallId?: string;
  status?: string;
  message?: string;
  error?: string;
}

export interface BlandWebhookPayload {
  call_id: string;
  status: string;
  completed: boolean;
  corrected_duration?: number;
  max_duration?: number;
  from?: string;
  to?: string;
  answered_by?: string;
  recording_url?: string;
  concatenated_transcript?: string;
  transcripts?: Array<{
    id: number;
    created_at: string;
    text: string;
    user: string;
  }>;
  summary?: string;
  analysis?: {
    order_confirmed?: boolean;
    order_total?: string;
    estimated_time?: string;
  };
  metadata?: Record<string, unknown>;
}

function buildAgentPrompt(request: InitiateCallRequest): string {
  const { items, customerName, customerPhone, fulfillmentType, deliveryAddress, partySize } = request;

  const totalPizzas = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalGuests = partySize || items.reduce((sum, item) => sum + item.quantity * 2, 0);

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

## Payment
- Tell them you'll pay at ${fulfillmentType === 'pickup' ? 'pickup' : 'delivery'}.

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
- "Hi, I'd like to place a large order for ${fulfillmentType}. Do you have any specials for big orders?"
- [Listen to specials]
- "That sounds great! I'll take [adjusted order based on specials]. I also need [dietary-specific items]."
- "What's your most popular specialty pizza? I'd like to add one of those too."
- "Great, can I confirm the order? [repeat back]. The name is ${customerName}, phone ${customerPhone}."
- "What's the total?"
- "And we'll pay at ${fulfillmentType === 'pickup' ? 'pickup' : 'delivery'}."
- "How long will it be ready?"

Remember: You're trying to get good value and variety. Don't be afraid to deviate from the base order if the pizzeria has better suggestions!`;
}

// Format card number for speaking (groups of 4)
function formatCardForSpeech(number: string): string {
  return number.replace(/(\d{4})/g, '$1 ').trim();
}

function formatExpForSpeech(month: number, year: number): string {
  return `${month.toString().padStart(2, '0')} slash ${year.toString().slice(-2)}`;
}

/**
 * Prompt for card-paid calls. Ported from the retired `ai-phone-order` edge function (the only
 * path that paid by card), so the call itself behaves as before.
 */
function buildCardAgentPrompt(request: InitiateCallRequest, card: VirtualCardSecret): string {
  const { items, customerName, customerPhone, fulfillmentType, deliveryAddress } = request;
  const totalPizzas = items.reduce((sum, item) => sum + item.quantity, 0);
  const orderDescription = items.map(item => {
    let desc = `${item.quantity}x ${item.size} pizza`;
    if (item.toppings.length > 0) desc += ` with ${item.toppings.join(', ')}`;
    if (item.dietaryNotes.length > 0) desc += ` (${item.dietaryNotes.join(', ')})`;
    return desc;
  }).join('\n- ');

  const paymentInstructions = `

## Payment Instructions
You have a credit card to pay for this order. After confirming the order and getting the total:

1. **Ask to pay by card**: "I'd like to pay by credit card now, is that okay?"
2. **If they accept card payment over phone**:
   - Card number: ${formatCardForSpeech(card.number)}
   - Expiration: ${formatExpForSpeech(card.expMonth, card.expYear)}
   - CVC/Security code: ${card.cvc}
   - Name on card: ${customerName}
   - Billing zip: Ask the customer or say "I'll need to check on that" if they require it

3. **If they don't accept card over phone**: Say "That's fine, we'll pay when we pick up" and continue with the order.

4. **IMPORTANT**: Read the card number slowly and clearly, pausing between each group of four digits. Be patient if they need you to repeat.

5. **Confirm payment**: Make sure they confirm the payment went through before ending the call.`;

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

/** Server-side order estimate in cents (same formula the frontend showed). */
export function estimateOrderCents(totalPizzas: number): number {
  return Math.ceil(totalPizzas * PER_PIZZA_CENTS * (1 + BUFFER_RATIO));
}

export async function initiateCall(request: InitiateCallRequest): Promise<CallResponse> {
  const apiKey = process.env.BLAND_API_KEY;
  const webhookUrl = process.env.BACKEND_URL
    ? `${process.env.BACKEND_URL}/api/ai-phone/webhook`
    : null;

  if (!apiKey) {
    // Fail closed with a clear 503 until BLAND_API_KEY is set on this backend deployment.
    throw new AppError('AI phone ordering is not configured yet. Please try again later.', 503, 'BLAND_NOT_CONFIGURED');
  }

  const totalPizzas = request.items.reduce((sum, item) => sum + item.quantity, 0);
  // Server decides the amounts: no client-sent estimate or limit is used.
  const spendingLimitCents = request.payWithCard ? computeSpendingLimitCents(totalPizzas) : null;
  if (request.payWithCard) assertCardPaymentsConfigured();
  const estimatedTotal = spendingLimitCents ?? estimateOrderCents(totalPizzas);

  // Create the AIPhoneCall record first
  const aiPhoneCall = await prisma.aIPhoneCall.create({
    data: {
      callId: 'pending', // Will be updated after Bland API call
      status: 'initiated',
      pizzeriaPhone: request.pizzeriaPhone,
      pizzeriaName: request.pizzeriaName,
      customerName: request.customerName,
      customerPhone: request.customerPhone,
      fulfillmentType: request.fulfillmentType,
      deliveryAddress: request.deliveryAddress,
      orderItems: JSON.stringify(request.items),
      estimatedTotal,
      partyId: request.partyId,
      userId: request.userId,
    },
  });

  let card: VirtualCardSecret | null = null;
  try {
    if (spendingLimitCents !== null) {
      card = await createOrderVirtualCard({
        userId: request.userId,
        partyId: request.partyId,
        aiPhoneCallId: aiPhoneCall.id,
        pizzeriaName: request.pizzeriaName,
        spendingLimitCents,
      });
    }

    const cleanPhone = request.pizzeriaPhone.replace(/[^\d+]/g, '');
    const agentPrompt = card ? buildCardAgentPrompt(request, card) : buildAgentPrompt(request);
    const firstSentence = card
      ? `Hi there! Just so you know, I'm an AI assistant calling on behalf of a customer. I have a credit card ready to pay and I'd like to place an order for ${request.fulfillmentType} — ${totalPizzas} pizza${totalPizzas > 1 ? 's' : ''}.`
      : `Hi there! I'd like to place a large order for ${request.fulfillmentType} - about ${totalPizzas} pizzas for a party. Do you have any specials or deals for large orders?`;

    const blandPayload: Record<string, unknown> = {
      phone_number: cleanPhone,
      task: agentPrompt,
      voice: 'maya',
      first_sentence: firstSentence,
      wait_for_greeting: true,
      record: true,
      max_duration: 10,
      model: 'enhanced',
      language: 'en',
      answered_by_enabled: true,
      temperature: 0.7,
      interruption_threshold: 150,
      metadata: {
        aiPhoneCallId: aiPhoneCall.id,
        customerName: request.customerName,
        customerPhone: request.customerPhone,
        pizzeriaName: request.pizzeriaName,
        partyId: request.partyId,
        totalPizzas,
        fulfillmentType: request.fulfillmentType,
        // read back by processWebhook / the live-status routes to redact card data
        hasPaymentCard: !!card,
        ...(card ? { virtualCardId: card.cardId } : {}),
      },
      // Analysis schema for extracting structured data
      analysis_schema: {
        order_confirmed: {
          type: 'boolean',
          description: 'Whether the pizzeria confirmed they will prepare the order',
        },
        order_total: {
          type: 'string',
          description: 'The total price quoted by the pizzeria (e.g., "$45.50")',
        },
        estimated_time: {
          type: 'string',
          description: 'When the order will be ready (e.g., "30-45 minutes", "6:30 PM")',
        },
      },
    };

    // Add webhook if configured
    if (webhookUrl) {
      blandPayload.webhook = webhookUrl;
    }

    const blandResponse = await fetch(`${BLAND_API_URL}/calls`, {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(blandPayload),
    });

    const blandData = await blandResponse.json();

    if (!blandResponse.ok) {
      if (card) await deactivateCard(card.cardId);
      // Update the record with failure
      await prisma.aIPhoneCall.update({
        where: { id: aiPhoneCall.id },
        data: { status: 'failed' },
      });

      return {
        success: false,
        aiPhoneCallId: aiPhoneCall.id,
        error: blandData.message || 'Failed to initiate call',
      };
    }

    // Update the record with the Bland call ID
    await prisma.aIPhoneCall.update({
      where: { id: aiPhoneCall.id },
      data: {
        callId: blandData.call_id,
        callStartedAt: new Date(),
      },
    });

    return {
      success: true,
      callId: blandData.call_id,
      aiPhoneCallId: aiPhoneCall.id,
      status: blandData.status,
      message: `AI is calling ${request.pizzeriaName} to place your order for ${totalPizzas} pizzas.`,
    };
  } catch (error) {
    if (card) await deactivateCard(card.cardId);
    // Update the record with failure
    await prisma.aIPhoneCall.update({
      where: { id: aiPhoneCall.id },
      data: { status: 'failed' },
    });

    throw error;
  }
}

/** True when a Bland call object belongs to a card-paid call. Fails closed when metadata is missing. */
export function blandCallHadCard(call: { metadata?: unknown } | null | undefined): boolean {
  const md = call?.metadata;
  if (!md || typeof md !== 'object') return true;
  const m = md as Record<string, unknown>;
  return m.hasPaymentCard === true || m.hasPaymentCard === 'true' || typeof m.virtualCardId === 'string';
}

/**
 * Transcript safe to show a user. Card-number-shaped digits are always masked. For card-paid
 * calls the exact card values are fetched from Stripe and masked too; if that is not possible the
 * transcript is withheld (null) rather than risk leaking the CVC.
 */
export async function safeTranscript(
  transcript: string | null | undefined,
  call: { metadata?: unknown } | null | undefined
): Promise<string | null> {
  if (!transcript) return null;
  if (!blandCallHadCard(call)) return redactCardData(transcript);
  const cardId = (call?.metadata as Record<string, unknown> | undefined)?.virtualCardId;
  if (typeof cardId !== 'string') return null;
  try {
    const card = await retrieveCardSecret(cardId);
    return redactCardData(transcript, card);
  } catch (err) {
    console.error('Could not load card to redact transcript', (err as Error).message);
    return null;
  }
}

export interface BlandCallDetails {
  status?: string;
  call_status?: string;
  recording_url?: string | null;
  concatenated_transcript?: string;
  transcripts?: Array<{ user: string; text: string }>;
  call_length?: number | null;
  answered_by?: string;
  ended_reason?: string | null;
  metadata?: Record<string, unknown> | null;
}

/** GET /v1/calls/:id from Bland (server-side, our API key). */
export async function fetchBlandCall(callId: string): Promise<{ ok: boolean; status: number; data: BlandCallDetails }> {
  const apiKey = process.env.BLAND_API_KEY;
  if (!apiKey) return { ok: false, status: 503, data: {} };
  const res = await fetch(`${BLAND_API_URL}/calls/${encodeURIComponent(callId)}`, {
    headers: { Authorization: apiKey },
  });
  const data = (await res.json().catch(() => ({}))) as BlandCallDetails;
  return { ok: res.ok, status: res.status, data };
}

/** GET /v1/calls/:id/recording from Bland (server-side). */
export async function fetchBlandRecording(callId: string): Promise<Response | null> {
  const apiKey = process.env.BLAND_API_KEY;
  if (!apiKey) return null;
  return fetch(`${BLAND_API_URL}/calls/${encodeURIComponent(callId)}/recording`, {
    headers: { Authorization: apiKey },
  });
}

export async function processWebhook(payload: BlandWebhookPayload): Promise<void> {
  const { call_id, status, completed } = payload;

  // Find the AIPhoneCall record with user and party info for notifications
  const aiPhoneCall = await prisma.aIPhoneCall.findUnique({
    where: { callId: call_id },
    include: {
      user: true,
      party: true,
    },
  });

  if (!aiPhoneCall) {
    console.error(`AIPhoneCall not found for call_id: ${call_id}`);
    return;
  }

  // Determine the status
  let newStatus = aiPhoneCall.status;
  if (completed) {
    if (payload.answered_by === 'voicemail' || payload.answered_by === 'no_answer') {
      newStatus = 'no_answer';
    } else {
      newStatus = 'completed';
    }
  } else if (status === 'in-progress') {
    newStatus = 'in_progress';
  } else if (status === 'ringing') {
    newStatus = 'ringing';
  } else if (status === 'failed') {
    newStatus = 'failed';
  }

  // Extract order data from analysis
  const orderConfirmed = payload.analysis?.order_confirmed ?? false;
  const orderTotal = payload.analysis?.order_total;
  const estimatedTime = payload.analysis?.estimated_time;

  // Parse order total to cents if present
  let confirmedTotal: number | null = null;
  if (orderTotal) {
    const match = orderTotal.match(/[\d.]+/);
    if (match) {
      confirmedTotal = Math.round(parseFloat(match[0]) * 100);
    }
  }

  // Build summary if not provided
  let summary = payload.summary;
  if (!summary && payload.concatenated_transcript) {
    summary = generateSummary(payload.concatenated_transcript, orderConfirmed, orderTotal, estimatedTime);
  }

  // sec-edge-functions: card-paid calls read the card aloud. Never store the card in our DB, and
  // do not keep the (card-bearing) recording URL for those calls.
  const hadCard = blandCallHadCard(payload);
  const transcript = await safeTranscript(payload.concatenated_transcript, payload);
  if (summary) summary = redactCardData(summary);

  // Update the record
  await prisma.aIPhoneCall.update({
    where: { id: aiPhoneCall.id },
    data: {
      status: newStatus,
      orderConfirmed,
      confirmedTotal,
      estimatedTime,
      transcript,
      summary,
      recordingUrl: hadCard ? null : payload.recording_url,
      callDuration: payload.corrected_duration,
      callEndedAt: completed ? new Date() : undefined,
    },
  });

  // If order was confirmed, create or update the Order record
  if (orderConfirmed && confirmedTotal) {
    const order = await prisma.order.create({
      data: {
        provider: 'ai_phone',
        externalOrderId: call_id,
        pizzas: aiPhoneCall.orderItems,
        totalAmount: confirmedTotal / 100,
        status: 'confirmed',
        pizzeriaName: aiPhoneCall.pizzeriaName,
        pizzeriaAddress: null,
        partyId: aiPhoneCall.partyId,
        userId: aiPhoneCall.userId,
      },
    });

    // Link the AIPhoneCall to the Order
    await prisma.aIPhoneCall.update({
      where: { id: aiPhoneCall.id },
      data: { orderId: order.id },
    });
  }

  // Send email notifications when call is completed
  if (completed && aiPhoneCall.user?.email) {
    const partyName = aiPhoneCall.party?.name || 'Your Party';

    if (orderConfirmed) {
      // Order was confirmed - send success email
      await sendOrderConfirmedEmail(
        aiPhoneCall.user.email,
        aiPhoneCall.customerName,
        aiPhoneCall.pizzeriaName,
        orderTotal || null,
        estimatedTime || null,
        aiPhoneCall.fulfillmentType,
        partyName
      );
    } else {
      // Order not confirmed - send failure email
      let failureReason = 'not_confirmed';
      if (newStatus === 'no_answer') {
        failureReason = payload.answered_by === 'voicemail' ? 'voicemail' : 'no_answer';
      } else if (newStatus === 'failed') {
        failureReason = 'failed';
      }

      await sendOrderFailedEmail(
        aiPhoneCall.user.email,
        aiPhoneCall.customerName,
        aiPhoneCall.pizzeriaName,
        aiPhoneCall.pizzeriaPhone,
        failureReason,
        partyName
      );
    }
  }
}

function generateSummary(
  transcript: string,
  orderConfirmed: boolean,
  orderTotal: string | undefined,
  estimatedTime: string | undefined
): string {
  const parts: string[] = [];

  if (orderConfirmed) {
    parts.push('Order was successfully placed.');
    if (orderTotal) {
      parts.push(`Total: ${orderTotal}.`);
    }
    if (estimatedTime) {
      parts.push(`Ready in: ${estimatedTime}.`);
    }
  } else {
    parts.push('Order could not be confirmed. Review the transcript for details.');
  }

  return parts.join(' ');
}

export async function getCallStatus(callId: string) {
  return prisma.aIPhoneCall.findUnique({
    where: { callId },
    include: {
      order: true,
    },
  });
}

export async function getCallById(id: string) {
  return prisma.aIPhoneCall.findUnique({
    where: { id },
    include: {
      order: true,
    },
  });
}

export async function retryCall(aiPhoneCallId: string): Promise<CallResponse> {
  const originalCall = await prisma.aIPhoneCall.findUnique({
    where: { id: aiPhoneCallId },
  });

  if (!originalCall) {
    return { success: false, error: 'Original call not found' };
  }

  // Parse orderItems from JSON string
  const orderItems = JSON.parse(originalCall.orderItems) as OrderItem[];

  // Create a new call with the same parameters
  return initiateCall({
    partyId: originalCall.partyId,
    userId: originalCall.userId,
    pizzeriaName: originalCall.pizzeriaName,
    pizzeriaPhone: originalCall.pizzeriaPhone,
    items: orderItems,
    customerName: originalCall.customerName,
    customerPhone: originalCall.customerPhone,
    fulfillmentType: originalCall.fulfillmentType as 'pickup' | 'delivery',
    deliveryAddress: originalCall.deliveryAddress ?? undefined,
    // retries never re-issue a card: the pizzeria is told payment happens at pickup/delivery
    payWithCard: false,
  });
}
