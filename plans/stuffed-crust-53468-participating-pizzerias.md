# stuffed-crust-53468: Participating Pizzerias section on event page

**Priority**: P2
**Type**: Feature

## Summary
Add a new "Participating Pizzerias" section to the public event page (EventPage.tsx)
that surfaces the pizzerias the host selected in the host-side "Pizza & drinks" tab.
The section mirrors the Detroit Global Pizza Day flyer layout: a map on the left
with red pushpin markers at each pizzeria, and a list on the right showing each
pizzeria's full details (name, address, rating, phone, website, distance from
venue). Section sits above the Photo Gallery section in the existing right-column
stack, reusing the same card-separator styling as the surrounding sections.

The data plumbing is already in place end-to-end — `selectedPizzerias` is stored
on the `parties` table as JSON, is already returned by the public
`GET /api/events/:slug` endpoint, and is already exposed on the `PublicEvent`
interface consumed by EventPage. No backend or DB changes are required for the
happy path. The only data gap is that manually-added pizzerias (the "Enter manually"
flow) don't currently capture lat/lng, so they'll fall back to a list-only
rendering with no map pin — see "Map approach" below.

## Visual design

**Desktop (≥768px)**
- Full-width section inside EventPage's right column (~780px wide between the
  400px left column and page padding).
- Two-column grid: `grid md:grid-cols-[1fr,1fr] gap-4` — map left, list right.
- Map: ~320px tall, rounded corners, red pushpin markers labeled with pizzeria
  names (InfoWindow or small custom HTML marker).
- List: each pizzeria rendered as a card (bg-theme-surface, rounded-xl,
  border-theme-stroke). Shows: avatar (red MapPin icon in circle), name, rating
  stars, address, distance from venue, phone, website link. Matches the
  existing `PizzeriaSelection` row treatment closely.

**Mobile (<768px)**
- Stacks vertically: map on top (aspect-video or h-64), list below.
- List cards full-width.

**Section header**
- `border-t border-theme-stroke pt-6 mt-6` wrapper to match surrounding sections.
- Small uppercase label `PARTICIPATING PIZZERIAS` to echo the flyer (using
  existing `text-sm font-semibold text-theme-text-secondary uppercase tracking-wider`
  typography pattern from PizzeriaSelection header).

## Current state

### Data model
- `parties.selected_pizzerias` is a `Json?` column in Prisma:
  `backend/prisma/schema.prisma` line 68 — `selectedPizzerias Json? @map("selected_pizzerias")`
- Stored as an array of `Pizzeria` objects matching the TypeScript interface in
  `frontend/src/types.ts` lines 314–332:
  ```
  interface Pizzeria {
    id, placeId, name, address, phone?, url?, rating?, reviewCount?,
    priceLevel?, isOpen?, distance?, location: { lat, lng },
    photos?, orderingOptions
  }
  ```
- **Not a separate DB table and no join table** — just a JSON blob per party.

### Host-side Pizza & drinks tab
- `frontend/src/pages/HostPage.tsx` line 266: `activeTab === 'pizza'` renders the
  Pizza & drinks tab.
- Line 344: `<PizzaStyleAndToppings firstSection={<PizzeriaSelection embedded />} />`
- `frontend/src/components/PizzeriaSelection.tsx` is the component to study for
  "full details" — specifically the selected-pizzeria row at lines 288–388
  which renders:
  - Red MapPin icon in a rounded circle avatar (line 296–309)
  - Name (line 312)
  - Rating with star (lines 313–318)
  - Distance-from-venue badge (lines 304–308, calculated via
    `calculateDistanceMiles` from `lib/ordering.ts`)
  - Address (line 327)
  - Borda-count voting scores (host-only, NOT shown on public page)
  - Website link + phone link (lines 341–366)
- Up to 3 pizzerias per event (hard cap at line 122, 143, 168).

### Event page data loading
- `frontend/src/pages/EventPage.tsx` line 41: `const [event, setEvent] = useState<PublicEvent | null>(null);`
- Loaded via `getEventBySlug(slug)` from `frontend/src/lib/api.ts` line 368.
- `PublicEvent` interface at `frontend/src/lib/api.ts` line 326–365 already
  includes `selectedPizzerias?: Pizzeria[];` at line 350.
- Backend handler `backend/src/routes/event.routes.ts` already selects
  `selectedPizzerias: true` at line 34 and line 94, and returns it at line 208.
- **Conclusion: pizzerias are already in the public event payload. No backend
  changes needed.**

