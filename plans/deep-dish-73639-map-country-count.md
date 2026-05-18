# deep-dish-73639 — Add country count to /map stats badge

**Priority**: P3 (small UX polish)

## Feature

The `/map` page (underboss-only `EventsMapPage`) shows a floating stats badge above the map:

> "{N} events across {M} cities"

Add a unique country count to the badge so it reads:

> "{N} events across {M} cities in {K} countries"

(Pluralization handled the same way as cities: "1 country" / "K countries".)

## Why it's safe

- `country` is already on `GPPEventMapItem` (`frontend/src/lib/api.ts:3266`) — populated by `fetchGppEventsForMap` from the backend `GET /api/gpp/events` payload. No backend or DB change needed.
- Counting is done client-side on already-fetched data — no extra request.
- Page is gated to admin/underboss; risk of regressing public surface is zero.

## Files to modify

Only one file:

- `frontend/src/pages/EventsMapPage.tsx`

## Implementation

1. Just after the existing `cityCount` line (around line 64), add a `countryCount` const derived from `events.map(e => e.country)`, filtering out null/empty strings before passing through `new Set(...).size`.

2. In the floating stats badge (around line 159-162), extend the span to append `" in {countryCount} country/countries"` when `countryCount > 0`.

## Out of scope

- No layout/restyle of the badge — single-line text, same pill shape.
- No backend/API changes — `country` already returned.
- No translation strings — page is admin-only and the badge is English-only today.

## Branch

`deep-dish-73639-map-country-count`
