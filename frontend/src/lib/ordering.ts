import { Pizzeria, OrderItem, OrderingProvider } from '../types';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// Search for nearby pizzerias
export async function searchPizzerias(lat: number, lng: number, radius: number = 5000): Promise<Pizzeria[]> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/search-pizzerias`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ lat, lng, radius }),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Failed to search pizzerias');
  }

  const data = await response.json();
  return data.pizzerias;
}

// Get user's current location
export function getCurrentLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation is not supported by your browser'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        resolve({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        reject(new Error(`Geolocation error: ${error.message}`));
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 300000, // Cache for 5 minutes
      }
    );
  });
}

// Strip secondary address components (floor, suite, apt, etc.) that confuse Nominatim
function stripSecondaryAddress(address: string): string {
  return address
    .replace(/,?\s*\b\d+(?:st|nd|rd|th)\s+(?:floor|fl)\b\.?/gi, '')  // "3rd Floor"
    .replace(/,?\s*\b(?:floor|fl)\b\.?\s*\d+/gi, '')                  // "Floor 2"
    .replace(/[,\s]+\b(?:suite|ste|apt|apartment|unit|rm|room|bldg|building)\b\.?\s*\w{0,5}\b/gi, '') // "Suite 200", "Apt 3B"
    .replace(/,?\s*#\s*\w+/g, '')                                      // "#500"
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function nominatimGeocode(query: string): Promise<{ lat: number; lng: number } | null> {
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`,
    { headers: { 'User-Agent': 'RSV.Pizza/1.0' } }
  );
  if (!response.ok) return null;
  const results = await response.json();
  if (results.length === 0) return null;
  return { lat: parseFloat(results[0].lat), lng: parseFloat(results[0].lon) };
}

// Geocode an address to coordinates — tries original first, then stripped version
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const result = await nominatimGeocode(address);
  if (result) return result;

  const cleaned = stripSecondaryAddress(address);
  if (cleaned !== address) return nominatimGeocode(cleaned);

  return null;
}

// Create a Square order
export async function createSquareOrder(
  locationId: string,
  items: OrderItem[],
  customerName: string,
  customerPhone?: string,
  customerEmail?: string,
  fulfillmentType: 'PICKUP' | 'DELIVERY' = 'PICKUP',
  deliveryAddress?: string,
  scheduledTime?: string
): Promise<{ success: boolean; orderId?: string; checkoutUrl?: string; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/square-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      locationId,
      items,
      customerName,
      customerPhone,
      customerEmail,
      fulfillmentType,
      deliveryAddress,
      scheduledTime,
    }),
  });

  return response.json();
}

// sec-edge-functions: AI phone orders (with or without card payment) go through the backend
// only — see initiateAIPhoneCall below. The anon-callable `ai-phone-order` edge function and the
// browser-side virtual-card flow are gone.

// Generate a phone order script
export function generatePhoneOrderScript(
  items: OrderItem[],
  customerName: string,
  fulfillmentType: 'pickup' | 'delivery',
  deliveryAddress?: string
): string {
  const lines = [
    `Hi, I'd like to place an order for ${fulfillmentType}.`,
    `Name: ${customerName}`,
    '',
    'Order:',
  ];

  items.forEach((item) => {
    let line = `- ${item.quantity}x ${item.size} ${item.name}`;
    if (item.toppings.length > 0) {
      line += ` with ${item.toppings.join(', ')}`;
    }
    if (item.dietaryNotes.length > 0) {
      line += ` (${item.dietaryNotes.join(', ')})`;
    }
    lines.push(line);
  });

  if (fulfillmentType === 'delivery' && deliveryAddress) {
    lines.push('', `Delivery address: ${deliveryAddress}`);
  }

  return lines.join('\n');
}

/**
 * basil-14648: for when an order MAY already exist at the shop (our AI called it in). Reading the place-order script
 * then would order the pizzas twice, so this one asks about the earlier order and lists only the pizzas.
 */
export function generateCheckOrderScript(items: OrderItem[], customerName: string): string {
  const who = customerName.trim() ? ` for ${customerName.trim()}` : '';
  const lines = [`Hi, I'm checking on a pickup order${who} that an automated assistant called in earlier. Do you have it? It was:`];
  items.forEach((item) => {
    lines.push(`- ${item.quantity}x ${item.size} ${item.name}${item.toppings.length > 0 ? ` with ${item.toppings.join(', ')}` : ''}`);
  });
  return lines.join('\n');
}

// Live call status from the backend (GET /api/ai-phone/calls/:ref/live). The transcript has
// card data masked; recordings are withheld for card-paid calls.

// Backend errors are `{ error: { message, code } }` (older routes: `{ error: string }` or `{ message }`).
// Always return a string, so a 503 "not configured" shows as a readable message.
export function apiErrorMessage(data: unknown, fallback: string): string {
  const d = data as { error?: unknown; message?: unknown } | null;
  if (d && typeof d.error === 'object' && d.error && typeof (d.error as { message?: unknown }).message === 'string') {
    return (d.error as { message: string }).message;
  }
  if (d && typeof d.error === 'string') return d.error;
  if (d && typeof d.message === 'string') return d.message;
  return fallback;
}

export interface CallStatus {
  status: 'queued' | 'in-progress' | 'completed' | 'failed' | 'unknown';
  recordingAvailable: boolean;
  transcript: string;
  callLength: number | null;
  answeredBy: 'human' | 'voicemail' | 'unknown';
  endedReason: string | null;
}

