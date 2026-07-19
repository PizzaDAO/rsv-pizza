# provolone-58291 — Underboss hides cancelled events

## Problem

The deployed `/api/sponsor/events` (partner endpoint) filters out cancelled events via `where.cancelledAt = null` (porchetta-81402). The `/api/underboss/:region` endpoints do NOT — they include cancelled events in event lists, region stats, RSVP/approved totals, and city rollups. Per porchetta-81402's commit message:

> GPP + sponsor-user list endpoints filter out cancelled events; underboss + admin endpoints keep them visible (badged) so an underboss can spot churn in their region.

Snax has decided to reverse that "keep visible (badged)" choice for the underboss dashboard: hide cancelled events outright, no toggle, no filter chip. The cancel/uncancel escape hatch already lives on the event-detail page.

## Implementation

Edit `backend/src/routes/underboss.routes.ts`, add `cancelledAt: null` to three handler whereClauses:

1. `GET /:region` — after the `let whereClause = ...` if/else block, add `whereClause = { ...whereClause, cancelledAt: null };`
2. `GET /:region/events` — add `cancelledAt: null` to BOTH the `prisma.party.findMany` where AND the `prisma.party.count` where
3. `GET /:region/stats` — add `cancelledAt: null` to the `prisma.party.findMany` where

## Deliberately NOT touched

- `GET /:region/events/:partyId` (single event by ID) — admins still need to open cancelled events to uncancel them. Detail page is the home of the uncancel UI.
- All `bulk-*` endpoints — operate on explicit IDs from admin
- Co-host sync queries (`/admin/create`, `/admin/:id`, `backfill-cohosts`) — should still keep bookkeeping current for cancelled events in case of reinstatement

## Frontend

Zero changes. Backend filter propagates through `events` props to `EventTable`, `CitiesTable`, `RegionStats` automatically.

## No migration, no new tests
