# mushroom-31723 — Host action recovery: guest reject + un-check-in

**Priority:** P2
**Type:** Feature / UX
**Branch:** `mushroom-31723-guest-rejection`

## Problem

Hosts can take two actions today with no in-app undo:

1. **Hard-DELETE a guest** from three places (`GuestCard`, `GuestBasicCard`, `GuestList` via `TableRow`). A Calgary host just deleted a guest by accident; recovery exists only via `deletion_log` + manual SQL (`supabase/migrations/20260429_create_deletion_log.sql`) — terrible UX.
2. **Check in a guest** from the host dashboard — once `checkedInAt` is stamped, the badge becomes static (`TableRow.tsx:440-447`). No way for the host to fix a mis-tap.

We want both host-facing affordances to be reversible: replace delete with a soft-**reject** (keeps the row, hidden from default view, one-click restore), and add a one-click **un-check-in** on already-checked-in guests.

## Approach — repurpose `approved=false`

Use the existing `approved` boolean as the soft-rejection signal. No new column, no migration. `approved=false` means "host rejected" (hidden from default views); `approved=null` means "needs host action"; `approved=true` means "confirmed by host."

## Decisions

1. Trash button renamed to **"Reject"** universally. No confirm modal (reject is reversible).
2. Reject does NOT touch `status`. Only `approved=false` carries the signal.
3. Public RSVP endpoint filters `approved !== false` out of `PublicEvent.guests`.
4. Hard-delete pulled from host UI entirely. Backend DELETE route stays for API keys + underboss only.

## Backend PR #1 (this PR)

### `backend/src/routes/rsvp.routes.ts`
- Capacity counter (around line 84-87) currently filters by `status` only. Add `&& g.approved !== false` to BOTH the capacity counter and the waitlist position aggregator (around line 397-402). **Highest regression risk.**
- Existing-guest-RSVP path (around line 391): if matched guest has `approved === false`, return the generic "already RSVPd" path — don't silently reactivate them.
- `getEventBySlug` / public event payload: filter the `guests` array to `approved !== false` so rejected guests don't leak into `PublicEvent.guests`.

### `backend/src/routes/checkin.routes.ts`
- Manual host check-in (POST `/api/checkin/:inviteCode/:guestId`, around line 251): if `guest.approved === false`, throw `AppError('Guest was rejected', 400, 'GUEST_REJECTED')` before stamping `checkedInAt`.
- **NEW route: DELETE `/api/checkin/:inviteCode/:guestId`** — un-check-in.
  - Same auth as the POST.
  - Sets `checkedInAt: null, checkedInBy: null`.
  - Idempotent: if guest is not currently checked in, return 200 with a "not_checked_in" status, matching the POST's idempotent pattern.
  - If `guest.approved === false`, return 400 `GUEST_REJECTED` (defense in depth).
  - Emit webhook event `guest.checkin_undone` if the webhook infra supports new event types; if it requires a schema change to add a new event type, scope that down to: just stamp the DB change, leave a `// TODO(mushroom-31723): emit guest.checkin_undone webhook` comment, and proceed. Don't block on webhook wiring.

### `backend/src/routes/raffle.routes.ts`
- Raffle entry creation (around line 365-372): add `approved: { not: false }` to the guest lookup `where` so rejected guests can't enter raffles.

### `backend/src/routes/scorecard.routes.ts`
- `findGuestForUser` (around line 53-59): add `approved: { not: false }` so rejected guests can't view/edit their scorecard.

### `backend/src/routes/v1/guests.ts`
- GET list (around line 139): currently accepts an `approved` query param. When the param is absent, default to filtering `approved: { not: false }` so rejected guests are excluded by default. Document in the route's JSDoc: "Rejected guests (`approved=false`) are excluded by default. Pass `?approved=false` explicitly to include them."

### `backend/src/routes/party.routes.ts`
- DO NOT modify the PATCH `/:partyId/guests/:guestId/approve` handler — it already correctly leaves `status` alone when the row is not `PENDING`. Frontend will call it with `{ approved: false }` for reject and `{ approved: true | null }` for restore.
- DO NOT remove the DELETE `/:partyId/guests/:guestId` route — it stays for the API-key / underboss escape hatch.

## Verification (you must run before opening PR)

1. `cd backend && npm run typecheck` (or whatever the project uses — check `backend/package.json` for the right script; common names: `typecheck`, `tsc`, `build`)
2. `cd backend && npm run lint` if lint is wired
3. `cd backend && npm run build` to confirm full TS compilation
4. If a test suite exists for routes (`backend/src/**/*.test.ts` or similar), run the relevant ones

## Out of scope (frontend PR #2 — DO NOT touch in this PR)

- Any `frontend/` file. PR #2 will handle: `PizzaContext` filtering, `RejectedGuestsModal` component, `TableRow` reject button + uncheckin `×`, `GuestList` header chip, optimistic updates.
- Don't change DB schema, Prisma, or migrations.
- Don't change `dbGuestToGuest`, `DbGuest` interface, or `safeColumns` — Option A is zero-schema-change.
