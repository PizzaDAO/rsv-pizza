/**
 * sec-edge-functions-2: pizzeria search, moved off the anon-callable `search-pizzerias` edge
 * function. Used by POST /api/ordering/search-pizzerias and called directly (no HTTP hop) by
 * autoPopulatePizzerias.
 *
 * Env (all optional; read per call):
 *   MAP_PROVIDER           'osm' (default, keyless Overpass) | 'google'
 *   GOOGLE_PLACES_API_KEY  required only when MAP_PROVIDER=google
 *   BLAND_API_KEY          when set, pizzerias with a phone get an `ai_phone` ordering option
 */

export interface OrderingOption {
  provider: string;
  available: boolean;
  merchantId?: string;
}

export interface Pizzeria {
  id: string;
  placeId: string;
  name: string;
  address: string;
  phone?: string;
  url?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  isOpen?: boolean;
  distance: number;
  location: { lat: number; lng: number };
  description?: string;
  orderingOptions: OrderingOption[];
}

export class PizzeriaSearchError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
    this.name = 'PizzeriaSearchError';
  }
}

export const MAX_RADIUS_M = 50_000;
export const DEFAULT_RADIUS_M = 5000;

// chorizo-72831: in-memory cache so identical coords don't re-bill Google Places.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;
const responseCache = new Map<string, { payload: Pizzeria[]; expiresAt: number }>();

export function clearPizzeriaCache(): void {
  responseCache.clear();
}

function cacheKey(lat: number, lng: number, radius: number, provider: string): string {
  return `${provider}_${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`;
}

function getCached(key: string): Pizzeria[] | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.payload;
}

function setCached(key: string, payload: Pizzeria[]): void {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

const FETCH_TIMEOUT_MS = 10_000;

/** fetch with an abort timeout; a timeout becomes PizzeriaSearchError(504) with no upstream text. */
async function fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err: any) {
    if (controller.signal.aborted || err?.name === 'AbortError') {
      throw new PizzeriaSearchError('Pizzeria search timed out', 504);
    }
    throw new PizzeriaSearchError('Pizzeria search provider error', 502);
  } finally {
    clearTimeout(timer);
  }
}

const toRad = (deg: number) => deg * (Math.PI / 180);

/** Haversine distance in meters. */
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const PRICE_LEVELS: Record<string, number> = {
  PRICE_LEVEL_FREE: 0,
  PRICE_LEVEL_INEXPENSIVE: 1,
  PRICE_LEVEL_MODERATE: 2,
  PRICE_LEVEL_EXPENSIVE: 3,
  PRICE_LEVEL_VERY_EXPENSIVE: 4,
};

async function searchGooglePlaces(lat: number, lng: number, radius: number, apiKey: string): Promise<Pizzeria[]> {
  const response = await fetchWithTimeout('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': apiKey,
      'X-Goog-FieldMask':
        'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.nationalPhoneNumber,places.websiteUri,places.editorialSummary',
    },
    body: JSON.stringify({
      includedTypes: ['pizza_restaurant', 'italian_restaurant'],
      maxResultCount: 20,
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    }),
  });
  const data: any = await response.json().catch(() => ({}));
  if (data.error) {
    console.error('Google Places API error:', data.error);
    throw new PizzeriaSearchError('Pizzeria search provider error');
  }
  return (data.places || [])
    .filter((p: any) => p?.location && typeof p.location.latitude === 'number')
    .map((place: any) => ({
      id: place.id,
      placeId: place.id,
      name: place.displayName?.text || 'Unknown',
      address: place.formattedAddress || '',
      phone: place.nationalPhoneNumber,
      url: place.websiteUri,
      rating: place.rating,
      reviewCount: place.userRatingCount,
      priceLevel: PRICE_LEVELS[place.priceLevel] || undefined,
      isOpen: place.currentOpeningHours?.openNow,
      distance: Math.round(calculateDistance(lat, lng, place.location.latitude, place.location.longitude)),
      location: { lat: place.location.latitude, lng: place.location.longitude },
      description: place.editorialSummary?.text || undefined,
      orderingOptions: [],
    }));
}

