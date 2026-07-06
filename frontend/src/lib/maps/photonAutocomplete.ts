// napoletana-58547: keyless address autocomplete for the `osm` provider path.
//
// Primary: Photon (https://photon.komoot.io) — autocomplete-optimized, keyless,
// returns coords + a structured address. Fallback: Nominatim with
// addressdetails=1 when Photon is unreachable or returns nothing.
//
// Results are mapped to the existing `CityData` shape (exported from
// LocationAutocomplete.tsx) so callers need no changes, plus a locally-derived
// IANA timezone (Google's path got tz from the place; here we compute it offline
// from lat/lng via tz-lookup).

import tzlookup from 'tz-lookup';
import type { CityData } from '../../components/LocationAutocomplete';

export interface AddressResult extends CityData {
  timezone: string | null;
  // The most specific label (venue / street / city name). Useful for
  // establishment searches (e.g. pizzerias) where the caller wants a name
  // distinct from the city.
  name: string;
}

export const AUTOCOMPLETE_DEBOUNCE_MS = 300;
export const AUTOCOMPLETE_MIN_CHARS = 3;

const PHOTON_URL = 'https://photon.komoot.io/api';
const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

function safeTimezone(lat: number, lng: number): string | null {
  try {
    return tzlookup(lat, lng);
  } catch {
    return null;
  }
}

// ── Photon ────────────────────────────────────────────────────────────────
interface PhotonProps {
  name?: string;
  housenumber?: string;
  street?: string;
  city?: string;
  district?: string;
  county?: string;
  state?: string;
  country?: string;
  countrycode?: string;
  postcode?: string;
  type?: string;
}

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: PhotonProps;
}

function mapPhotonFeature(f: PhotonFeature): AddressResult | null {
  const coords = f.geometry?.coordinates;
  const p = f.properties;
  if (!coords || !p) return null;
  const lng = coords[0];
  const lat = coords[1];
  if (typeof lat !== 'number' || typeof lng !== 'number') return null;

  const city = p.city || p.district || p.county || '';
  const street = [p.housenumber, p.street].filter(Boolean).join(' ') || undefined;

  // Build a human-readable label. Photon `name` is the most specific label
  // (venue / street / city name); append the broader context.
  const label = [p.name, city && city !== p.name ? city : null, p.state, p.country]
    .filter((s): s is string => !!s && s.length > 0)
    .join(', ');

  return {
    cityName: city || p.name || '',
    country: p.country || '',
    countryCode: (p.countrycode || '').toUpperCase(),
    state: p.state || undefined,
    street,
    postalCode: p.postcode || undefined,
    lat,
    lng,
    formattedName: label || p.name || '',
    timezone: safeTimezone(lat, lng),
    name: p.name || city || '',
  };
}

async function searchPhoton(query: string, signal?: AbortSignal): Promise<AddressResult[]> {
  const url = `${PHOTON_URL}?q=${encodeURIComponent(query)}&limit=5`;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Photon ${res.status}`);
  const data = (await res.json()) as { features?: PhotonFeature[] };
  return (data.features || [])
    .map(mapPhotonFeature)
    .filter((r): r is AddressResult => r !== null);
}

// ── Nominatim (fallback) ────────────────────────────────────────────────────
interface NominatimAddress {
  house_number?: string;
  road?: string;
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
  postcode?: string;
}

interface NominatimResult {
  lat: string;
  lon: string;
  display_name?: string;
  name?: string;
  address?: NominatimAddress;
}

function mapNominatimResult(r: NominatimResult): AddressResult | null {
  const lat = parseFloat(r.lat);
  const lng = parseFloat(r.lon);
  if (Number.isNaN(lat) || Number.isNaN(lng)) return null;
  const a = r.address || {};
  const city = a.city || a.town || a.village || a.municipality || a.county || '';
  const street = [a.house_number, a.road].filter(Boolean).join(' ') || undefined;

  return {
    cityName: city || r.name || '',
    country: a.country || '',
    countryCode: (a.country_code || '').toUpperCase(),
    state: a.state || undefined,
    street,
    postalCode: a.postcode || undefined,
    lat,
    lng,
    formattedName: r.display_name || r.name || '',
    timezone: safeTimezone(lat, lng),
    name: r.name || city || '',
  };
}

async function searchNominatim(query: string, signal?: AbortSignal): Promise<AddressResult[]> {
  const url =
    `${NOMINATIM_URL}?format=json&addressdetails=1&limit=5&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    signal,
    headers: { 'User-Agent': 'RSV.Pizza/1.0' },
  });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as NominatimResult[];
  return (data || [])
    .map(mapNominatimResult)
    .filter((r): r is AddressResult => r !== null);
}

/**
 * Keyless address search. Tries Photon first, falls back to Nominatim on error
 * or empty result. Pass an AbortSignal to cancel an in-flight request when the
 * query changes. Aborts propagate (the caller should ignore AbortError).
 */
export async function searchAddresses(
  query: string,
  signal?: AbortSignal,
): Promise<AddressResult[]> {
  const q = query.trim();
  if (q.length < AUTOCOMPLETE_MIN_CHARS) return [];

  try {
    const photon = await searchPhoton(q, signal);
    if (photon.length > 0) return photon;
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // fall through to Nominatim
  }

  try {
    return await searchNominatim(q, signal);
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    return [];
  }
}