### Photo Gallery section insertion point
- `frontend/src/pages/EventPage.tsx` lines 1118–1144 render the Photo Gallery
  section (`{photoStats?.photosEnabled && existingGuestData?.status === 'CONFIRMED' && (...)}`).
- The new section goes **immediately above** that block (after the Music Widget
  at line 1116).

### Map tech already in the codebase
- `VITE_GOOGLE_MAPS_API_KEY` env var is already configured (see
  `frontend/src/test/setup.ts` line 6 and many usages).
- **Google Maps JS SDK is dynamically loaded** in several components:
  - `frontend/src/components/GPPMap.tsx` — full interactive map reference (uses
    `new google.maps.Map` + `KmlLayer`, handles script-tag-already-exists race,
    error fallback). **This is our primary pattern to copy.**
  - `frontend/src/components/LocationAutocomplete.tsx` — uses Places Autocomplete
  - `frontend/src/components/PlaceAutocomplete.tsx` — uses Places Autocomplete
  - `frontend/src/components/PizzeriaSearch.tsx` — uses Static Maps API thumbnails
- **Static Maps API** is also used in several places for thumbnails
  (EventPage.tsx line 470, PizzeriaSearch.tsx line 324,
  sponsor-dashboard/EventInfoCard.tsx line 44).
- No Mapbox, Leaflet, or react-google-maps — **Google Maps JS API (raw) is the
  established pattern.**

### Pizzeria lat/lng availability
- Pizzerias from nearby-search or Google Places Autocomplete have real lat/lng
  (via `PlaceAutocomplete.tsx` line 69–70, `searchPizzerias` in `lib/ordering.ts`).
- **Manual-entry pizzerias**: `PizzeriaSelection.tsx` line 166–185 uses
  `LocationAutocomplete` for the address field, but the manual `onPlaceSelected`
  callback at line 632 only captures the address string, NOT the lat/lng. So
  manually-added pizzerias land in the DB with `location: { lat: 0, lng: 0 }`
  (line 177).
- `PizzeriaSelection.tsx` elsewhere already gates distance rendering with
  `pizzeria.location.lat !== 0` (line 304) — we'll use the same guard.

## Data changes needed

**None are strictly required to ship V1.** All of the 6 places listed in the
CLAUDE.md gotcha are already correctly wired for `selectedPizzerias`:

| Layer | Status | Location |
|-------|--------|----------|
| DB migration | ✓ exists | `selected_pizzerias jsonb` already on `parties` |
| Prisma schema | ✓ exists | `schema.prisma` line 68 |
| Backend PATCH handler | ✓ exists | `party.routes.ts` line 389, 468 |
| `updateParty` field list | ✓ exists | `supabase.ts` line 1300, 1347 |
| `dbPartyToParty` mapper | ✓ exists | `PizzaContext.tsx` line 104 |
| `DbParty` interface | ✓ exists | `supabase.ts` line 408 |
| `safeColumns` | ✓ exists | `supabase.ts` line 469 |
| Public event endpoint | ✓ exists | `event.routes.ts` line 34, 94, 208 |
| `PublicEvent` interface | ✓ exists | `api.ts` line 350 |

**Recommended but optional improvement (polish):**
- Fix manual-entry pizzerias to capture lat/lng. In
  `PizzeriaSelection.tsx` `addManualPizzeria()`, geocode the entered address
  via `geocodeAddress(customPizzeriaAddress)` (from `lib/ordering.ts` line 77 —
  already uses Nominatim as a free fallback) before saving. Or switch the
  manual address input to `PlaceAutocomplete`-style capture that gives back
  lat/lng. This ensures manually-added pizzerias also appear on the map.

## Files to create

1. **`frontend/src/components/ParticipatingPizzerias.tsx`** — the new section
   component. Props: `{ pizzerias: Pizzeria[]; venueAddress: string | null; }`.
   - Internally computes venue lat/lng via `geocodeAddress(venueAddress)` for
     the distance badges and as the map's initial center fallback.
   - Renders map (left) + list (right) on desktop, stacked on mobile.
   - Uses `calculateDistanceMiles` + `formatDistanceMiles` from `lib/ordering.ts`
     for per-pizzeria distance labels.

