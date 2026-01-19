# AI Calling Feature Integration Plan

## Overview

This plan integrates the enhanced AI calling feature from `rsvpizza-ai-calling` into the current `feature/auto-call` branch. The key improvements include:

- **Real-time call tracking** with database persistence
- **Call status polling** with animated UI feedback
- **Call transcript & recording** viewing
- **Retry logic** for failed calls
- **Webhook handling** for call completion updates

## Current State vs Target State

| Feature | Current (auto-call) | Target (ai-calling) |
|---------|---------------------|---------------------|
| Call initiation | Supabase Edge Function | Backend Express API |
| Call tracking | None | AIPhoneCall database model |
| Status updates | None (fire-and-forget) | Real-time polling every 3s |
| Transcript | Not available | Full transcript + recording |
| Retry | Not available | Retry failed/no-answer calls |
| Webhook | None | Bland AI webhook processing |

---

## Phase 1: Backend Changes

### 1.1 Add AIPhoneCall Model to Prisma Schema

**File:** `backend/prisma/schema.prisma`

Add after the `MagicLink` model:

```prisma
model AIPhoneCall {
  id     String @id @default(cuid())
  callId String @unique // Bland AI call_id
  status String @default("initiated") // initiated, ringing, in_progress, completed, failed, no_answer

  // Call metadata
  pizzeriaPhone   String
  pizzeriaName    String
  customerName    String
  customerPhone   String
  fulfillmentType String  // pickup, delivery
  deliveryAddress String?

  // Order details sent
  orderItems     String @default("[]") // JSON array as string
  estimatedTotal Int? // In cents

  // Extracted from call
  confirmedTotal Int?    // Actual total from pizzeria (cents)
  estimatedTime  String? // "30-45 minutes"
  orderConfirmed Boolean @default(false)

  // Call artifacts
  transcript   String?
  summary      String?
  recordingUrl String?
  callDuration Int? // seconds

  // Timestamps
  callStartedAt DateTime?
  callEndedAt   DateTime?
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  // Relations
  orderId String?
  order   Order?  @relation(fields: [orderId], references: [id])

  partyId String @db.Uuid
  party   Party  @relation(fields: [partyId], references: [id])

  userId String
  user   User   @relation(fields: [userId], references: [id])
}
```

Also add relation fields to existing models:
- **User:** Add `aiPhoneCalls AIPhoneCall[]`
- **Party:** Add `aiPhoneCalls AIPhoneCall[]`
- **Order:** Add `aiPhoneCall AIPhoneCall?`

### 1.2 Create Backend Service

**File:** `backend/src/services/blandAI.service.ts`

Core functions:
- `initiateCall(request)` - Create DB record, call Bland API
- `processWebhook(payload)` - Handle call completion, update DB, create Order
- `getCallById(id)` - Get call by our internal ID
- `getCallStatus(callId)` - Get call by Bland's call_id
- `retryCall(aiPhoneCallId)` - Retry a failed call

### 1.3 Create Webhook Auth Middleware

**File:** `backend/src/middleware/webhookAuth.ts`

- HMAC-SHA256 signature verification
- Uses `BLAND_WEBHOOK_SECRET` env var
- Allows webhooks without verification in dev mode

### 1.4 Create API Routes

**File:** `backend/src/routes/ai-phone.routes.ts`

Endpoints:
| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/api/ai-phone/initiate` | Required | Start AI phone call |
| GET | `/api/ai-phone/:id/status` | Required | Get call status |
| GET | `/api/ai-phone/:id/transcript` | Required | Get transcript/recording |
| POST | `/api/ai-phone/:id/retry` | Required | Retry failed call |
| POST | `/api/ai-phone/webhook` | Webhook | Receive Bland AI webhooks |

### 1.5 Register Routes

**File:** `backend/src/index.ts`

Add import and route registration:
```typescript
import aiPhoneRoutes from './routes/ai-phone.routes.js';
// ...
app.use('/api/ai-phone', aiPhoneRoutes);
```

---

## Phase 2: Frontend Changes

### 2.1 Add AICallStatus Component

**File:** `frontend/src/components/AICallStatus.tsx`

Features:
- Real-time status polling (every 3 seconds)
- Animated status icons for each call phase
- Elapsed time display
- Progress indicators (3 dots)
- Order confirmation display
- Retry/cancel buttons for failed calls

### 2.2 Add CallTranscript Component

**File:** `frontend/src/components/CallTranscript.tsx`

Features:
- Collapsible transcript viewer
- Audio recording playback
- Call summary display
- Duration indicator

### 2.3 Update Ordering Library

**File:** `frontend/src/lib/ordering.ts`

Add new functions:
```typescript
// Initiate call via backend API
export async function initiateAIPhoneCall(
  partyId: string,
  pizzeriaName: string,
  pizzeriaPhone: string,
  items: OrderItem[],
  customerName: string,
  customerPhone: string,
  fulfillmentType: 'pickup' | 'delivery',
  deliveryAddress?: string,
  partySize?: number,
  estimatedTotal?: number
): Promise<{ success: boolean; callId?: string; aiPhoneCallId?: string; error?: string }>

// Retry a failed call
export async function retryAIPhoneCall(
  aiPhoneCallId: string
): Promise<{ success: boolean; callId?: string; aiPhoneCallId?: string; error?: string }>

// Get call status
export async function getAIPhoneCallStatus(
  aiPhoneCallId: string
): Promise<CallStatusData>

