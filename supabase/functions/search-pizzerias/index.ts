import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { Pizzeria, OrderingOption } from '../_shared/types.ts';

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || '';
const SQUARE_ACCESS_TOKEN = Deno.env.get('SQUARE_ACCESS_TOKEN') || '';
const BLAND_API_KEY = Deno.env.get('BLAND_API_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
      'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.priceLevel,places.currentOpeningHours,places.nationalPhoneNumber'
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
      rating: place.rating,
      reviewCount: place.userRatingCount,
      priceLevel: priceLevelMap[place.priceLevel] || undefined,
      isOpen: place.currentOpeningHours?.openNow,
      distance: Math.round(distance),
      location: {
        lat: place.location.latitude,
        lng: place.location.longitude,
      },
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
