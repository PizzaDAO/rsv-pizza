# pepperoni-33539: Add "Show all events" toggle to /map with status color-coding

**Priority:** P2
**Branch:** `pepperoni-33539-map-all-events`

## Feature

The existing `/map` page (`frontend/src/pages/EventsMapPage.tsx`) is underboss-gated and currently shows only events whose `underbossStatus` is NOT `rejected` or `hidden`. Snax wants:

1. A **"Show all events"** toggle button on `/map` that, when on, displays every GPP event regardless of status (including `rejected`, `hidden`, `pending`).
2. **Markers color-coded by status** using semantic colors:
   - `approved` → green `#22c55e`
   - `listed` → blue `#3b82f6`
   - `pending` (null or "pending") → yellow `#eab308`
   - `rejected` → red `#ef4444`
   - `hidden` → gray `#6b7280`
3. A **legend** so the colors are interpretable.

Since the page is already underboss-gated and the existing backend `/api/gpp/events` endpoint is unauthenticated, the backend needs an auth-gated query param to safely return rejected/hidden events.

## Status values (confirmed)

From `backend/src/routes/gpp.routes.ts` and `frontend/src/components/underboss/EventCard.tsx`:
`approved`, `listed`, `rejected`, `hidden`, `pending` (often stored as `null`).

## Changes

### 1. Backend — `backend/src/routes/gpp.routes.ts`

The `GET /api/gpp/events` handler at ~line 632 currently hardcodes:
```ts
const where: any = { eventType: 'gpp', underbossStatus: { notIn: ['rejected', 'hidden'] } };
```

Add an optional `?statuses=all` query param. When present **AND** the request is made by an authenticated underboss/admin user, skip the `notIn` filter so all events come back:

```ts
const { limit = '500', offset = '0', city, country, region, statuses } = req.query;

let includeAllStatuses = false;
if (statuses === 'all') {
  // Check auth — only underboss/admin can see rejected/hidden
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.slice(7);
    try {
      const supabaseUser = await verifySupabaseToken(token); // existing helper, see other routes
      const me = await prisma.user.findUnique({
        where: { id: supabaseUser.id },
        select: { isAdmin: true, isUnderboss: true },
      });
      if (me?.isAdmin || me?.isUnderboss) {
        includeAllStatuses = true;
      }
    } catch {
      // Bad token — silently fall back to filtered view; don't 401
    }
  }
}

const where: any = { eventType: 'gpp' };
if (!includeAllStatuses) {
  where.underbossStatus = { notIn: ['rejected', 'hidden'] };
}
// ... rest of city/country/region filters unchanged
```

**Check** how other routes in this file (or in `underboss.routes.ts`) verify the Supabase auth token to confirm the exact helper name and import path. Mirror that pattern. If `gpp.routes.ts` doesn't already import auth helpers, look in `backend/src/middleware/` for `requireUnderboss`/`requireAuth` middleware and follow the same pattern as a route that uses optional auth — if no such pattern exists, add the verification inline as shown above using whatever Supabase admin client / JWT helper the codebase already uses.

Also ensure `formatGppEvent` (around line 583) includes `underbossStatus` in the response. It already does (`underbossStatus: event.underbossStatus || 'pending'`), so verify it's exposed in the API payload that the frontend consumes.

### 2. Frontend API — `frontend/src/lib/api.ts`

- Add `underbossStatus` field to `GPPEventMapItem` interface (~line 3255):
  ```ts
  export interface GPPEventMapItem {
    // ...existing fields
    underbossStatus: string;  // 'approved' | 'listed' | 'pending' | 'rejected' | 'hidden'
  }
  ```
- Add `underbossStatus` to the `GPPEventApiResponse` interface if not already there.
- Update `fetchGppEventsForMap` (~line 3291) to accept an `includeAllStatuses: boolean` parameter:
  ```ts
  export async function fetchGppEventsForMap(includeAllStatuses = false): Promise<GPPEventMapItem[]> {
    const qs = includeAllStatuses ? '?limit=500&statuses=all' : '?limit=500';
    const data = await apiRequest<GPPEventsApiPayload>(`/api/gpp/events${qs}`, {
      requireAuth: includeAllStatuses, // need auth token to get rejected/hidden
    });
    return (data.events || []).map((e) => ({
      // ...existing mapping
      underbossStatus: e.underbossStatus || 'pending',
    }));
  }
  ```
  Verify `requireAuth: true` causes `apiRequest` to attach the Supabase Bearer token — check how other authed calls (e.g., `fetchUnderbossMe`) use the helper.

### 3. Frontend page — `frontend/src/pages/EventsMapPage.tsx`