2. **`frontend/src/components/ParticipatingPizzeriasMap.tsx`** — the map
   sub-component. Copies the Google Maps loader pattern from `GPPMap.tsx`
   (lines 22–95). Differences:
   - No KmlLayer.
   - Instantiates `google.maps.Marker` (or `AdvancedMarkerElement` if we want
     to be modern) for each pizzeria with `location.lat !== 0`.
   - Fits bounds to markers via `LatLngBounds` + `map.fitBounds(bounds)`.
   - Attaches a simple `InfoWindow` per marker showing the pizzeria name on
     click — matches the "labeled pins" look of the flyer reference image.
   - Error / no-key fallback: renders a styled placeholder card (matching
     `GPPMap.tsx` lines 97–110 pattern).
   - No-coord fallback: if none of the pizzerias have coords, don't render
     the map at all and let the parent fall back to a list-only layout.

## Files to modify

1. **`frontend/src/pages/EventPage.tsx`**
   - Add `import { ParticipatingPizzerias } from '../components/ParticipatingPizzerias';`
   - Insert `<ParticipatingPizzerias pizzerias={event.selectedPizzerias || []} venueAddress={event.address} />` immediately above the Photo Gallery block at line 1118.
   - Wrap the section with the standard `{event.selectedPizzerias && event.selectedPizzerias.length > 0 && (...)}` conditional.

2. **`frontend/src/components/PizzeriaSelection.tsx`** *(optional polish)*
   - In `addManualPizzeria()` (line 166), geocode `customPizzeriaAddress` via
     `geocodeAddress()` before building the `Pizzeria` object, and use the
     resulting lat/lng instead of `{ lat: 0, lng: 0 }` (line 177).
   - This ensures manual pizzerias also show up as pins on the new public map.
   - Keeping this in the same PR is low-risk — it's additive.

## Step-by-step implementation

1. **Read references**: open `GPPMap.tsx`, `PizzeriaSelection.tsx` (lines
   274–392 for the selected-pizzeria row), `EventPage.tsx` (lines 1115–1144 for
   section styling), and `lib/ordering.ts` (for `geocodeAddress`,
   `calculateDistanceMiles`, `formatDistanceMiles`).

2. **Create `ParticipatingPizzeriasMap.tsx`**:
   - Copy `GPPMap.tsx` lifecycle pattern: `useEffect` that loads Google Maps,
     handles existing script tag, error fallback.
   - `useMemo` to filter `pizzerias` to those with `location.lat !== 0 &&
     location.lng !== 0`.
   - After map init, loop over valid pizzerias and create a `google.maps.Marker`
     with `icon` = default red pin, `title` = pizzeria name, and an
     `InfoWindow` opened on click showing `<strong>{name}</strong><br/>{address}`.
   - Compute `google.maps.LatLngBounds` from all marker positions; call
     `map.fitBounds(bounds)`. If only one marker, center on it with a sensible
     zoom like 14. If venue coords are provided, include venue in bounds too
     (optional: also drop a differently-colored venue pin).
   - Accept height prop, default 320.
   - Return `null` if no valid markers (parent handles this).

3. **Create `ParticipatingPizzerias.tsx`**:
   - Accept `{ pizzerias, venueAddress }` props.
   - `useState` for `venueLocation: {lat,lng}|null`.
   - `useEffect` calling `geocodeAddress(venueAddress)` to populate
     `venueLocation` for distance calculations.
   - Layout: `<div className="border-t border-theme-stroke pt-6 mt-6">` +
     section header `<h3>` with `MapPin` icon + title "Participating Pizzerias".
   - Body: responsive grid `<div className="grid md:grid-cols-2 gap-4">`
     - Left: `<ParticipatingPizzeriasMap pizzerias={pizzerias}
       venueLocation={venueLocation} />` (hidden if no valid coords).
     - Right: `<div className="space-y-3">` with one card per pizzeria.
   - **Pizzeria card** (mirror PizzeriaSelection row at lines 288–388, minus
     Borda score + host-only actions):
     - Red MapPin icon avatar
     - Name (bold), rating stars (if present)
     - Address (truncate on mobile, full on desktop)
     - Distance from venue if `venueLocation && pizzeria.location.lat !== 0`
     - Phone link (tel:) and Website link (target="_blank") row at bottom
     - `trackLinkClick(slug, url, 'pizzeria', pizzeria.name)` on both links —
       use the existing `trackLinkClick` pattern from EventPage (line 1007).
   - Empty-state: if `pizzerias.length === 0`, component renders nothing
     (parent already gates via conditional).

4. **Wire into `EventPage.tsx`**:
   - Add import.
   - Insert the component above the Photo Gallery block at line 1118. Use the
     same wrapper pattern (`border-t border-theme-stroke pt-6 mt-6` already
     inside the component, so no wrapper needed at call site).
   - Guard: `{event.selectedPizzerias && event.selectedPizzerias.length > 0 && ...}`.

