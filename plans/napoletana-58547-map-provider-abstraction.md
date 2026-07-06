# napoletana-58547 — Pluggable map-provider layer (Google ↔ keyless OSM, switchable on demand)

## Problem

Our Google Maps API key is currently not working, which breaks every user-visible
map surface at once: address autocomplete, interactive maps, static venue
thumbnails, and pizzeria discovery. We need a **temporary** fallback to a keyless
open-source provider so the site keeps working — **without deleting any Google
code**, so we can flip back to Google (or to a paid provider later) on demand via
a single switch.

## Goal

Introduce a thin **provider abstraction** at each of the 4 map seams. Google stays
as one implementation; a keyless OpenStreetMap-based implementation is added and
becomes the default while the key is down. A single env var per surface selects the
active provider at build/deploy time — no code change required to switch back.

**Non-goals:** removing Google code, achieving Google-parity POI quality, changing
any data model. This is a resilience/switchability layer, not a redesign.

## What already works (do not touch)

- **Geocoding (address → lat/lng)** is *already* off Google:
  - `frontend/src/lib/ordering.ts` `geocodeAddress()` → Nominatim only.
  - `backend/src/lib/geocode.ts` `geocodeCity()` → Nominatim-first, Google only as
    fallback (`GOOGLE_GEOCODING_API_KEY`). Dead key just means it stops at Nominatim.
  - **Keep both as-is.** They are the coordinate source the new components reuse.

## The switch

One provider selector, defaulting to the keyless path while Google is down:

- **Frontend:** `VITE_MAP_PROVIDER` = `google` | `osm` (default `osm`).
  Read once in a new `frontend/src/lib/maps/provider.ts`:
  ```ts
  export type MapProvider = 'google' | 'osm';
  export const MAP_PROVIDER: MapProvider =
    (import.meta.env.VITE_MAP_PROVIDER as MapProvider) || 'osm';
  export const isGoogleMaps = () => MAP_PROVIDER === 'google';
  ```
- **Edge function (pizzeria search):** `MAP_PROVIDER` Supabase secret = `google` | `osm`
  (default `osm`). Read in `search-pizzerias/index.ts`.

To restore Google later: set `VITE_MAP_PROVIDER=google` in Vercel (+ redeploy) and
`MAP_PROVIDER=google` in Supabase secrets. Zero code changes.

## Keyless provider choices (the `osm` path)

| Seam | Keyless replacement | Notes |
|---|---|---|
| Interactive maps | **MapLibre GL JS** (`maplibre-gl`) + **OpenFreeMap** vector style (`https://tiles.openfreemap.org/styles/liberty`) | Truly keyless, no rate-limit signup, MIT. Fallback style: Carto `voyager` basemap. Avoid raw `tile.openstreetmap.org` (usage policy forbids app-scale use). |
| Static map images | **Non-interactive MapLibre map** (interaction disabled) in place of the `<img>` | No keyless static-image service is reliable; a locked-down MapLibre instance is the simplest keyless equivalent. Keep the Google `<img>` branch behind `isGoogleMaps()`. |
| Address autocomplete | **Photon** (`https://photon.komoot.io/api?q=`) primary, **Nominatim** fallback | Photon is autocomplete-optimized and keyless; returns coords + structured address. |
| Pizzeria POI search | **Overpass API** (`amenity=restaurant`/`fast_food` + `cuisine~pizza` around lat/lng) | Keyless. Coverage/quality drops outside major metros — acceptable "for now", flagged in UI copy is not needed but note in PR. |
| Timezone (from autocomplete) | **`tz-lookup`** npm (offline lat/lng → IANA tz) | Google path derived tz from the place; keyless path computes it locally. |

## Architecture — new `frontend/src/lib/maps/` module

Create wrapper components that internally branch on `MAP_PROVIDER`, keeping each
Google implementation intact as the `google` branch:

```
frontend/src/lib/maps/
  provider.ts            # MAP_PROVIDER + helpers (above)
  MapLibreMap.tsx        # generic interactive MapLibre map (markers, popups, fitBounds, GeoJSON)
  loadMapLibre.ts        # lazy-load maplibre-gl + css (mirrors existing loadGoogleMaps pattern)
  photonAutocomplete.ts  # debounced Photon→Nominatim search returning CityData[]
  overpassPizzerias.ts   # (shared types) Overpass query→Pizzeria[] mapper (used by edge fn logic ref)
```

### Seam 1 — Interactive maps (4 components)

Files: `GPPEventsMap.tsx`, `GPPPizzeriasMap.tsx`, `GPPMap.tsx`, `ParticipatingPizzeriasMap.tsx`.

