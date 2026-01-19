import { prisma } from '../config/database.js';

const BLAND_API_URL = 'https://api.bland.ai/v1';

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
  estimatedTotal?: number;
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

export async function initiateCall(request: InitiateCallRequest): Promise<CallResponse> {
  const apiKey = process.env.BLAND_API_KEY;
  const webhookUrl = process.env.BACKEND_URL
    ? `${process.env.BACKEND_URL}/api/ai-phone/webhook`
    : null;

  if (!apiKey) {
    return { success: false, error: 'Bland AI API key not configured' };
  }

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
      estimatedTotal: request.estimatedTotal,
      partyId: request.partyId,
      userId: request.userId,
    },
  });

  try {
    const cleanPhone = request.pizzeriaPhone.replace(/[^\d+]/g, '');
    const agentPrompt = buildAgentPrompt(request);
    const totalPizzas = request.items.reduce((sum, item) => sum + item.quantity, 0);

    const blandPayload: Record<string, unknown> = {
      phone_number: cleanPhone,
      task: agentPrompt,
      voice: 'maya',
      first_sentence: `Hi there! I'd like to place a large order for ${request.fulfillmentType} - about ${totalPizzas} pizzas for a party. Do you have any specials or deals for large orders?`,
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
    // Update the record with failure
    await prisma.aIPhoneCall.update({
      where: { id: aiPhoneCall.id },
      data: { status: 'failed' },
    });

    throw error;
  }
}

export async function processWebhook(payload: BlandWebhookPayload): Promise<void> {
  const { call_id, status, completed } = payload;

  // Find the AIPhoneCall record
  const aiPhoneCall = await prisma.aIPhoneCall.findUnique({
    where: { callId: call_id },
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

  // Update the record
  await prisma.aIPhoneCall.update({
    where: { id: aiPhoneCall.id },
    data: {
      status: newStatus,
      orderConfirmed,
      confirmedTotal,
      estimatedTime,
      transcript: payload.concatenated_transcript,
      summary,
      recordingUrl: payload.recording_url,
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
    estimatedTotal: originalCall.estimatedTotal ?? undefined,
  });
}
