import { Pizzeria, Donation, DonationPublicStats } from '../types';

// Authenticated API helper functions
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

function getAuthToken(): string | null {
  return localStorage.getItem('authToken');
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: any;
  requireAuth?: boolean;
}

export async function apiRequest<T>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const { method = 'GET', body, requireAuth = true } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (requireAuth) {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `API error: ${response.status}`);
  }

  return response.json();
}

// Party API functions
export interface CreatePartyData {
  name?: string;
  hostName?: string;
  date?: string;
  duration?: number;
  timezone?: string;
  pizzaSize?: string;
  pizzaStyle?: string;
  address?: string;
  maxGuests?: number;
  hideGuests?: boolean;
  requireApproval?: boolean;
  availableBeverages?: string[];
  availableToppings?: string[];
  password?: string;
  eventImageUrl?: string;
  description?: string;
  customUrl?: string;
  coHosts?: any[];
}

export interface UpdatePartyData {
  name?: string;
  hostName?: string;
  date?: string | null;
  duration?: number | null;
  timezone?: string | null;
  address?: string | null;
  venueName?: string | null;
  maxGuests?: number | null;
  hideGuests?: boolean;
  requireApproval?: boolean;
  availableBeverages?: string[];
  availableToppings?: string[];
  password?: string | null;
  eventImageUrl?: string | null;
  description?: string | null;
  customUrl?: string | null;
  coHosts?: any[];
  donationEnabled?: boolean;
  donationGoal?: number | null;
  donationMessage?: string | null;
  suggestedAmounts?: number[];
  donationRecipient?: string | null;
}

export async function createPartyApi(data: CreatePartyData) {
  return apiRequest<{ party: any }>('/api/parties', {
    method: 'POST',
    body: {
      name: data.name,
      hostName: data.hostName,
      date: data.date,
      duration: data.duration,
      timezone: data.timezone,
      pizzaSize: data.pizzaSize || 'large',
      pizzaStyle: data.pizzaStyle || 'new-york',
      address: data.address,
      maxGuests: data.maxGuests,
      hideGuests: data.hideGuests,
      requireApproval: data.requireApproval,
      availableBeverages: data.availableBeverages,
      availableToppings: data.availableToppings,
      password: data.password,
      eventImageUrl: data.eventImageUrl,
      description: data.description,
      customUrl: data.customUrl,
      coHosts: data.coHosts,
    },
  });
}

export async function updatePartyApi(partyId: string, data: UpdatePartyData) {
  return apiRequest<{ party: any }>(`/api/parties/${partyId}`, {
    method: 'PATCH',
    body: {
      name: data.name,
      hostName: data.hostName,
      date: data.date,
      duration: data.duration,
      timezone: data.timezone,
      address: data.address,
      venueName: data.venueName,
      maxGuests: data.maxGuests,
      hideGuests: data.hideGuests,
      requireApproval: data.requireApproval,
      availableBeverages: data.availableBeverages,
      availableToppings: data.availableToppings,
      password: data.password,
      eventImageUrl: data.eventImageUrl,
      description: data.description,
      customUrl: data.customUrl,
      coHosts: data.coHosts,
      donationEnabled: data.donationEnabled,
      donationGoal: data.donationGoal,
      donationMessage: data.donationMessage,
      suggestedAmounts: data.suggestedAmounts,
      donationRecipient: data.donationRecipient,
    },
  });
}

export async function deletePartyApi(partyId: string) {
  return apiRequest<{ success: boolean }>(`/api/parties/${partyId}`, {
    method: 'DELETE',
  });
}

// Guest API functions (host actions)
export async function addGuestByHostApi(
  partyId: string,
  data: {
    name: string;
    email?: string;
    dietaryRestrictions?: string[];
    likedToppings?: string[];
    dislikedToppings?: string[];
    likedBeverages?: string[];
    dislikedBeverages?: string[];
  }
) {
  return apiRequest<{ guest: any; alreadyExists?: boolean }>(`/api/parties/${partyId}/guests`, {
    method: 'POST',
    body: data,
  });
}

export async function removeGuestApi(partyId: string, guestId: string) {
  return apiRequest<{ success: boolean }>(`/api/parties/${partyId}/guests/${guestId}`, {
    method: 'DELETE',
  });
}

