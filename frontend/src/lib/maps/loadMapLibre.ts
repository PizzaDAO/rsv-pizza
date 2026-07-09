// napoletana-58547: lazy-load MapLibre GL JS + its CSS.
//
// Mirrors the script-injection pattern of the Google loader (load once, share
// the instance across every map component) — but MapLibre is an npm package,
// so we use a dynamic `import()` to keep the (large) library out of the initial
// bundle and only pull it when a map is actually rendered under the `osm` path.

// Keyless vector style. OpenFreeMap is truly keyless (no signup / rate-limit
// token) and MIT-licensed. If it is ever unavailable, swap to the Carto
// Voyager basemap below — same MapLibre code, just a different style URL.
export const OPENFREEMAP_STYLE = 'https://tiles.openfreemap.org/styles/liberty';
export const CARTO_VOYAGER_STYLE =
  'https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json';

// The generic map style used everywhere unless a caller overrides it.
export const DEFAULT_MAP_STYLE = OPENFREEMAP_STYLE;

type MapLibreModule = typeof import('maplibre-gl');

let modPromise: Promise<MapLibreModule['default']> | null = null;

/**
 * Resolve the maplibre-gl default export, loading the library + its stylesheet
 * on first use. Safe to call from multiple components — the underlying import
 * is memoized so the library is only fetched once.
 */
export async function loadMapLibre(): Promise<MapLibreModule['default']> {
  if (!modPromise) {
    modPromise = (async () => {
      // Side-effect CSS import (static literal so Vite can bundle it). Loaded
      // alongside the JS the first time any MapLibre map mounts.
      await import('maplibre-gl/dist/maplibre-gl.css');
      const mod = await import('maplibre-gl');
      return mod.default;
    })();
  }
  return modPromise;
}
