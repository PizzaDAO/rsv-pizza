# AI Call Ordering

RSVPizza can use AI voice agents to automatically call pizzerias and place orders on behalf of users.

## Current Implementation

We use **Bland AI** for AI phone calls. The Edge Function `ai-phone-order` handles the integration.

### How It Works

1. User selects a pizzeria and clicks "AI Order Call"
2. User enters their name, phone number, and fulfillment type (pickup/delivery)
3. User chooses payment method:
   - **Pay at pickup** (default) - No card required
   - **Pay with card** - User saves card via Stripe, AI pays over phone
4. Our Edge Function calls Bland AI's API to initiate a phone call
5. Bland AI calls the pizzeria with a smart ordering script that:
   - **Asks about specials and deals** for large orders
   - **Inquires about house specialties** and popular pizzas
   - **Adapts the order** based on what the pizzeria offers
   - **Respects dietary restrictions** (vegetarian, vegan, gluten-free) as firm requirements
   - **Handles substitutions** gracefully if toppings are unavailable
   - **Confirms the final order** and total price
   - **Pays with virtual card** (if payment option selected)
6. User receives confirmation when complete

### Setup

1. Sign up at https://www.bland.ai/
2. Get your API key from the dashboard
3. Set the secrets in Supabase:
   ```bash
   # Bland AI for phone calls
   npx supabase secrets set BLAND_API_KEY=your_key_here --project-ref znpiwdvvsqaxuskpfleo

   # Stripe for payments (optional)
   npx supabase secrets set STRIPE_SECRET_KEY=sk_live_xxx --project-ref znpiwdvvsqaxuskpfleo
   npx supabase secrets set STRIPE_ISSUING_CARDHOLDER_ID=ich_xxx --project-ref znpiwdvvsqaxuskpfleo
   ```

4. Set frontend environment variable:
   ```env
   VITE_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
   ```

## Payment Flow

### Overview

When a user chooses "Pay with card", the following flow happens:

```
┌─────────┐    ┌───────────┐    ┌──────────────┐    ┌───────────┐
│  User   │───▶│ RSVPizza  │───▶│ Virtual Card │───▶│ Pizzeria  │
│ (Stripe)│    │  (holds   │    │ (Stripe      │    │ (charges  │
│         │    │  funds)   │    │  Issuing)    │    │  card)    │
└─────────┘    └───────────┘    └──────────────┘    └───────────┘
```

### Step-by-Step

1. **User adds card** - Stripe Elements collects card securely (PCI compliant)
2. **Pre-authorization** - User's card is pre-authorized for estimated amount
3. **Virtual card created** - Stripe Issuing creates a one-time virtual card
4. **AI calls pizzeria** - Places order and reads virtual card number
5. **Pizzeria charges virtual card** - Payment goes through Stripe Issuing
6. **User charged** - Actual order total is captured from user's card

### Why Virtual Cards?

- **Security**: User's real card number is never exposed
- **PCI Compliance**: We never store or transmit real card numbers
- **Control**: Spending limits per card, can be cancelled instantly
- **Tracking**: Each order has its own card for easy reconciliation

### Stripe Issuing Requirements

To use virtual cards, you need:

1. **Stripe account** with Issuing enabled (requires application)
2. **Issuing balance** funded via:
   - Push-funded (wire/ACH to Stripe) - same day
   - Pull-funded (Stripe pulls from your bank) - 5 business days
3. **Cardholder** created for RSVPizza (one-time setup)

## Pricing (as of January 2026)

### Bland AI

| Item | Cost |
|------|------|
| Connected call time | $0.09/minute (billed by second) |
| Minimum per outbound call | $0.015 (even if call fails) |
| SMS messaging | $0.02/message |
| Call transfers | $0.025/min (free with own Twilio) |
| Voicemail | $0.09/min |

**Subscription Plans:**

| Plan | Price | Daily Calls | Concurrent | Voice Clones |
|------|-------|-------------|------------|--------------|
| Build | $299/mo | 2,000 | 50 | 5 |
| Scale | $499/mo | 5,000 | 100 | 15 |
| Enterprise | Custom | Unlimited | Unlimited | Unlimited |

**Estimated cost per pizza order:** $0.18-$0.36 (2-4 minute call, longer with payment)

### Stripe Issuing

| Item | Cost |
|------|------|
| Virtual card creation | $0.10/card |
| Transactions | $0.20 + 0.20% per transaction |
| Declined authorizations | Free |

### Alternative Providers

| Provider | Base Rate | Notes |
|----------|-----------|-------|
| Retell AI | ~$0.09/min | Better latency according to some reviews |
| Vapi | $0.05/min + provider | Lower base rate but additional costs |
| Synthflow | Custom | Enterprise focused |

