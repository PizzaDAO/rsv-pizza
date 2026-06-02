import { useEffect, useState } from 'react';
import { MapPin } from 'lucide-react';
import { geocodeAddress } from '../lib/ordering';

interface VenueMapProps {
  address: string;
  venueName?: string;
  latitude?: number | null;
  longitude?: number | null;
  className?: string;
  zoom?: number;
}

// Static Maps free-tier max dimension is 640. We render at 600x400 @ scale=2
// (retina) which still counts as one billable request. The <img> stretches
// via CSS to fill its parent — callers control the rendered pixel size via
// `className` exactly as before.
const STATIC_MAP_WIDTH = 600;
const STATIC_MAP_HEIGHT = 400;

/**
 * Venue thumbnail rendered as a cacheable Google Static Maps `<img>` tag
 * (billed ~$2/1k vs ~$7/1k for the Dynamic Maps JS SDK, AND the resulting
 * URL is browser/CDN-cacheable). Public API matches the previous
 * SDK-driven implementation: callers control rendered size via `className`
 * (aspect-square, w-[40%] absolute, w-full h-48, etc.) and we fall back to
 * `geocodeAddress(address)` when lat/lng aren't stored on the party.
 *
 * Tap-through opens the canonical Google Maps place card per the project's
 * URL convention (architecture_google_maps_url_action.md): `/maps/search/`
 * with `query` (the address, when available) or lat/lng as the fallback.
 * EventPage's outer link uses the placeId form when available; this in-image
 * link is the tap-target safety net for callers that don't wrap it themselves.
 */
export default function VenueMap({
  address,
  venueName,
  latitude,
  longitude,
  className,
  zoom = 17,
}: VenueMapProps) {
  const [location, setLocation] = useState<{ lat: number; lng: number } | null>(
    latitude != null && longitude != null ? { lat: latitude, lng: longitude } : null,
  );
  const [error, setError] = useState(false);

  // Use stored lat/lng if available; otherwise geocode the venue address.
  // Mirrors the distance-badge logic in ParticipatingPizzerias so behavior
  // is consistent across the EventPage.
  useEffect(() => {
    let cancelled = false;
    if (!address) {
      setLocation(null);
      return;
    }
    if (latitude != null && longitude != null) {
      setLocation({ lat: latitude, lng: longitude });
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
  }, [address, latitude, longitude]);

  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;

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
  if (error || !apiKey) {
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

  // Loading state: geocoding in flight, no lat/lng yet. Match the empty-address
  // placeholder visual so the parent container doesn't flash size/shape.
  if (!location) {
    return (
      <div
        data-testid="venue-map"
        className={`${className ?? ''} venue-map-thumbnail rounded-[inherit] bg-theme-surface flex items-center justify-center`}
      >
        <MapPin className="w-12 h-12 text-theme-text/40" />
      </div>
    );
  }

  // Lat/lng URL is cacheable (the address-string form is not, per Google's
  // Static Maps caching rules).
  const center = `${location.lat},${location.lng}`;
  const staticMapUrl =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${center}` +
    `&zoom=${zoom}` +
    `&size=${STATIC_MAP_WIDTH}x${STATIC_MAP_HEIGHT}` +
    `&scale=2` +
    `&maptype=roadmap` +
    `&markers=color:red%7C${center}` +
    `&key=${apiKey}`;

  // Canonical Google Maps place card. We don't have a `ChIJ…` placeId in
  // this component's prop surface, so use `query` alone (address preferred,
  // fall back to lat/lng).
  const googleMapsLink = address
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`
    : `https://www.google.com/maps/search/?api=1&query=${center}`;

  return (
    <a
      href={googleMapsLink}
      target="_blank"
      rel="noopener noreferrer"
      data-testid="venue-map"
      className={`${className ?? ''} venue-map-thumbnail block rounded-[inherit] overflow-hidden bg-theme-surface`}
      aria-label={`Open ${venueName || address} in Google Maps`}
    >
      <img
        src={staticMapUrl}
        alt={venueName || 'Venue map'}
        loading="lazy"
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
    </a>
  );
}
