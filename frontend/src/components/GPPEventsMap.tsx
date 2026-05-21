import { useEffect, useMemo, useRef, useState } from 'react';
import { MarkerClusterer } from '@googlemaps/markerclusterer';
import { GPPEventMapItem, updateUnderbossStatus } from '../lib/api';

// Lucide "send" icon SVG, inlined for use inside the InfoWindow HTML string.
const SEND_ICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/></svg>`;

interface GPPEventsMapProps {
  events: GPPEventMapItem[];
  cityChats?: Map<string, string>;
  height?: string;
  canModerate?: boolean;
  // When true, markers are rendered as status-colored circles (admin/underboss
  // view). When false, the public Benny pizza icon is used to preserve brand on
  // the public /map view. Defaults to false so the public landing page stays
  // on-brand even if a caller forgets to pass it.
  isModerator?: boolean;
  // Optional overrides for the non-moderator pin icon. Defaults preserve the
  // existing public /map behavior (Molto Benny pizza pin). Used by /map/swc to
  // swap in the composite Benny + SWC shield pin (cacciatore-72814).
  iconUrl?: string;
  iconWidth?: number;
  iconHeight?: number;
  iconAnchorX?: number;
  iconAnchorY?: number;
}

// Semantic colors keyed on underbossStatus. Keep in sync with STATUS_LEGEND
// in EventsMapPage.tsx so the legend matches the marker colors.
const STATUS_COLORS: Record<string, string> = {
  approved: '#22c55e',
  listed: '#3b82f6',
  pending: '#eab308',
  rejected: '#ef4444',
  hidden: '#6b7280',
};

function statusColor(status?: string | null): string {
  if (!status) return STATUS_COLORS.pending;
  return STATUS_COLORS[status] || STATUS_COLORS.pending;
}

function makeMarkerIcon(status?: string | null): google.maps.Icon {
  const color = statusColor(status);
  const svg = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">` +
      `<circle cx="16" cy="16" r="11" fill="${color}" stroke="white" stroke-width="3"/>` +
      `</svg>`
  );
  return {
    url: `data:image/svg+xml;utf8,${svg}`,
    scaledSize: new google.maps.Size(32, 32),
    anchor: new google.maps.Point(16, 16),
  };
}

