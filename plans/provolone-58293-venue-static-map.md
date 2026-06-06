# provolone-58293 — Venue thumbnail: Dynamic → Static Maps

**Priority**: Medium (cost reduction, peak-day spend)

## Summary

Swap the EventPage venue thumbnail (`frontend/src/components/VenueMap.tsx`) from the Google Maps JavaScript SDK (Dynamic Maps, ~$7 / 1k loads) to the Google Maps Static Maps API rendered as a cacheable `<img>` tag (~$2 / 1k AND browser/CDN-cacheable). On the project's peak event day (GPP), this cuts venue-thumbnail spend by roughly 70% per call, plus repeat hits to the same event page reuse the cached image entirely.

The component's public API is preserved — same exported name, same prop shape, same `className`-controlled sizing — so EventPage and any other caller need zero changes.

## Files touched

- `frontend/src/components/VenueMap.tsx` — full rewrite as a Static Maps `<img>` wrapped in an anchor to the canonical Google Maps place card.
- `plans/provolone-58293-venue-static-map.md` — this plan.

## Implementation notes

- **Coords-first, then geocode.** If `latitude` + `longitude` are stored on the party, use them directly. Otherwise call the existing `geocodeAddress(address)` helper. We never pass the address string straight to `center=` — Google's Static Maps caching rules treat lat/lng URLs as cacheable but address-string URLs as request-time-resolved (and uncacheable).
- **URL pattern:**
  ```
  https://maps.googleapis.com/maps/api/staticmap
    ?center={lat},{lng}
    &zoom={zoom ?? 17}
    &size=600x400
    &scale=2
    &maptype=roadmap
    &markers=color:red%7C{lat},{lng}
    &key={VITE_GOOGLE_MAPS_API_KEY}
  ```
  600x400 stays under Static Maps' free-tier 640px-per-dimension cap; `scale=2` doubles file size for retina screens but still counts as a single billable request. The `<img>` stretches to fill its parent via `width:100%; height:100%; object-fit:cover`, so callers keep using `className` (aspect-square, w-[40%] absolute, w-full h-48) to control rendered size — unchanged from the SDK version.
- **Tap-through.** Wrap the `<img>` in an `<a href={googleMapsLink} target="_blank" rel="noopener noreferrer">` using `/maps/search/?api=1&query=<address>` per `architecture_google_maps_url_action.md`. VenueMap doesn't have a `ChIJ…` placeId on its prop surface, so we use `query` alone (address preferred, lat/lng fallback). EventPage's outer link in the location-row still uses the placeId form when available; this is just a safety net for the in-image tap.
- **Loading state.** While geocoding is in flight (no stored lat/lng yet), render a centered `<MapPin>` placeholder matching the existing fallback visuals so the container doesn't flash size/shape.
- **Error / no-key state.** Unchanged from current: gradient placeholder with the venue name. The error branch now also covers "no `VITE_GOOGLE_MAPS_API_KEY`" the same way.
- **Custom pizza marker dropped.** The SDK version used `/molto-benny.png` as the marker icon. Static Maps `icon:` requires an absolute HTTPS URL accessible to Google's servers; in v1 we use the plain `color:red` pin per the task spec. If we want the pizza marker back, follow-up ticket can serve it from a stable public URL and add `icon:https://rsv.pizza/molto-benny.png|` to the `markers=` param.

## Out of scope

- `ParticipatingPizzeriasMap.tsx` — multi-pin, benefits from pan/zoom, stays Dynamic.
- `/map`, `/map/all`, `/map/swc`, `GPPMap.tsx`, `GPPPizzeriasMap.tsx`, `GPPEventsMap.tsx`, `EventsMapPage.tsx`, `EventsMapAllPage.tsx`, `EventsMapSwcPage.tsx` — all inherently interactive global event maps, stay Dynamic.
- Edge-function caching proxy — separate larger ticket; for v1 we rely on the browser cache of the direct Static Maps URL. The 70% per-call price drop alone justifies shipping now.
- `geocodeAddress` helper itself is untouched; we just call it from the new VenueMap when needed.
- EventPage and any other caller of VenueMap is untouched — backwards-compat is the whole point.

## Operational note (must verify before merge)

**Static Maps API must be enabled separately** in the Google Cloud Console under "APIs & Services → Enable APIs" for project `1083518967216`. The existing `VITE_GOOGLE_MAPS_API_KEY` only has Dynamic Maps + Places enabled by default. Without explicit Static Maps enablement, the `<img>` requests will 403 and we fall through to the `error` placeholder (gradient + venue name). Snax to confirm enablement on the GCP project before merging this PR.

Verification once enabled: open any preview event-page on a deploy of this branch, check Network tab for a `staticmap?…` request returning 200 with `Content-Type: image/png`.
