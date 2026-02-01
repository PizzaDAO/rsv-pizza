# Waitlist Feature

**Task ID:** sausage-63975
**Priority:** Mid
**Status:** Planned

## Overview

When an event reaches max capacity, allow guests to join a waitlist. Hosts can promote guests when spots open, triggering email notifications.

## Database Changes

### Add to Guest Model

```prisma
status           GuestStatus @default(CONFIRMED)
waitlistPosition Int?        @map("waitlist_position")
promotedAt       DateTime?   @map("promoted_at")

enum GuestStatus {
  PENDING     // Awaiting approval
  CONFIRMED   // Confirmed guest
  DECLINED    // Declined by host
  WAITLISTED  // On waitlist
}
```

### Migration

```sql
ALTER TABLE guests
  ADD COLUMN status TEXT NOT NULL DEFAULT 'CONFIRMED',
  ADD COLUMN waitlist_position INTEGER,
  ADD COLUMN promoted_at TIMESTAMPTZ;

UPDATE guests SET status = 'PENDING' WHERE approved IS NULL;
UPDATE guests SET status = 'CONFIRMED' WHERE approved = true;
UPDATE guests SET status = 'DECLINED' WHERE approved = false;
```

## Backend API

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/rsvp/:code/guest` | Modified: add to waitlist if at capacity |
| GET | `/api/parties/:id/waitlist` | Get waitlist for party |
| POST | `/api/parties/:id/guests/:guestId/promote` | Promote from waitlist |

### RSVP at Capacity

Instead of error, create guest with `status: WAITLISTED` and assign position.

### Promote Endpoint

1. Verify guest is waitlisted
2. Update status to CONFIRMED
3. Reorder remaining waitlist positions
4. Send promotion email with QR code
5. Trigger webhook

## Frontend Changes

### RSVPModal

Add waitlist success state:
- "You're on the Waitlist!"
- Show position number
- "We'll notify you if a spot opens"

### GuestList

Split into two sections:
- **Guests**: Confirmed guests with count/capacity
- **Waitlist**: Waitlisted guests with position badges + "Promote" button

### TableRow

Add waitlist variant:
- Position badge (#1, #2, etc.)
- Promote button (green)
- Remove button

### PizzaContext

Add `promoteGuest(id)` function.

### EventPage

Update capacity display:
- "X spots left" when not full
- "(Waitlist open)" when at capacity

## Email Functions

- `sendWaitlistConfirmationEmail` - Position + "we'll notify you"
- `sendPromotionEmail` - Celebration + QR code

## Implementation Order

1. Database migration
2. Backend: RSVP waitlist logic + promote endpoint
3. Backend: Email functions
4. Frontend: Types + API calls
5. Frontend: RSVPModal waitlist state
6. Frontend: GuestList + TableRow waitlist UI
7. Frontend: EventPage capacity display
8. Webhooks: `guest.waitlisted`, `guest.promoted`

## Verification

- [ ] RSVP when at capacity → joins waitlist
- [ ] See waitlist position in success message
- [ ] Host sees waitlist section in dashboard
- [ ] Promote guest → moves to confirmed
- [ ] Promotion email received with QR
- [ ] Remaining positions reorder correctly
- [ ] Webhooks fire for waitlist/promote events
