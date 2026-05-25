# tartufo-49271 — Live RSVP ticker

**Priority:** P2
**Branch:** `tartufo-49271-live-rsvp-ticker`

## Context

`DashboardKPIs` (the wrapper shipped by `quattro-71244`) already renders a single-row flex container with `LeaderboardPill` at the top. The host dashboard's gamified KPI block is the natural spot to surface incoming RSVPs without ever leaving the page.

**Realtime is already mounted at the page level.** `HostPage.tsx` calls `useGuestsRealtime(party?.id, ...)` directly and routes the result into `PizzaContext` via `setGuests` + `setParty`. `GPPDashboardTab` already passes `guests` from context down into `DashboardKPIs`. The ticker does NOT need its own subscription — it only needs to read the `guests` prop already flowing through.

This honours the `architecture_guests_in_realtime_publication` rule: zero new subscriptions, no `PizzaContext` realtime, the existing host-only opt-in mount stays load-bearing.

## Approach

A new presentational component `LiveRSVPTicker` consumes `guests: Guest[]`, derives the last 5 entries (filtered to real-time signal sources), and renders them as an animated stacked list. The ticker animates a row in via a single CSS keyframe when its `id` is new to its visible window. Hover/focus pauses animation by toggling a `data-paused` attribute.

**Critical schema gaps that change the plan:**

1. `Guest` has a single `name` field (not `firstName`/`lastName`). The ticker renders avatar initials from `name.split(' ').map(s => s[0])` (cap at 2).
2. `Guest` has **no** `city`/`country` fields. No location line in v1.
3. `Guest` (app-level type in `types.ts`) does NOT carry `submittedVia`, even though `DbGuest.submitted_via` exists. To honour the filter requirement, we must:
   - add an optional `submittedVia?: string` field to `Guest` in `types.ts`,
   - extend `dbGuestToGuest` in `PizzaContext.tsx` to map `dbGuest.submitted_via` → `Guest.submittedVia`,
   - filter the ticker visible list to `submittedVia` in `['link', 'rsvp', 'api']` (default-accept when undefined so older rows in flight aren't dropped).

`date-fns@^4.1.0` is already a frontend dependency — reuse `formatDistanceToNowStrict` instead of writing a new `useTimeAgo` hook. The component formats locally and re-renders every 30s using a small `useEffect` + `setInterval` to keep the "Xm ago" labels fresh between RSVP events.

The ticker renders nothing at all when `visibleGuests.length === 0` — a collapsed placeholder competes with the existing `LeaderboardPill` skeleton during initial load.

## Files

**New:**
- `frontend/src/components/gpp-dashboard/LiveRSVPTicker.tsx`

**Modified:**
- `frontend/src/types.ts` — add `submittedVia?: string` to `Guest`.
- `frontend/src/contexts/PizzaContext.tsx` — extend `dbGuestToGuest` to include `submittedVia: dbGuest.submitted_via`.
- `frontend/src/components/gpp-dashboard/DashboardKPIs.tsx` — render `<LiveRSVPTicker guests={guests} />` as the FIRST child of the returned `<div className="space-y-4">`.
- `frontend/src/components/gpp-dashboard/index.ts` — export `LiveRSVPTicker`.
- `frontend/src/index.css` — `@keyframes ticker-slide-in` + `.animate-ticker-in`, respect `prefers-reduced-motion`.
- `frontend/src/i18n/locales/{de,en,es,fr,ja,pt,zh}/host.json` — add `dashboard.ticker.{empty,justNow,minutesAgo,hoursAgo,daysAgo,recentRsvps}` (7 files).

## Step-by-step

1. Verify in `HostPage.tsx` that `useGuestsRealtime` is still mounted at the page level (it is, ~line 67).
2. Extend `Guest` in `frontend/src/types.ts` with `submittedVia?: string`.
3. Update `dbGuestToGuest` in `PizzaContext.tsx` to copy `submitted_via` → `submittedVia`.
4. Create `LiveRSVPTicker.tsx`:
   - `visibleGuests` via `useMemo` filtering `g.submittedVia === undefined || ['link','rsvp','api'].includes(g.submittedVia)`, sorted by `submittedAt` desc, sliced to 5.
   - Track previously-seen guest ids in a `useRef<Set<string>>` so newly-arrived rows get `animate-ticker-in`. Apply `animation-delay: index * 60ms` to avoid stuttery cascades.
   - Hover/focus sets `animation-play-state: paused` via CSS.
   - 32px avatar bubble with initials, `name`, `formatDistanceToNowStrict(new Date(submittedAt), { addSuffix: true })`.
   - `setInterval` every 30s to keep relative timestamps fresh.
   - Key rows by `id ?? submittedAt + name` to handle undefined ids on optimistic inserts.
   - Early return `null` when `visibleGuests.length === 0`.
5. Add the keyframes + utility class in `index.css`.
6. Wire `<LiveRSVPTicker guests={guests} />` as the first child of the return in `DashboardKPIs.tsx`.
7. Add i18n keys to all 7 host.json files.

## Risks & gotchas

- **`Guest.submittedVia` is a contract widening.** Grep `: Guest` literal constructors before merging.
- **Realtime ordering:** sort by `submittedAt` desc client-side; trust the snapshot.
- **StrictMode double-mount:** 30s interval cleanup needed.
- **Tab inactive:** browsers throttle `setInterval` to ~1Hz; 30s timer is fine.
- **Filter conservatism:** prompt says `IN ('link','rsvp','api')`. Default-accept undefined so legacy rows still appear.
- **No `avatar_url` on `Guest`:** initials-only.
- **Animation stagger:** `animation-delay: index * 60ms` on bursts.
- **`Guest.id` may be undefined.** Key on fallback to avoid React warnings.