export default function GPPEventsMap({
  events,
  cityChats = new Map(),
  height = '100%',
  canModerate = false,
  isModerator = false,
  iconUrl = '/molto-benny-btc.svg',
  iconWidth = 38,
  iconHeight = 38,
  iconAnchorX = 19,
  iconAnchorY = 38,
}: GPPEventsMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markersRef = useRef<google.maps.Marker[]>([]);
  const markerByEventIdRef = useRef<Map<string, google.maps.Marker>>(new Map());
  const eventByIdRef = useRef<Map<string, GPPEventMapItem>>(new Map());
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const infoWindowRef = useRef<google.maps.InfoWindow | null>(null);
  const infoWindowListenerRef = useRef<google.maps.MapsEventListener | null>(
    null
  );
  const mapClickListenerRef = useRef<google.maps.MapsEventListener | null>(null);
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

      // Populate event lookup ref (kept in sync with marker rebuild)
      const eventIndex = new Map<string, GPPEventMapItem>();
      for (const ev of validEvents) {
        eventIndex.set(ev.id, ev);
      }
      eventByIdRef.current = eventIndex;

      // Clean up previous markers & clusterer
      markersRef.current.forEach((m) => m.setMap(null));
      markersRef.current = [];
      markerByEventIdRef.current.clear();
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

        const linkLabel = canModerate ? 'View Event &rarr;' : 'RSVP &rarr;';
        const linkHtml = `<a href="/${event.slug}" target="_blank" rel="noopener noreferrer" style="color:#E52828;font-size:12px;text-decoration:none;font-weight:500">${linkLabel}</a>`;

        const cityKey = event.name.replace(/^Global Pizza Party\s*/i, '').trim().toLowerCase();
        const telegramUrlRaw = event.telegramGroup || cityChats.get(cityKey) || null;
        const telegramUrl = telegramUrlRaw ? telegramUrlRaw.replace(/"/g, '&quot;') : null;
        const telegramHtml = telegramUrl
          ? `<a href="${telegramUrl}" target="_blank" rel="noopener noreferrer" style="color:#29B6F6;font-size:12px;text-decoration:none;font-weight:500">Telegram &rarr;</a>`
          : '';

        const sanitizeHandle = (raw: string | null | undefined): string | null => {
          if (!raw) return null;
          const stripped = raw.trim().replace(/^@/, '');
          if (!/^[A-Za-z0-9_]{3,40}$/.test(stripped)) return null;
          return stripped;
        };

        const hostTgHandles: string[] = [];
        if (canModerate) {
          const primary = sanitizeHandle(event.hostTelegram);
          if (primary) hostTgHandles.push(primary);
          for (const raw of event.coHostTelegrams || []) {
            if (hostTgHandles.length >= 2) break;
            const h = sanitizeHandle(raw);
            if (h && !hostTgHandles.includes(h)) hostTgHandles.push(h);
          }
        }

        const hostTgIconsHtml = hostTgHandles
          .map(
            (h) =>
              `<a href="https://t.me/${h}" target="_blank" rel="noopener noreferrer" title="DM @${h} on Telegram" style="color:#29B6F6;display:inline-flex;align-items:center;text-decoration:none">${SEND_ICON_SVG}</a>`
          )
          .join('');

        let actionsHtml = '';
        if (canModerate) {
          // Status pill — shown for every moderator-visible event so the
          // marker color is interpretable in the InfoWindow too.
          const statusKey = event.underbossStatus || 'pending';
          const statusColorHex = statusColor(statusKey);
          const statusPillHtml = `<span style="background:${statusColorHex}1a;color:${statusColorHex};font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:600;text-transform:capitalize">${statusKey}</span>`;
          const rsvpPillHtml = `<span style="background:#fef2f2;color:#E52828;font-size:11px;padding:2px 8px;border-radius:9999px;font-weight:500">${event.rsvpCount.toLocaleString()} RSVPs</span>`;
          if (statusKey === 'approved') {
            actionsHtml = `
              ${statusPillHtml}
              ${hostTgIconsHtml}
              ${rsvpPillHtml}
              <button data-action="reject" data-event-id="${event.id}" style="background:none;border:none;color:#dc2626;font-size:11px;text-decoration:underline;cursor:pointer;padding:0">Mark rejected</button>
            `;
          } else if (statusKey === 'rejected') {
            actionsHtml = `
              ${statusPillHtml}
              ${hostTgIconsHtml}
              ${rsvpPillHtml}
              <button data-action="approve" data-event-id="${event.id}" style="background:none;border:none;color:#16a34a;font-size:11px;text-decoration:underline;cursor:pointer;padding:0">Mark approved</button>
            `;
          } else {
            actionsHtml = `
              ${statusPillHtml}
              ${hostTgIconsHtml}
              ${rsvpPillHtml}
              <button data-action="approve" data-event-id="${event.id}" style="background:#16a34a;color:white;border:none;font-size:12px;padding:4px 12px;border-radius:8px;font-weight:600;cursor:pointer">Approve</button>
              <button data-action="reject" data-event-id="${event.id}" style="background:#dc2626;color:white;border:none;font-size:12px;padding:4px 12px;border-radius:8px;font-weight:600;cursor:pointer">Reject</button>
            `;
          }
        }

        const actionsRowHtml = canModerate
          ? `<div style="margin-top:8px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${actionsHtml}</div>`
          : '';

        return `
          <div style="max-width:260px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;padding:4px">
            <h3 style="margin:0 0 4px;font-size:15px;font-weight:700;color:#1a1a1a">${event.name}</h3>
            ${dateHtml}
            ${venueHtml}
            ${addressHtml}
            <div style="margin-top:6px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              ${linkHtml}
              ${telegramHtml}
            </div>
            ${actionsRowHtml}
          </div>
        `;
      }

      async function onActionClick(e: Event) {
        const button = e.currentTarget as HTMLButtonElement;
        const action = button.dataset.action as 'approve' | 'reject';
        const eventId = button.dataset.eventId;
        if (!action || !eventId) return;

        const actionButtons = document.querySelectorAll<HTMLButtonElement>(
          '[data-action][data-event-id]'
        );
        const originalText = button.textContent;
        actionButtons.forEach((b) => {
          b.disabled = true;
        });
        button.textContent = 'Saving…';

        try {
          await updateUnderbossStatus(
            eventId,
            action === 'approve' ? 'approved' : 'rejected'
          );
        } catch (err) {
          alert((err as Error).message || 'Failed to update');
          actionButtons.forEach((b) => {
            b.disabled = false;
          });
          button.textContent = originalText;
          return;
        }

        const current = eventByIdRef.current.get(eventId);
        if (!current) return;
        const updated: GPPEventMapItem = {
          ...current,
          underbossStatus: action === 'approve' ? 'approved' : 'rejected',
        };

        // Mutate ref directly — no state update, so no useEffect re-run
        eventByIdRef.current.set(eventId, updated);

        infoWindow.setContent(buildInfoContent(updated));

        if (isModerator) {
          const marker = markerByEventIdRef.current.get(eventId);
          if (marker) {
            // Update the marker icon to reflect the new status color
            marker.setIcon(makeMarkerIcon(updated.underbossStatus));
          }
        }
      }

      function attachActionHandlers() {
        if (!canModerate) return;
        const buttons = document.querySelectorAll<HTMLButtonElement>(
          '[data-action][data-event-id]'
        );
        buttons.forEach((b) => {
          b.addEventListener('click', onActionClick);
        });
      }

      if (infoWindowListenerRef.current) {
        infoWindowListenerRef.current.remove();
        infoWindowListenerRef.current = null;
      }
      if (canModerate) {
        infoWindowListenerRef.current = infoWindow.addListener(
          'domready',
          attachActionHandlers
        );
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
          icon: isModerator
            ? makeMarkerIcon(event.underbossStatus)
            : {
                url: iconUrl,
                scaledSize: new google.maps.Size(iconWidth, iconHeight),
                anchor: new google.maps.Point(iconAnchorX, iconAnchorY),
              },
        });

        const eventId = event.id;
        marker.addListener('click', () => {
          const latest = eventByIdRef.current.get(eventId) ?? event;
          // Close first so setContent() doesn't trigger auto-pan against the
          // previous anchor (which causes the "zoom back to old card" jitter).
          infoWindow.close();
          infoWindow.setContent(buildInfoContent(latest));
          infoWindow.open({ map, anchor: marker });
        });

        markers.push(marker);
        markerByEventIdRef.current.set(event.id, marker);
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

      if (mapClickListenerRef.current) {
        mapClickListenerRef.current.remove();
        mapClickListenerRef.current = null;
      }
      mapClickListenerRef.current = map.addListener('click', () => {
        infoWindow.close();
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
  }, [validEvents, cityChats, canModerate, isModerator, iconUrl, iconWidth, iconHeight, iconAnchorX, iconAnchorY]);

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
