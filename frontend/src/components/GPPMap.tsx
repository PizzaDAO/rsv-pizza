import { useEffect, useRef, useState } from 'react';

const KML_URL = 'https://www.google.com/maps/d/kml?mid=1ixyD2QbCZcz9IdK2gFKCNCz92hDDzEA';

interface GPPMapProps {
  height?: number;
  minZoom?: number;
  maxZoom?: number;
  initialZoom?: number;
}

export default function GPPMap({
  height = 500,
  minZoom = 3,
  maxZoom = 12,
  initialZoom = 3,
}: GPPMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError(true);
      return;
    }

    const initMap = () => {
      if (!containerRef.current || mapRef.current) return;

      const map = new google.maps.Map(containerRef.current, {
        center: { lat: 20, lng: 0 },
        zoom: initialZoom,
        minZoom,
        maxZoom,
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
          { featureType: 'administrative.country', elementType: 'geometry.stroke', stylers: [{ color: '#999' }] },
          { featureType: 'administrative.province', stylers: [{ visibility: 'off' }] },
        ],
      });

      new google.maps.KmlLayer({
        url: KML_URL,
        map,
        preserveViewport: true,
        suppressInfoWindows: false,
      });

      mapRef.current = map;
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
  }, [initialZoom, minZoom, maxZoom]);

  if (error) {
    return (
      <div style={{ height }} className="flex items-center justify-center bg-gray-100 rounded-2xl">
        <a
          href="https://www.google.com/maps/d/u/0/viewer?mid=1ixyD2QbCZcz9IdK2gFKCNCz92hDDzEA"
          target="_blank"
          rel="noopener noreferrer"
          className="text-blue-600 underline"
        >
          View map on Google Maps
        </a>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      data-testid="gpp-map"
      style={{ height, width: '100%' }}
      className="rounded-2xl"
    />
  );
}
