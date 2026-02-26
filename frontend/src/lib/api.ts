import { Pizzeria, Donation, DonationPublicStats, Photo, PhotoStats, Staff, StaffStats, StaffStatus } from '../types';

// Authenticated API helper functions
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();

function getAuthToken(): string | null {
  return localStorage.getItem('authToken');
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: any;
  requireAuth?: boolean;
}

// Custom event name for auth expiration
export const AUTH_EXPIRED_EVENT = 'auth-expired';

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
  } else {
    // Still send token if available (for optionalAuth endpoints)
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Handle 401 Unauthorized - token expired or invalid
    if (response.status === 401 && requireAuth) {
      // Clear the invalid token
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');

      // Dispatch custom event for AuthContext to handle
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }

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
  selectedPizzerias?: any[];
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
  donationRecipientUrl?: string | null;
  donationEthAddress?: string | null;
  shareToUnlock?: boolean;
  shareTweetText?: string | null;
  photoModeration?: boolean;
  nftEnabled?: boolean;
  nftChain?: string | null;
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
      shareToUnlock: data.shareToUnlock,
      shareTweetText: data.shareTweetText,
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
      selectedPizzerias: data.selectedPizzerias,
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
      donationRecipientUrl: data.donationRecipientUrl,
      donationEthAddress: data.donationEthAddress,
      shareToUnlock: data.shareToUnlock,
      shareTweetText: data.shareTweetText,
      photoModeration: data.photoModeration,
      nftEnabled: data.nftEnabled,
      nftChain: data.nftChain,
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
  eventType?: string | null;
  eventTags?: string[];
  donationEnabled?: boolean;
  donationRecipient?: string | null;
  donationRecipientUrl?: string | null;
  donationGoal?: number | null;
  donationMessage?: string | null;
  suggestedAmounts?: number[];
  donationEthAddress?: string | null;
  shareToUnlock?: boolean;
  shareTweetText?: string | null;
  photoModeration?: boolean;
  nftEnabled?: boolean;
  nftChain?: string | null;
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
    // Crypto donation fields
    paymentMethod?: 'stripe' | 'crypto';
    chainId?: number;
    tokenSymbol?: string;
    tokenAddress?: string;
    txHash?: string;
    walletAddress?: string;
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
  status?: 'approved' | 'pending' | 'rejected' | 'all';
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
    if (filters.status) params.append('status', filters.status);
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
  data: { caption?: string; tags?: string[]; starred?: boolean; status?: string }
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

// Batch review photos (host only)
export async function batchReviewPhotos(
  partyId: string,
  photoIds: string[],
  status: 'approved' | 'rejected'
): Promise<{ updated: number } | null> {
  try {
    return await apiRequest<{ updated: number }>(`/api/parties/${partyId}/photos/batch-review`, {
      method: 'POST',
      body: { photoIds, status },
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error batch reviewing photos:', error);
    return null;
  }
}

// ============================================
// Staff API functions (host only)
// ============================================

export interface StaffListResponse {
  staff: Staff[];
  total: number;
  limit: number;
  offset: number;
}

export interface StaffFilters {
  status?: StaffStatus;
  role?: string;
  limit?: number;
  offset?: number;
}

export interface CreateStaffData {
  name: string;
  email?: string;
  phone?: string;
  role: string;
  status?: StaffStatus;
  notes?: string;
}

export interface UpdateStaffData {
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string;
  status?: StaffStatus;
  notes?: string | null;
}

// Get all staff for a party
export async function getPartyStaff(
  partyId: string,
  filters: StaffFilters = {}
): Promise<StaffListResponse | null> {
  try {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.role) params.append('role', filters.role);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    const queryString = params.toString();
    const url = `/api/parties/${partyId}/staff${queryString ? `?${queryString}` : ''}`;

    return await apiRequest<StaffListResponse>(url, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching staff:', error);
    return null;
  }
}

// GPP API functions
export interface CreateGPPEventData {
  city: string;
  hostName: string;
  email: string;
}

export interface GPPEventResponse {
  success: boolean;
  event: {
    id: string;
    name: string;
    inviteCode: string;
    eventType: string;
    eventTags: string[];
  };
  hostPageUrl: string;
  eventPageUrl: string;
  message: string;
}

export async function createGPPEvent(data: CreateGPPEventData): Promise<GPPEventResponse> {
  return apiRequest<GPPEventResponse>('/api/gpp/events', {
    method: 'POST',
    body: data,
    requireAuth: false,
  });
}

export async function verifyTweet(slug: string, tweetUrl: string): Promise<{ verified: boolean; error?: string }> {
  return apiRequest(`/api/events/${slug}/verify-tweet`, {
    method: 'POST',
    body: { tweetUrl },
    requireAuth: false,
  });
}

// Check-in API functions
export interface CheckInResponse {
  success: boolean;
  alreadyCheckedIn: boolean;
  guest: {
    id: string;
    name: string;
    email?: string;
    checkedInAt: string;
    checkedInBy?: string;
  };
  message: string;
}

export async function checkInGuest(inviteCode: string, guestId: string): Promise<CheckInResponse> {
  return apiRequest<CheckInResponse>(`/api/checkin/${inviteCode}/${guestId}`, {
    method: 'POST',
    requireAuth: true,
  });
}

export interface CheckInStatusResponse {
  guest: {
    id: string;
    name: string;
    email?: string;
    checkedInAt?: string;
    checkedInBy?: string;
  };
  isCheckedIn: boolean;
}

export async function getCheckInStatus(inviteCode: string, guestId: string): Promise<CheckInStatusResponse> {
  return apiRequest<CheckInStatusResponse>(`/api/checkin/${inviteCode}/${guestId}`, {
    method: 'GET',
    requireAuth: true,
  });
}

// Get staff statistics
export async function getStaffStats(partyId: string): Promise<StaffStats | null> {
  try {
    return await apiRequest<StaffStats>(`/api/parties/${partyId}/staff/stats`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching staff stats:', error);
    return null;
  }
}

// Add a new staff member
export async function createStaff(
  partyId: string,
  data: CreateStaffData
): Promise<{ staff: Staff } | null> {
  try {
    return await apiRequest<{ staff: Staff }>(`/api/parties/${partyId}/staff`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating staff:', error);
    return null;
  }
}

// Update a staff member
export async function updateStaff(
  partyId: string,
  staffId: string,
  data: UpdateStaffData
): Promise<{ staff: Staff } | null> {
  try {
    return await apiRequest<{ staff: Staff }>(`/api/parties/${partyId}/staff/${staffId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating staff:', error);
    return null;
  }
}

// Delete a staff member
export async function deleteStaff(partyId: string, staffId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/staff/${staffId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting staff:', error);
    return false;
  }
}