5. **(Optional polish)** Fix manual-entry lat/lng in `PizzeriaSelection.tsx`
   `addManualPizzeria()`:
   ```
   const geocoded = customPizzeriaLocation
     || (customPizzeriaAddress ? await geocodeAddress(customPizzeriaAddress) : null)
     || { lat: 0, lng: 0 };
   ```

6. **Test locally**: open an event with pizzerias selected and verify the
   section renders correctly.

7. **Ship as draft PR** per standard workflow, verify on Vercel preview.

## Map approach

**Recommendation: interactive Google Maps JS via raw SDK**, copying the loader
pattern from `GPPMap.tsx`.

**Reasoning:**
- The codebase already loads the Google Maps JS API (Places library) via a
  shared-script-tag-detection pattern in `GPPMap.tsx`, `LocationAutocomplete.tsx`,
  `PlaceAutocomplete.tsx`, and `PizzeriaSearch.tsx`. No new dependency.
- `VITE_GOOGLE_MAPS_API_KEY` is already configured across environments.
- Interactive (pan/zoom, click pins for InfoWindow with name) matches what a
  "list + map" UI should feel like better than a static image.
- Bounds auto-fit handles 1–3 pins gracefully.
- Error fallback identical to `GPPMap.tsx` (link to Google Maps URL).

**Rejected alternatives:**
- Static Maps API image — simpler but can't show labels/InfoWindows well, and
  URL length gets long with multiple markers. Keep as `noscript` fallback only.
- Mapbox / Leaflet — would add a dependency; API key rotation; no precedent.
- react-google-maps — adds a dep when the raw SDK already works elsewhere in
  the repo.

**No-coord fallback:**
- If a pizzeria has `{lat:0, lng:0}` (manual entry that wasn't geocoded), skip
  it in the markers loop but still show it in the list.
- If ALL pizzerias lack coords, don't render the map pane at all — collapse
  the grid to single-column and show list full-width.
- If `VITE_GOOGLE_MAPS_API_KEY` is missing at runtime (unlikely in production
  but possible in previews), the map component renders the styled placeholder
  link-to-Google-Maps fallback from `GPPMap.tsx` lines 97–110.

## Verification steps

**Manual testing on Vercel preview:**
1. Open a published event that has 3 pizzerias selected in the host-side
   Pizza & drinks tab.
2. Verify the "Participating Pizzerias" section appears directly above the
   Photo Gallery section on desktop, and above it in the stacked mobile flow.
3. Verify the map renders on the left with red pins at each pizzeria.
4. Click a pin and confirm the InfoWindow shows the pizzeria name + address.
5. Verify distance badges on list cards show miles from the venue (if the
   event has an address set).
6. Verify phone `tel:` links and website `target="_blank"` links work and
   emit `trackLinkClick` calls (check network tab for `/api/linkclick` POSTs).
7. Shrink viewport to mobile; confirm map stacks on top, list below, both
   full-width.

**Edge cases:**
- Event with 0 pizzerias: section should not render at all.
- Event with 1 pizzeria: map should zoom to a sensible level (14 or so),
  single marker visible; list shows 1 card.
- Event with a manually-entered pizzeria (lat/lng = 0): pizzeria appears in
  list but NOT on the map. If it's the only pizzeria, the map pane is hidden.
- Event with no venue address: distance badges are hidden (guard already
  exists in PizzeriaSelection code at line 304 — reuse that pattern).
- `VITE_GOOGLE_MAPS_API_KEY` missing: map falls back to link-out placeholder;
  list still renders.
- Pizzeria with no rating / no phone / no URL: corresponding sub-element hidden.

## Open questions

1. **Section name**: "Participating Pizzerias" or "Pizzerias" or
   "Participating Pizzerias" with flyer-style "Detroit" prefix injected from
   city? Recommend plain "Participating Pizzerias" to keep it universal.

2. **Venue pin**: Should the map also show a differently-colored pin for the
   event venue so guests see the spatial relationship? Recommend YES.

3. **Gate on RSVP status?** Photo Gallery is gated behind
   `existingGuestData?.status === 'CONFIRMED'`. Recommend NO gating — show to
   everyone who lands on the event page (it's a lure).

4. **Include on GPP map?** GPP events use a special `GPPMap` KML layer.
   Recommend YES — orthogonal to the global GPP map.

5. **Manual-entry lat/lng fix scope**: Include the polish fix to
   `PizzeriaSelection.addManualPizzeria()` in the same PR, or split into a
   separate follow-up? Recommend **same PR** — small, additive.
