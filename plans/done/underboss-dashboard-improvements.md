# Underboss Dashboard Improvements

## Overview
7 improvements to the /underboss dashboard: host status, party approval, host tags, search bar fix, relative time, thumbs up/down filters, updated progress checkmarks.

## Database Changes (3 new columns on `parties`)

```sql
ALTER TABLE parties ADD COLUMN host_status text;
ALTER TABLE parties ADD COLUMN underboss_approved boolean DEFAULT false;
ALTER TABLE parties ADD COLUMN host_tags jsonb DEFAULT '[]'::jsonb;
```

Prisma schema additions:
```prisma
hostStatus        String?  @map("host_status")
underbossApproved Boolean  @default(false) @map("underboss_approved")
hostTags          Json     @default("[]") @map("host_tags")
```

---

## Improvement 1: Host Status Selector (new / alum / pro)

**Backend** (`underboss.routes.ts`):
- Add `hostStatus` to `formatEvent()` return
- New endpoint: `PATCH /api/underboss/event/:partyId/host-status` with body `{ hostStatus: "new"|"alum"|"pro"|null }`

**Frontend** (`EventRow.tsx`):
- Small dropdown or badge-style selector in the Host cell
- Color-coded: green=pro, blue=alum, yellow=new
- Optimistic update

---

## Improvement 2: Party Approval

**Backend** (`underboss.routes.ts`):
- Add `underbossApproved` to `formatEvent()` return
- New endpoint: `PATCH /api/underboss/event/:partyId/approve` with body `{ approved: boolean }`

**Frontend** (`EventRow.tsx`):
- Checkbox/toggle in the event row (green check when approved, gray when not)
- Controls whether event appears on public browsing site
- Optimistic update

---

## Improvement 3: Host Tags (swc, custom)

**Backend** (`underboss.routes.ts`):
- Add `hostTags` to `formatEvent()` return
- New endpoint: `PATCH /api/underboss/event/:partyId/tags` with body `{ tags: string[] }`

**Frontend** (`EventRow.tsx`):
- Small colored pills in Host cell
- "+" button opens inline tag editor with preset tags ("swc") + custom text input
- Click existing tags to remove

---

## Improvement 4: Fix Search Bar

**File**: `EventTable.tsx` lines 119-127

Replace raw `<input>` with `IconInput` component. Keep `bg-theme-surface` color.

---

## Improvement 5: Change Date to Relative Time

**File**: `EventRow.tsx`

Replace `formatDate()` with `formatRelativeTime()` showing "in 3 days", "2 weeks ago", "Tomorrow" etc. Add hover tooltip with actual date. Color: red for past, green for upcoming within a week.

Change column header from "Date" to "Time".

---

## Improvement 6: Thumbs Up/Down Filters

**File**: `EventTable.tsx`

Replace simple checkbox toggles with three-state thumbs pattern (from RSVPModal topping selector):
- **Neutral**: don't filter
- **ThumbsUp** (green #39d98a): must HAVE this
- **ThumbsDown** (red #ff393a): must NOT have this

State: `progressIncludes: string[]` + `progressExcludes: string[]`

---

## Improvement 7: Update Progress Checkmarks

**Backend** (`underboss.routes.ts` - `computeProgress()`):

Expand from 5 items to 9, matching GPP host dashboard:

| # | Item | Check |
|---|------|-------|
| 1 | Created Event | always true |
| 2 | Party Kit | `!!party.partyKit` |
| 3 | Team (Co-Hosts) | `coHosts.length > 0` |
| 4 | Venue | `!!(venueName \|\| address)` |
| 5 | Budget | `!!(budgetEnabled && budgetTotal)` |
| 6 | Partners (Sponsors) | `sponsors.length > 0` |
| 7 | Prepared | false (manual step) |
| 8 | Social Posts | `!!(xPostUrl \|\| farcasterPostUrl)` |
| 9 | Thrown | event passed + has check-ins |

**Frontend types** (`UnderbossEventProgress`): Add `hasCreatedEvent`, `hasCoHosts`, `hasSponsors`, `hasPrepared`, `hasSocialPosts`, `hasThrown`

**Frontend UI** (`EventRow.tsx`): Show 9 ProgressIndicator items instead of 5

**Filter keys** (`EventTable.tsx`): Update to new progress keys (skip "Event" always-true and "Prep" always-false)

---

## Implementation Order

1. DB migrations (must hit production first — preview deploys share the same DB)
2. Backend API changes (new endpoints + updated computeProgress/formatEvent)
3. Deploy backend: `cd backend && vercel --prod --scope pizza-dao`
4. Frontend types + API functions
5. Improvement 4 (IconInput search) — frontend-only
6. Improvement 5 (relative time) — frontend-only
7. Improvement 6 (thumbs filters) — frontend-only
8. Improvement 7 (expanded progress)
9. Improvements 1-3 (host status, approval, tags — depend on new DB columns + endpoints)

## Files to Modify
- `backend/prisma/schema.prisma` — 3 new Party fields
- `backend/src/routes/underboss.routes.ts` — 3 new PATCH endpoints, updated computeProgress/formatEvent
- `frontend/src/types.ts` — UnderbossEvent, UnderbossEventProgress updates
- `frontend/src/lib/api.ts` — 3 new API functions
- `frontend/src/components/underboss/EventTable.tsx` — IconInput search, thumbs filters, updated filter keys
- `frontend/src/components/underboss/EventRow.tsx` — host status, approval, tags, relative time, 9-item progress
- `frontend/src/components/underboss/ProgressIndicator.tsx` — may need minor updates
- `frontend/src/pages/UnderbossDashboard.tsx` — updated stats computation
