# Underboss Dashboard

## Overview

Regional supervisor dashboard for GPP underbosses — read-only overview of all GPP events in their assigned region. Shows event progress (venue, budget, party kit, checklist completion), host contact info, RSVP counts, and aggregate stats.

**Regions**: LATAM, Europe, India, USA + Canada, Africa, APAC

## Authentication

**Token-based access via secret link** (no full user account required).

- URL: `/underboss/{region}?token={secret}`
- Backend verifies token against `underbosses` table
- Tokens can be rotated/revoked by super admin
- Read-only dashboard, lower security requirements

## Database

### 1. New column on `parties` table: `region`

```sql
ALTER TABLE parties ADD COLUMN region TEXT;
CREATE INDEX idx_parties_region ON parties(region);
```

Values: `'latam'`, `'europe'`, `'india'`, `'usa-canada'`, `'africa'`, `'apac'`, or `NULL`.

**6-step field checklist applies** (parties table change).

### 2. New table: `underbosses`

```sql
CREATE TABLE underbosses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  region TEXT NOT NULL,
  access_token TEXT NOT NULL UNIQUE,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX idx_underbosses_token ON underbosses(access_token);
CREATE INDEX idx_underbosses_region ON underbosses(region);
```

### 3. Prisma schema

```prisma
model Underboss {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  email       String
  region      String
  accessToken String   @unique @map("access_token")
  isActive    Boolean  @default(true) @map("is_active")
  notes       String?
  createdAt   DateTime @default(now()) @map("created_at") @db.Timestamptz
  updatedAt   DateTime @updatedAt @map("updated_at") @db.Timestamptz

  @@index([region])
  @@map("underbosses")
}
```

Also add `region String? @map("region")` to Party model.

## Backend Routes (`backend/src/routes/underboss.routes.ts`)

### Token validation middleware

```typescript
async function requireUnderbossToken(req, res, next) {
  const token = req.query.token || req.headers['x-underboss-token'];
  if (!token) throw new AppError('Access token required', 401);
  const underboss = await prisma.underboss.findUnique({ where: { accessToken: token } });
  if (!underboss || !underboss.isActive) throw new AppError('Invalid token', 403);
  req.underboss = underboss;
  next();
}
```

### Dashboard routes

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/underboss/:region` | Main dashboard data (events + stats) |
| GET | `/api/underboss/:region/events` | Paginated event list |
| GET | `/api/underboss/:region/events/:partyId` | Single event detail |
| GET | `/api/underboss/:region/stats` | Aggregate stats |

### Admin routes (behind `requireAuth` + super admin check)

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/underboss/admin/create` | Create underboss + generate token |
| GET | `/api/underboss/admin/list` | List all underbosses |
| PATCH | `/api/underboss/admin/:id` | Update underboss |
| POST | `/api/underboss/admin/:id/rotate-token` | Rotate access token |
| DELETE | `/api/underboss/admin/:id` | Deactivate underboss |
| PATCH | `/api/underboss/admin/assign-region/:partyId` | Set region on a GPP event |

### GET `/api/underboss/:region` response shape

```typescript
{
  region: string,
  underboss: { name: string, email: string },
  stats: {
    totalEvents: number,
    totalRsvps: number,
    totalApproved: number,
    eventsWithVenue: number,
    eventsWithBudget: number,
    eventsWithKit: number,
    completionRate: { venue: number, budget: number, partyKit: number },
    avgRsvpsPerEvent: number,
  },
  events: [{
    id: string,
    name: string,
    customUrl: string | null,
    date: string | null,
    address: string | null,
    venueName: string | null,
    host: { name: string, email: string },
    coHosts: [],
    progress: {
      hasVenue: boolean,
      hasBudget: boolean,
      hasPartyKit: boolean,
      hasEventImage: boolean,
      hasDate: boolean,
      hasAddress: boolean,
    },
    guestCount: number,
    approvedCount: number,
    checkedInCount: number,
    photoCount: number,
    kitStatus: string | null,
    fundraisingGoal: number | null,
    totalSponsored: number,
    createdAt: string,
  }]
}
```

## Frontend Types (`frontend/src/types.ts`)

```typescript
export type GPPRegion = 'latam' | 'europe' | 'india' | 'usa-canada' | 'africa' | 'apac';

export const GPP_REGIONS: { id: GPPRegion; label: string }[] = [
  { id: 'latam', label: 'LATAM' },
  { id: 'europe', label: 'Europe' },
  { id: 'india', label: 'India' },
  { id: 'usa-canada', label: 'USA + Canada' },
  { id: 'africa', label: 'Africa' },
  { id: 'apac', label: 'APAC' },
];

export interface UnderbossEventProgress {
  hasVenue: boolean;
  hasBudget: boolean;
  hasPartyKit: boolean;
  hasEventImage: boolean;
  hasDate: boolean;
  hasAddress: boolean;
}

export interface UnderbossEvent { ... }
export interface UnderbossStats { ... }
export interface UnderbossDashboardData { ... }
```

## Frontend Components

| File | Purpose |
|------|---------|
| `pages/UnderbossDashboard.tsx` | Main page, loads data, renders layout |
| `components/underboss/RegionStats.tsx` | Stats cards (total events, RSVPs, completion rates) |
| `components/underboss/EventTable.tsx` | Table of events with progress indicators |
| `components/underboss/EventRow.tsx` | Individual event row with progress dots |
| `components/underboss/ProgressIndicator.tsx` | Colored circle (green/yellow/red) |
| `components/underboss/index.ts` | Barrel export |

Route: `/underboss/:region` added to `App.tsx`

## Region Assignment

**Option A (Recommended)**: Manual assignment by super admin after event creation. Region defaults to `null` on GPP creation. Admin tool or direct endpoint assigns regions.

**Option B (Future)**: Auto-assignment via city name heuristic lookup table.

## Files to Create

- `backend/src/routes/underboss.routes.ts`
- `frontend/src/pages/UnderbossDashboard.tsx`
- `frontend/src/components/underboss/RegionStats.tsx`
- `frontend/src/components/underboss/EventTable.tsx`
- `frontend/src/components/underboss/EventRow.tsx`
- `frontend/src/components/underboss/ProgressIndicator.tsx`
- `frontend/src/components/underboss/index.ts`

## Files to Modify

- `backend/prisma/schema.prisma` — Add Underboss model + region on Party
- `backend/src/index.ts` — Register underboss routes
- `backend/src/routes/party.routes.ts` — Add region to PATCH handler
- `frontend/src/types.ts` — Add underboss types
- `frontend/src/lib/api.ts` — Add underboss API functions
- `frontend/src/lib/supabase.ts` — Update DbParty, SAFE_PARTY_COLUMNS, updateParty for region
- `frontend/src/contexts/PizzaContext.tsx` — Add region to dbPartyToParty
- `frontend/src/App.tsx` — Add /underboss/:region route

## Implementation Order

1. DB migration: Add `region` to `parties` table
2. DB migration: Create `underbosses` table
3. Prisma schema: Add region to Party, add Underboss model, generate
4. 6-step field checklist for `region` on parties
5. Backend routes: Create `underboss.routes.ts` with token auth + data endpoints
6. Register routes in `backend/src/index.ts`
7. Deploy backend
8. Frontend types + API functions
9. Frontend page + components
10. Frontend routing
11. Seed initial underboss records
12. Assign regions to existing GPP events
