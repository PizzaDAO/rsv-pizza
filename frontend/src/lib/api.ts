import { Pizzeria, Photo, PhotoStats } from '../types';

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

// Photo API functions
export interface PhotoUploadData {
  url: string;
  thumbnailUrl?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
  uploaderName?: string;
  uploaderEmail?: string;
  guestId?: string;
  caption?: string;
  tags?: string[];
}

export interface PhotosListResponse {
  photos: Photo[];
  total: number;
  limit: number;
  offset: number;
}

export interface PhotoFilters {
  starred?: boolean;
  tag?: string;
  uploadedBy?: string;
  limit?: number;
  offset?: number;
}

// Get photos for a party (public endpoint)
export async function getPartyPhotos(
  partyId: string,
  filters: PhotoFilters = {}
): Promise<PhotosListResponse | null> {
  try {
    const params = new URLSearchParams();
    if (filters.starred) params.append('starred', 'true');
    if (filters.tag) params.append('tag', filters.tag);
    if (filters.uploadedBy) params.append('uploadedBy', filters.uploadedBy);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    const queryString = params.toString();
    const url = `/api/parties/${partyId}/photos${queryString ? `?${queryString}` : ''}`;

    return await apiRequest<PhotosListResponse>(url, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photos:', error);
    return null;
  }
}

// Upload a photo (public endpoint - guest can upload)
export async function uploadPhoto(
  partyId: string,
  data: PhotoUploadData
): Promise<{ photo: Photo } | null> {
  try {
    return await apiRequest<{ photo: Photo }>(`/api/parties/${partyId}/photos`, {
      method: 'POST',
      body: data,
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error uploading photo:', error);
    return null;
  }
}

// Get single photo details
export async function getPhoto(
  partyId: string,
  photoId: string
): Promise<{ photo: Photo } | null> {
  try {
    return await apiRequest<{ photo: Photo }>(`/api/parties/${partyId}/photos/${photoId}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photo:', error);
    return null;
  }
}

// Update photo (host only)
export async function updatePhoto(
  partyId: string,
  photoId: string,
  data: { caption?: string; tags?: string[]; starred?: boolean }
): Promise<{ photo: Photo } | null> {
  try {
    return await apiRequest<{ photo: Photo }>(`/api/parties/${partyId}/photos/${photoId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating photo:', error);
    return null;
  }
}

// Delete photo (host or uploader)
export async function deletePhoto(
  partyId: string,
  photoId: string,
  uploaderEmail?: string
): Promise<boolean> {
  try {
    const params = uploaderEmail ? `?uploaderEmail=${encodeURIComponent(uploaderEmail)}` : '';
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/photos/${photoId}${params}`, {
      method: 'DELETE',
      requireAuth: false,
    });
    return true;
  } catch (error) {
    console.error('Error deleting photo:', error);
    return false;
  }
}

// Get photo statistics
export async function getPhotoStats(partyId: string): Promise<PhotoStats | null> {
  try {
    return await apiRequest<PhotoStats>(`/api/parties/${partyId}/photos/stats`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photo stats:', error);
    return null;
  }
}
