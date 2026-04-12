import { useEffect, useMemo, useRef, useState } from 'react';
import { Pizzeria } from '../types';

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

  useEffect(() => {
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

      // Venue pin (white pin, red circle, party popper icon)
      if (venueLocation) {
        const pinSvg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48"><path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="white" stroke="black" stroke-opacity="0.15"/><circle cx="18" cy="17" r="11" fill="#ff393a"/><g transform="translate(11,10) scale(0.583)" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="M22 2l-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="M22 13l-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="M11 2l.33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/></g></svg>')}`;
        const venueMarker = new google.maps.Marker({
          position: venueLocation,
          map,
          title: venueName || 'Venue',
          clickable: false,
          icon: {
            url: pinSvg,
            scaledSize: new google.maps.Size(36, 48),
            anchor: new google.maps.Point(18, 48),
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
