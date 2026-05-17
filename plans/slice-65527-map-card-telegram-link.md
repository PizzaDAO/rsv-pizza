# slice-65527 — /map event card: Telegram chat link

## Problem
On `/map` (`EventsMapPage` → `GPPEventsMap`), clicking a marker opens an InfoWindow that shows the event name, date, venue, address, a "View Event →" link and an RSVPs pill. There's no way to jump to the event's Telegram chat from the card. The `/partner` dashboard already renders a Telegram chip on each event card using the same source-of-truth logic — the map should do the same.

## Scope
Add a "Telegram" link to the InfoWindow alongside "View Event →" whenever a Telegram URL is resolvable for the event. Source priority (matches `/partner`):

1. `event.telegramGroup` (per-event override, column `parties.telegram_group`)
2. Fallback: city chat URL from the master Google sheet, looked up by stripping `"Global Pizza Party "` from `event.name` and lowercasing — same `resolveCityChat` logic used in `PartnerDashboardPage.tsx:163`.

If neither resolves, render nothing — no placeholder, no broken link.

## Files to change

### 1. Backend — expose `telegramGroup` on `/api/gpp/events`
`backend/src/routes/gpp.routes.ts`

- In `gppEventSelect` (line 525), add one line:
  ```ts
  telegramGroup: true,
  ```
- In `formatGppEvent` (line 554), include in the returned object:
  ```ts
  telegramGroup: event.telegramGroup || null,
  ```

The endpoint is already public (`requireAuth: false` on the client) and cached `public, max-age=300`. `telegram_group` is not a sensitive field — `/partner` already exposes it via `sponsor-user.routes.ts:766` and the underboss route at `underboss.routes.ts:243`.

### 2. Frontend API types — add `telegramGroup` to map response
`frontend/src/lib/api.ts`

- In `GPPEventApiResponse` (line 3269) add:
  ```ts
  telegramGroup: string | null;
  ```
- In `GPPEventMapItem` (line 3255) add:
  ```ts
  telegramGroup: string | null;
  ```
- In `fetchGppEventsForMap` (line 3291) map it:
  ```ts
  telegramGroup: e.telegramGroup ?? null,
  ```

### 3. Frontend page — fetch city chats and pass to map
`frontend/src/pages/EventsMapPage.tsx`

- Import:
  ```ts
  import { fetchSheetCities } from '../lib/cities';
  ```
- Add state alongside `events`:
  ```ts
  const [cityChats, setCityChats] = useState<Map<string, string>>(new Map());
  ```
- Fetch once on mount (independent of auth — the sheet is public):
  ```ts
  useEffect(() => {
    fetchSheetCities()
      .then((cities) => {
        const map = new Map<string, string>();
        for (const c of cities) {
          if (c.chatUrl) map.set(c.city.toLowerCase().trim(), c.chatUrl);
        }
        setCityChats(map);
      })
      .catch(() => { /* silent — Telegram links just won't show */ });
  }, []);
  ```
- Pass to the map:
  ```tsx
  <GPPEventsMap events={events} cityChats={cityChats} height="calc(100vh - 64px)" />
  ```

### 4. Frontend map component — render link in InfoWindow
`frontend/src/components/GPPEventsMap.tsx`

- Extend props:
  ```ts
  interface GPPEventsMapProps {
    events: GPPEventMapItem[];
    cityChats?: Map<string, string>;
    height?: string;
  }
  ```
- Destructure with a default empty map (so the component still works without the prop):
  ```ts
  cityChats = new Map(),
  ```
- Add `cityChats` to the `useEffect` deps array (line 249) so a late-arriving sheet fetch re-renders markers/InfoWindow content.
- In `buildInfoContent` (line 108), before the existing `linkHtml`:
  ```ts
  const cityKey = event.name.replace(/^Global Pizza Party\s*/i, '').trim().toLowerCase();
  const telegramUrl = event.telegramGroup || cityChats.get(cityKey) || null;
  const telegramHtml = telegramUrl
    ? `<a href="${telegramUrl}" target="_blank" rel="noopener noreferrer" style="color:#29B6F6;font-size:12px;text-decoration:none;font-weight:500">Telegram &rarr;</a>`
    : '';
  ```
- Insert `${telegramHtml}` into the bottom flex row between `${linkHtml}` and `${rsvpHtml}`:
  ```html
  <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
    ${linkHtml}
    ${telegramHtml}
    ${rsvpHtml}
  </div>
  ```

Color `#29B6F6` matches the Telegram chip on the `/partner` card (`PartnerDashboardPage.tsx:966`).

⚠️ The `telegramUrl` value is interpolated raw into an `href`. Since it comes from either the DB (`telegram_group`, set by hosts via `EventDetailsTab`) or the sheet — both controlled inputs — XSS risk is low, but quote-escape defensively:
```ts
const safeHref = telegramUrl.replace(/"/g, '&quot;');
```

## Verification
- Open `/map` as an underboss.
- Markers in cities that have a sheet chat URL (NYC, Berlin, Tokyo, etc.) should now show a "Telegram →" link in their InfoWindows.
- Markers for events that have a custom `telegram_group` set on the party row should show **that** link, overriding the city default.
- Markers for events with no `telegram_group` and no matching city in the sheet should still render without any Telegram link (no broken `href="null"`, no stray separator).
- Clicking the link opens Telegram in a new tab.
- Check that the underboss-only access gate still works (logged-out user → sign-in prompt, no events fetched).

## Out of scope
- Adding/editing `telegram_group` from the map UI (host already does this in `EventDetailsTab`).
- Telegram-link CSV column changes (already present on `/partner` export).
- Marker icon changes or any visual redesign of the InfoWindow beyond inserting the new link.
- Caching `cityChats` across sessions — `fetchSheetCities` is fast and the map page is rarely loaded.

## Notes / gotchas
- **Backend deploy required after merge.** The frontend changes will fail silently on previews (no `telegramGroup` in API response → no link rendered, no fallback to sheet either because sheet lookup also requires the field path to exist). Backend deploys from `master` only via `rsvpizza-master-deploy` worktree (`cd backend && vercel --prod --scope pizza-dao`). Order: merge → deploy backend → verify on prod.
- **Not one of the "7-place" DB-field adds.** No DB migration, no column grant, no Prisma schema change, no `safeColumns` update, no `dbPartyToParty` change, no `updateParty`/`updatePartyApi` field-list change. `telegram_group` already exists on `parties` and is read/written elsewhere. We are only extending the GPP map's response shape and adding a UI element.
- The `/api/gpp/events` response is cached `public, max-age=300`. After the backend ships, expect up to 5 min of stale responses on the CDN.
- `fetchSheetCities` is a public Google Sheets gviz call — no auth needed, but it does cross-origin from the browser. Already proven on `/partner`.
