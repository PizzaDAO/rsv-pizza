import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Pizzeria, OrderingOption } from '../_shared/types.ts';

// napoletana-58547: pluggable map provider. 'osm' = keyless Overpass (default while
// the Google key is down), 'google' = existing Google Places path. Flip via the
// MAP_PROVIDER Supabase secret with zero code change.
const MAP_PROVIDER = (Deno.env.get('MAP_PROVIDER') || 'osm').toLowerCase(); // 'google' | 'osm'

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || '';
const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') || '';
const BLAND_API_KEY = Deno.env.get('BLAND_API_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// chorizo-72831: in-memory cache to avoid re-billing Google Places for the same coords.
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_MAX_ENTRIES = 1000;
interface CacheEntry { payload: unknown; expiresAt: number; }
const responseCache = new Map<string, CacheEntry>();

function cacheKey(lat: number, lng: number, radius: number): string {
  return `${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`;
}

function getCached(key: string): unknown | null {
  const entry = responseCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    responseCache.delete(key);
    return null;
  }
  // refresh LRU position
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.payload;
}

function setCached(key: string, payload: unknown): void {
  if (responseCache.size >= CACHE_MAX_ENTRIES) {
    const oldest = responseCache.keys().next().value;
    if (oldest) responseCache.delete(oldest);
  }
  responseCache.set(key, { payload, expiresAt: Date.now() + CACHE_TTL_MS });
}

interface SearchRequest {
  lat: number;
  lng: number;
  radius?: number; // meters, default 5000
}

// Search Google Places for nearby pizzerias using Places API (New)
async function searchGooglePlaces(lat: number, lng: number, radius: number): Promise<Pizzeria[]> {
  const url = 'https://places.googleapis.com/v1/places:searchNearby';

  const requestBody = {
    includedTypes: ['pizza_restaurant', 'italian_restaurant'],
    maxResultCount: 20,
    locationRestriction: {
      circle: {
        center: { latitude: lat, longitude: lng },
        radius: radius
      }
    }
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.nationalPhoneNumber,places.websiteUri,places.editorialSummary'
    },
    body: JSON.stringify(requestBody)
  });

  const data = await response.json();

  if (data.error) {
    console.error('Google Places API error:', data.error);
    throw new Error(`Google Places API error: ${data.error.message || data.error.status}`);
  }

  const pizzerias: Pizzeria[] = (data.places || []).map((place: any) => {
    // Calculate distance from search point
    const distance = calculateDistance(
      lat, lng,
      place.location.latitude,
      place.location.longitude
    );

    // Map price level from new API format
    const priceLevelMap: Record<string, number> = {
      'PRICE_LEVEL_FREE': 0,
      'PRICE_LEVEL_INEXPENSIVE': 1,
      'PRICE_LEVEL_MODERATE': 2,
      'PRICE_LEVEL_EXPENSIVE': 3,
      'PRICE_LEVEL_VERY_EXPENSIVE': 4,
    };

    return {
      id: place.id,
      placeId: place.id,
      name: place.displayName?.text || 'Unknown',
      address: place.formattedAddress || '',
      phone: place.nationalPhoneNumber,
      url: place.websiteUri,
      rating: place.rating,
      reviewCount: place.userRatingCount,
      priceLevel: priceLevelMap[place.priceLevel] || undefined,
      isOpen: place.currentOpeningHours?.openNow,
      distance: Math.round(distance),
      location: {
        lat: place.location.latitude,
        lng: place.location.longitude,
      },
      description: place.editorialSummary?.text || undefined,
      orderingOptions: [], // Will be populated by checkOrderingOptions
    };
  });

  return pizzerias;
}

