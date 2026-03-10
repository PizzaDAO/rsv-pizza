# Event Page View Tracking

## Overview

Track views of event pages and display stats in the Report widget. Lightweight fire-and-forget tracking that doesn't slow down page loads.

## Architecture

- **Tracking**: `POST /api/events/:slug/view` — fire-and-forget from EventPage via `fetch` with `keepalive: true`
- **Storage**: New `page_views` table with individual records (enables time-series, unique counts, referrer tracking)
- **Uniqueness**: `SHA-256(IP + User-Agent)` — privacy-friendly, no cookies/fingerprinting
- **Dedup**: Skip recording if same visitor_hash viewed same party within last 30 minutes

## Database

### New table: `page_views`

```sql
CREATE TABLE page_views (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  party_id UUID NOT NULL REFERENCES parties(id) ON DELETE CASCADE,
  visitor_hash TEXT,
  ip_address TEXT,
  user_agent TEXT,
  referrer TEXT,
  country TEXT,
  viewed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_page_views_party_id ON page_views(party_id);
CREATE INDEX idx_page_views_party_viewed ON page_views(party_id, viewed_at);
CREATE INDEX idx_page_views_party_unique ON page_views(party_id, visitor_hash);
```

Enable RLS with deny-all for anon (only service_role writes).

### Prisma model

```prisma
model PageView {
  id          String   @id @default(uuid()) @db.Uuid
  partyId     String   @map("party_id") @db.Uuid
  party       Party    @relation(fields: [partyId], references: [id], onDelete: Cascade)
  visitorHash String?  @map("visitor_hash")
  ipAddress   String?  @map("ip_address")
  userAgent   String?  @map("user_agent")
  referrer    String?
  country     String?
  viewedAt    DateTime @default(now()) @map("viewed_at") @db.Timestamptz

  @@index([partyId])
  @@index([partyId, viewedAt])
  @@index([partyId, visitorHash])
  @@map("page_views")
}
```

Add `pageViews PageView[]` to Party model.

## Backend

### Tracking: `POST /api/events/:slug/view` (public, no auth)

- Find party by inviteCode or customUrl
- Extract IP, User-Agent, Referer from headers
- Compute visitor_hash = SHA-256(IP + User-Agent)
- Deduplicate: skip if same hash viewed within 30 min
- Insert page_view record
- Return 204 (no content) — fastest response
- Never fail the request (catch all errors, return 204 anyway)

### Stats: `GET /api/parties/:partyId/report/views` (host only, requireAuth)

Returns:
```typescript
{
  totalViews: number,
  uniqueViews: number,
  dailyViews: { date: string, total: number, unique: number }[],  // last 30 days
  topReferrers: { referrer: string, count: number }[],  // top 10
}
```

## Frontend

### EventPage.tsx — Fire-and-forget tracking

```typescript
fetch(`${API_URL}/api/events/${slug}/view`, {
  method: 'POST',
  keepalive: true,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ referrer: document.referrer || null }),
}).catch(() => {});
```

### New: `report/PageViewStats.tsx`

- Summary cards: Total Views, Unique Visitors
- Simple CSS bar chart for daily views (last 30 days, no charting library)
- Top referrers list

### Modified: ReportWidget.tsx, ReportKPIs.tsx, ReportPreview.tsx

- Load view stats alongside report data
- Add page views to auto-calculated KPI grid
- Show in public report view

## Files to Create

- `backend/src/routes/pageview.routes.ts` (or add to event.routes.ts)
- `frontend/src/components/report/PageViewStats.tsx`

## Files to Modify

- `backend/prisma/schema.prisma` — PageView model + Party relation
- `backend/src/routes/report.routes.ts` — Stats endpoint
- `backend/src/routes/event.routes.ts` — Tracking endpoint
- `backend/src/index.ts` — Register route (if separate file)
- `frontend/src/pages/EventPage.tsx` — Fire-and-forget tracking
- `frontend/src/lib/api.ts` — getPageViewStats function
- `frontend/src/types.ts` — PageViewStats interface
- `frontend/src/components/report/ReportWidget.tsx` — Load + display stats
- `frontend/src/components/report/ReportKPIs.tsx` — Add to KPI grid
- `frontend/src/components/report/ReportPreview.tsx` — Show in preview

## Implementation Order

1. DB migration: Create `page_views` table + RLS
2. Prisma schema: Add PageView model
3. Backend: Tracking POST endpoint
4. Backend: Stats GET endpoint
5. Deploy backend
6. Frontend: Tracking call in EventPage
7. Frontend: API function + types
8. Frontend: PageViewStats component
9. Frontend: Integrate into ReportWidget + KPIs
