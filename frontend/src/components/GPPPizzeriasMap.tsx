import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { GPPPizzeriaMapItem } from '../lib/api';

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
          // Build star rating display
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

          // Truncate description
          let descHtml = '';
          if (pizzeria.description) {
            const truncated =
              pizzeria.description.length > 120
                ? pizzeria.description.slice(0, 120) + '...'
                : pizzeria.description;
            descHtml = `<p style="color:#555;font-size:12px;margin:4px 0;line-height:1.4">${truncated}</p>`;
          }

          // Website link
          let linkHtml = '';
          if (pizzeria.url) {
            linkHtml = `<a href="${pizzeria.url}" target="_blank" rel="noopener noreferrer" style="color:#E52828;font-size:12px;text-decoration:none;font-weight:500">Visit Website &rarr;</a>`;
          }

          // Photo from Google Places API
          const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
          let photoHtml = '';
          if (pizzeria.photoRef && apiKey) {
            const photoUrl = `https://places.googleapis.com/v1/${pizzeria.photoRef}/media?maxWidthPx=400&key=${apiKey}`;
            photoHtml = `<img src="${photoUrl}" alt="${pizzeria.name}" referrerpolicy="no-referrer" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px" />`;
          }

          const content = `
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

          infoWindow.setContent(content);
          infoWindow.open(map, marker);
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
