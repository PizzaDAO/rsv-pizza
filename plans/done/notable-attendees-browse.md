# Notable Attendees: Browse All + Star Toggle

## Overview

Two related features:
1. **"Browse All" button** in the Notable Attendees section — opens a modal showing all guests with star toggles
2. **Star toggle in Guest List** — click a star icon on any guest row to mark them as a notable attendee

## Current State

- `notable_attendees` table has: `id`, `party_id`, `name`, `link`, `sort_order`, `created_at` — **no guest_id link**
- `NotableAttendeesList.tsx` has inline "Search Guests" (text search, max 8 results) + "Add Manually" form
- `GuestList.tsx` / `TableRow.tsx` have no awareness of notable attendees

## Database

### New column on `notable_attendees`: `guest_id`

```sql
ALTER TABLE notable_attendees
ADD COLUMN guest_id UUID REFERENCES guests(id) ON DELETE CASCADE;

CREATE INDEX idx_notable_attendees_guest_id ON notable_attendees(guest_id);
```

Nullable — notable attendees can also be manually added (non-guests like companies).

### Prisma schema

```prisma
model NotableAttendee {
  id        String   @id @default(uuid()) @db.Uuid
  partyId   String   @map("party_id") @db.Uuid
  party     Party    @relation(fields: [partyId], references: [id], onDelete: Cascade)
  name      String
  link      String?
  guestId   String?  @map("guest_id") @db.Uuid
  guest     Guest?   @relation(fields: [guestId], references: [id], onDelete: Cascade)
  sortOrder Int      @default(0) @map("sort_order")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz

  @@index([partyId])
  @@map("notable_attendees")
}
```

Add reverse relation to Guest model: `notableAttendees NotableAttendee[]`

## Backend Routes (`backend/src/routes/report.routes.ts`)

### Modified: POST `/:partyId/report/notable-attendees`

Accept optional `guestId`. If provided, check for duplicates (return existing if already notable).

### New: DELETE `/:partyId/report/notable-attendees/by-guest/:guestId`

Remove notable attendee by guest ID (for unstar action).

### New: GET `/:partyId/report/notable-attendees/guest-ids`

Returns array of `guestId` values that are currently notable. Lightweight — used by GuestList for star states.

## Frontend Components

### New: `report/BrowseGuestsModal.tsx`

Full-screen modal showing ALL guests in a scrollable, searchable list with star toggles:
- Search by name or email using `IconInput`
- Each row: avatar initial, name, email, star toggle button
- Star filled yellow = notable, empty = not notable
- Counter at bottom: "X notable attendees selected"
- Follows modal pattern: fixed backdrop `bg-black/60 backdrop-blur-sm` + `z-50`

### Modified: `report/NotableAttendeesList.tsx`

- Replace "Search Guests" button with **"Browse All"** button that opens `BrowseGuestsModal`
- Keep "Add Manually" button for non-guest notable attendees

### Modified: `TableRow.tsx`

Add star icon to `basic` variant (guest rows):
- New props: `isNotable?`, `onToggleNotable?`, `isTogglingNotable?`
- Star visible on hover if not notable, always visible if notable (filled yellow)
- Same hover-reveal pattern as existing trash icon

### Modified: `GuestList.tsx`

- Fetch notable guest IDs on mount via `getNotableGuestIds`
- Track in state: `Set<string>` of notable guest IDs
- `handleToggleNotable` callback with optimistic updates
- Pass `isNotable` and `onToggleNotable` to each `TableRow`

## Syncing State

No global state needed. API is source of truth. Each component fetches on mount/tab switch:
- Star a guest in Guest List → switch to Report tab → Report re-fetches, sees new notable
- Star in Browse All modal → switch to Guests tab → GuestList re-fetches notable IDs

## Frontend Types (`frontend/src/types.ts`)

```typescript
export interface NotableAttendee {
  id: string;
  partyId: string;
  name: string;
  link: string | null;
  guestId: string | null;  // NEW
  sortOrder: number;
  createdAt: string;
}
```

## Frontend API (`frontend/src/lib/api.ts`)

Modify: `addNotableAttendee` — accept optional `guestId`
Add: `deleteNotableAttendeeByGuestId`, `getNotableGuestIds`

## Files to Create

- `frontend/src/components/report/BrowseGuestsModal.tsx`

## Files to Modify

- `backend/prisma/schema.prisma` — Add `guestId` to NotableAttendee, reverse relation on Guest
- `backend/src/routes/report.routes.ts` — Update POST, add DELETE-by-guest, add GET guest-ids
- `frontend/src/types.ts` — Add `guestId` to NotableAttendee
- `frontend/src/lib/api.ts` — Add/modify API functions
- `frontend/src/components/report/NotableAttendeesList.tsx` — Browse All button + modal
- `frontend/src/components/TableRow.tsx` — Star icon in basic variant
- `frontend/src/components/GuestList.tsx` — Notable state management + wire to TableRow

## Implementation Order

1. DB migration: Add `guest_id` column to `notable_attendees`
2. Prisma schema: Add `guestId` to NotableAttendee, reverse relation on Guest
3. Backend: Update POST, add DELETE-by-guest + GET guest-ids endpoints
4. Deploy backend
5. Frontend types + API functions
6. Create `BrowseGuestsModal`
7. Update `NotableAttendeesList` — Browse All button + modal
8. Update `TableRow` — star icon props and rendering
9. Update `GuestList` — notable state management + wire star toggle

## Edge Cases

- **Duplicate prevention**: Backend POST checks for existing `guestId` before creating
- **Name-only matches**: Browse All modal detects name matches to avoid duplicates
- **Deleted guests**: `ON DELETE CASCADE` removes notable attendee record when guest deleted
- **Manual entries**: No star shown in guest list (they may not be actual guests)
- **Optimistic updates**: Both GuestList star and Browse All modal update UI immediately