Pattern per file: at the top of the render/effect, branch on `isGoogleMaps()`.
- `google` branch → the **existing** `new google.maps.Map` + `loadGoogleMaps` code
  (unchanged, kept verbatim).
- `osm` branch → new MapLibre code:
  - `new maplibregl.Map({ style: OPENFREEMAP_STYLE, ... })`
  - Markers → `new maplibregl.Marker({ element })` (custom pin element for the
    Molto Benny / status icons).
  - InfoWindow → `new maplibregl.Popup()`.
  - `LatLngBounds`/`fitBounds` → `maplibregl.LngLatBounds` + `map.fitBounds(bounds, {padding})`.
  - **`GPPMap.tsx` uses `KmlLayer`** — MapLibre has none. Convert the KML to GeoJSON
    with `@tmcw/togeojson` (fetch the KML, parse, `map.addSource`/`addLayer`).
    This is the one non-mechanical port; budget extra time.

Cleanest structure: extract each component's marker/data logic into a shared helper
and have the two branches only differ in the map primitive calls.

### Seam 2 — Static map images (3 spots)

Files: `VenueMap.tsx`, `PizzeriaSearch.tsx` (line ~324 static URL),
`sponsor-dashboard/EventInfoCard.tsx` (line ~44 static URL).

- Keep the Google `staticmap` `<img>` branch exactly as-is behind `isGoogleMaps()`.
- Add an `osm` branch that renders a small `<MapLibreMap>` with interaction disabled
  (`interactive:false`, `dragPan/scrollZoom` off), single marker at center, same
  container `className` so layout is unchanged. Tap-through link: keep the existing
  `google.com/maps/search` deep link (a link is fine even when tiles are OSM), or
  switch to `https://www.openstreetmap.org/?mlat=..&mlon=..#map=17/..` under `osm`.
- `VenueMap.tsx` already has a `MapPin` fallback for missing key/geocode-fail — reuse
  it as the loading/empty state.

### Seam 3 — Address autocomplete (4 components)

Files: `LocationAutocomplete.tsx`, `PlaceAutocomplete.tsx`,
`kit/ShippingAddressAutocomplete.tsx`, `venue/VenueForm.tsx` (`PlacesService`).

- Keep the Google `Autocomplete`/`PlacesService` code behind `isGoogleMaps()`.
- Add an `osm` branch built on the existing `IconInput` (per CLAUDE.md — no raw
  inputs) + a results dropdown, wired to `photonAutocomplete.ts`:
  - Debounce (~300ms), min 3 chars, abortable fetch.
  - Map Photon/Nominatim result → the existing `CityData` shape
    (`cityName/country/countryCode/state/street/postalCode/lat/lng/formattedName`).
    Photon `properties` covers city/country/countrycode/state/street/postcode;
    fall back to Nominatim `addressdetails=1` when a field is missing.
  - Derive `onTimezoneChange` from `tz-lookup(lat, lng)` (Google path got tz from
    the place; keep the same callback contract).
  - Fire the same callbacks (`onPlaceSelected`, `onLocationSelected`, `onCitySelected`)
    so **no caller changes**. `placeId` → `null` under `osm` (callers already accept null).
- Match the existing dropdown look to `LocationModal`/existing modal patterns.

### Seam 4 — Pizzeria POI discovery (edge function)

