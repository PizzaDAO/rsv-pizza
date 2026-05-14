import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { GPPEventMapItem } from '../lib/api';

interface GPPEventsMapProps {
  events: GPPEventMapItem[];
  height?: string;
}

export default function GPPEventsMap({
  events,
  height = '100%',
}: GPPEventsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [error, setError] = useState(false);

  // Filter out events with no valid coordinates
  const validEvents = useMemo(
    () =>
      events.filter(
        (e) =>
          e.latitude != null &&
          e.longitude != null &&
          !(e.latitude === 0 && e.longitude === 0)
      ),
    [events]
  );

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError(true);
      return;
    }

    if (validEvents.length === 0) return;

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

      // Inject InfoWindow style overrides once (light theme)
      if (!document.getElementById('events-map-iw-styles')) {
        const style = document.createElement('style');
        style.id = 'events-map-iw-styles';
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

      function buildInfoContent(event: GPPEventMapItem) {
        const dateHtml = event.date
          ? `<p style="color:#555;font-size:12px;margin:2px 0;font-weight:500">${new Date(
              event.date
            ).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              year: 'numeric',
            })}</p>`
          : '';

        const venueHtml = event.venueName
          ? `<p style="color:#555;font-size:12px;margin:2px 0">${event.venueName}</p>`
          : '';

        const addressHtml = event.address
          ? `<p style="color:#888;font-size:11px;margin:2px 0">${event.address}</p>`
          : '';

        const rsvpHtml = `<span style="background:#fef2f2;color:#E52828;font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:500">${event.rsvpCount.toLocaleString()} RSVPs</span>`;

        const linkHtml = `<a href="/${event.slug}" target="_blank" rel="noopener noreferrer" style="color:#E52828;font-size:12px;text-decoration:none;font-weight:500">View Event &rarr;</a>`;

        return `
          <div style="max-width:260px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:4px">
            <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1a1a1a">${event.name}</h3>
            ${dateHtml}
            ${venueHtml}
            ${addressHtml}
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${linkHtml}
              ${rsvpHtml}
            </div>
          </div>
        `;
      }

      // Build markers
      const markers: google.maps.Marker[] = [];
      const bounds = new google.maps.LatLngBounds();

      for (const event of validEvents) {
        const position = {
          lat: event.latitude as number,
          lng: event.longitude as number,
        };
        bounds.extend(position);

        const marker = new google.maps.Marker({
          position,
          title: event.name,
          icon: {
            url: '/molto-benny-btc.svg',
            scaledSize: new google.maps.Size(38, 38),
            anchor: new google.maps.Point(19, 38),
          },
        });

        marker.addListener('click', () => {
          infoWindow.setContent(buildInfoContent(event));
          infoWindow.open(map, marker);
        });

        markers.push(marker);
      }

      markersRef.current = markers;

      // Create clusterer with red bubbles (Benny's shoe color: #FF0029)
      clustererRef.current = new MarkerClusterer({
        map,
        markers,
        renderer: {
          render: ({ count, position }) => {
            const svg = window.btoa(`
              <svg fill="#FF0029" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240">
                <circle cx="120" cy="120" opacity=".6" r="70" />
                <circle cx="120" cy="120" opacity=".3" r="90" />
                <circle cx="120" cy="120" opacity=".2" r="110" />
                <circle cx="120" cy="120" opacity=".1" r="130" />
              </svg>
            `);
            return new google.maps.Marker({
              position,
              icon: {
                url: `data:image/svg+xml;base64,${svg}`,
                scaledSize: new google.maps.Size(45, 45),
              },
              label: {
                text: String(count),
                color: 'rgba(255,255,255,0.9)',
                fontSize: '12px',
                fontWeight: '600',
              },
              title: `${count} events`,
              zIndex: Number(google.maps.Marker.MAX_ZINDEX) + count,
            });
          },
        },
      });

      // Fit bounds to all markers, then cap zoom at 15 on idle
      if (markers.length > 0) {
        map.fitBounds(bounds);
        const listener = google.maps.event.addListener(map, 'idle', () => {
          if ((map.getZoom() ?? 0) > 15) map.setZoom(15);
          google.maps.event.removeListener(listener);
        });
      }
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
  }, [validEvents]);

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
      data-testid="gpp-events-map"
      style={{ height, width: '100%' }}
    />
  );
}
