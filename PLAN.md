# Plan: Let Hosts Specify Which 3 Pizzerias Guests See

## Current Behavior
- When guests reach RSVP page 2, pizzerias are auto-fetched based on the event's address
- The top 3 results from Google Places search are shown
- Hosts have no control over which pizzerias appear

## Proposed Solution

### 1. Database Schema Change
Add a new field to the `Party` model in `backend/prisma/schema.prisma`:
```prisma
selectedPizzerias Json? @map("selected_pizzerias")
```
This will store an array of full pizzeria objects (name, placeId, address, url, etc.) so we don't need to re-fetch them.

### 2. Backend Changes

**Update `backend/src/routes/party.routes.ts`:**
- Allow `selectedPizzerias` to be updated via the existing party update endpoint

### 3. Frontend - Host Configuration (EventDetailsTab.tsx)

Add a new "Pizzeria Selection" section:

**A. Search & Select from Google Places:**
- Show pizzerias found near the event address (reuse existing search logic)
- Let hosts click to select up to 3 pizzerias
- Display selected pizzerias with ability to remove

**B. Manual Entry (if pizzeria not found):**
- "Add custom pizzeria" button
- Form fields:
  - Name (required)
  - Address (optional)
  - Phone (optional)
  - URL (optional) - for website or online ordering link
- Generate a unique ID for manual entries (e.g., `custom-{uuid}`)
- Custom pizzerias appear in the selected list

**C. Save selections to database**

### 4. Frontend - RSVP Page (RSVPPage.tsx)

Update pizzeria loading logic:
- If `party.selectedPizzerias` exists and has entries → use those directly
- Otherwise → fall back to current auto-fetch behavior (backward compatible)

## Files to Modify

| File | Changes |
|------|---------|
| `backend/prisma/schema.prisma` | Add `selectedPizzerias` field to Party |
| `backend/src/routes/party.routes.ts` | Handle `selectedPizzerias` in update |
| `frontend/src/types.ts` | Update `Party` interface |
| `frontend/src/components/EventDetailsTab.tsx` | Add pizzeria selection UI + manual entry form |
| `frontend/src/pages/RSVPPage.tsx` | Use stored pizzerias if available |

## Implementation Order

1. Schema + migration
2. Backend route update
3. Frontend types update
4. EventDetailsTab pizzeria selection UI with manual entry
5. RSVPPage to use stored pizzerias
6. Test end-to-end

## UI Mockup (EventDetailsTab)

```
Pizzeria Selection
─────────────────────────────────
Selected (2 of 3):
  [x] Joe's Pizza - 123 Main St
  [x] My Custom Pizzeria - 456 Oak Ave (mycustompizza.com)

Nearby Pizzerias:
  [ ] Tony's Slice - 789 Elm St
  [ ] Pizza Palace - 321 Pine St

[+ Add Custom Pizzeria]
  ┌─────────────────────────────┐
  │ Name: ________________      │
  │ Address: ______________     │
  │ Phone: ________________     │
  │ URL: __________________     │
  │         [Cancel] [Add]      │
  └─────────────────────────────┘
```