export async function updateGuestApprovalApi(partyId: string, guestId: string, approved: boolean) {
  return apiRequest<{ guest: any }>(`/api/parties/${partyId}/guests/${guestId}/approve`, {
    method: 'PATCH',
    body: { approved },
  });
}

// Public RSVP API (no auth required)
export async function submitRsvpApi(
  inviteCode: string,
  data: {
    name: string;
    email?: string;
    ethereumAddress?: string;
    roles?: string[];
    mailingListOptIn?: boolean;
    dietaryRestrictions?: string[];
    likedToppings?: string[];
    dislikedToppings?: string[];
    likedBeverages?: string[];
    dislikedBeverages?: string[];
    pizzeriaRankings?: string[];
  }
) {
  return apiRequest<{ success: boolean; guest: any; message: string }>(
    `/api/rsvp/${inviteCode}/guest`,
    {
      method: 'POST',
      body: data,
      requireAuth: false,
    }
  );
}

// Host profile type for API responses
export interface HostProfile {
  name: string | null;
  avatar_url: string | null;
  website: string | null;
  twitter: string | null;
  instagram: string | null;
  youtube: string | null;
  tiktok: string | null;
  linkedin: string | null;
}

// Public event data type
export interface PublicEvent {
  id: string;
  name: string;
  inviteCode: string;
  customUrl: string | null;
  date: string | null;
  duration: number | null;
  timezone: string | null;
  pizzaStyle: string;
  availableBeverages: string[];
  availableToppings: string[];
  address: string | null;
  venueName: string | null;
  maxGuests: number | null;
  hideGuests: boolean;
  eventImageUrl: string | null;
  description: string | null;
  rsvpClosedAt: string | null;
  coHosts: any[];
  hasPassword: boolean;
  hostName: string | null;
  hostProfile: HostProfile | null;
  guestCount: number;
  userId: string | null;
  selectedPizzerias?: Pizzeria[];
}

// Public Event API (no auth required)
export async function getEventBySlug(slug: string): Promise<PublicEvent | null> {
  try {
    const response = await apiRequest<{ event: PublicEvent }>(
      `/api/events/${slug}`,
      {
        method: 'GET',
        requireAuth: false,
      }
    );
    return response.event;
  } catch (error) {
    console.error('Error fetching event:', error);
    return null;
  }
}

// Donation API functions

// Get donation stats for a party (public)
export async function getDonationStats(partyId: string): Promise<DonationPublicStats | null> {
  try {
    const response = await apiRequest<DonationPublicStats>(
      `/api/parties/${partyId}/donations/public`,
      {
        method: 'GET',
        requireAuth: false,
      }
    );
    return response;
  } catch (error) {
    console.error('Error fetching donation stats:', error);
    return null;
  }
}

// Get donations list for a party (host only)
export async function getDonations(partyId: string): Promise<{
  donations: Donation[];
  summary: { totalAmount: number; totalCount: number; currency: string };
} | null> {
  try {
    return await apiRequest<{
      donations: Donation[];
      summary: { totalAmount: number; totalCount: number; currency: string };
    }>(`/api/parties/${partyId}/donations`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching donations:', error);
    return null;
  }
}

// Create a donation record
export async function createDonation(
  partyId: string,
  data: {
    amount: number;
    currency?: string;
    paymentIntentId?: string;
    chargeId?: string;
    donorName?: string;
    donorEmail?: string;
    isAnonymous?: boolean;
    message?: string;
    guestId?: string;
  }
): Promise<{ donation: Donation } | null> {
  try {
    return await apiRequest<{ donation: Donation }>(
      `/api/parties/${partyId}/donations`,
      {
        method: 'POST',
        body: data,
        requireAuth: false, // Public endpoint for guests
      }
    );
  } catch (error) {
    console.error('Error creating donation:', error);
    return null;
  }
}

// Update donation status (after webhook or payment confirmation)
export async function updateDonationStatus(
  partyId: string,
  donationId: string,
  data: { status?: string; chargeId?: string }
): Promise<{ donation: Donation } | null> {
  try {
    return await apiRequest<{ donation: Donation }>(
      `/api/parties/${partyId}/donations/${donationId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: false, // Called from client after payment
      }
    );
  } catch (error) {
    console.error('Error updating donation status:', error);
    return null;
  }
}
