import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

// Thin proxy to Google Places Photo (New) API. Takes a photo resource name
// like `places/ChIJ.../photos/AWU5eFh...` and redirects the browser to the
// short-lived `photoUri` returned by Google.
//
// Critical:
// - NEVER persist the image bytes. We only proxy the short-lived URI. Per
//   Google Maps Platform ToS 3.2.3, photo bytes may not be cached long-term.
// - SSRF-safe: the `name` query param is validated against a strict regex
//   before we construct the outbound URL.
// - CORS: wide-open so `<img src>` works cross-origin.

const GOOGLE_PLACES_API_KEY = Deno.env.get('GOOGLE_PLACES_API_KEY') || '';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Google Places photo resource names look like: places/{placeId}/photos/{photoId}
// Both segments are opaque alphanumerics + - + _. Be strict to prevent SSRF.
const PHOTO_NAME_REGEX = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

function jsonError(status: number, message: string) {
  return new Response(
    JSON.stringify({ error: message }),
    {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    }
  );
}

function clampDimension(value: string | null, fallback: number, min: number, max: number): number {
  const parsed = value ? parseInt(value, 10) : NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    if (!GOOGLE_PLACES_API_KEY) {
      return jsonError(500, 'Google Places API key not configured');
    }

    const url = new URL(req.url);
    const name = url.searchParams.get('name');

    if (!name) {
      return jsonError(400, 'name query param is required');
    }

    // SSRF guard — reject anything that doesn't match the exact Google shape.
    if (!PHOTO_NAME_REGEX.test(name)) {
      return jsonError(400, 'invalid photo name');
    }

    const maxWidthPx = clampDimension(url.searchParams.get('maxWidthPx'), 400, 32, 4800);
    const maxHeightPx = clampDimension(url.searchParams.get('maxHeightPx'), 400, 32, 4800);

    // Ask Google for the resolved short-lived URI instead of binary bytes so
    // we can 302 the browser directly to lh3.googleusercontent.com. This saves
    // us from streaming the bytes through the edge function and lets the
    // browser cache based on the ultimate image URL.
    const googleUrl =
      `https://places.googleapis.com/v1/${name}/media` +
      `?maxWidthPx=${maxWidthPx}` +
      `&maxHeightPx=${maxHeightPx}` +
      `&skipHttpRedirect=true`;

    const googleResponse = await fetch(googleUrl, {
      method: 'GET',
      headers: {
        'X-Goog-Api-Key': GOOGLE_PLACES_API_KEY,
      },
    });

    if (!googleResponse.ok) {
      // 4xx / 5xx from Google (stale name, bad key, etc). Return a matching
      // status so the frontend can fall through to the SVG placeholder.
      return jsonError(googleResponse.status, 'failed to resolve photo');
    }

    const data = await googleResponse.json();
    const photoUri: string | undefined = data?.photoUri;

    if (!photoUri || typeof photoUri !== 'string') {
      return jsonError(502, 'google did not return a photoUri');
    }

    // 302 to the resolved photo URL. Cache-Control on the redirect response
    // lets browsers reuse the lookup for an hour; the underlying image is
    // served directly from Google's CDN after the redirect.
    return new Response(null, {
      status: 302,
      headers: {
        ...corsHeaders,
        Location: photoUri,
        'Cache-Control': 'public, max-age=3600',
      },
    });
  } catch (error) {
    console.error('pizzeria-photo error:', error);
    return jsonError(500, (error as Error).message || 'internal error');
  }
});
