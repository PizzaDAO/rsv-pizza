import { useEffect, useMemo, useState } from 'react';
import { MapPin, Star, Phone, Link as LinkIcon } from 'lucide-react';
import { Pizzeria } from '../types';
import {
  geocodeAddress,
  calculateDistanceMiles,
  formatDistanceMiles,
} from '../lib/ordering';
import { trackLinkClick } from '../lib/api';
import ParticipatingPizzeriasMap from './ParticipatingPizzeriasMap';

interface ParticipatingPizzeriasProps {
  pizzerias: Pizzeria[];
  venueAddress: string | null;
  eventSlug: string | undefined;
}

/**
 * Extract a reasonable city label from a full address string.
 *
 * Examples:
 *   "123 Main St, Detroit, MI 48201, USA" → "Detroit"
 *   "221B Baker Street, London NW1 6XE, UK" → null (no clear city segment)
 *   ""                                   → null
 *
 * Strategy: split on commas, take the second segment (typical Google-formatted
 * address has the city in position 1), strip leading numbers / zip codes, and
 * reject obviously-wrong results (empty, all-numeric, or still contains street
 * suffixes like "St"/"Ave"/"Blvd"). Any reject → null → parent falls back to
 * plain "Participating Pizzerias".
 */
export function extractCityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const parts = address.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  // Typical formats:
  //   "<street>, <city>, <state zip>, <country>"         (US)
  //   "<street>, <city>, <country>"                      (intl, 3 parts)
  // Grab the second segment.
  const candidate = parts[1]
    // Strip leading ZIP / house number
    .replace(/^\d+[\s-]*/, '')
    .trim();

  if (!candidate) return null;
  // Reject all-numeric
  if (/^\d+$/.test(candidate)) return null;
  // Reject street-suffix junk (the split landed mid-street)
  if (/\b(st|street|ave|avenue|blvd|boulevard|rd|road|dr|drive|ln|lane|way|pl|place|ct|court|pkwy|parkway)\b\.?$/i.test(candidate)) {
    return null;
  }
  // Reject if it looks like a state+zip line (e.g. "MI 48201")
  if (/^[A-Z]{2}\s+\d{4,}$/.test(candidate)) return null;

  return candidate;
}

export function ParticipatingPizzerias({
  pizzerias,
  venueAddress,
  eventSlug,
}: ParticipatingPizzeriasProps) {
  const [venueLocation, setVenueLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Geocode the venue address for distance badges on the pizzeria list.
  useEffect(() => {
    let cancelled = false;
    if (!venueAddress) {
      setVenueLocation(null);
      return;
    }
    (async () => {
      try {
        const result = await geocodeAddress(venueAddress);
        if (!cancelled) setVenueLocation(result);
      } catch (err) {
        console.error('Failed to geocode venue address:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [venueAddress]);

  const cityLabel = useMemo(() => extractCityFromAddress(venueAddress), [venueAddress]);

  const hasAnyCoords = useMemo(
    () => pizzerias.some((p) => p.location && p.location.lat !== 0 && p.location.lng !== 0),
    [pizzerias]
  );

  if (!pizzerias || pizzerias.length === 0) return null;

  const sectionLabel = cityLabel
    ? `Participating ${cityLabel} Pizzerias`
    : 'Participating Pizzerias';

  const handleLinkClick = (url: string, pizzeriaName: string) => {
    if (eventSlug) {
      trackLinkClick(eventSlug, url, 'pizzeria', pizzeriaName);
    }
  };

  return (
    <div className="border-t border-theme-stroke pt-6 mt-6">
      <div className="card p-4 sm:p-6">
        {/* Header — matches MusicWidget header style */}
        <div className="flex items-center gap-3 mb-4">
          <MapPin size={20} className="text-[#ff393a]" />
          <h2 className="text-lg font-semibold text-theme-text">{sectionLabel}</h2>
        </div>

        <div className={hasAnyCoords ? 'grid md:grid-cols-2 gap-4' : ''}>
          {hasAnyCoords && (
            <div>
              <ParticipatingPizzeriasMap pizzerias={pizzerias} />
            </div>
          )}

          <div className="space-y-3">
            {pizzerias.map((pizzeria) => {
              const hasCoords =
                pizzeria.location && pizzeria.location.lat !== 0 && pizzeria.location.lng !== 0;
              const showDistance = venueLocation && hasCoords;
              return (
                <div
                  key={pizzeria.id}
                  className="flex items-start gap-3 p-3 bg-theme-surface rounded-xl border border-theme-stroke"
                >
                  <div className="w-10 h-10 rounded-full bg-[#ff393a]/20 flex items-center justify-center flex-shrink-0">
                    <MapPin className="w-5 h-5 text-[#ff393a]" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-theme-text font-medium truncate">{pizzeria.name}</p>
                      {pizzeria.rating && (
                        <span className="flex items-center gap-1 text-xs text-yellow-400">
                          <Star size={12} className="fill-yellow-400" />
                          {pizzeria.rating.toFixed(1)}
                        </span>
                      )}
                      {showDistance && (
                        <span className="text-xs text-theme-text-muted">
                          {formatDistanceMiles(
                            calculateDistanceMiles(
                              venueLocation!.lat,
                              venueLocation!.lng,
                              pizzeria.location.lat,
                              pizzeria.location.lng
                            )
                          )}
                        </span>
                      )}
                    </div>
                    {pizzeria.address && (
                      <p className="text-theme-text-muted text-xs mt-0.5">{pizzeria.address}</p>
                    )}
                    {(pizzeria.url || pizzeria.phone) && (
                      <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                        {pizzeria.url && (
                          <a
                            href={pizzeria.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[#ff393a]/80 hover:text-[#ff393a] text-xs flex items-center gap-1"
                            onClick={() => handleLinkClick(pizzeria.url!, pizzeria.name)}
                          >
                            <LinkIcon size={10} />
                            Website
                          </a>
                        )}
                        {pizzeria.phone && (
                          <a
                            href={`tel:${pizzeria.phone}`}
                            className="text-theme-text-muted hover:text-theme-text text-xs flex items-center gap-1"
                            onClick={() =>
                              handleLinkClick(`tel:${pizzeria.phone}`, pizzeria.name)
                            }
                          >
                            <Phone size={10} />
                            {pizzeria.phone}
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default ParticipatingPizzerias;
