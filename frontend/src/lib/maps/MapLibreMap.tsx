import { useEffect, useRef, useState } from 'react';
import type { Map as MlMap, Marker as MlMarker } from 'maplibre-gl';
import { loadMapLibre, DEFAULT_MAP_STYLE } from './loadMapLibre';

export interface MapLibreMarker {
  lat: number;
  lng: number;
  /** Custom pin element. When omitted, MapLibre's default teardrop pin is used. */
  element?: HTMLElement;
  /** Color for the default pin (ignored when `element` is provided). */
  color?: string;
  /** HTML popup shown when the marker is clicked. */
  popupHTML?: string;
  /** Called when the marker element is clicked (in addition to any popup). */
  onClick?: () => void;
  title?: string;
}

interface MapLibreMapProps {
  center?: { lat: number; lng: number };
  zoom?: number;
  minZoom?: number;
  maxZoom?: number;
  markers?: MapLibreMarker[];
  /** Optional GeoJSON overlay (FeatureCollection/Feature) drawn as line+fill+circle. */
  geojson?: unknown;
  /** Disable all interaction (pan/zoom) — used for "static" thumbnails. */
  interactive?: boolean;
  /** Fit the viewport to all markers after they are added. */
  fitToMarkers?: boolean;
  fitPadding?: number;
  fitMaxZoom?: number;
  className?: string;
  style?: React.CSSProperties;
  mapStyle?: string;
  dataTestId?: string;
  onMapClick?: () => void;
}

const OVERLAY_SOURCE_ID = 'ml-overlay';

/**
 * napoletana-58547: generic MapLibre GL map wrapper for the keyless `osm`
 * provider path. Handles interactive maps, static (interaction-disabled)
 * thumbnails, custom HTML markers with popups, fit-to-markers, and an optional
 * GeoJSON overlay. The Google equivalents live in the individual components
 * behind `isGoogleMaps()`.
 */
export default function MapLibreMap({
  center = { lat: 20, lng: 0 },
  zoom = 3,
  minZoom,
  maxZoom,
  markers = [],
  geojson,
  interactive = true,
  fitToMarkers = false,
  fitPadding = 48,
  fitMaxZoom = 15,
  className,
  style,
  mapStyle = DEFAULT_MAP_STYLE,
  dataTestId,
  onMapClick,
}: MapLibreMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const markerObjsRef = useRef<MlMarker[]>([]);
  const mlRef = useRef<Awaited<ReturnType<typeof loadMapLibre>> | null>(null);
  const [ready, setReady] = useState(false);

  // ── Init map once ──────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current || mapRef.current) return;
        mlRef.current = maplibregl;

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: mapStyle,
          center: [center.lng, center.lat],
          zoom,
          minZoom,
          maxZoom,
          interactive,
          attributionControl: { compact: true },
        });

        if (interactive) {
          map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
        }

        if (onMapClick) {
          map.on('click', () => onMapClick());
        }

        mapRef.current = map;
        setReady(true);
      })
      .catch((err) => {
        console.error('Failed to load MapLibre map:', err);
      });

    return () => {
      cancelled = true;
      markerObjsRef.current.forEach((m) => m.remove());
      markerObjsRef.current = [];
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // Intentionally init-once; content is synced by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Sync markers + fit bounds ───────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    const maplibregl = mlRef.current;
    if (!ready || !map || !maplibregl) return;

    // Clear previous markers
    markerObjsRef.current.forEach((m) => m.remove());
    markerObjsRef.current = [];

    const bounds = new maplibregl.LngLatBounds();

    for (const mk of markers) {
      const marker = mk.element
        ? new maplibregl.Marker({ element: mk.element, anchor: 'bottom' })
        : new maplibregl.Marker({ color: mk.color });
      marker.setLngLat([mk.lng, mk.lat]);

      if (mk.popupHTML) {
        marker.setPopup(new maplibregl.Popup({ offset: 24 }).setHTML(mk.popupHTML));
      }
      if (mk.onClick) {
        marker.getElement().style.cursor = 'pointer';
        marker.getElement().addEventListener('click', mk.onClick);
      }
      marker.addTo(map);
      markerObjsRef.current.push(marker);
      bounds.extend([mk.lng, mk.lat]);
    }

    if (fitToMarkers && markers.length > 1) {
      map.fitBounds(bounds, { padding: fitPadding, maxZoom: fitMaxZoom, animate: false });
    } else if (fitToMarkers && markers.length === 1) {
      map.setCenter([markers[0].lng, markers[0].lat]);
    } else {
      map.setCenter([center.lng, center.lat]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, markers, fitToMarkers, fitPadding, fitMaxZoom, center.lat, center.lng]);

  // ── Sync GeoJSON overlay ─────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !geojson) return;

    const apply = () => {
      const existing = map.getSource(OVERLAY_SOURCE_ID) as
        | { setData: (d: unknown) => void }
        | undefined;
      if (existing) {
        existing.setData(geojson as never);
        return;
      }
      map.addSource(OVERLAY_SOURCE_ID, { type: 'geojson', data: geojson as never });
      map.addLayer({
        id: `${OVERLAY_SOURCE_ID}-fill`,
        type: 'fill',
        source: OVERLAY_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': '#ff393a', 'fill-opacity': 0.15 },
      });
      map.addLayer({
        id: `${OVERLAY_SOURCE_ID}-line`,
        type: 'line',
        source: OVERLAY_SOURCE_ID,
        paint: { 'line-color': '#ff393a', 'line-width': 2 },
      });
      map.addLayer({
        id: `${OVERLAY_SOURCE_ID}-point`,
        type: 'circle',
        source: OVERLAY_SOURCE_ID,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5,
          'circle-color': '#ff393a',
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 2,
        },
      });
    };

    if (map.isStyleLoaded()) {
      apply();
    } else {
      map.once('load', apply);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, geojson]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={style}
      data-testid={dataTestId}
    />
  );
}
