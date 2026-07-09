import { useEffect, useMemo, useRef, useState } from 'react';
import { Pizzeria } from '../types';
import { isGoogleMaps } from '../lib/maps/provider';
import MapLibreMap, { MapLibreMarker } from '../lib/maps/MapLibreMap';

interface ParticipatingPizzeriasMapProps {
  pizzerias: Pizzeria[];
  venueLocation?: { lat: number; lng: number } | null;
  venueName?: string;
  height?: number;
}

/**
 * Renders a Google Map with red pins for each pizzeria. Follows the same
 * dynamic-loader + script-tag-collision pattern as GPPMap.tsx. Returns null if
 * no pizzerias have valid coordinates (and the parent can then collapse the
 * grid to a single column).
 */
export default function ParticipatingPizzeriasMap({
  pizzerias,
  venueLocation,
  venueName,
  height = 320,
}: ParticipatingPizzeriasMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const [error, setError] = useState(false);

  // Filter to pizzerias with real coordinates
  const validPizzerias = useMemo(
    () =>
      pizzerias.filter(
        (p) => p.location && p.location.lat !== 0 && p.location.lng !== 0
      ),
    [pizzerias]
  );

  // napoletana-58547: markers for the keyless MapLibre (`osm`) render path.
  // Pizzeria pins are the 🍕 emoji with the name label below; the venue is the
  // Molto Benny mascot — mirroring the Google markers.
  const osmMarkers = useMemo<MapLibreMarker[]>(() => {
    if (isGoogleMaps()) return [];

    const buildPizzeriaPin = (name: string): HTMLElement => {
      const wrap = document.createElement('div');
      wrap.style.display = 'flex';
      wrap.style.flexDirection = 'column';
      wrap.style.alignItems = 'center';
      wrap.style.transform = 'translateY(-50%)';
      const emoji = document.createElement('div');
      emoji.textContent = '\u{1F355}';
      emoji.style.fontSize = '24px';
      emoji.style.lineHeight = '1';
      const label = document.createElement('div');
      label.textContent = name;
      label.style.color = '#ffffff';
      label.style.fontSize = '11px';
      label.style.fontWeight = '600';
      label.style.textShadow = '0 1px 2px rgba(0,0,0,0.85)';
      label.style.whiteSpace = 'nowrap';
      wrap.appendChild(emoji);
      wrap.appendChild(label);
      return wrap;
    };

    const buildVenuePin = (title: string): HTMLElement => {
      const img = document.createElement('img');
      img.src = '/molto-benny.png';
      img.width = 45;
      img.height = 45;
      img.style.width = '45px';
      img.style.height = '45px';
      img.alt = title;
      return img;
    };

    const list: MapLibreMarker[] = validPizzerias.map((p) => ({
      lat: p.location.lat,
      lng: p.location.lng,
      element: buildPizzeriaPin(p.name),
      title: p.name,
    }));

    if (venueLocation) {
      list.push({
        lat: venueLocation.lat,
        lng: venueLocation.lng,
        element: buildVenuePin(venueName || 'Venue'),
        title: venueName || 'Venue',
      });
    }
    return list;
  }, [validPizzerias, venueLocation, venueName]);

  useEffect(() => {
    // osm renders declaratively via <MapLibreMap> below — skip Google loading.
    if (!isGoogleMaps()) return;

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError(true);
      return;
    }

    // Nothing to draw — don't even try to load the map
    if (validPizzerias.length === 0) {
      return;
    }

    const initMap = () => {
      if (!containerRef.current) return;

      // Clean up any old markers from a previous render
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];

      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: validPizzerias[0]?.location || { lat: 40, lng: -100 },
          zoom: 14,
          mapTypeId: 'roadmap',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        });
      }

      const map = mapRef.current;
      const bounds = new google.maps.LatLngBounds();

      // Pizzeria pins (default red) with name labels drawn below the pin
      for (const pizzeria of validPizzerias) {
        const position = { lat: pizzeria.location.lat, lng: pizzeria.location.lng };
        const marker = new google.maps.Marker({
          position,
          map,
          title: pizzeria.name,
          clickable: false,
          label: {
            text: '\u{1F355}',
            fontSize: '24px',
          },
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 0,
          },
        });

        // Name label below the emoji pin
        const nameLabel = new google.maps.Marker({
          position,
          map,
          clickable: false,
          icon: {
            path: google.maps.SymbolPath.CIRCLE,
            scale: 0,
            labelOrigin: new google.maps.Point(0, 2.2),
          },
          label: {
            text: pizzeria.name,
            color: '#ffffff',
            fontSize: '11px',
            fontWeight: '600',
            className: 'pizzeria-pin-label',
          },
        });

        markersRef.current.push(marker, nameLabel);
        bounds.extend(position);
      }

      // Venue pin (Molto Benny mascot)
      if (venueLocation) {
        const venueMarker = new google.maps.Marker({
          position: venueLocation,
          map,
          title: venueName || 'Venue',
          clickable: false,
          icon: {
            url: '/molto-benny.png',
            scaledSize: new google.maps.Size(45, 45),
            anchor: new google.maps.Point(22, 45),
          },
        });
        markersRef.current.push(venueMarker);
        bounds.extend(venueLocation);
      }

      // Fit bounds — if only one marker, center with zoom 14 instead of
      // fitBounds (which can over-zoom on a single point).
      if (markersRef.current.length === 1) {
        const only = markersRef.current[0].getPosition();
        if (only) {
          map.setCenter(only);
          map.setZoom(14);
        }
      } else if (markersRef.current.length > 1) {
        map.fitBounds(bounds, 48);
      }
    };

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
  }, [validPizzerias, venueLocation, venueName]);

  // If we have nothing to show on the map, render nothing and let the parent
  // collapse the grid.
  if (validPizzerias.length === 0) {
    return null;
  }

  // ── osm branch: keyless MapLibre map ────────────────────────────────────────
  if (!isGoogleMaps()) {
    return (
      <MapLibreMap
        center={validPizzerias[0]?.location || { lat: 40, lng: -100 }}
        zoom={14}
        markers={osmMarkers}
        fitToMarkers
        fitPadding={48}
        fitMaxZoom={16}
        className="rounded-2xl overflow-hidden border border-theme-stroke"
        style={{ height, width: '100%' }}
        dataTestId="participating-pizzerias-map"
      />
    );
  }

  if (error) {
    const firstPizzeria = validPizzerias[0];
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center bg-theme-surface rounded-2xl border border-theme-stroke"
      >
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
            firstPizzeria.name + ' ' + firstPizzeria.address
          )}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[#ff393a] underline"
        >
          View pizzerias on Google Maps
        </a>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="participating-pizzerias-map"
      style={{ height, width: '100%' }}
      className="rounded-2xl overflow-hidden border border-theme-stroke"
    />
  );
}