// Get call transcript
export async function getAIPhoneCallTranscript(
  aiPhoneCallId: string
): Promise<TranscriptData>
```

### 2.4 Update OrderCheckout Component

**File:** `frontend/src/components/OrderCheckout.tsx`

Changes:
1. Add `partyId` prop to interface
2. Add `calling` and `complete` to `CheckoutStep` type
3. Add state: `aiPhoneCallId`, `callData`
4. Import `AICallStatus` and `CallTranscript` components
5. Import new ordering functions
6. Update `handleAIPhoneOrder` to use backend API when `partyId` available
7. Add `handleCallComplete` and `handleRetryCall` handlers
8. Add `calling` step rendering with `AICallStatus`
9. Add `complete` step rendering with order details and `CallTranscript`

---

## Phase 3: Environment Variables

### Backend `.env`
```
# Existing
DATABASE_URL=postgresql://...
JWT_SECRET=...
FRONTEND_URL=...
PORT=3006

# New
BLAND_API_KEY=your_bland_api_key
BLAND_WEBHOOK_SECRET=your_webhook_secret (optional)
BACKEND_URL=https://your-backend-url.com (for webhook callback)
```

### Frontend `.env`
```
# Existing
VITE_BACKEND_URL=http://localhost:3006
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

---

## Phase 4: Database Migration

After updating the Prisma schema:

```bash
cd backend
npx prisma migrate dev --name add_ai_phone_call
npx prisma generate
```

---

## Implementation Order

1. **Backend first** (can be tested independently):
   - [ ] Update Prisma schema with AIPhoneCall model
   - [ ] Run database migration
   - [ ] Create `blandAI.service.ts`
   - [ ] Create `webhookAuth.ts`
   - [ ] Create `ai-phone.routes.ts`
   - [ ] Register routes in `index.ts`
   - [ ] Test endpoints with Postman/curl

2. **Frontend second**:
   - [ ] Add `AICallStatus.tsx` component
   - [ ] Add `CallTranscript.tsx` component
   - [ ] Update `ordering.ts` with new API functions
   - [ ] Update `OrderCheckout.tsx` with new flow
   - [ ] Update any components that use `OrderCheckout` to pass `partyId`

3. **Integration testing**:
   - [ ] Test full flow: initiate → status polling → completion
   - [ ] Test retry on failed calls
   - [ ] Test webhook processing
   - [ ] Verify transcript/recording display

---

## Files Changed Summary

### New Files
| Path | Purpose |
|------|---------|
| `backend/src/services/blandAI.service.ts` | Bland AI service layer |
| `backend/src/routes/ai-phone.routes.ts` | API endpoints |
| `backend/src/middleware/webhookAuth.ts` | Webhook verification |
| `frontend/src/components/AICallStatus.tsx` | Call status display |
| `frontend/src/components/CallTranscript.tsx` | Transcript viewer |

### Modified Files
| Path | Changes |
|------|---------|
| `backend/prisma/schema.prisma` | Add AIPhoneCall model + relations |
| `backend/src/index.ts` | Register ai-phone routes |
| `frontend/src/lib/ordering.ts` | Add new API functions |
| `frontend/src/components/OrderCheckout.tsx` | Add calling/complete steps |

---

## Risk Mitigation

1. **Backward Compatibility**: Keep existing Supabase edge function as fallback when `partyId` is not available
2. **Feature Flag**: Can add env var to enable/disable new flow
3. **Database**: New model is additive, doesn't break existing data
4. **Webhook**: Works without secret in dev mode for easier testing

---

## Notes

- The current branch uses explicit styling (`bg-[#1a1a2e]`) while ai-calling uses `card` class. Will use current branch styling.
- `party` is available from `usePizza()` context in `PizzaOrderSummary.tsx` (line 21) - pass `party?.id` as `partyId` prop
- The ai-calling version has legacy fallback to edge function - will preserve this for backward compatibility

---

## Detailed File Changes

### PizzaOrderSummary.tsx (line ~684)

```diff
  {selectedPizzeria && selectedOption && (
    <OrderCheckout
      pizzeria={selectedPizzeria}
      orderingOption={selectedOption}
      recommendations={recommendations}
+     partyId={party?.id}
      onClose={handleCloseCheckout}
      onOrderComplete={handleOrderComplete}
    />
  )}
```

### OrderCheckout.tsx - Interface Update

```diff
  interface OrderCheckoutProps {
    pizzeria: Pizzeria;
    orderingOption: OrderingOption;
    recommendations: PizzaRecommendation[];
+   partyId?: string;
    onClose: () => void;
    onOrderComplete: (orderId: string, checkoutUrl?: string) => void;
  }
```

### OrderCheckout.tsx - CheckoutStep Type

```diff
- type CheckoutStep = 'details' | 'payment' | 'confirm';
+ type CheckoutStep = 'details' | 'payment' | 'confirm' | 'calling' | 'complete';
```

### OrderCheckout.tsx - New State Variables

```typescript
// AI Phone Call state
const [aiPhoneCallId, setAiPhoneCallId] = useState<string | null>(null);
const [callData, setCallData] = useState<CallStatusData | null>(null);
```

### OrderCheckout.tsx - New Imports

```typescript
import { AICallStatus, CallStatusData } from './AICallStatus';
import { CallTranscript } from './CallTranscript';
import {
  // ... existing imports
  initiateAIPhoneCall,
  retryAIPhoneCall,
} from '../lib/ordering';
```