// napoletana-58547: keyless OpenStreetMap search via Overpass. lat/lng/radius are validated
// numbers (see parseSearchInput), so interpolating them into the query is safe.
async function searchOverpassPizzerias(lat: number, lng: number, radius: number): Promise<Pizzeria[]> {
  const query = `[out:json][timeout:15];
( node["amenity"~"restaurant|fast_food"]["cuisine"~"pizza",i](around:${radius},${lat},${lng});
  way ["amenity"~"restaurant|fast_food"]["cuisine"~"pizza",i](around:${radius},${lat},${lng}); );
out center 20;`;

  const response = await fetchWithTimeout('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    // overpass-api.de answers 406 to requests without an identifying User-Agent (Node's default is rejected).
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'rsv.pizza/1.0 (+https://rsv.pizza)',
      Accept: 'application/json',
    },
    body: `data=${encodeURIComponent(query)}`,
  });
  if (!response.ok) {
    console.error('Overpass API error:', response.status);
    throw new PizzeriaSearchError('Pizzeria search provider error');
  }
  const data: any = await response.json();

  return (data.elements || [])
    .filter((el: any) => {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      return el.tags?.name && typeof elLat === 'number' && typeof elLng === 'number';
    })
    .map((el: any) => {
      const tags = el.tags || {};
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      const address = [
        [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
        tags['addr:city'],
      ]
        .filter(Boolean)
        .join(', ');
      return {
        id: `osm/${el.type}/${el.id}`,
        placeId: `osm/${el.type}/${el.id}`,
        name: tags.name,
        address,
        phone: tags.phone || tags['contact:phone'],
        url: tags.website || tags['contact:website'],
        distance: Math.round(calculateDistance(lat, lng, elLat, elLng)),
        location: { lat: elLat, lng: elLng },
        orderingOptions: [],
      };
    });
}

function generateOrderingOptions(p: Pizzeria): OrderingOption[] {
  const options: OrderingOption[] = [];
  if (process.env.BLAND_API_KEY && p.phone) options.push({ provider: 'ai_phone', available: true });
  if (p.phone) options.push({ provider: 'phone', available: true });
  return options;
}

/** Validates raw input; throws PizzeriaSearchError(400). */
export function parseSearchInput(body: any): { lat: number; lng: number; radius: number } {
  const { lat, lng } = body || {};
  let { radius } = body || {};
  if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    throw new PizzeriaSearchError('lat and lng are required numbers', 400);
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    throw new PizzeriaSearchError('lat/lng out of range', 400);
  }
  if (radius === undefined || radius === null) radius = DEFAULT_RADIUS_M;
  if (typeof radius !== 'number' || !Number.isFinite(radius) || radius < 100 || radius > MAX_RADIUS_M) {
    throw new PizzeriaSearchError(`radius must be between 100 and ${MAX_RADIUS_M} meters`, 400);
  }
  return { lat, lng, radius: Math.round(radius) };
}

export async function searchPizzerias(lat: number, lng: number, radius: number = DEFAULT_RADIUS_M): Promise<Pizzeria[]> {
  const provider = (process.env.MAP_PROVIDER || 'osm').toLowerCase() === 'google' ? 'google' : 'osm';
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || '';
  if (provider === 'google' && !apiKey) {
    throw new PizzeriaSearchError('Pizzeria search is not configured', 503);
  }

  const key = cacheKey(lat, lng, radius, provider);
  const cached = getCached(key);
  if (cached) return cached;

  const pizzerias =
    provider === 'google'
      ? await searchGooglePlaces(lat, lng, radius, apiKey)
      : await searchOverpassPizzerias(lat, lng, radius);

  for (const p of pizzerias) p.orderingOptions.push(...generateOrderingOptions(p));

  // weighted score: rating * log10(reviewCount + 1)
  const score = (p: Pizzeria) => (p.rating || 0) * Math.log10((p.reviewCount || 0) + 1);
  pizzerias.sort((a, b) => score(b) - score(a));

  setCached(key, pizzerias);
  return pizzerias;
}
