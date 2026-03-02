import { prisma } from '../config/database.js';
import { createWebhookSignature } from '../middleware/apiKey.js';

// Webhook event types
export const WEBHOOK_EVENTS = [
  'party.created',
  'party.updated',
  'party.deleted',
  'party.rsvp_closed',
  'party.rsvp_opened',
  'guest.registered',
  'guest.updated',
  'guest.approved',
  'guest.declined',
  'guest.removed',
  'guest.waitlisted',
  'guest.promoted',
] as const;

export type WebhookEvent = typeof WEBHOOK_EVENTS[number];

// Maximum consecutive failures before disabling webhook
const MAX_FAIL_COUNT = 5;

// Retry delays in milliseconds (exponential backoff)
const RETRY_DELAYS = [1000, 5000, 30000]; // 1s, 5s, 30s

interface WebhookPayload {
  event: WebhookEvent;
  timestamp: string;
  data: any;
}

/**
 * Trigger webhooks for a specific event
 * This is synchronous - it delivers webhooks immediately
 */
export async function triggerWebhook(event: WebhookEvent, data: any, userId: string): Promise<void> {
  try {
    // Find all active webhooks for this user that subscribe to this event
    const apiKeys = await prisma.apiKey.findMany({
      where: {
        userId,
        status: 'approved',
        revoked: false,
      },
      include: {
        webhooks: {
          where: {
            active: true,
            events: { has: event },
          },
        },
      },
    });

    // Flatten webhooks from all API keys
    const webhooks = apiKeys.flatMap(key => key.webhooks);

    if (webhooks.length === 0) {
      return;
    }

    // Prepare payload
    const payload: WebhookPayload = {
      event,
      timestamp: new Date().toISOString(),
      data,
    };

    const payloadString = JSON.stringify(payload);

    // Deliver to each webhook (synchronously, but in parallel)
    await Promise.all(webhooks.map(webhook => deliverWebhook(webhook, payloadString)));
  } catch (error) {
    console.error('Error triggering webhooks:', error);
    // Don't throw - webhook failures shouldn't break the main operation
  }
}

/**
 * Deliver a webhook with retries
 */
async function deliverWebhook(
  webhook: { id: string; url: string; secret: string; failCount: number },
  payloadString: string
): Promise<void> {
  // Create signature
  const signature = createWebhookSignature(payloadString, webhook.secret);

  // Create delivery record
  const delivery = await prisma.webhookDelivery.create({
    data: {
      event: JSON.parse(payloadString).event,
      payload: JSON.parse(payloadString),
      status: 'pending',
      webhookId: webhook.id,
    },
  });

  let lastError: Error | null = null;
  let lastStatusCode: number | null = null;
  let lastResponseBody: string | null = null;

  // Try delivery with retries
  for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(webhook.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-RSVPizza-Signature': signature,
          'X-RSVPizza-Event': JSON.parse(payloadString).event,
          'X-RSVPizza-Delivery': delivery.id,
        },
        body: payloadString,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      lastStatusCode = response.status;
      lastResponseBody = await response.text().catch(() => null);

      if (response.ok) {
        // Success - update delivery and reset fail count
        await Promise.all([
          prisma.webhookDelivery.update({
            where: { id: delivery.id },
            data: {
              status: 'success',
              statusCode: response.status,
              responseBody: lastResponseBody,
              attempts: attempt + 1,
              lastAttempt: new Date(),
            },
          }),
          prisma.webhook.update({
            where: { id: webhook.id },
            data: { failCount: 0 },
          }),
        ]);
        return;
      }

      // Non-2xx response
      lastError = new Error(`HTTP ${response.status}: ${lastResponseBody}`);
    } catch (error: any) {
      lastError = error;
      if (error.name === 'AbortError') {
        lastError = new Error('Request timeout');
      }
    }

    // Wait before retry (if not last attempt)
    if (attempt < RETRY_DELAYS.length) {
      await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt]));
    }
  }

  // All retries failed
  const newFailCount = webhook.failCount + 1;
  const shouldDisable = newFailCount >= MAX_FAIL_COUNT;

  await Promise.all([
    prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: 'failed',
        statusCode: lastStatusCode,
        responseBody: lastResponseBody || lastError?.message,
        attempts: RETRY_DELAYS.length + 1,
        lastAttempt: new Date(),
      },
    }),
    prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        failCount: newFailCount,
        active: !shouldDisable,
      },
    }),
  ]);

  if (shouldDisable) {
    console.warn(`Webhook ${webhook.id} disabled after ${MAX_FAIL_COUNT} consecutive failures`);
  }
}

/**
 * Send a test webhook event
 */
export async function sendTestWebhook(webhookId: string): Promise<{ success: boolean; error?: string }> {
  const webhook = await prisma.webhook.findUnique({
    where: { id: webhookId },
  });

  if (!webhook) {
    return { success: false, error: 'Webhook not found' };
  }

  const testPayload: WebhookPayload = {
    event: 'party.created',
    timestamp: new Date().toISOString(),
    data: {
      test: true,
      message: 'This is a test webhook delivery',
    },
  };

  const payloadString = JSON.stringify(testPayload);
  const signature = createWebhookSignature(payloadString, webhook.secret);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(webhook.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-RSVPizza-Signature': signature,
        'X-RSVPizza-Event': 'test',
        'X-RSVPizza-Delivery': 'test',
      },
      body: payloadString,
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (response.ok) {
      return { success: true };
    }

    const body = await response.text().catch(() => '');
    return { success: false, error: `HTTP ${response.status}: ${body}` };
  } catch (error: any) {
    if (error.name === 'AbortError') {
      return { success: false, error: 'Request timeout' };
    }
    return { success: false, error: error.message };
  }
}