// napoletana-58547: keyless OpenStreetMap pizzeria search via the Overpass API.
// Maps each OSM element to the same Pizzeria shape searchGooglePlaces returns.
async function searchOverpassPizzerias(lat: number, lng: number, radius: number): Promise<Pizzeria[]> {
  const query = `[out:json][timeout:15];
( node["amenity"~"restaurant|fast_food"]["cuisine"~"pizza",i](around:${radius},${lat},${lng});
  way ["amenity"~"restaurant|fast_food"]["cuisine"~"pizza",i](around:${radius},${lat},${lng}); );
out center 20;`;

  const response = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    console.error('Overpass API error:', response.status, text);
    throw new Error(`Overpass API error: ${response.status}`);
  }

  const data = await response.json();

  const pizzerias: Pizzeria[] = (data.elements || [])
    .filter((el: any) => {
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;
      // Require a name (unnamed POIs aren't useful) and resolvable coords
      // (ways carry coords under `center`).
      return el.tags?.name && typeof elLat === 'number' && typeof elLng === 'number';
    })
    .map((el: any) => {
      const tags = el.tags || {};
      const elLat = el.lat ?? el.center?.lat;
      const elLng = el.lon ?? el.center?.lon;

      // Assemble a street address from OSM addr:* tags when present.
      const address = [
        [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
        tags['addr:city'],
      ].filter(Boolean).join(', ');

      return {
        id: `osm/${el.type}/${el.id}`,
        placeId: `osm/${el.type}/${el.id}`,
        name: tags.name,
        address,
        phone: tags.phone || tags['contact:phone'],
        url: tags.website || tags['contact:website'],
        rating: undefined,
        reviewCount: undefined,
        priceLevel: undefined,
        isOpen: undefined,
        distance: Math.round(calculateDistance(lat, lng, elLat, elLng)),
        location: {
          lat: elLat,
          lng: elLng,
        },
        orderingOptions: [], // populated by the main handler (Square/phone/AI)
      };
    });

  return pizzerias;
}

// Calculate distance between two coordinates in meters (Haversine formula)
function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

// Check if pizzeria has Square integration
async function checkSquareAvailability(pizzeria: Pizzeria): Promise<OrderingOption | null> {
  if (!SQUARE_ACCESS_TOKEN) return null;

  try {
    // Search Square for merchants near this location
    // Note: Square's Search Locations API doesn't search by name/location publicly
    // In production, you'd maintain a mapping of known Square merchant IDs
    // For now, we'll return null and rely on manual configuration
    return null;
  } catch (error) {
    console.error('Square check error:', error);
    return null;
  }
}

// Generate ordering options for a pizzeria
function generateOrderingOptions(pizzeria: Pizzeria): OrderingOption[] {
  const options: OrderingOption[] = [];

  // AI phone ordering (if Bland API key is configured and pizzeria has phone)
  if (BLAND_API_KEY && pizzeria.phone) {
    options.push({
      provider: 'ai_phone' as any,
      available: true,
    });
  }

  // Manual phone ordering is always available if they have a phone
  if (pizzeria.phone) {
    options.push({
      provider: 'phone',
      available: true,
    });
  }

  return options;
}

// Main handler
serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { lat, lng, radius = 5000 }: SearchRequest = await req.json();

    if (!lat || !lng) {
      return new Response(
        JSON.stringify({ error: 'lat and lng are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Only the Google provider requires the Places key. The Overpass (osm)
    // path is keyless, so don't gate it on GOOGLE_PLACES_API_KEY.
    if (MAP_PROVIDER === 'google' && !GOOGLE_PLACES_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Google Places API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const key = cacheKey(lat, lng, radius);
    const cached = getCached(key);
    const successHeaders = {
      ...corsHeaders,
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=86400, s-maxage=86400',
    };
    if (cached) {
      return new Response(JSON.stringify(cached), { headers: successHeaders });
    }

    // Search for pizzerias via the active provider.
    const pizzerias = MAP_PROVIDER === 'google'
      ? await searchGooglePlaces(lat, lng, radius)
      : await searchOverpassPizzerias(lat, lng, radius);

    // Add ordering options to each pizzeria
    for (const pizzeria of pizzerias) {
      // Check Square availability
      const squareOption = await checkSquareAvailability(pizzeria);
      if (squareOption) {
        pizzeria.orderingOptions.push(squareOption);
      }

      // Add other ordering options (phone)
      const otherOptions = generateOrderingOptions(pizzeria);
      pizzeria.orderingOptions.push(...otherOptions);
    }

    // Sort by weighted score: rating * log10(reviewCount + 1)
    // This balances quality (rating) with credibility (review count)
    const getScore = (p: Pizzeria) => {
      const rating = p.rating || 0;
      const reviews = p.reviewCount || 0;
      return rating * Math.log10(reviews + 1);
    };
    pizzerias.sort((a, b) => getScore(b) - getScore(a));

    const payload = { pizzerias };
    setCached(key, payload);
    return new Response(JSON.stringify(payload), { headers: successHeaders });
  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
