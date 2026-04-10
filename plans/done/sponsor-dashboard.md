# Sponsor Dashboard

## Summary
A dashboard for sponsors (similar to the Underboss Dashboard) that shows all events tagged with their sponsor tag. Sponsors are regular users granted a sponsor role + tag by admins via `/admin`.

## Access Model
- **Auth**: Sponsors log in with a regular account (same as hosts)
- **Role assignment**: Admin adds the user's email as a sponsor in `/admin` with a **sponsor tag** (e.g., `swc`)
- **Scoping**: Dashboard shows only events where `eventTags` or `hostTags` contains their sponsor tag
- **Route**: `/sponsor-dashboard` (authenticated, checks sponsor role)
- **Pattern**: Follows the same model as Underboss — `Admin` table has roles, `Underboss` table has regions. New `SponsorUser` table has tags.

## Sections
1. **Checklist** — sponsor-specific tasks per event
2. **Venue location** — map + address per event
3. **Budget** — event budget summary (read-only)
4. **Hosts + Co-hosts** — reuse `HostsList` component
5. **RSVP counts** — guest count / max guests

## Database Changes

### New table: `sponsor_users`
```sql
CREATE TABLE sponsor_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  name TEXT,
  tag TEXT NOT NULL,              -- e.g., "swc" — matches against eventTags/hostTags
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sponsor_users_tag ON sponsor_users(tag);
```

This mirrors the `Underboss` table pattern (email-based lookup, active flag, created_by) but uses a `tag` instead of `region`.

### New table: `sponsor_checklist_items`
```sql
CREATE TABLE sponsor_checklist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_user_id UUID NOT NULL REFERENCES sponsor_users(id) ON DELETE CASCADE,
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT false,
  completed_at TIMESTAMPTZ,
  due_date DATE,
  sort_order INT NOT NULL DEFAULT 0,
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_sponsor_checklist_sponsor ON sponsor_checklist_items(sponsor_user_id);
CREATE INDEX idx_sponsor_checklist_party ON sponsor_checklist_items(party_id);
```

### Prisma models
```prisma
model SponsorUser {
  id        String   @id @default(uuid()) @db.Uuid
  email     String   @unique
  name      String?
  tag       String                          // e.g., "swc"
  isActive  Boolean  @default(true) @map("is_active")
  notes     String?
  createdBy String?  @map("created_by")
  createdAt DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt DateTime @updatedAt @map("updated_at") @db.Timestamptz

  checklistItems SponsorChecklistItem[]

  @@index([tag])
  @@map("sponsor_users")
}

model SponsorChecklistItem {
  id            String    @id @default(uuid()) @db.Uuid
  sponsorUserId String    @map("sponsor_user_id") @db.Uuid
  sponsorUser   SponsorUser @relation(fields: [sponsorUserId], references: [id], onDelete: Cascade)
  partyId       String    @map("party_id") @db.Uuid
  party         Party     @relation(fields: [partyId], references: [id], onDelete: Cascade)
  name          String
  completed     Boolean   @default(false)
  completedAt   DateTime? @map("completed_at") @db.Timestamptz
  dueDate       DateTime? @map("due_date") @db.Date
  sortOrder     Int       @default(0) @map("sort_order")
  isDefault     Boolean   @default(false) @map("is_default")
  createdAt     DateTime  @default(now()) @map("created_at") @db.Timestamptz
  updatedAt     DateTime  @updatedAt @map("updated_at") @db.Timestamptz

  @@index([sponsorUserId])
  @@index([partyId])
  @@map("sponsor_checklist_items")
}
```

## Backend

### Admin endpoints (in `/api/admin/`)
| Method | Endpoint | Permission | Purpose |
|--------|----------|-----------|---------|
| GET | `/api/admin/sponsor-users` | isAdmin | List all sponsor users |
| POST | `/api/admin/sponsor-users` | isSuperAdmin | Create sponsor user (email + tag) |
| PATCH | `/api/admin/sponsor-users/:id` | isSuperAdmin | Update sponsor user |
| DELETE | `/api/admin/sponsor-users/:id` | isSuperAdmin | Deactivate sponsor user |

### Sponsor dashboard endpoints (in `/api/sponsor/`)
| Method | Endpoint | Auth | Purpose |
|--------|----------|------|---------|
| GET | `/api/sponsor/me` | requireAuth | Check if logged-in user is a sponsor, return tag |
| GET | `/api/sponsor/events` | requireSponsorAuth | Get all events matching sponsor's tag with dashboard data |
| POST | `/api/sponsor/checklist/:itemId/toggle` | requireSponsorAuth | Toggle checklist item |

