# Future Features

This document tracks features that have been discussed, planned, or partially implemented for future development.

---

## Half-Implemented Features

### Guest Email Invites
**Status:** UI hidden, backend not implemented
**Location:** `frontend/src/components/GuestList.tsx`, `InviteGuestsModal.tsx`

The "Invite Guest" button and modal exist but currently only log to console. The modal allows entering email addresses but doesn't send actual invitations.

**To complete:**
- Create backend endpoint for sending invite emails
- Track invited-but-not-RSVPed guests in database
- Show "Your Events" section for invited events (currently only shows RSVP'd events)

### Check-in System
**Status:** QR codes generated, no check-in endpoint
**Location:** `backend/src/routes/rsvp.routes.ts`

RSVP confirmation emails include QR codes linking to `rsv.pizza/checkin/{inviteCode}/{guestId}`, but the check-in page/endpoint doesn't exist yet.

**To complete:**
- Create `/checkin/:inviteCode/:guestId` route
- Add `checkedInAt` field to Guest model
- Build check-in UI for hosts to scan/verify guests
- Track attendance vs RSVPs

---

## Planned Features

### Multi-Wave Pizza Ordering
**Status:** Detailed plan exists
**Plan:** `.claude/plans/staged-drifting-coral.md`

For long parties (2+ hours), split pizza deliveries into multiple waves:
- First wave arrives 5 minutes BEFORE party starts
- First wave weighted 1.25x heavier
- No pizza arrives less than 45 minutes before party ends
- Waves spaced 45-60 minutes apart

**Implementation includes:**
- Add `duration` field to Party model
- Create wave calculation algorithm
- Update UI to show stacked wave sections
- Update call script for multi-wave orders

### Pizzeria Recommendations
**Status:** Not implemented
**Discussed:** Show top 3 local pizzerias based on event location

Allow guests to rank their preferred pizzerias 1-3 by clicking. Could integrate with:
- Google Places API
- Yelp API
- Manual pizzeria database

### User Invitations (Not RSVPs)
**Status:** Not implemented
**Discussed:** Differentiate between "invited" and "RSVPed" guests

Currently guests only exist after RSVPing. Could add:
- Pre-invite guests by email
- Track invitation status (sent, opened, RSVPed, declined)
- Show hosts who hasn't responded

---

## Ideas for Later

### Dietary Matching Algorithm Improvements
- Better handling of half-and-half pizzas for mixed dietary needs
- Auto-suggest pizza combinations based on guest preferences
- Handle conflicting preferences more gracefully

### Event Templates
- Save event settings as reusable templates
- Quick-create from previous events
- Share templates between hosts

### Payment Integration
- Guests can contribute to pizza costs
- Split costs evenly or by consumption
- Venmo/PayPal/crypto integration

### Real-time Updates
- Live guest count on event page
- Notifications when new RSVPs come in
- WebSocket integration for instant updates

### Analytics Dashboard
- Most popular toppings over time
- Guest attendance rates
- Cost per guest metrics

---

## Technical Debt

### Supabase/Backend Hybrid
Currently using Supabase for some operations and Express backend for others. Consider:
- Standardizing on one approach
- Moving all auth to Supabase
- Using Supabase Edge Functions instead of Express

### Missing Tests
- No unit tests for pizza algorithm
- No integration tests for API endpoints
- No E2E tests for critical flows
