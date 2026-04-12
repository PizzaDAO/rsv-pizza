import { useEffect, useMemo, useRef, useState } from 'react';
import { Pizzeria } from '../types';

interface ParticipatingPizzeriasMapProps {
  pizzerias: Pizzeria[];
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
            text: pizzeria.name,
            color: '#ffffff',
            fontSize: '12px',
            fontWeight: '600',
            className: 'pizzeria-pin-label',
          },
        });

        markersRef.current.push(marker);
        bounds.extend(position);
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
  }, [validPizzerias]);

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
