# Checklist Widget

## Overview

Event planning checklist for hosts with two item types:
1. **Manual items** — host marks complete (e.g., "Co-hosts confirmed")
2. **Auto-complete items** — detect completion from party/widget state (e.g., "Venue confirmed" when venue is added)

## Default GPP Checklist Items (2026)

| Due Date | Task | Type | Auto Rule | Links To |
|----------|------|------|-----------|----------|
| March 8 | Submit Party Kit Shipping Address | Auto | `party_kit_submitted` | Party Kit tab |
| March 14 | Co-hosts confirmed | Manual | — | — |
| April 3 | Venue confirmed | Auto | `venue_added` | Venue tab |
| April 10 | Budget submitted | Auto | `budget_submitted` | Budget tab |

Defaults are seeded lazily on first load (not on party creation). Idempotent — calling seed twice has no effect.

## Database

### New table: `checklist_items`

```sql
CREATE TABLE checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  due_date DATE,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  is_auto BOOLEAN NOT NULL DEFAULT false,
  auto_rule TEXT,       -- 'party_kit_submitted', 'venue_added', 'budget_submitted'
  link_tab TEXT,        -- tab to navigate to when clicked
  sort_order INT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_checklist_items_party_id ON checklist_items(party_id);
CREATE INDEX idx_checklist_items_party_sort ON checklist_items(party_id, sort_order);
```

No changes to `parties` table needed — 6-step DB field checklist does NOT apply.

## Prisma Schema

```prisma
model ChecklistItem {
  id          String    @id @default(uuid()) @db.Uuid
  partyId     String    @map("party_id") @db.Uuid
  party       Party     @relation(fields: [partyId], references: [id], onDelete: Cascade)
  name        String
  dueDate     DateTime? @map("due_date") @db.Date
  completed   Boolean   @default(false)
  completedAt DateTime? @map("completed_at") @db.Timestamptz
  isAuto      Boolean   @default(false) @map("is_auto")
  autoRule    String?   @map("auto_rule")
  linkTab     String?   @map("link_tab")
  sortOrder   Int       @default(0) @map("sort_order")
  isDefault   Boolean   @default(false) @map("is_default")
  createdAt   DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@index([partyId, sortOrder])
  @@map("checklist_items")
}
```

Also add `checklistItems ChecklistItem[]` relation to the Party model.

## Backend Routes (`backend/src/routes/checklist.routes.ts`)

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/:partyId/checklist` | Get items + auto-complete state data |
| POST | `/:partyId/checklist/seed` | Seed default GPP items (idempotent) |
| POST | `/:partyId/checklist/items` | Create custom item |
| PATCH | `/:partyId/checklist/items/:itemId` | Update item |
| DELETE | `/:partyId/checklist/items/:itemId` | Delete custom item (not defaults) |
| POST | `/:partyId/checklist/items/:itemId/toggle` | Toggle manual completion |

### GET response shape

```typescript
{
  items: ChecklistItem[],
  autoCompleteStates: {
    party_kit_submitted: boolean,  // party_kits has record for this party
    venue_added: boolean,          // party.venue_name is set OR venues table has entry
    budget_submitted: boolean,     // budget_items has items for this party
  },
  seeded: boolean  // whether default items exist
}
```

Register in `backend/src/index.ts` BEFORE `partyRoutes`.

## Frontend Types (`frontend/src/types.ts`)

```typescript
export interface ChecklistItem {
  id: string;
  partyId: string;
  name: string;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  isAuto: boolean;
  autoRule: string | null;
  linkTab: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutoCompleteStates {
  party_kit_submitted: boolean;
  venue_added: boolean;
  budget_submitted: boolean;
}

export interface ChecklistData {
  items: ChecklistItem[];
  autoCompleteStates: AutoCompleteStates;
  seeded: boolean;
}
```

## Frontend API (`frontend/src/lib/api.ts`)

6 functions: `getChecklist`, `seedChecklist`, `createChecklistItem`, `updateChecklistItem`, `deleteChecklistItem`, `toggleChecklistItem`

## Frontend Components

| File | Purpose |
|------|---------|
| `checklist/ChecklistTab.tsx` | Main tab — loads data, auto-seeds on first load, renders list + progress |
| `checklist/ChecklistItemRow.tsx` | Row: checkbox, name (clickable if linkTab), due date (red if overdue) |
| `checklist/ChecklistItemForm.tsx` | Modal: add custom task (name + due date) |
| `checklist/index.ts` | Barrel export |

### Auto-complete logic (frontend)

```typescript
function isItemCompleted(item: ChecklistItem, autoStates: AutoCompleteStates): boolean {
  if (item.isAuto && item.autoRule) {
    return autoStates[item.autoRule as keyof AutoCompleteStates] ?? false;
  }
  return item.completed;
}
```

Auto items: checkbox reflects real state, disabled (user can't toggle).
Manual items: toggleable by user.
Custom items: deletable. Default items: not deletable.

## Wire Up

1. **HostPage.tsx** — add `'checklist'` to `TabType` + `ALL_VALID_TABS`, import + render `ChecklistTab`
2. **AppsHub.tsx** — change checklist from `'coming-soon'` to `'live'`, add `tab: 'checklist'`
3. **appDefinitions.ts** — add to `PINNABLE_APPS`

## Files to Create

- `backend/src/routes/checklist.routes.ts`
- `frontend/src/components/checklist/ChecklistTab.tsx`
- `frontend/src/components/checklist/ChecklistItemRow.tsx`
- `frontend/src/components/checklist/ChecklistItemForm.tsx`
- `frontend/src/components/checklist/index.ts`

## Files to Modify

- `backend/prisma/schema.prisma` — add ChecklistItem model + Party relation
- `backend/src/index.ts` — register checklist routes
- `frontend/src/types.ts` — add types
- `frontend/src/lib/api.ts` — add API functions
- `frontend/src/pages/HostPage.tsx` — add tab
- `frontend/src/components/AppsHub.tsx` — change status to live
- `frontend/src/lib/appDefinitions.ts` — add to PINNABLE_APPS

## Implementation Order

1. Apply DB migration (Supabase MCP)
2. Update Prisma schema + generate
3. Create backend routes, register in index.ts
4. Deploy backend (`cd backend && vercel --prod --scope pizza-dao`)
5. Add frontend types + API functions
6. Create frontend components
7. Wire into HostPage + AppsHub + appDefinitions
8. Push branch for preview
