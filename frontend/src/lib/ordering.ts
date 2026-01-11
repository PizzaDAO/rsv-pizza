import { supabase } from './supabase';
import { Pizzeria, OrderItem, OrderingProvider } from '../types';

const SUPABASE_URL = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw';

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

// Geocode an address to coordinates
export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  // Using a simple geocoding approach with Nominatim (free, no API key)
  // In production, you might want to use Google Geocoding API
  const response = await fetch(
    `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
    {
      headers: {
        'User-Agent': 'RSVPizza/1.0',
      },
    }
  );

  if (!response.ok) {
    return null;
  }

  const results = await response.json();
  if (results.length === 0) {
    return null;
  }

  return {
    lat: parseFloat(results[0].lat),
    lng: parseFloat(results[0].lon),
  };
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

// Place an order via AI phone call (Bland AI)
export async function createAIPhoneOrder(
  pizzeriaName: string,
  pizzeriaPhone: string,
  items: OrderItem[],
  customerName: string,
  customerPhone: string,
  fulfillmentType: 'pickup' | 'delivery' = 'pickup',
  deliveryAddress?: string,
  scheduledTime?: string
): Promise<{ success: boolean; callId?: string; message?: string; error?: string }> {
  const response = await fetch(`${SUPABASE_URL}/functions/v1/ai-phone-order`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      pizzeriaName,
      pizzeriaPhone,
      items,
      customerName,
      customerPhone,
      fulfillmentType,
      deliveryAddress,
      scheduledTime,
    }),
  });

  return response.json();
}

// Generate a phone order script
export function generatePhoneOrderScript(
  pizzeriaName: string,
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
