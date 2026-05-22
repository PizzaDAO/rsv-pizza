# focaccia-58293 — `/map/all` public no-clustering variant

## Summary
Public no-clustering variant of `/map` at `/map/all`. Every event renders as an individual Benny pin at every zoom level — no grouped red bubble clusters.

## Files touched
- `frontend/src/pages/EventsMapAllPage.tsx` (NEW) — stripped-down copy of `EventsMapPage` public branch. Calls `fetchGppEventsForMap()` with default args (curated public payload — excludes `rejected`/`hidden`) and renders `<GPPEventsMap ... cluster={false} />`. No moderator UI, no filters, no login gate, no city-chat Telegram fallback.
- `frontend/src/App.tsx` — adds `React.lazy` import for `EventsMapAllPage` and registers `<Route path="/map/all">` immediately after `/map/swc` (so it resolves before the catch-all `/:slug`).

## Out of scope
- `GPPEventsMap.tsx` — the `cluster` prop already exists (default `true`).
- Backend / Prisma / API — the curated public payload is exactly what we need.
- Discoverability — no link added from `/map` or `/gpp`; that's a separate decision.
