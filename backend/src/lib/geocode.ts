export interface GeocodeResult {
  lat: number;
  lng: number;
  source: 'nominatim' | 'google';
}

/**
 * Geocode a city name to lat/lng using Nominatim first, Google Maps as fallback.
 * Returns null on any error or no result — never throws.
 */
export async function geocodeCity(city: string, country?: string | null): Promise<GeocodeResult | null> {
  const query = country ? `${city}, ${country}` : city;

  // --- Nominatim ---
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1`;
    const resp = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'rsv.pizza-backend/1.0 (samgold24@gmail.com)',
      },
    });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (Array.isArray(data) && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lng = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lng)) {
          return { lat, lng, source: 'nominatim' };
        }
      }
    }
  } catch (err) {
    console.warn('[geocodeCity] Nominatim error:', err instanceof Error ? err.message : err);
  }

  // --- Google Maps fallback ---
  const googleKey = process.env.GOOGLE_GEOCODING_API_KEY;
  if (!googleKey) {
    return null;
  }

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${googleKey}`;
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    if (resp.ok) {
      const data = await resp.json();
      if (data.results && data.results.length > 0) {
        const loc = data.results[0].geometry?.location;
        if (loc && typeof loc.lat === 'number' && typeof loc.lng === 'number') {
          return { lat: loc.lat, lng: loc.lng, source: 'google' };
        }
      }
    }
  } catch (err) {
    console.warn('[geocodeCity] Google Maps error:', err instanceof Error ? err.message : err);
  }

  return null;
}
