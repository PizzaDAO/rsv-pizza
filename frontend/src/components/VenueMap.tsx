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

      markerRef.current = new google.maps.Marker({
        position: location,
        map: mapRef.current,
        title: venueName || address,
        label: {
          text: '\u{1F389}',
          fontSize: '28px',
        },
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 0,
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
