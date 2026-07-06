// napoletana-58547: single map-provider switch.
//
// The Google Maps key is currently down, which breaks every map surface at
// once (autocomplete, interactive maps, static thumbnails, pizzeria search).
// This selector lets us run a keyless OpenStreetMap/MapLibre path by default
// while keeping every Google implementation intact behind `isGoogleMaps()`,
// so we can flip back to Google with zero code changes:
//
//   VITE_MAP_PROVIDER=google  → use the Google Maps key
//   VITE_MAP_PROVIDER=osm      → keyless fallback (default while the key is down)

export type MapProvider = 'google' | 'osm';

export const MAP_PROVIDER: MapProvider =
  (import.meta.env.VITE_MAP_PROVIDER as MapProvider) || 'osm';

export const isGoogleMaps = () => MAP_PROVIDER === 'google';
