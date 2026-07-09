import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { GPPPizzeriaMapItem, saveGppPizzeriaPhoto } from '../lib/api';
import { isGoogleMaps } from '../lib/maps/provider';
import { loadMapLibre, DEFAULT_MAP_STYLE } from '../lib/maps/loadMapLibre';
import type { Map as MlMap, Marker as MlMarker, Popup as MlPopup } from 'maplibre-gl';

interface GPPPizzeriasMapProps {
  pizzerias: GPPPizzeriaMapItem[];
  height?: string;
}

export default function GPPPizzeriasMap({
  pizzerias,
  height = '100%',
}: GPPPizzeriasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  // napoletana-58547: keyless MapLibre (`osm`) refs.
  const osmMapRef = useRef<MlMap | null>(null);
  const osmMarkersRef = useRef<MlMarker[]>([]);
  const osmPopupRef = useRef<MlPopup | null>(null);
  const [error, setError] = useState(false);

  // Filter out pizzerias with no valid coordinates
  const validPizzerias = useMemo(
    () =>
      pizzerias.filter(
        (p) =>
          p.location &&
          !(p.location.lat === 0 && p.location.lng === 0)
      ),
    [pizzerias]
  );

  useEffect(() => {
    if (!isGoogleMaps()) return; // osm handled by the effect below

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError(true);
      return;
    }

    if (validPizzerias.length === 0) return;

    const initMap = () => {
      if (!containerRef.current) return;

      // Clean up previous markers & clusterer
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }

      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: { lat: 20, lng: 0 },
          zoom: 3,
          minZoom: 2,
          maxZoom: 18,
          mapTypeId: 'roadmap',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
          restriction: {
            latLngBounds: { north: 85, south: -85, west: -180, east: 180 },
            strictBounds: true,
          },
          styles: [
            { featureType: 'water', stylers: [{ color: '#b6e4f7' }] },
            { featureType: 'landscape', stylers: [{ color: '#e8f5e9' }] },
            { featureType: 'road', stylers: [{ visibility: 'off' }] },
            { featureType: 'transit', stylers: [{ visibility: 'off' }] },
            { featureType: 'poi', stylers: [{ visibility: 'off' }] },
            {
              featureType: 'administrative.country',
              elementType: 'geometry.stroke',
              stylers: [{ color: '#999' }],
            },
            {
              featureType: 'administrative.province',
              stylers: [{ visibility: 'off' }],
            },
          ],
        });
      }

      const map = mapRef.current;

      // Inject InfoWindow style overrides once
      if (!document.getElementById('gpp-iw-styles')) {
        const style = document.createElement('style');
        style.id = 'gpp-iw-styles';
        style.textContent = `
          .gm-style-iw-chr { height: auto !important; }
          .gm-style-iw-chr button { width: 24px !important; height: 24px !important; }
          .gm-style-iw-chr button span { width: 16px !important; height: 16px !important; margin: 4px !important; }
          .gm-style-iw-d { overflow: auto !important; padding-top: 0 !important; }
          .gm-style-iw { padding-top: 0 !important; }
        `;
        document.head.appendChild(style);
      }

      // Shared InfoWindow
      if (!infoWindowRef.current) {
        infoWindowRef.current = new google.maps.InfoWindow();
      }
      const infoWindow = infoWindowRef.current;

      // PlacesService for fetching photos on demand
      const placesService = new google.maps.places.PlacesService(map);

      // In-memory cache of photo URLs fetched this session
      const photoCache: Record<string, string> = {};

      function buildInfoContent(pizzeria: GPPPizzeriaMapItem, photoUrl?: string) {
        let photoHtml = '';
        if (photoUrl) {
          photoHtml = `<img src="${photoUrl}" alt="${pizzeria.name}" referrerpolicy="no-referrer" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px" />`;
        }

        let ratingHtml = '';
        if (pizzeria.rating) {
          const fullStars = Math.floor(pizzeria.rating);
          const halfStar = pizzeria.rating - fullStars >= 0.5;
          let stars = '';
          for (let i = 0; i < fullStars; i++) stars += '\u2605';
          if (halfStar) stars += '\u00BD';
          const reviewText = pizzeria.reviewCount
            ? ` (${pizzeria.reviewCount})`
            : '';
          ratingHtml = `<div style="color:#f59e0b;font-size:14px;margin:2px 0">${stars} <span style="color:#666;font-size:12px">${pizzeria.rating}${reviewText}</span></div>`;
        }

        let descHtml = '';
        if (pizzeria.description) {
          const truncated =
            pizzeria.description.length > 120
              ? pizzeria.description.slice(0, 120) + '...'
              : pizzeria.description;
          descHtml = `<p style="color:#555;font-size:12px;margin:4px 0;line-height:1.4">${truncated}</p>`;
        }

        let linkHtml = '';
        if (pizzeria.url) {
          linkHtml = `<a href="${pizzeria.url}" target="_blank" rel="noopener noreferrer" style="color:#E52828;font-size:12px;text-decoration:none;font-weight:500">Visit Website &rarr;</a>`;
        }

        return `
          <div style="max-width:260px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:4px">
            ${photoHtml}
            <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1a1a1a">${pizzeria.name}</h3>
            ${ratingHtml}
            <p style="color:#888;font-size:12px;margin:2px 0">${pizzeria.address || ''}</p>
            ${descHtml}
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
              ${linkHtml}
              <span style="background:#fef2f2;color:#E52828;font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:500">${pizzeria.eventCity}</span>
            </div>
          </div>
        `;
      }

      // Build markers
      const markers: google.maps.Marker[] = [];

      for (const pizzeria of validPizzerias) {
        const position = {
          lat: pizzeria.location.lat,
          lng: pizzeria.location.lng,
        };

        const marker = new google.maps.Marker({
          position,
          title: pizzeria.name,
          label: {
            text: '\u{1F355}',
            fontSize: '22px',
          },
          optimized: false,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 14,
            fillOpacity: 0,
            strokeWeight: 0,
          },
        });

        marker.addListener('click', () => {
          // If we already have a cached photo URL (from DB or session), show immediately
          const cachedUrl = pizzeria.photoUrl || photoCache[pizzeria.placeId || ''];
          infoWindow.setContent(buildInfoContent(pizzeria, cachedUrl));
          infoWindow.open(map, marker);

          // If no photo yet and we have a placeId, fetch from Places API
          if (!cachedUrl && pizzeria.placeId) {
            placesService.getDetails(
              { placeId: pizzeria.placeId, fields: ['photos'] },
              (place, status) => {
                if (
                  status === google.maps.places.PlacesServiceStatus.OK &&
                  place?.photos &&
                  place.photos.length > 0
                ) {
                  const photoUrl = place.photos[0].getUrl({ maxWidth: 400 });
                  // Cache in memory for this session
                  photoCache[pizzeria.placeId!] = photoUrl;
                  // Update InfoWindow with photo
                  infoWindow.setContent(buildInfoContent(pizzeria, photoUrl));
                  // Fire-and-forget save to backend
                  saveGppPizzeriaPhoto(pizzeria.eventId, pizzeria.placeId!, photoUrl).catch(() => {});
                }
              }
            );
          }
        });

        markers.push(marker);
      }

      markersRef.current = markers;

      // Create clusterer
      clustererRef.current = new MarkerClusterer({ map, markers });
    };

    // Load Google Maps script if not already loaded
    if (window.google?.maps) {
      initMap();
      return;
    }

    const existingScript = document.querySelector(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    );

    if (existingScript) {
      const waitForMaps = () => {
        if (window.google?.maps) {
          initMap();
        } else {
          setTimeout(waitForMaps, 100);
        }
      };
      waitForMaps();
      return;
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places&callback=Function.prototype`;
    script.async = true;
    script.defer = true;
    script.onload = () => initMap();
    script.onerror = () => setError(true);
    document.head.appendChild(script);
  }, [validPizzerias]);

  // ── osm: keyless MapLibre implementation ────────────────────────────────────
  // No native clustering and no on-demand Google Places photo fetch (Overpass
  // ids are not Google place ids). We still show a persisted `photoUrl` when the
  // backend has one cached.
  useEffect(() => {
    if (isGoogleMaps()) return;
    if (validPizzerias.length === 0) return;

    let cancelled = false;

    function buildInfoContent(pizzeria: GPPPizzeriaMapItem, photoUrl?: string) {
      let photoHtml = '';
      if (photoUrl) {
        photoHtml = `<img src="${photoUrl}" alt="${pizzeria.name}" referrerpolicy="no-referrer" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px" />`;
      }

      let ratingHtml = '';
      if (pizzeria.rating) {
        const fullStars = Math.floor(pizzeria.rating);
        const halfStar = pizzeria.rating - fullStars >= 0.5;
        let stars = '';
        for (let i = 0; i < fullStars; i++) stars += '★';
        if (halfStar) stars += '½';
        const reviewText = pizzeria.reviewCount ? ` (${pizzeria.reviewCount})` : '';
        ratingHtml = `<div style="color:#f59e0b;font-size:14px;margin:2px 0">${stars} <span style="color:#666;font-size:12px">${pizzeria.rating}${reviewText}</span></div>`;
      }

      let descHtml = '';
      if (pizzeria.description) {
        const truncated =
          pizzeria.description.length > 120
            ? pizzeria.description.slice(0, 120) + '...'
            : pizzeria.description;
        descHtml = `<p style="color:#555;font-size:12px;margin:4px 0;line-height:1.4">${truncated}</p>`;
      }

      let linkHtml = '';
      if (pizzeria.url) {
        linkHtml = `<a href="${pizzeria.url}" target="_blank" rel="noopener noreferrer" style="color:#E52828;font-size:12px;text-decoration:none;font-weight:500">Visit Website &rarr;</a>`;
      }

      return `
        <div style="max-width:260px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:4px">
          ${photoHtml}
          <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1a1a1a">${pizzeria.name}</h3>
          ${ratingHtml}
          <p style="color:#888;font-size:12px;margin:2px 0">${pizzeria.address || ''}</p>
          ${descHtml}
          <div style="margin-top:6px;display:flex;align-items:center;gap:8px">
            ${linkHtml}
            <span style="background:#fef2f2;color:#E52828;font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:500">${pizzeria.eventCity}</span>
          </div>
        </div>
      `;
    }

    loadMapLibre()
      .then((maplibregl) => {
        if (cancelled || !containerRef.current) return;

        osmMarkersRef.current.forEach((m) => m.remove());
        osmMarkersRef.current = [];

        if (!osmMapRef.current) {
          osmMapRef.current = new maplibregl.Map({
            container: containerRef.current,
            style: DEFAULT_MAP_STYLE,
            center: [0, 20],
            zoom: 3,
            minZoom: 2,
            maxZoom: 18,
            attributionControl: { compact: true },
          });
          osmMapRef.current.addControl(
            new maplibregl.NavigationControl({ showCompass: false }),
            'top-right'
          );
        }
        const map = osmMapRef.current;

        if (!osmPopupRef.current) {
          osmPopupRef.current = new maplibregl.Popup({ maxWidth: '280px', closeButton: true });
        }
        const popup = osmPopupRef.current;

        for (const pizzeria of validPizzerias) {
          const el = document.createElement('div');
          el.textContent = '\u{1F355}';
          el.style.fontSize = '22px';
          el.style.lineHeight = '1';
          el.style.cursor = 'pointer';

          const marker = new maplibregl.Marker({ element: el, anchor: 'center' })
            .setLngLat([pizzeria.location.lng, pizzeria.location.lat])
            .addTo(map);

          el.addEventListener('click', (ev) => {
            ev.stopPropagation();
            const cachedUrl = pizzeria.photoUrl || undefined;
            popup
              .setLngLat([pizzeria.location.lng, pizzeria.location.lat])
              .setHTML(buildInfoContent(pizzeria, cachedUrl))
              .addTo(map);
          });

          osmMarkersRef.current.push(marker);
        }

        map.on('click', () => popup.remove());
      })
      .catch((err) => {
        console.error('Failed to load MapLibre pizzerias map:', err);
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
      osmMarkersRef.current.forEach((m) => m.remove());
      osmMarkersRef.current = [];
      if (osmPopupRef.current) osmPopupRef.current.remove();
      if (osmMapRef.current) {
        osmMapRef.current.remove();
        osmMapRef.current = null;
      }
    };
  }, [validPizzerias]);

  if (error) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center bg-gray-100 rounded-2xl"
      >
        <p className="text-gray-500">
          Unable to load map. Please try again later.
        </p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="gpp-pizzerias-map"
      style={{ height, width: '100%' }}
    />
  );
}
