import React, { useRef, useEffect, useMemo, useState } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import type { SponsorDashboardEvent } from '../../types';

interface PartnerEventsMapProps {
  events: SponsorDashboardEvent[];
  height?: string;
}

export default function PartnerEventsMap({ events, height = '500px' }: PartnerEventsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validEvents = useMemo(
    () => events.filter(e => e.latitude && e.longitude && e.latitude !== 0 && e.longitude !== 0),
    [events]
  );

  useEffect(() => {
    const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      setError('Google Maps API key not configured');
      return;
    }

    const initMap = () => {
      if (!containerRef.current) return;

      // Cleanup previous
      markersRef.current.forEach(m => m.setMap(null));
      markersRef.current = [];
      if (clustererRef.current) {
        clustererRef.current.clearMarkers();
        clustererRef.current = null;
      }

      const map = new google.maps.Map(containerRef.current, {
        zoom: 2,
        center: { lat: 20, lng: 0 },
        styles: [
          { elementType: 'geometry', stylers: [{ color: '#1d2c4d' }] },
          { elementType: 'labels.text.fill', stylers: [{ color: '#8ec3b9' }] },
          { elementType: 'labels.text.stroke', stylers: [{ color: '#1a3646' }] },
          { featureType: 'water', elementType: 'geometry.fill', stylers: [{ color: '#0e1626' }] },
          { featureType: 'landscape', elementType: 'geometry', stylers: [{ color: '#1d3d2e' }] },
          { featureType: 'road', stylers: [{ visibility: 'off' }] },
          { featureType: 'transit', stylers: [{ visibility: 'off' }] },
          { featureType: 'poi', stylers: [{ visibility: 'off' }] },
        ],
      });
      mapRef.current = map;

      // InfoWindow CSS overrides (one-time)
      if (!document.getElementById('partner-map-iw-styles')) {
        const style = document.createElement('style');
        style.id = 'partner-map-iw-styles';
        style.textContent = `
          .gm-style-iw-c { background: #1a1a2e !important; border-radius: 12px !important; padding: 0 !important; }
          .gm-style-iw-d { overflow: hidden !important; padding: 16px !important; }
          .gm-style-iw-tc::after { background: #1a1a2e !important; }
          .gm-ui-hover-effect { top: 4px !important; right: 4px !important; }
          .gm-ui-hover-effect > span { background-color: white !important; }
        `;
        document.head.appendChild(style);
      }

      const infoWindow = new google.maps.InfoWindow();
      infoWindowRef.current = infoWindow;

      const bounds = new google.maps.LatLngBounds();

      const markers = validEvents.map(event => {
        const position = { lat: event.latitude!, lng: event.longitude! };
        bounds.extend(position);

        const marker = new google.maps.Marker({
          position,
          map,
          title: event.name,
          icon: {
            url: '/molto-benny.png',
            scaledSize: new google.maps.Size(32, 32),
          },
        });

        marker.addListener('click', () => {
          const dateStr = event.date
            ? new Date(event.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })
            : '';

          const content = `
            <div style="color: #fff; font-family: system-ui, sans-serif; min-width: 200px;">
              <div style="font-weight: 700; font-size: 14px; margin-bottom: 4px;">${event.name}</div>
              ${dateStr ? `<div style="color: rgba(255,255,255,0.6); font-size: 12px; margin-bottom: 6px;">${dateStr}</div>` : ''}
              ${event.venueName ? `<div style="color: rgba(255,255,255,0.8); font-size: 12px;">${event.venueName}</div>` : ''}
              ${event.address ? `<div style="color: rgba(255,255,255,0.5); font-size: 11px; margin-bottom: 6px;">${event.address}</div>` : ''}
              <div style="color: rgba(255,255,255,0.7); font-size: 12px; margin-bottom: 8px;">${event.rsvpCount} RSVPs</div>
              <a href="/${event.slug}" target="_blank" style="color: #E52828; font-size: 12px; text-decoration: none; font-weight: 600;">View Event \u2192</a>
            </div>
          `;
          infoWindow.setContent(content);
          infoWindow.open(map, marker);
        });

        markersRef.current.push(marker);
        return marker;
      });

      if (markers.length > 0) {
        clustererRef.current = new MarkerClusterer({ map, markers });
        map.fitBounds(bounds);
        // Don't zoom in too much for single markers
        const listener = google.maps.event.addListener(map, 'idle', () => {
          if (map.getZoom()! > 15) map.setZoom(15);
          google.maps.event.removeListener(listener);
        });
      }
    };

    // Load Google Maps script following GPPPizzeriasMap pattern
    if (window.google?.maps) {
      initMap();
      return;
    }

    const existingScript = document.querySelector('script[src*="maps.googleapis.com"]');
    if (existingScript) {
      const check = setInterval(() => {
        if (window.google?.maps) {
          clearInterval(check);
          initMap();
        }
      }, 100);
      return () => clearInterval(check);
    }

    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}`;
    script.async = true;
    script.defer = true;
    script.onload = () => initMap();
    script.onerror = () => setError('Failed to load Google Maps');
    document.head.appendChild(script);

    return () => {
      markersRef.current.forEach(m => m.setMap(null));
      if (clustererRef.current) clustererRef.current.clearMarkers();
    };
  }, [validEvents]);

  if (error) {
    return (
      <div className="bg-white/10 rounded-xl p-8 text-center">
        <p className="text-white/50">{error}</p>
      </div>
    );
  }

  return (
    <div>
      <div ref={containerRef} style={{ height, width: '100%', borderRadius: '12px' }} />
      {events.length > validEvents.length && (
        <p className="text-white/40 text-xs mt-2 text-center">
          Showing {validEvents.length} of {events.length} events on map
        </p>
      )}
    </div>
  );
}
