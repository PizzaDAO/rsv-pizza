# cacciatore-72814 — Super-admin /map/swc with composite Benny+shield pin

**Priority**: P3 (admin-only tooling)

## Feature

Add a new super-admin-only route `/map/swc` — a variant of the existing `/map`
(`EventsMapPage`) that shows only SWC-flagged GPP events and renders each pin
as a composite SVG: Molto Benny on the left + a small ground-mounted display
stand showing the purple SWC crypto-shield on his right.

## Why it's safe

- New route, new page, new SVG asset — no behavior change for the public `/map`.
- Backend endpoint adds an optional `?swcOnly=true` query param to
  `GET /api/gpp/events`; existing callers unaffected.
- Existing `GPPEventsMap` component gains optional icon props with defaults
  that preserve current `/map` Benny pin behavior.
- No DB migration. No new columns. `eventTags` is already in the GPP
  events select + response.

## Gating

`/map/swc` is **super-admin only** (`me.isAdmin === true`). Underbosses do
NOT get access. Logged-out and non-admin users see a "Super admin access
required" gate card; logged-out users get a Sign in CTA that opens the
existing `LoginModal`.

## SWC filter spec

An event is "SWC-flagged" when its `eventTags` array contains at least one
tag that:

- includes the substring `"swc"`, AND
- is NOT exactly the bare string `"swc"`.

So `swc-2026`, `swc-bali`, `swc-attendees` all match; `swc` alone does not.
The filter is applied server-side as a JS post-filter on the existing
`findMany` result (Prisma doesn't have a clean way to match
"array contains substring"). Capped at the existing 500-result limit.

## Files to create

- `frontend/public/swcshield.svg` — the standalone 32x32 purple SWC shield.
- `frontend/public/molto-benny-swc.svg` — composite (viewBox 1000x700):
  Molto Benny on the left, a vertical pole + pedestal on the right with the
  SWC shield mounted on top at ~6.25x scale.
- `frontend/src/pages/EventsMapSwcPage.tsx` — admin-gated variant of
  `EventsMapPage` with the SWC fetch and the composite pin.
- `plans/cacciatore-72814.md` — this file.

## Files to modify

- `frontend/src/components/GPPEventsMap.tsx` — add optional `iconUrl`,
  `iconWidth`, `iconHeight`, `iconAnchorX`, `iconAnchorY` props with defaults
  matching the current Benny pin.
- `frontend/src/lib/api.ts` — extend `fetchGppEventsForMap` signature with
  an optional 4th `swcOnly` param; appends `swcOnly=true` to the URL.
- `frontend/src/App.tsx` — lazy import `EventsMapSwcPage`, register
  `/map/swc` route (immediately after `/map`, before the catch-all `/:slug`).
- `backend/src/routes/gpp.routes.ts` — `GET /api/gpp/events` handler accepts
  `?swcOnly=true` and applies the JS post-filter described above; recomputes
  `total` as the post-filter length when `swcOnly=true`.

## Out of scope

- Tag editing UI — uses existing `eventTags` data; assumes someone has
  already tagged the relevant events with `swc-*`.
- Moderation actions inside the SWC map InfoWindow (Approve/Reject) — page
  passes `canModerate` so the existing super-admin actions still surface,
  but no new SWC-specific moderation flow.
- i18n — admin-only English-only page.
- Public `/map` behavior — completely unchanged.

## Branch

`cacciatore-72814-swc-map`
