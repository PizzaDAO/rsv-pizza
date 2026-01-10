import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Pizzeria, OrderingOption } from '../_shared/types.ts';

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || '';
const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface SearchRequest {
  lat: number;
  lng: number;
  radius?: number; // meters, default 5000
}

// Search Google Places for nearby pizzerias
async function searchGooglePlaces(lat: number, lng: number, radius: number): Promise<Pizzeria[]> {
  const url = new URL('https://maps.googleapis.com/maps/api/place/nearbysearch/json');
  url.searchParams.set('location', `${lat},${lng}`);
  url.searchParams.set('radius', radius.toString());
  url.searchParams.set('type', 'restaurant');
  url.searchParams.set('keyword', 'pizza');
  url.searchParams.set('key', GOOGLE_PLACES_API_KEY);

  const response = await fetch(url.toString());
  const data = await response.json();

  if (data.status !== 'OK' && data.status !== 'ZERO_RESULTS') {
    console.error('Google Places API error:', data.status, data.error_message);
    throw new Error(`Google Places API error: ${data.status}`);
  }

  const pizzerias: Pizzeria[] = (data.results || []).map((place: any) => {
    // Calculate distance from search point
    const distance = calculateDistance(
      lat, lng,
      place.geometry.location.lat,
      place.geometry.location.lng
    );

    return {
      id: place.place_id,
      placeId: place.place_id,
      name: place.name,
      address: place.vicinity || place.formatted_address || '',
      rating: place.rating,
      reviewCount: place.user_ratings_total,
      priceLevel: place.price_level,
      isOpen: place.opening_hours?.open_now,
      distance: Math.round(distance),
      location: {
        lat: place.geometry.location.lat,
        lng: place.geometry.location.lng,
      },
      photos: place.photos?.slice(0, 3).map((photo: any) =>
        `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photo.photo_reference}&key=${GOOGLE_PLACES_API_KEY}`
      ),
      orderingOptions: [], // Will be populated by checkOrderingOptions
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

// Generate deep links for delivery platforms
function generateDeepLinks(pizzeria: Pizzeria): OrderingOption[] {
  const options: OrderingOption[] = [];
  const encodedName = encodeURIComponent(pizzeria.name);
  const encodedAddress = encodeURIComponent(pizzeria.address);

  // DoorDash deep link
  options.push({
    provider: 'doordash',
    available: true, // Optimistic - user will see if available when they click
    deepLink: `https://www.doordash.com/search/store/${encodedName}/`,
  });

  // Uber Eats deep link
  options.push({
    provider: 'ubereats',
    available: true,
    deepLink: `https://www.ubereats.com/search?q=${encodedName}`,
  });

  // Slice deep link
  options.push({
    provider: 'slice',
    available: true,
    deepLink: `https://slicelife.com/search?query=${encodedName}&location=${encodedAddress}`,
  });

  // Phone ordering is always available
  options.push({
    provider: 'phone',
    available: true,
  });

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

    if (!GOOGLE_PLACES_API_KEY) {
      return new Response(
        JSON.stringify({ error: 'Google Places API key not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Search for pizzerias
    const pizzerias = await searchGooglePlaces(lat, lng, radius);

    // Add ordering options to each pizzeria
    for (const pizzeria of pizzerias) {
      // Check Square availability
      const squareOption = await checkSquareAvailability(pizzeria);
      if (squareOption) {
        pizzeria.orderingOptions.push(squareOption);
      }

      // Add deep links for other platforms
      const deepLinkOptions = generateDeepLinks(pizzeria);
      pizzeria.orderingOptions.push(...deepLinkOptions);
    }

    // Sort by distance
    pizzerias.sort((a, b) => (a.distance || 0) - (b.distance || 0));

    return new Response(
      JSON.stringify({ pizzerias }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error) {
    console.error('Search error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
