import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { geocodeAddress, geocodeAddressGoogle } from '../lib/ordering';

interface VenueMapProps {
  address: string;
  venueName?: string;
  latitude?: number | null;
  longitude?: number | null;
  className?: string;
  zoom?: number;
}

// Module-scope singleton: ensures we only inject the Maps JS SDK once per
// page even when multiple <VenueMap> instances mount (EventPage renders 3:
// the mobile square thumbnail, the desktop side-by-side, and the mobile
// location section). Without this, each instance races to insert its own
// <script> and the SDK warns "You have included the Google Maps JavaScript
// API multiple times".
let mapsLoaderPromise: Promise<void> | null = null;

function loadGoogleMaps(apiKey: string): Promise<void> {
  if (typeof window !== 'undefined' && window.google?.maps) {
    return Promise.resolve();
  }
  if (mapsLoaderPromise) return mapsLoaderPromise;

  mapsLoaderPromise = new Promise<void>((resolve, reject) => {
    // Some other component on the page may have already inserted the script.
    // Wait for it to finish loading instead of duplicating it.
    const existingScript = document.querySelector(
      'script[src*="maps.googleapis.com/maps/api/js"]'
    );

    if (existingScript) {
      const waitForMaps = () => {
        if (window.google?.maps) {
          resolve();
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
    script.onload = () => resolve();
    script.onerror = () => {
      // Reset so a future mount can retry (e.g. transient network failure
      // during initial page load).
      mapsLoaderPromise = null;
      reject(new Error('Failed to load Google Maps JS SDK'));
    };
    document.head.appendChild(script);
  });

  return mapsLoaderPromise;
}

/**
 * Dynamic Google Maps JS SDK venue thumbnail with a single red pin at the
 * geocoded venue address. Uses the same dynamic-loader + script-tag-collision
 * pattern as ParticipatingPizzeriasMap.tsx / GPPMap.tsx. Fills its parent
 * container via `className` so callers control sizing (aspect-square, w-[40%]
 * absolute, w-full h-48, etc.).
 *
 * Geocoding pipeline (in priority order):
 *   1. Stored `latitude`/`longitude` props — no network call.
 *   2. `geocodeAddress` (Nominatim, OSM) — handles English/European addresses
 *      with no Google quota cost.
 *   3. `geocodeAddressGoogle` (Maps JS SDK Geocoder) — fallback for the long
 *      tail (CJK script, unusual transliterations) where Nominatim returns
 *      zero results.
 */
export default function VenueMap({
  address,
  venueName,
  latitude,
  longitude,
  className,
  zoom = 17,
}: VenueMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [error, setError] = useState(false);

  // Resolve coordinates: stored props → Nominatim → Google SDK Geocoder.
  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setLocation(null);
      return;
    }

    // Path 1: stored coordinates — no network call.
    if (latitude != null && longitude != null) {
      setLocation({ lat: latitude, lng: longitude });
      return;
    }

    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

    (async () => {
      try {
        // Path 2: Nominatim (free, no Google quota cost). Handles the
        // common case of English/European addresses.
        const nominatimResult = await geocodeAddress(address);
        if (cancelled) return;
        if (nominatimResult) {
          setLocation(nominatimResult);
          return;
        }

        // Path 3: Google SDK Geocoder fallback. Handles CJK-script
        // addresses (e.g. Shenzhen) and other long-tail cases where
        // Nominatim returns zero results. Skip if no API key, since
        // we couldn't render the map anyway.
        if (!apiKey) {
          setError(true);
          return;
        }
        await loadGoogleMaps(apiKey);
        if (cancelled) return;
        const googleResult = await geocodeAddressGoogle(address);
        if (cancelled) return;
        if (googleResult) {
          setLocation(googleResult);
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
  }, [address, latitude, longitude]);

  // Once we have coordinates, load the Google Maps JS SDK (if needed) and
  // render the map + single red marker.
  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError(true);
      return;
    }
    if (!location) return;

    let cancelled = false;

    const initMap = () => {
      if (cancelled || !containerRef.current) return;

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
        icon: {
          url: '/molto-benny.png',
          scaledSize: new google.maps.Size(54, 54),
          anchor: new google.maps.Point(27, 54),
        },
      });
    };

    loadGoogleMaps(apiKey)
      .then(() => initMap())
      .catch(() => {
        if (!cancelled) setError(true);
      });

    return () => {
      cancelled = true;
    };
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
