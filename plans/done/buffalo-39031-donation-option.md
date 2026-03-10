# Donation Option for Events

**Task ID:** buffalo-39031
**Priority:** High
**Status:** Planned

## Overview

Add an optional donation feature to RSV.Pizza events. Hosts can enable donations, configure suggested amounts, and view totals. Guests see an optional donation step during RSVP. Uses the existing Stripe integration.

## Database Schema

### Add to Party Model

```prisma
donationEnabled     Boolean   @default(false) @map("donation_enabled")
donationGoal        Decimal?  @db.Decimal(10, 2) @map("donation_goal")
donationMessage     String?   @map("donation_message")
suggestedAmounts    Json      @default("[500, 1000, 2500, 5000]") @map("suggested_amounts") // cents
donationRecipient   String?   @map("donation_recipient")
```

### New Donation Model

```prisma
model Donation {
  id              String   @id @default(cuid())
  amount          Decimal  @db.Decimal(10, 2)
  currency        String   @default("usd")
  status          String   @default("pending") // pending, succeeded, failed, refunded
  paymentIntentId String?  @map("payment_intent_id")
  chargeId        String?  @map("charge_id")
  donorName       String?  @map("donor_name")
  donorEmail      String?  @map("donor_email")
  isAnonymous     Boolean  @default(false) @map("is_anonymous")
  message         String?
  partyId         String   @map("party_id") @db.Uuid
  party           Party    @relation(fields: [partyId], references: [id], onDelete: Cascade)
  guestId         String?  @map("guest_id") @db.Uuid
  guest           Guest?   @relation(fields: [guestId], references: [id], onDelete: SetNull)
  createdAt       DateTime @default(now()) @map("created_at")
  updatedAt       DateTime @updatedAt @map("updated_at")

  @@map("donations")
}
```

## Backend API

### New Routes (`backend/src/routes/donation.routes.ts`)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/parties/:id/donations` | Host: get donation list |
| POST | `/api/parties/:id/donations` | Create a donation |
| GET | `/api/parties/:id/donations/public` | Public stats (total, goal progress) |

### Stripe Edge Function Updates

Add to `supabase/functions/stripe-payment/index.ts`:
- `create_donation_intent` - PaymentIntent for immediate capture
- `get_donation_status` - Check payment status

## Frontend Components

### New Files

| File | Purpose |
|------|---------|
| `components/DonationSettings.tsx` | Host config UI |
| `components/DonationStep.tsx` | Guest donation step in RSVP |
| `components/DonationForm.tsx` | Stripe Elements form |
| `components/DonationSummary.tsx` | Host dashboard section |

### Integration Points

- `EventDetailsTab.tsx` - Add DonationSettings to Options section
- `EventForm.tsx` - Add donation toggle for new events
- `RSVPPage.tsx` - Add Step 3 for optional donation
- `HostPage.tsx` - Add DonationSummary section

## Payment Flow

```
Guest clicks "Donate" →
Create PaymentIntent (edge function) →
Stripe Elements collects card →
Confirm payment client-side →
Create Donation record via API →
Show success message
```

## Implementation Phases

### Phase 1: Core Feature
1. Database migration
2. Backend APIs (Party CRUD + donation routes)
3. Host configuration UI
4. Guest donation flow (RSVP Step 3)
5. Host dashboard summary

### Phase 2: Future Enhancements
- Stripe Connect for direct host payouts
- Recurring donations
- Refunds from dashboard
- Thank-you emails
- Public donor wall

## Assumptions & Clarifications Needed

| Question | Assumption |
|----------|------------|
| Payment processor | Use existing Stripe integration |
| Fund distribution | Platform holds funds (Phase 1) |
| Platform fee | None in Phase 1 |
| Crypto donations | Defer to Phase 2+ |

## Files to Modify

### Backend
- `backend/prisma/schema.prisma` - Add models
- `backend/src/routes/party.routes.ts` - Donation fields
- `backend/src/routes/donation.routes.ts` - **New**
- `supabase/functions/stripe-payment/index.ts` - Donation intent

### Frontend
- `frontend/src/lib/supabase.ts` - Add types
- `frontend/src/lib/api.ts` - Donation API calls
- `frontend/src/components/EventForm.tsx` - Donation toggle
- `frontend/src/components/EventDetailsTab.tsx` - DonationSettings
- `frontend/src/pages/RSVPPage.tsx` - Step 3
- `frontend/src/pages/HostPage.tsx` - Summary section
- 4 new component files

## Verification Steps

- [ ] Create event with donations enabled
- [ ] Configure suggested amounts and goal
- [ ] RSVP and make donation (test mode)
- [ ] RSVP and skip donation
- [ ] Verify donation in host dashboard
- [ ] Test anonymous donation
- [ ] Test donation with message
- [ ] Test payment failure handling
