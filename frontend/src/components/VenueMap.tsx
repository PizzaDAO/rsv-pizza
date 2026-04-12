import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { geocodeAddress } from '../lib/ordering';

interface VenueMapProps {
  address: string;
  venueName?: string;
  className?: string;
  zoom?: number;
}

/**
 * Dynamic Google Maps JS SDK venue thumbnail with a single red pin at the
 * geocoded venue address. Uses the same dynamic-loader + script-tag-collision
 * pattern as ParticipatingPizzeriasMap.tsx / GPPMap.tsx. Fills its parent
 * container via `className` so callers control sizing (aspect-square, w-[40%]
 * absolute, w-full h-48, etc.).
 */
export default function VenueMap({
  address,
  venueName,
  className,
  zoom = 17,
}: VenueMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState(false);

  // Geocode the venue address once (or whenever it changes). We use the
  // existing `geocodeAddress` helper so behavior matches the distance badges
  // in ParticipatingPizzerias.
  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setLocation(null);
      return;
    }
    (async () => {
      try {
        const result = await geocodeAddress(address);
        if (cancelled) return;
        if (result) {
          setLocation(result);
        } else {
          setError(true);
        }
      } catch (err) {
        console.error('Failed to geocode venue address:', err);
        if (!cancelled) setError(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  // Once we have coordinates, load the Google Maps JS SDK (if needed) and
  // render the map + single red marker.
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError(true);
      return;
    }
    if (!location) return;

    const initMap = () => {
      if (!containerRef.current) return;

      if (!mapRef.current) {
        mapRef.current = new google.maps.Map(containerRef.current, {
          center: location,
          zoom,
          mapTypeId: 'roadmap',
          disableDefaultUI: true,
          zoomControl: true,
          gestureHandling: 'greedy',
        });
      } else {
        mapRef.current.setCenter(location);
        mapRef.current.setZoom(zoom);
      }

      // Clean up any previous marker before creating a new one
      if (markerRef.current) {
        markerRef.current.setMap(null);
        markerRef.current = null;
      }

      const pinSvg = `data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="36" height="48" viewBox="0 0 36 48"><path d="M18 0C8.06 0 0 8.06 0 18c0 12.6 18 30 18 30s18-17.4 18-30C36 8.06 27.94 0 18 0z" fill="white" stroke="black" stroke-opacity="0.15"/><circle cx="18" cy="17" r="11" fill="#ff393a"/><g transform="translate(11,10) scale(0.583)" stroke="white" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="none"><path d="M5.8 11.3 2 22l10.7-3.79"/><path d="M4 3h.01"/><path d="M22 8h.01"/><path d="M15 2h.01"/><path d="M22 20h.01"/><path d="M22 2l-2.24.75a2.9 2.9 0 0 0-1.96 3.12c.1.86-.57 1.63-1.45 1.63h-.38c-.86 0-1.6.6-1.76 1.44L14 10"/><path d="M22 13l-.82-.33c-.86-.34-1.82.2-1.98 1.11c-.11.7-.72 1.22-1.43 1.22H17"/><path d="M11 2l.33.82c.34.86-.2 1.82-1.11 1.98C9.52 4.9 9 5.52 9 6.23V7"/></g></svg>')}`;
      markerRef.current = new google.maps.Marker({
        position: location,
        map: mapRef.current,
        title: venueName || address,
        icon: {
          url: pinSvg,
          scaledSize: new google.maps.Size(36, 48),
          anchor: new google.maps.Point(18, 48),
        },
      });
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
  }, [location, venueName, address, zoom]);

  // No address → render a subtle placeholder so the parent layout still has
  // something to fill. Callers that want "nothing" can just not render the
  // component.
  if (!address) {
    return (
      <div
        className={`${className ?? ''} venue-map-thumbnail rounded-[inherit] bg-gradient-to-br from-[#ff393a]/20 to-[#ff6b35]/20 flex items-center justify-center`}
      >
        <MapPin className="w-12 h-12 text-theme-text" />
      </div>
    );
  }

  // Missing API key or geocoding failure → fallback placeholder that matches
  // the visual language of the old static-map "no key" state.
  if (error) {
    return (
      <div
        className={`${className ?? ''} venue-map-thumbnail rounded-[inherit] bg-gradient-to-br from-[#ff393a]/20 to-[#ff6b35]/20 flex items-center justify-center`}
      >
        <div className="text-center">
          <MapPin className="w-12 h-12 text-theme-text mx-auto mb-2" />
          <p className="text-theme-text text-sm font-medium">{venueName || 'Venue location'}</p>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="venue-map"
      className={`${className ?? ''} venue-map-thumbnail rounded-[inherit] overflow-hidden bg-theme-surface`}
    />
  );
}
