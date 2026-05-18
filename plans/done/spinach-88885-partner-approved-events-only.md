# spinach-88885: Partner dashboard — filter to approved events only

**Priority**: P1
**Stage**: Doing

## Problem
The `/partner` dashboard currently shows partner users every event tagged with their sponsor tag — including events whose `underbossStatus` is still `'pending'` or `'rejected'`. Partners should only see events that have been **approved** by an underboss. Pending/rejected events are still being vetted (or have been turned down) and shouldn't be surfaced to partners.

Admins viewing `/partner` should continue to see everything (they need pending/rejected visibility for debugging and tagging).

## Field semantics
`parties.underboss_status` (Prisma: `underbossStatus`) is a string with values `pending` | `approved` | `rejected`, default `pending`. "Approved" means `underbossStatus === 'approved'`. Confirmed by:
- `backend/prisma/schema.prisma:172` — column definition
- `backend/src/routes/gpp.routes.ts:584` — same semantic check elsewhere

## Files to modify
- `backend/src/routes/sponsor-user.routes.ts` — the `GET /api/sponsor/events` handler (mounted as `/api/sponsor/events`), starting line 520

## Change
In the `where` clause that's built around lines 530–539, add a filter on `underbossStatus` **only when the request is not an admin view**:

```ts
const where: any = {};
if (tag && tag !== 'pizzadao') {
  where.eventTags = { has: tag };
} else if (tag === 'pizzadao') {
  where.eventType = 'gpp';
} else if (req.isAdminViewing) {
  where.NOT = { eventTags: { equals: [] } };
}

// NEW: non-admin partners only see approved events
if (!req.isAdminViewing) {
  where.underbossStatus = 'approved';
}
```

This must be applied AFTER the tag/admin branching, since the filter is independent of the tag selection.

## Why backend-only (no frontend change)
The frontend `PartnerDashboardPage` simply renders whatever the backend returns. Filtering at the source means:
- CSV download (`buildEventsCsv`) automatically excludes non-approved events
- Stats tiles (RSVPs, impressions, clicks) automatically exclude non-approved
- Region filter, search, sort — all operate on the already-filtered set
- No need to touch the React component

## Verification
1. **As a non-admin partner**: Visit `/partner` after deploy. Only events with `underbossStatus === 'approved'` should appear. Pending or rejected tagged events should be hidden.
2. **As an admin**: Visit `/partner` with no tag selected, or with a specific tag — all events (regardless of status) should still appear, matching current behavior.
3. **Stats**: Event count and aggregate RSVPs should reflect only approved events for partners.
4. **CSV download**: Should contain only approved events for partner users.

## DB / migration
None. `underbossStatus` already exists.

## Notes for implementer
- This is a **backend-only** change. Don't modify the frontend.
- The change is in **one place**, in the `where: any = {}` block. Do not modify the rest of the handler.
- Backend deploys from master, so this won't show up on the Vercel frontend preview until merged + backend redeployed. The preview frontend will keep hitting the prod backend's old behavior until backend is shipped.
