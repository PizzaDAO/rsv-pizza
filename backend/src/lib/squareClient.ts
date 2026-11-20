import crypto from 'crypto';
import { AppError } from '../middleware/error.js';

/**
 * sec-edge-functions-2: Square order creation, moved off the anon-callable `square-order` edge
 * function. Env (same names the edge function read): SQUARE_ACCESS_TOKEN, SQUARE_ENVIRONMENT
 * ('sandbox' default | 'production'). Unset token fails closed with 503.
 */

export interface SquareOrderItem {
  name: string;
  quantity: number;
  size: string;
  toppings: string[];
  dietaryNotes: string[];
  priceEstimate?: number;
}

export interface SquareOrderInput {
  locationId: string;
  items: SquareOrderItem[];
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
  scheduledTime?: string;
}

export interface SquareOrderResult {
  success: boolean;
  orderId?: string;
  checkoutUrl?: string;
  error?: string;
}

const SQUARE_VERSION = '2024-01-18';

function config() {
  const token = process.env.SQUARE_ACCESS_TOKEN || '';
  if (!token) throw new AppError('Square ordering is not configured', 503, 'SQUARE_NOT_CONFIGURED');
  const base =
    (process.env.SQUARE_ENVIRONMENT || 'sandbox') === 'production'
      ? 'https://connect.squareup.com'
      : 'https://connect.squareupsandbox.com';
  return { token, base };
}

export async function createSquareOrder(req: SquareOrderInput): Promise<SquareOrderResult> {
  const { token, base } = config();
  const headers = {
    'Square-Version': SQUARE_VERSION,
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };
  const idempotencyKey = crypto.randomUUID();

  const lineItems = req.items.map((item, i) => ({
    uid: `pizza-${i}`,
    name: item.name,
    quantity: String(item.quantity),
    note: [
      `Size: ${item.size}`,
      item.toppings.length > 0 ? `Toppings: ${item.toppings.join(', ')}` : null,
      item.dietaryNotes.length > 0 ? `Dietary: ${item.dietaryNotes.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' | '),
    base_price_money:
      item.priceEstimate !== undefined
        ? { amount: Math.round(item.priceEstimate * 100), currency: 'USD' }
        : undefined,
  }));

  const recipient = {
    display_name: req.customerName,
    phone_number: req.customerPhone,
    email_address: req.customerEmail,
  };
  const schedule = req.scheduledTime ? 'SCHEDULED' : 'ASAP';
  const fulfillment = {
    uid: 'fulfillment-1',
    type: req.fulfillmentType,
    state: 'PROPOSED',
    ...(req.fulfillmentType === 'PICKUP'
      ? { pickup_details: { recipient, schedule_type: schedule, pickup_at: req.scheduledTime } }
      : {
          delivery_details: {
            recipient: {
              ...recipient,
              address: req.deliveryAddress ? { address_line_1: req.deliveryAddress } : undefined,
            },
            schedule_type: schedule,
            deliver_at: req.scheduledTime,
          },
        }),
  };

  const orderResponse = await fetch(`${base}/v2/orders`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: idempotencyKey,
      order: { location_id: req.locationId, line_items: lineItems, fulfillments: [fulfillment] },
    }),
  });
  const orderData: any = await orderResponse.json().catch(() => ({}));
  if (!orderResponse.ok) {
    console.error('Square order creation failed:', orderData?.errors);
    return { success: false, error: orderData?.errors?.[0]?.detail || 'Failed to create order' };
  }
  const orderId: string = orderData.order.id;

  const linkResponse = await fetch(`${base}/v2/online-checkout/payment-links`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      idempotency_key: `${idempotencyKey}-payment`,
      payment_link: { order_id: orderId, description: 'Pizza Party Order' },
    }),
  });
  const linkData: any = await linkResponse.json().catch(() => ({}));
  if (!linkResponse.ok) {
    console.error('Square payment link creation failed:', linkData?.errors);
    return { success: true, orderId, error: 'Order created but payment link failed. Please pay at the restaurant.' };
  }
  return { success: true, orderId, checkoutUrl: linkData.payment_link?.url };
}