// Get AI call status. `callRef` is our AI call id or the Bland call id.
export async function getCallStatus(callRef: string): Promise<CallStatus> {
  const token = localStorage.getItem('authToken');
  const response = await fetch(`${BACKEND_URL}/api/ai-phone/calls/${encodeURIComponent(callRef)}/live`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(apiErrorMessage(error, 'Failed to get call status'));
  }

  return response.json();
}

// Fetch the call recording through the authenticated backend proxy and return a blob: URL for
// <audio src>. The caller must URL.revokeObjectURL it when done.
export async function fetchCallRecordingObjectUrl(callRef: string): Promise<string | null> {
  const token = localStorage.getItem('authToken');
  const response = await fetch(`${BACKEND_URL}/api/ai-phone/calls/${encodeURIComponent(callRef)}/recording`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) return null;
  return URL.createObjectURL(await response.blob());
}

// Calculate distance (Haversine, returns miles)
export function calculateDistanceMiles(
  lat1: number, lng1: number, lat2: number, lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2-lat1)*Math.PI)/180;
  const dLng = ((lng2-lng1)*Math.PI)/180;
  const a = Math.sin(dLat/2)**2+Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a));
}

export function formatDistanceMiles(miles: number): string {
  if (miles<0.1) return "<0.1 mi";
  return miles.toFixed(1)+" mi";
}

// Format distance for display
export function formatDistance(meters: number): string {
  if (meters < 1000) {
    return `${meters}m`;
  }
  const miles = meters / 1609.344;
  return `${miles.toFixed(1)} mi`;
}

// Format rating stars
export function formatRating(rating: number | undefined): string {
  if (!rating) return 'No rating';
  return rating.toFixed(1);
}

// Get provider display name
export function getProviderName(provider: OrderingProvider): string {
  const names: Record<OrderingProvider, string> = {
    square: 'Order Online',
    toast: 'Order Online',
    chownow: 'ChowNow',
    doordash: 'DoorDash',
    ubereats: 'Uber Eats',
    slice: 'Slice',
    phone: 'Call to Order',
    ai_phone: 'AI Order Call',
  };
  return names[provider];
}

// Get provider color
export function getProviderColor(provider: OrderingProvider): string {
  const colors: Record<OrderingProvider, string> = {
    square: '#006aff',
    toast: '#ff6900',
    chownow: '#00a651',
    doordash: '#ff3008',
    ubereats: '#000000',
    slice: '#f15a29',
    phone: '#6b7280',
    ai_phone: '#8b5cf6', // Purple for AI
  };
  return colors[provider];
}

// Check if provider supports direct API ordering
export function supportsDirectOrdering(provider: OrderingProvider): boolean {
  return ['square', 'toast', 'chownow', 'ai_phone'].includes(provider);
}

// --- Backend API AI Phone Call Functions ---

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || import.meta.env.VITE_API_URL || 'http://localhost:3006';

// Initiate AI phone call via backend API
export async function initiateAIPhoneCall(
  partyId: string,
  pizzeriaName: string,
  pizzeriaPhone: string,
  items: OrderItem[],
  customerName: string,
  customerPhone: string,
  fulfillmentType: 'pickup' | 'delivery',
  deliveryAddress?: string,
  partySize?: number,
  // When true the backend issues a virtual card (server-decided limit) and the AI reads it to the
  // pizzeria. Card details never reach the browser.
  payWithCard: boolean = false
): Promise<{ success: boolean; callId?: string; aiPhoneCallId?: string; error?: string }> {
  const token = localStorage.getItem('authToken');

  const response = await fetch(`${BACKEND_URL}/api/ai-phone/initiate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      partyId,
      pizzeriaName,
      pizzeriaPhone,
      items,
      customerName,
      customerPhone,
      fulfillmentType,
      deliveryAddress,
      partySize,
      payWithCard,
    }),
  });

  // Handle non-JSON responses (e.g., HTML 404 from backend not yet deployed)
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {
      success: false,
      error: `Backend API returned non-JSON response (status ${response.status}). The ai-phone endpoint may not be deployed yet.`,
    };
  }

  const data = await response.json();

  // Normalize error response - backend may return {message, code} or {error}
  if (!response.ok || data.message || data.error) {
    return {
      success: false,
      error: apiErrorMessage(data, 'Failed to initiate AI call'),
    };
  }

  return data;
}

// Retry a failed AI phone call
export async function retryAIPhoneCall(
  aiPhoneCallId: string
): Promise<{ success: boolean; callId?: string; aiPhoneCallId?: string; error?: string }> {
  const token = localStorage.getItem('authToken');

  const response = await fetch(`${BACKEND_URL}/api/ai-phone/${aiPhoneCallId}/retry`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return {
      success: false,
      error: `Backend API returned non-JSON response (status ${response.status}).`,
    };
  }

  if (!response.ok) {
    const data = await response.json();
    return {
      success: false,
      error: apiErrorMessage(data, 'Failed to retry call'),
    };
  }

  return response.json();
}

// Get AI phone call status
export async function getAIPhoneCallStatus(aiPhoneCallId: string) {
  const token = localStorage.getItem('authToken');

  const response = await fetch(`${BACKEND_URL}/api/ai-phone/${aiPhoneCallId}/status`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Backend API returned non-JSON response (status ${response.status})`);
  }

  if (!response.ok) {
    throw new Error('Failed to fetch call status');
  }

  return response.json();
}

// Get AI phone call transcript
export async function getAIPhoneCallTranscript(aiPhoneCallId: string) {
  const token = localStorage.getItem('authToken');

  const response = await fetch(`${BACKEND_URL}/api/ai-phone/${aiPhoneCallId}/transcript`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    throw new Error(`Backend API returned non-JSON response (status ${response.status})`);
  }

  if (!response.ok) {
    throw new Error('Failed to fetch transcript');
  }

  return response.json();
}
