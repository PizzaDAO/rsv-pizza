# AI Call Ordering

RSVPizza can use AI voice agents to automatically call pizzerias and place orders on behalf of users.

## Current Implementation

We use **Bland AI** for AI phone calls. The Edge Function `ai-phone-order` handles the integration.

### How It Works

1. User selects a pizzeria and clicks "AI Order Call"
2. User enters their name, phone number, and fulfillment type (pickup/delivery)
3. Our Edge Function calls Bland AI's API to initiate a phone call
4. Bland AI calls the pizzeria with a smart ordering script that:
   - **Asks about specials and deals** for large orders
   - **Inquires about house specialties** and popular pizzas
   - **Adapts the order** based on what the pizzeria offers
   - **Respects dietary restrictions** (vegetarian, vegan, gluten-free) as firm requirements
   - **Handles substitutions** gracefully if toppings are unavailable
   - **Confirms the final order** and total price
5. User receives confirmation when complete

### Setup

1. Sign up at https://www.bland.ai/
2. Get your API key from the dashboard
3. Set the secret in Supabase:
   ```bash
   npx supabase secrets set BLAND_API_KEY=your_key_here --project-ref znpiwdvvsqaxuskpfleo
   ```

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

**Estimated cost per pizza order:** $0.18-$0.27 (2-3 minute call)

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

5. **Confirm**: Always reads back the final order and gets the total price.

### Example Adaptation

**Base order**: 4x cheese, 4x pepperoni, 2x veggie, 2x vegan

**What the AI might order**:
- Take the "Party Pack Special" (5 large pizzas for $60)
- Add their house specialty "Grandma's Supreme"
- Keep the 2x vegan pizzas (dietary requirement - firm)
- Get a free garlic bread (promotion)

## Edge Function

Location: `supabase/functions/ai-phone-order/index.ts`

### Request Format

```typescript
interface PhoneOrderRequest {
  pizzeriaName: string;
  pizzeriaPhone: string;
  items: OrderItem[];
  customerName: string;
  customerPhone: string;
  fulfillmentType: 'pickup' | 'delivery';
  deliveryAddress?: string;
  partySize?: number;  // Total guests - helps AI contextualize the order
}
```

### Response Format

```typescript
interface PhoneOrderResponse {
  success: boolean;
  callId?: string;
  status?: string;
  message?: string;
  error?: string;
}
```

## Future Improvements

- [ ] Add webhook to receive call completion status
- [ ] Store call recordings for quality assurance
- [ ] Add retry logic for failed calls
- [ ] Support for scheduled orders (call at specific time)
- [ ] Multi-language support
- [ ] Custom voice training for brand consistency
- [ ] Integration with Retell AI as alternative provider
- [ ] Call status tracking in UI (ringing, connected, completed)

## Fallback: Manual Phone Ordering

If AI calling is not configured or fails, users can:

1. Click "Call to Order" to see the pizzeria's phone number
2. Copy the auto-generated order script
3. Call the pizzeria manually and read the script

The order script is generated in `frontend/src/lib/ordering.ts` via `generatePhoneOrderScript()`.