File: `supabase/functions/search-pizzerias/index.ts` (+ helper `scripts/backfill-place-ids.js`
left on Google; it's an offline one-shot, not runtime — leave as-is, note in PR).

- Branch `searchGooglePlaces` vs new `searchOverpassPizzerias(lat, lng, radius)` on
  the `MAP_PROVIDER` secret.
- Overpass query:
  ```
  [out:json][timeout:15];
  ( node["amenity"~"restaurant|fast_food"]["cuisine"~"pizza",i](around:RADIUS,LAT,LNG);
    way ["amenity"~"restaurant|fast_food"]["cuisine"~"pizza",i](around:RADIUS,LAT,LNG); );
  out center 20;
  ```
  Endpoint: `https://overpass-api.de/api/interpreter` (POST, `data=`). Map each element
  → the existing `Pizzeria` shape (id = `osm/{type}/{id}`, name = `tags.name`,
  address from `addr:*` tags, `location` from `lat/lon` or `center`, phone =
  `tags.phone`, url = `tags.website`; rating/priceLevel/isOpen → undefined).
- **Keep the in-memory response cache** (already there) — Overpass is slower and
  rate-limited, so caching matters more, not less. Consider extending TTL under `osm`.
- Preserve the existing sort; with no ratings it degenerates to insertion order —
  acceptable "for now".

## Dependencies to add (frontend)

- `maplibre-gl` (interactive + static maps)
- `@tmcw/togeojson` (KML → GeoJSON for GPPMap)
- `tz-lookup` (offline timezone from lat/lng)

All MIT/BSD, no keys. `maplibre-gl` ships its own CSS — import in `loadMapLibre.ts`.

## Env / config changes

- `frontend/.env.example`: add `VITE_MAP_PROVIDER=osm` with a comment ("`google` to
  use the Google key; `osm` for the keyless fallback").
- **Vercel:** add `VITE_MAP_PROVIDER=osm` (Production + Preview). Keep
  `VITE_GOOGLE_MAPS_API_KEY` set so flipping back is instant.
- **Supabase secrets:** add `MAP_PROVIDER=osm`. Keep `GOOGLE_PLACES_API_KEY`.

## Rollout (respect prod-shared-backend ordering, per CLAUDE.md)

1. Land the frontend abstraction (previews auto-deploy per branch). Verify on the
   preview URL with `VITE_MAP_PROVIDER=osm`.
2. Deploy the `search-pizzerias` edge function **and** set `MAP_PROVIDER=osm` secret
   (edge functions deploy independently of `master`).
3. Set `VITE_MAP_PROVIDER=osm` in Vercel Production, redeploy frontend.
4. Rollback = set both back to `google` (assuming the key is restored).

## Testing / verification

- Existing tests reference `VITE_GOOGLE_MAPS_API_KEY` (`test/setup.ts`,
  `VenueForm.test.tsx`, `RSVPModal.test.tsx`). Add `VITE_MAP_PROVIDER` to
  `test/setup.ts`; make the `osm`-branch components render without a Google global.
- Manual matrix (both provider values) on: create-event location autocomplete
  (→ tz + coords populate), EventPage venue thumbnail, `/gpp` events map + KML map,
  participating-pizzerias map, pizzeria search (Overpass results appear), kit
  shipping autocomplete, sponsor dashboard event card.
- `npx tsc --noEmit` in `frontend/` (vite build does **not** typecheck — per repo memory).

## Risks / caveats

- **Overpass coverage/quality** is materially worse than Google Places outside big
  cities (missing pizzerias, no ratings/hours/photos). This is the weakest seam;
  acceptable only as a temporary bridge. The `sicilian-25988` pizzeria-photos work
  assumes Google `place.id` — those photos won't exist under `osm` (Overpass ids
  aren't Google place ids). Flag but don't block.
- **Public tile/geocoder rate limits** (OpenFreeMap, Photon, Overpass are community
  services with fair-use policies). Fine for current traffic; if we stay on `osm`
  long-term, move to self-hosted or a free-tier key provider (MapTiler/Geoapify) —
  same abstraction, new branch.
- **`GPPMap` KML→GeoJSON** is the only non-mechanical port; verify the KML actually
  fetches from its current source and renders.
- Keep all Google branches compiling — don't let the `osm` default bit-rot the
  Google path (it's the rollback).

## File checklist

New:
- `frontend/src/lib/maps/provider.ts`
- `frontend/src/lib/maps/loadMapLibre.ts`
- `frontend/src/lib/maps/MapLibreMap.tsx`
- `frontend/src/lib/maps/photonAutocomplete.ts`
- `frontend/src/lib/maps/overpassPizzerias.ts` (shared mapper/types)

Edited (add `osm` branch, keep Google branch):
- `frontend/src/components/GPPEventsMap.tsx`
- `frontend/src/components/GPPPizzeriasMap.tsx`
- `frontend/src/components/GPPMap.tsx`
- `frontend/src/components/ParticipatingPizzeriasMap.tsx`
- `frontend/src/components/VenueMap.tsx`
- `frontend/src/components/PizzeriaSearch.tsx`
- `frontend/src/components/sponsor-dashboard/EventInfoCard.tsx`
- `frontend/src/components/LocationAutocomplete.tsx`
- `frontend/src/components/PlaceAutocomplete.tsx`
- `frontend/src/components/kit/ShippingAddressAutocomplete.tsx`
- `frontend/src/components/venue/VenueForm.tsx`
- `supabase/functions/search-pizzerias/index.ts`
- `frontend/.env.example`
- `frontend/src/test/setup.ts`
- `frontend/package.json` (deps)

Untouched (already keyless / intentionally left on Google):
- `frontend/src/lib/ordering.ts` (`geocodeAddress` — Nominatim)
- `backend/src/lib/geocode.ts` (Nominatim-first)
- `scripts/backfill-place-ids.js` (offline one-shot)