### `requireSponsorAuth` middleware
```typescript
// Look up user email in sponsor_users table
// If found and isActive, attach sponsorUser to req
// If not found, 403
```

### `GET /api/sponsor/events` response
```typescript
{
  sponsor: { name, email, tag },
  events: [{
    id, name, slug, date, timezone, address, venueName, eventImageUrl,
    hostName, hostProfile,
    coHosts: [...],
    rsvpCount, maxGuests,
    budget: { total, spent, paid, pending, remaining } | null,
    checklist: [{ id, name, completed, dueDate, sortOrder }]
  }]
}
```

Events are queried with: `WHERE event_tags @> ARRAY['swc']` (or `host_tags`).

## Admin UI Changes

### Add "Sponsor Users" section to AdminPage
Following the existing Underboss management pattern:
- **Add Sponsor User**: email input + tag input + name (optional)
- **List sponsor users**: show email, name, tag, active status
- **Deactivate/remove**: toggle active status

This goes in the existing `AdminPage.tsx` as a new section, similar to the "Underboss Management" section.

## Files to Create

| File | Purpose |
|------|---------|
| `frontend/src/pages/SponsorDashboardPage.tsx` | Main dashboard page |
| `frontend/src/components/sponsor-dashboard/SponsorChecklist.tsx` | Checklist with progress bar |
| `frontend/src/components/sponsor-dashboard/EventInfoCard.tsx` | Per-event card (venue/map/date) |
| `frontend/src/components/sponsor-dashboard/BudgetSummary.tsx` | Read-only budget overview |
| `frontend/src/components/sponsor-dashboard/RsvpCounter.tsx` | RSVP count display |
| `backend/src/routes/sponsor-user.routes.ts` | Sponsor dashboard + admin management endpoints |
| `backend/src/middleware/sponsorAuth.ts` | `requireSponsorAuth` middleware |

## Files to Modify

| File | Change |
|------|--------|
| `frontend/src/App.tsx` | Add `/sponsor-dashboard` route |
| `frontend/src/pages/AdminPage.tsx` | Add "Sponsor Users" management section |
| `frontend/src/lib/api.ts` | Add sponsor dashboard + admin API functions |
| `frontend/src/types.ts` | Add `SponsorUser`, `SponsorDashboardData`, `SponsorChecklistItem` |
| `backend/src/index.ts` | Mount sponsor user routes |
| `backend/prisma/schema.prisma` | Add `SponsorUser` + `SponsorChecklistItem` models |

## Layout

Multi-event portfolio view — one page showing all tagged events as cards:

```
[Header: Sponsor Logo/Name]
"SWC Sponsor Dashboard"
"Showing 12 events tagged 'swc'"

[Event Card 1: "Global Pizza Party Philadelphia"]
  +----------------------------------------------+
  | [Map Thumb]  May 22, 2026 @ 6:00 PM          |
  |              709 N 2nd St, Philadelphia       |
  |                                               |
  | Hosts: PizzaDAO, John Doe                     |
  | RSVPs: 42 / 100                               |
  | Budget: $1,200 / $2,000                       |
  |                                               |
  | Checklist: 3/5 complete [=======---] 60%      |
  +----------------------------------------------+

[Event Card 2: "Global Pizza Party NYC"]
  +----------------------------------------------+
  | ...                                           |
  +----------------------------------------------+

[Event Card 3: ...]
```

## Implementation Order
1. DB migrations (`sponsor_users` + `sponsor_checklist_items`)
2. Prisma schema update
3. Backend: `requireSponsorAuth` middleware
4. Backend: sponsor dashboard endpoints + admin management endpoints
5. **Deploy backend to prod**
6. Frontend: Admin page — add Sponsor Users section
7. Frontend: types + API functions
8. Frontend: dashboard components
9. Frontend: SponsorDashboardPage assembly + route

## Key Considerations
- **Backend must deploy before frontend preview works**
- **Tag matching**: Query events where `eventTags` array contains the sponsor's tag. Use Prisma's `has` filter: `where: { eventTags: { has: tag } }`
- **Budget visibility**: Show if `budgetEnabled` is true. Can add per-event opt-out later.
- **Checklist seeding**: Default items created per event on first dashboard load
- **Navigation**: Add "Sponsor Dashboard" link in header/menu when user has sponsor role (same pattern as Underboss Dashboard link)