## AI Ordering Behavior

The AI is designed to be a **smart shopper**, not just a script reader. Here's how it behaves:

### Conversation Flow

1. **Opening**: "Hi! I'd like to place a large order for pickup - about 12 pizzas for a party. Do you have any specials or deals for large orders?"

2. **Listen & Adapt**: If they offer a party pack or "buy 2 get 1 free", the AI adjusts the order to take advantage of it.

3. **Ask for Recommendations**: "What's your most popular pizza?" or "Any house specialties you'd recommend?" - May swap 1-2 basic pizzas for their suggestions.

4. **Handle Constraints**:
   - Dietary restrictions (vegetarian, vegan, GF) are **firm** - never substituted
   - Regular toppings are **flexible** - can be swapped if unavailable
   - Sizes are **flexible** - accepts closest equivalent

5. **Get Total & Pay**: Gets the final total. If paying by card, reads the virtual card number slowly and clearly.

6. **Confirm**: Always confirms payment went through (if paying) and pickup time.

### Example Adaptation

**Base order**: 4x cheese, 4x pepperoni, 2x veggie, 2x vegan

**What the AI might order**:
- Take the "Party Pack Special" (5 large pizzas for $60)
- Add their house specialty "Grandma's Supreme"
- Keep the 2x vegan pizzas (dietary requirement - firm)
- Get a free garlic bread (promotion)
- Pay with card: "I'd like to pay by card now if that's okay"

### Payment Conversation

When paying by card, the AI:

1. Asks: "I'd like to pay by credit card now, is that okay?"
2. If accepted:
   - Reads card number slowly: "4 2 4 2... 4 2 4 2... 4 2 4 2... 4 2 4 2"
   - Provides expiration: "Expires oh-three slash twenty-seven"
   - Provides security code: "The security code is 1 2 3"
   - Provides name: "Name on card is John Smith"
3. If declined: "That's fine, we'll pay when we pick up"
4. Confirms: "Can you confirm the payment went through?"

## Edge Functions

### ai-phone-order

Location: `supabase/functions/ai-phone-order/index.ts`

**Request Format:**

```typescript
interface PhoneOrderRequest {
  pizzeriaName: string;
  pizzeriaPhone: string;
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryAddress?: string;
  partySize?: number;
  paymentCard?: {
    number: string;
    cvc: string;
    expMonth: number;
    expYear: number;
  };
}
```

**Response Format:**

```typescript
interface PhoneOrderResponse {
  success: boolean;
  callId?: string;
  status?: string;
  message?: string;
  error?: string;
}
```

### stripe-payment

Location: `supabase/functions/stripe-payment/index.ts`

Handles all Stripe operations:
- `create_customer` - Create Stripe customer
- `get_setup_intent` - Get SetupIntent for saving payment method
- `create_payment_intent` - Create pre-authorized payment
- `create_virtual_card` - Create Stripe Issuing virtual card
- `get_virtual_card` - Get full card details (number, CVC)
- `capture_payment` - Capture pre-authorized payment

## Frontend Components

### PaymentForm

Location: `frontend/src/components/PaymentForm.tsx`

Stripe Elements form for securely collecting card information. Uses SetupIntent to save payment method without charging.

### OrderCheckout (updated)

Location: `frontend/src/components/OrderCheckout.tsx`

Multi-step checkout flow:
1. **Details** - Name, phone, fulfillment type, payment choice
2. **Payment** - Add card (if paying by card and no saved method)
3. **Confirm** - Review order, estimated total, confirm & call

## Future Improvements

- [x] Virtual card payment support
- [ ] Add webhook to receive call completion status
- [ ] Store call recordings for quality assurance
- [ ] Add retry logic for failed calls
- [ ] Support for scheduled orders (call at specific time)
- [ ] Multi-language support
- [ ] Custom voice training for brand consistency
- [ ] Integration with Retell AI as alternative provider
- [ ] Call status tracking in UI (ringing, connected, completed)
- [ ] Capture actual order total from call transcript
- [ ] Automatic refund if order fails

## Fallback: Manual Phone Ordering

If AI calling is not configured or fails, users can:

1. Click "Call to Order" to see the pizzeria's phone number
2. Copy the auto-generated order script
3. Call the pizzeria manually and read the script

The order script is generated in `frontend/src/lib/ordering.ts` via `generatePhoneOrderScript()`.

## Security Considerations

- **PCI Compliance**: User card data handled entirely by Stripe Elements
- **Virtual Cards**: One-time use, spending-limited, can be cancelled
- **No Card Storage**: We never store or see full card numbers
- **Pre-authorization**: User's card is only charged after order confirmation
- **Spending Limits**: Virtual cards limited to estimated order amount + buffer