- Add `const [showAll, setShowAll] = useState(false);` state.
- Change `loadEvents` to accept the flag and pass it through:
  ```ts
  const loadEvents = (includeAll: boolean) => {
    setLoading(true);
    setError(null);
    fetchGppEventsForMap(includeAll)
      .then(setEvents)
      .catch((err) => setError(err.message || 'Failed to load events'))
      .finally(() => setLoading(false));
  };
  ```
- Call `loadEvents(showAll)` initially and whenever `showAll` flips. Use a separate `useEffect` keyed on `[showAll, authorized]` so toggling re-fetches.
- Add a toggle button next to the floating stats badge (top of the map area):
  ```tsx
  <button
    onClick={() => setShowAll((v) => !v)}
    className="bg-white/90 backdrop-blur-sm rounded-full px-4 py-2 shadow-lg border border-white/50 text-sm font-semibold text-gray-800 hover:bg-white transition"
  >
    {showAll ? 'Show approved only' : 'Show all events'}
  </button>
  ```
  Position it near the existing stats badge (top center) — small, non-intrusive. Stats badge should update to reflect filtered count.
- When `showAll === true`, render a **legend** in the bottom-left corner with a small dot + label for each of the 5 statuses.

### 4. Frontend map — `frontend/src/components/GPPEventsMap.tsx`

Replace the static Benny pizza icon with a per-marker colored circle SVG keyed on `underbossStatus`:

```ts
const STATUS_COLORS: Record<string, string> = {
  approved: '#22c55e',
  listed:   '#3b82f6',
  pending:  '#eab308',
  rejected: '#ef4444',
  hidden:   '#6b7280',
};

function makeMarkerIcon(status: string): google.maps.Icon {
  const color = STATUS_COLORS[status] || STATUS_COLORS.pending;
  const svg = encodeURIComponent(`
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
      <circle cx="16" cy="16" r="11" fill="${color}" stroke="white" stroke-width="3"/>
    </svg>
  `);
  return {
    url: `data:image/svg+xml;utf8,${svg}`,
    scaledSize: new google.maps.Size(32, 32),
    anchor: new google.maps.Point(16, 16),
  };
}
```

Update the marker creation loop (~line 157) to use `makeMarkerIcon(event.underbossStatus)` instead of the hardcoded `molto-benny-btc.svg`.

Also extend `GPPEventsMapProps` if needed — but since `events` already carries `underbossStatus` once the API change lands, no new prop is required.

Add the status to the InfoWindow `buildInfoContent` (a small badge near the RSVP pill):
```ts
const statusHtml = `<span style="background:${color}20;color:${color};font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:500">${event.underbossStatus}</span>`;
```

**Cluster renderer:** the existing red cluster bubble (#FF0029) is fine for "all events" view too — clustering is about density, not status. Leave it alone.

## Files to modify

- `backend/src/routes/gpp.routes.ts` — auth-gated `?statuses=all`, ensure `underbossStatus` in response
- `frontend/src/lib/api.ts` — add `underbossStatus` to `GPPEventMapItem`, accept `includeAllStatuses` param
- `frontend/src/pages/EventsMapPage.tsx` — toggle button, legend, refetch on toggle
- `frontend/src/components/GPPEventsMap.tsx` — per-marker colored icon, status in InfoWindow

## Verification

1. Local: `cd frontend && npm run typecheck && npm run build`
2. Local: `cd backend && npm run build`
3. Sign in as underboss, visit `/map`:
   - Default view shows ~current count, all markers approved-green or listed-blue
   - Click "Show all events" → marker count jumps, pending/rejected/hidden markers appear in their colors
   - Legend appears showing the 5 colors
   - Toggling back hides the rejected/hidden markers
4. Verify a logged-out (or non-underboss) request to `/api/gpp/events?statuses=all` returns the **filtered** list (param silently ignored without auth — no 401).

## Critical project gotchas

- **Backend deploys from master only.** Preview frontends call the production backend. The backend changes (`?statuses=all`) MUST be deployed to prod before the toggle works on the preview URL. Coordinate with Snax — they'll merge & deploy backend before testing preview, OR Snax can test locally with `npm run dev` on backend.
- Preview frontend without backend deploy → toggle button will appear but only return the filtered list (the param is silently ignored).
- Use **relative paths** for `Write`/`Edit` calls inside the worktree (per memory: absolute paths leak to main repo with `isolation: "worktree"`).
- No DB schema changes — `underbossStatus` already exists on `parties`. No migration needed.

## Out of scope

- No changes to the public `/gpp` landing-page map.
- No changes to which events count as "approved" / which appear publicly — only the underboss map view changes.
- No notifications, no bulk-action UI on the map.
