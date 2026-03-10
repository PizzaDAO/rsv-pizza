import { Pizzeria, Donation, DonationPublicStats, Photo, PhotoStats, Sponsor, SponsorStats, SponsorStatus, SponsorshipType, VenueStatus, Venue, VenuePhoto, VenuePhotoCategory, VenueReport, Performer, PerformersResponse, EventReport, SocialPost, NotableAttendee, Staff, StaffStats, StaffStatus, Display, DisplayContentType, DisplayContentConfig, DisplayViewerData, Raffle, RafflePrize, RaffleEntry, RaffleWinner, BudgetOverview, BudgetItem, BudgetCategory, BudgetStatus, PartyKit, KitTier, ChecklistItem, ChecklistData, PageViewStats, UnderbossDashboardData, GPPRegion, AdminUser, UnderbossAdmin } from '../types';

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

    throw new Error(error.message || error.error?.message || `API error: ${response.status}`);
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
  // Venue tracking fields
  venueStatus?: VenueStatus | null;
  venueCapacity?: number | null;
  venueCost?: number | null;
  venuePointPerson?: string | null;
  venueContactName?: string | null;
  venueContactEmail?: string | null;
  venueContactPhone?: string | null;
  venueOrganization?: string | null;
  venueWebsite?: string | null;
  venueNotes?: string | null;
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
  fundraisingGoal?: number | null;
  musicEnabled?: boolean;
  musicNotes?: string | null;
  venueReportTitle?: string | null;
  venueReportNotes?: string | null;
  pinnedApps?: string[];
  region?: string | null;
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
      // Venue tracking fields
      venueStatus: data.venueStatus,
      venueCapacity: data.venueCapacity,
      venueCost: data.venueCost,
      venuePointPerson: data.venuePointPerson,
      venueContactName: data.venueContactName,
      venueContactEmail: data.venueContactEmail,
      venueContactPhone: data.venueContactPhone,
      venueOrganization: data.venueOrganization,
      venueWebsite: data.venueWebsite,
      venueNotes: data.venueNotes,
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
      fundraisingGoal: data.fundraisingGoal,
      musicEnabled: data.musicEnabled,
      musicNotes: data.musicNotes,
      venueReportTitle: data.venueReportTitle,
      venueReportNotes: data.venueReportNotes,
      pinnedApps: data.pinnedApps,
      region: data.region,
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

export async function promoteGuestApi(partyId: string, guestId: string) {
  return apiRequest<{ guest: any }>(`/api/parties/${partyId}/guests/${guestId}/promote`, {
    method: 'POST',
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
// Sponsor CRM API functions
// ============================================

export interface CreateSponsorData {
  name: string;
  website?: string;
  brandTwitter?: string;
  pointPerson?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTwitter?: string;
  telegram?: string;
  status?: SponsorStatus;
  amount?: number | null;
  sponsorshipType?: SponsorshipType | null;
  productService?: string;
  logoUrl?: string;
  notes?: string;
  lastContactedAt?: string | null;
}

export interface UpdateSponsorData extends Partial<CreateSponsorData> {}

export interface SponsorFilters {
  status?: SponsorStatus;
  sortBy?: 'createdAt' | 'name' | 'amount' | 'lastContactedAt' | 'status';
  sortOrder?: 'asc' | 'desc';
}

// Get all sponsors for a party
export async function getSponsors(
  partyId: string,
  filters: SponsorFilters = {}
): Promise<{ sponsors: Sponsor[] } | null> {
  try {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.sortBy) params.append('sortBy', filters.sortBy);
    if (filters.sortOrder) params.append('sortOrder', filters.sortOrder);

    const queryString = params.toString();
    const url = `/api/parties/${partyId}/sponsors${queryString ? `?${queryString}` : ''}`;

    return await apiRequest<{ sponsors: Sponsor[] }>(url, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching sponsors:', error);
    return null;
  }
}

// ============================================
// Performer/Music API functions
// ============================================

export interface CreatePerformerData {
  name: string;
  type?: 'dj' | 'live_band' | 'solo' | 'playlist';
  genre?: string;
  setTime?: string;
  setDuration?: number;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  instagram?: string;
  soundcloud?: string;
  status?: 'pending' | 'confirmed' | 'cancelled';
  equipmentProvided?: boolean;
  equipmentNotes?: string;
  fee?: number;
  feePaid?: boolean;
  notes?: string;
}

export interface UpdatePerformerData {
  name?: string;
  type?: 'dj' | 'live_band' | 'solo' | 'playlist';
  genre?: string | null;
  setTime?: string | null;
  setDuration?: number | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  instagram?: string | null;
  soundcloud?: string | null;
  status?: 'pending' | 'confirmed' | 'cancelled';
  equipmentProvided?: boolean;
  equipmentNotes?: string | null;
  fee?: number | null;
  feePaid?: boolean;
  notes?: string | null;
}

// Get performers for a party (public endpoint)
export async function getPerformers(partyId: string): Promise<PerformersResponse | null> {
  try {
    return await apiRequest<PerformersResponse>(`/api/parties/${partyId}/performers`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching performers:', error);
    return null;
  }
}

// GPP API functions
export interface CreateGPPEventData {
  city: string;
  hostName: string;
  email: string;
  telegram?: string;
  country?: string;
  countryCode?: string;
  cityLat?: number;
  cityLng?: number;
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

// Get sponsor pipeline statistics
export async function getSponsorStats(partyId: string): Promise<SponsorStats | null> {
  try {
    return await apiRequest<SponsorStats>(`/api/parties/${partyId}/sponsors/stats`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching sponsor stats:', error);
    return null;
  }
}

// Create a new sponsor
export async function createSponsor(
  partyId: string,
  data: CreateSponsorData
): Promise<{ sponsor: Sponsor } | null> {
  try {
    return await apiRequest<{ sponsor: Sponsor }>(`/api/parties/${partyId}/sponsors`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating sponsor:', error);
    throw error;
  }
}

// Get single sponsor details
export async function getSponsor(
  partyId: string,
  sponsorId: string
): Promise<{ sponsor: Sponsor } | null> {
  try {
    return await apiRequest<{ sponsor: Sponsor }>(`/api/parties/${partyId}/sponsors/${sponsorId}`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching sponsor:', error);
    return null;
  }
}

// Update a sponsor
export async function updateSponsor(
  partyId: string,
  sponsorId: string,
  data: UpdateSponsorData
): Promise<{ sponsor: Sponsor } | null> {
  try {
    return await apiRequest<{ sponsor: Sponsor }>(`/api/parties/${partyId}/sponsors/${sponsorId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating sponsor:', error);
    throw error;
  }
}

// Delete a sponsor
export async function deleteSponsor(partyId: string, sponsorId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/sponsors/${sponsorId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting sponsor:', error);
    return false;
  }
}

// Update fundraising goal for a party
export async function updateFundraisingGoal(
  partyId: string,
  fundraisingGoal: number | null
): Promise<{ party: any } | null> {
  try {
    return await apiRequest<{ party: any }>(`/api/parties/${partyId}`, {
      method: 'PATCH',
      body: { fundraisingGoal },
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating fundraising goal:', error);
    throw error;
  }
}

// ============================================
// Venue API functions
// ============================================

export interface VenueCreateData {
  name: string;
  address?: string;
  website?: string;
  capacity?: number;
  cost?: number;
  organization?: string;
  pointPerson?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  status?: VenueStatus;
  notes?: string;
  pros?: string;
  cons?: string;
}

export interface VenueUpdateData extends Partial<VenueCreateData> {}

// Get all venues for a party
export async function getVenues(partyId: string): Promise<Venue[]> {
  try {
    const response = await apiRequest<{ venues: Venue[] }>(`/api/parties/${partyId}/venues`, {
      method: 'GET',
      requireAuth: true,
    });
    return response.venues;
  } catch (error) {
    console.error('Error fetching venues:', error);
    return [];
  }
}

// Create a new venue
export async function createVenue(partyId: string, data: VenueCreateData): Promise<Venue | null> {
  try {
    const response = await apiRequest<{ venue: Venue }>(`/api/parties/${partyId}/venues`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
    return response.venue;
  } catch (error) {
    console.error('Error creating venue:', error);
    throw error;
  }
}

// Update a venue
export async function updateVenue(partyId: string, venueId: string, data: VenueUpdateData): Promise<Venue | null> {
  try {
    const response = await apiRequest<{ venue: Venue }>(`/api/parties/${partyId}/venues/${venueId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
    return response.venue;
  } catch (error) {
    console.error('Error updating venue:', error);
    throw error;
  }
}

// Delete a venue
export async function deleteVenue(partyId: string, venueId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/venues/${venueId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting venue:', error);
    return false;
  }
}

// Select a venue as the event location
export async function selectVenue(partyId: string, venueId: string): Promise<{ venue: Venue; party: any } | null> {
  try {
    const response = await apiRequest<{ venue: Venue; party: any }>(`/api/parties/${partyId}/venues/${venueId}/select`, {
      method: 'PATCH',
      requireAuth: true,
    });
    return response;
  } catch (error) {
    console.error('Error selecting venue:', error);
    throw error;
  }
}

// Deselect a venue
export async function deselectVenue(partyId: string, venueId: string): Promise<Venue | null> {
  try {
    const response = await apiRequest<{ venue: Venue }>(`/api/parties/${partyId}/venues/${venueId}/deselect`, {
      method: 'PATCH',
      requireAuth: true,
    });
    return response.venue;
  } catch (error) {
    console.error('Error deselecting venue:', error);
    throw error;
  }
}

// Add a performer (host only)
export async function addPerformer(
  partyId: string,
  data: CreatePerformerData
): Promise<{ performer: Performer } | null> {
  try {
    return await apiRequest<{ performer: Performer }>(`/api/parties/${partyId}/performers`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error adding performer:', error);
    throw error;
  }
}

// Update a performer (host only)
export async function updatePerformer(
  partyId: string,
  performerId: string,
  data: UpdatePerformerData
): Promise<{ performer: Performer } | null> {
  try {
    return await apiRequest<{ performer: Performer }>(
      `/api/parties/${partyId}/performers/${performerId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating performer:', error);
    throw error;
  }
}

// Delete a performer (host only)
export async function deletePerformer(
  partyId: string,
  performerId: string
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/performers/${performerId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting performer:', error);
    return false;
  }
}

// Reorder performers (host only)
export async function reorderPerformers(
  partyId: string,
  performerIds: string[]
): Promise<{ performers: Performer[] } | null> {
  try {
    return await apiRequest<{ performers: Performer[] }>(
      `/api/parties/${partyId}/performers/reorder`,
      {
        method: 'PATCH',
        body: { performerIds },
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error reordering performers:', error);
    throw error;
  }
}

// =====================
// Report API functions
// =====================

// Get full report data (host only)
export async function getReport(partyId: string): Promise<{ report: EventReport } | null> {
  try {
    return await apiRequest<{ report: EventReport }>(`/api/parties/${partyId}/report`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching report:', error);
    return null;
  }
}

// Update report fields (host only)
export interface UpdateReportData {
  reportRecap?: string | null;
  reportVideoUrl?: string | null;
  reportPhotosUrl?: string | null;
  flyerArtist?: string | null;
  xPostUrl?: string | null;
  xPostViews?: number | null;
  farcasterPostUrl?: string | null;
  farcasterViews?: number | null;
  lumaUrl?: string | null;
  lumaViews?: number | null;
  poapEventId?: string | null;
  poapMints?: number | null;
  poapMoments?: number | null;
}

export async function updateReport(
  partyId: string,
  data: UpdateReportData
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/report`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error updating report:', error);
    return false;
  }
}

// Publish report
export async function publishReport(
  partyId: string,
  password?: string
): Promise<{ reportPublicSlug: string; publicUrl: string } | null> {
  try {
    return await apiRequest<{ success: boolean; reportPublicSlug: string; publicUrl: string }>(
      `/api/parties/${partyId}/report/publish`,
      {
        method: 'POST',
        body: password ? { password } : undefined,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error publishing report:', error);
    return null;
  }
}

// Check if published report requires password
export async function checkReportPassword(
  publicSlug: string
): Promise<{ requiresPassword: boolean; name: string } | null> {
  try {
    return await apiRequest<{ requiresPassword: boolean; name: string }>(
      `/api/reports/public/${publicSlug}/check`,
      { method: 'GET', requireAuth: false }
    );
  } catch {
    return null;
  }
}

// Fetch published report (public, with optional password)
export async function fetchPublicReport(
  publicSlug: string,
  password?: string
): Promise<any> {
  const params = password ? `?password=${encodeURIComponent(password)}` : '';
  return apiRequest(`/api/reports/public/${publicSlug}${params}`, {
    method: 'GET',
    requireAuth: false,
  });
}

// Unpublish report
export async function unpublishReport(partyId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/report/publish`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error unpublishing report:', error);
    return false;
  }
}

// Add social post
export async function addSocialPost(
  partyId: string,
  data: { platform: string; url: string; authorHandle?: string; title?: string; views?: number | null }
): Promise<{ socialPost: SocialPost } | null> {
  try {
    return await apiRequest<{ socialPost: SocialPost }>(
      `/api/parties/${partyId}/report/social-posts`,
      {
        method: 'POST',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error adding social post:', error);
    return null;
  }
}

// Delete social post
export async function deleteSocialPost(partyId: string, postId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/report/social-posts/${postId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting social post:', error);
    return false;
  }
}

// Add notable attendee
export async function addNotableAttendee(
  partyId: string,
  data: { name: string; link?: string; guestId?: string }
): Promise<{ notableAttendee: NotableAttendee } | null> {
  try {
    return await apiRequest<{ notableAttendee: NotableAttendee }>(
      `/api/parties/${partyId}/report/notable-attendees`,
      {
        method: 'POST',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error adding notable attendee:', error);
    return null;
  }
}

// Delete notable attendee
export async function deleteNotableAttendee(partyId: string, attendeeId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/report/notable-attendees/${attendeeId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting notable attendee:', error);
    return false;
  }
}

// Delete notable attendee by guest ID
export async function deleteNotableAttendeeByGuestId(partyId: string, guestId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/report/notable-attendees/by-guest/${guestId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting notable attendee by guest ID:', error);
    return false;
  }
}

// Get notable guest IDs for a party
export async function getNotableGuestIds(partyId: string): Promise<string[]> {
  try {
    const result = await apiRequest<{ guestIds: string[] }>(
      `/api/parties/${partyId}/report/notable-attendees/guest-ids`,
      {
        method: 'GET',
        requireAuth: true,
      }
    );
    return result.guestIds;
  } catch (error) {
    console.error('Error fetching notable guest IDs:', error);
    return [];
  }
}

// Get public report by slug (no auth)
export async function getPublicReport(slug: string): Promise<{ report: EventReport } | null> {
  try {
    return await apiRequest<{ report: EventReport }>(`/api/reports/public/${slug}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching public report:', error);
    return null;
  }
}

// Get page view stats (host only)
export async function getPageViewStats(partyId: string): Promise<PageViewStats | null> {
  try {
    return await apiRequest<PageViewStats>(`/api/parties/${partyId}/report/views`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching page view stats:', error);
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

// ============================================
// Display API functions
// ============================================

export interface CreateDisplayData {
  name: string;
  contentType?: DisplayContentType;
  contentConfig?: DisplayContentConfig;
  rotationInterval?: number;
  backgroundColor?: string;
  showClock?: boolean;
  showEventName?: boolean;
  password?: string;
}

export interface UpdateDisplayData {
  name?: string;
  contentType?: DisplayContentType;
  contentConfig?: DisplayContentConfig;
  rotationInterval?: number;
  backgroundColor?: string;
  showClock?: boolean;
  showEventName?: boolean;
  isActive?: boolean;
  password?: string | null;
}

// List displays for a party
export async function getPartyDisplays(partyId: string): Promise<{ displays: Display[] } | null> {
  try {
    return await apiRequest<{ displays: Display[] }>(`/api/parties/${partyId}/displays`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching displays:', error);
    return null;
  }
}

// Create a new display
export async function createDisplay(
  partyId: string,
  data: CreateDisplayData
): Promise<{ display: Display } | null> {
  try {
    return await apiRequest<{ display: Display }>(`/api/parties/${partyId}/displays`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating display:', error);
    return null;
  }
}

// Get display details
export async function getDisplay(
  partyId: string,
  displayId: string
): Promise<{ display: Display } | null> {
  try {
    return await apiRequest<{ display: Display }>(`/api/parties/${partyId}/displays/${displayId}`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching display:', error);
    return null;
  }
}

// Update display
export async function updateDisplay(
  partyId: string,
  displayId: string,
  data: UpdateDisplayData
): Promise<{ display: Display } | null> {
  try {
    return await apiRequest<{ display: Display }>(`/api/parties/${partyId}/displays/${displayId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating display:', error);
    return null;
  }
}

// Delete display
export async function deleteDisplay(partyId: string, displayId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/displays/${displayId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting display:', error);
    return false;
  }
}

// Get display for public viewer (no auth)
export async function getDisplayForViewer(
  partyId: string,
  slug: string,
  password?: string
): Promise<DisplayViewerData | null> {
  try {
    const params = password ? `?password=${encodeURIComponent(password)}` : '';
    return await apiRequest<DisplayViewerData>(`/api/display/view/${partyId}/${slug}${params}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching display for viewer:', error);
    return null;
  }
}

// Get photos for display (for live refresh)
export async function getDisplayPhotos(
  partyId: string,
  slug: string,
  since?: string
): Promise<{ photos: Photo[] } | null> {
  try {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    return await apiRequest<{ photos: Photo[] }>(`/api/display/view/${partyId}/${slug}/photos${params}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching display photos:', error);
    return null;
  }
}

// ============================================
// Raffle API Functions
// ============================================

export async function getRaffles(partyId: string): Promise<{ raffles: Raffle[] } | null> {
  try {
    return await apiRequest<{ raffles: Raffle[] }>(`/api/parties/${partyId}/raffles`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching raffles:', error);
    return null;
  }
}

export async function getRaffle(partyId: string, raffleId: string): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles/${raffleId}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching raffle:', error);
    return null;
  }
}

export async function createRaffle(
  partyId: string,
  data: { name: string; description?: string; entriesPerGuest?: number }
): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating raffle:', error);
    return null;
  }
}

export async function updateRaffle(
  partyId: string,
  raffleId: string,
  data: { name?: string; description?: string; status?: string; entriesPerGuest?: number }
): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles/${raffleId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating raffle:', error);
    return null;
  }
}

export async function deleteRaffle(partyId: string, raffleId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/raffles/${raffleId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting raffle:', error);
    return false;
  }
}

export async function addRafflePrize(
  partyId: string,
  raffleId: string,
  data: { name: string; description?: string; imageUrl?: string; quantity?: number }
): Promise<{ prize: RafflePrize } | null> {
  try {
    return await apiRequest<{ prize: RafflePrize }>(`/api/parties/${partyId}/raffles/${raffleId}/prizes`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error adding prize:', error);
    return null;
  }
}

export async function updateRafflePrize(
  partyId: string,
  raffleId: string,
  prizeId: string,
  data: { name?: string; description?: string; imageUrl?: string; quantity?: number }
): Promise<{ prize: RafflePrize } | null> {
  try {
    return await apiRequest<{ prize: RafflePrize }>(`/api/parties/${partyId}/raffles/${raffleId}/prizes/${prizeId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating prize:', error);
    return null;
  }
}

export async function deleteRafflePrize(partyId: string, raffleId: string, prizeId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/raffles/${raffleId}/prizes/${prizeId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting prize:', error);
    return false;
  }
}

export async function enterRaffle(
  partyId: string,
  raffleId: string,
  guestId: string
): Promise<{ entry: RaffleEntry } | null> {
  try {
    return await apiRequest<{ entry: RaffleEntry }>(`/api/parties/${partyId}/raffles/${raffleId}/enter`, {
      method: 'POST',
      body: { guestId },
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error entering raffle:', error);
    throw error;
  }
}

export async function drawRaffleWinners(partyId: string, raffleId: string): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles/${raffleId}/draw`, {
      method: 'POST',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error drawing winners:', error);
    throw error;
  }
}

export async function claimRafflePrize(
  partyId: string,
  raffleId: string,
  winnerId: string
): Promise<{ winner: RaffleWinner } | null> {
  try {
    return await apiRequest<{ winner: RaffleWinner }>(`/api/parties/${partyId}/raffles/${raffleId}/winners/${winnerId}/claim`, {
      method: 'POST',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error claiming prize:', error);
    return null;
  }
}

export async function unclaimRafflePrize(
  partyId: string,
  raffleId: string,
  winnerId: string
): Promise<{ winner: RaffleWinner } | null> {
  try {
    return await apiRequest<{ winner: RaffleWinner }>(`/api/parties/${partyId}/raffles/${raffleId}/winners/${winnerId}/claim`, {
      method: 'DELETE',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error unclaiming prize:', error);
    return null;
  }
}

// Budget API functions
// ============================================

// Get budget overview and items
export async function getBudget(partyId: string): Promise<BudgetOverview | null> {
  try {
    return await apiRequest<BudgetOverview>(`/api/parties/${partyId}/budget`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching budget:', error);
    return null;
  }
}

// Update budget settings
export async function updateBudgetSettings(
  partyId: string,
  data: { budgetEnabled?: boolean; budgetTotal?: number | null }
): Promise<{ budgetEnabled: boolean; budgetTotal: number | null } | null> {
  try {
    return await apiRequest<{ budgetEnabled: boolean; budgetTotal: number | null }>(
      `/api/parties/${partyId}/budget/settings`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating budget settings:', error);
    return null;
  }
}

// Create budget item
export interface CreateBudgetItemData {
  name: string;
  category: BudgetCategory;
  cost: number;
  status?: BudgetStatus;
  pointPerson?: string;
  notes?: string;
  receiptUrl?: string;
}

export async function createBudgetItem(
  partyId: string,
  data: CreateBudgetItemData
): Promise<{ item: BudgetItem } | null> {
  try {
    return await apiRequest<{ item: BudgetItem }>(`/api/parties/${partyId}/budget/items`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating budget item:', error);
    return null;
  }
}

// Update budget item
export async function updateBudgetItem(
  partyId: string,
  itemId: string,
  data: Partial<CreateBudgetItemData>
): Promise<{ item: BudgetItem } | null> {
  try {
    return await apiRequest<{ item: BudgetItem }>(
      `/api/parties/${partyId}/budget/items/${itemId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating budget item:', error);
    return null;
  }
}

// Delete budget item
export async function deleteBudgetItem(partyId: string, itemId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/budget/items/${itemId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting budget item:', error);
    return false;
  }
}

// Toggle budget item status
export async function toggleBudgetItemStatus(
  partyId: string,
  itemId: string
): Promise<{ item: BudgetItem } | null> {
  try {
    return await apiRequest<{ item: BudgetItem }>(
      `/api/parties/${partyId}/budget/items/${itemId}/toggle-status`,
      {
        method: 'POST',
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error toggling budget item status:', error);
    return null;
  }
}

// Party Kit API functions
// ============================================

export interface KitRequestData {
  requestedTier?: KitTier;
  recipientName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
  phone?: string;
  notes?: string;
}

export interface KitResponse {
  kitEnabled: boolean;
  kitDeadline: string | null;
  kit: PartyKit | null;
}

// Get kit request for a party
export async function getPartyKit(partyId: string): Promise<KitResponse | null> {
  try {
    return await apiRequest<KitResponse>(`/api/parties/${partyId}/kit`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching kit:', error);
    return null;
  }
}

// Submit a kit request
export async function submitKitRequest(
  partyId: string,
  data: KitRequestData
): Promise<{ kit: PartyKit } | null> {
  try {
    return await apiRequest<{ kit: PartyKit }>(`/api/parties/${partyId}/kit`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error submitting kit request:', error);
    throw error;
  }
}

// Update a kit request
export async function updateKitRequest(
  partyId: string,
  data: Partial<KitRequestData>
): Promise<{ kit: PartyKit } | null> {
  try {
    return await apiRequest<{ kit: PartyKit }>(`/api/parties/${partyId}/kit`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating kit request:', error);
    throw error;
  }
}

// Cancel a kit request
export async function cancelKitRequest(partyId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/kit`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error canceling kit request:', error);
    return false;
  }
}

// ============================================
// Checklist API functions
// ============================================

// Get checklist items + auto-complete states
export async function getChecklist(partyId: string): Promise<ChecklistData | null> {
  try {
    return await apiRequest<ChecklistData>(`/api/parties/${partyId}/checklist`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching checklist:', error);
    return null;
  }
}

// Seed default GPP checklist items (idempotent)
export async function seedChecklist(partyId: string): Promise<{ items: ChecklistItem[]; seeded: boolean } | null> {
  try {
    return await apiRequest<{ items: ChecklistItem[]; seeded: boolean }>(`/api/parties/${partyId}/checklist/seed`, {
      method: 'POST',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error seeding checklist:', error);
    return null;
  }
}

// Create a custom checklist item
export async function createChecklistItem(
  partyId: string,
  data: { name: string; dueDate?: string | null }
): Promise<{ item: ChecklistItem } | null> {
  try {
    return await apiRequest<{ item: ChecklistItem }>(`/api/parties/${partyId}/checklist/items`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating checklist item:', error);
    return null;
  }
}

// Update a checklist item
export async function updateChecklistItem(
  partyId: string,
  itemId: string,
  data: { name?: string; dueDate?: string | null; sortOrder?: number }
): Promise<{ item: ChecklistItem } | null> {
  try {
    return await apiRequest<{ item: ChecklistItem }>(
      `/api/parties/${partyId}/checklist/items/${itemId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating checklist item:', error);
    return null;
  }
}

// Delete a custom checklist item
export async function deleteChecklistItem(partyId: string, itemId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/checklist/items/${itemId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    return false;
  }
}

// Toggle manual completion of a checklist item
export async function toggleChecklistItem(
  partyId: string,
  itemId: string
): Promise<{ item: ChecklistItem } | null> {
  try {
    return await apiRequest<{ item: ChecklistItem }>(
      `/api/parties/${partyId}/checklist/items/${itemId}/toggle`,
      {
        method: 'POST',
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error toggling checklist item:', error);
    return null;
  }
}

// ============================================
// Underboss Dashboard API
// ============================================

// ============================================
// Admin Management API
// ============================================

export async function fetchAdminMe(): Promise<{ isAdmin: boolean; role?: string; email?: string; name?: string; id?: string }> {
  return apiRequest('/api/admin/me');
}

export async function fetchAdminList(): Promise<AdminUser[]> {
  const result = await apiRequest<{ admins: AdminUser[] }>('/api/admin/list');
  return result.admins;
}

export async function addAdmin(data: { email: string; name?: string; role?: string }): Promise<AdminUser> {
  const result = await apiRequest<{ admin: AdminUser }>('/api/admin/add', {
    method: 'POST',
    body: data,
  });
  return result.admin;
}

export async function removeAdmin(id: string): Promise<void> {
  await apiRequest(`/api/admin/${id}`, { method: 'DELETE' });
}

// ============================================
// Underboss Admin API (management)
// ============================================

export async function fetchUnderbossList(): Promise<UnderbossAdmin[]> {
  const result = await apiRequest<{ underbosses: UnderbossAdmin[] }>('/api/underboss/admin/list');
  return result.underbosses;
}

export async function createUnderboss(data: { name: string; email: string; regions: string[]; notes?: string }): Promise<{ underboss: UnderbossAdmin }> {
  return apiRequest('/api/underboss/admin/create', {
    method: 'POST',
    body: data,
  });
}

export async function updateUnderboss(id: string, data: { regions: string[] }): Promise<UnderbossAdmin> {
  const result = await apiRequest<{ underboss: UnderbossAdmin }>(`/api/underboss/admin/${id}`, {
    method: 'PATCH',
    body: data,
  });
  return result.underboss;
}

export async function deactivateUnderboss(id: string): Promise<void> {
  await apiRequest(`/api/underboss/admin/${id}`, { method: 'DELETE' });
}

// ============================================
// Underboss Dashboard API
// ============================================

// Fetch current user's underboss status
export interface UnderbossMeResponse {
  isAdmin: boolean;
  isUnderboss: boolean;
  region: string | null;
  regions: string[];
  name: string | null;
  email: string;
}

export async function fetchUnderbossMe(): Promise<UnderbossMeResponse> {
  return apiRequest<UnderbossMeResponse>('/api/underboss/me');
}

// Fetch underboss dashboard data (JWT auth)
export async function fetchUnderbossDashboard(
  region: GPPRegion | 'all'
): Promise<UnderbossDashboardData> {
  return apiRequest<UnderbossDashboardData>(`/api/underboss/${region}`);
}

// ============================================
// Venue Photo API functions
// ============================================

// Create venue photo record
export async function createVenuePhoto(
  partyId: string,
  venueId: string,
  data: {
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    width?: number;
    height?: number;
    caption?: string;
    category?: VenuePhotoCategory;
  }
): Promise<VenuePhoto | null> {
  try {
    const response = await apiRequest<{ photo: VenuePhoto }>(
      `/api/parties/${partyId}/venues/${venueId}/photos`,
      {
        method: 'POST',
        body: data,
        requireAuth: true,
      }
    );
    return response.photo;
  } catch (error) {
    console.error('Error creating venue photo:', error);
    throw error;
  }
}

// List venue photos
export async function getVenuePhotos(
  partyId: string,
  venueId: string
): Promise<VenuePhoto[]> {
  try {
    const response = await apiRequest<{ photos: VenuePhoto[] }>(
      `/api/parties/${partyId}/venues/${venueId}/photos`,
      {
        method: 'GET',
        requireAuth: true,
      }
    );
    return response.photos;
  } catch (error) {
    console.error('Error fetching venue photos:', error);
    return [];
  }
}

// Update venue photo
export async function updateVenuePhoto(
  partyId: string,
  venueId: string,
  photoId: string,
  data: { caption?: string; category?: VenuePhotoCategory; sortOrder?: number }
): Promise<VenuePhoto | null> {
  try {
    const response = await apiRequest<{ photo: VenuePhoto }>(
      `/api/parties/${partyId}/venues/${venueId}/photos/${photoId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
    return response.photo;
  } catch (error) {
    console.error('Error updating venue photo:', error);
    throw error;
  }
}

// Delete venue photo
export async function deleteVenuePhoto(
  partyId: string,
  venueId: string,
  photoId: string
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/venues/${venueId}/photos/${photoId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting venue photo:', error);
    return false;
  }
}

// ============================================
// Venue Report API functions
// ============================================

// Get venue report data (host only)
export async function getVenueReport(partyId: string): Promise<VenueReport | null> {
  try {
    const response = await apiRequest<{ venueReport: VenueReport }>(
      `/api/parties/${partyId}/venue-report`,
      {
        method: 'GET',
        requireAuth: true,
      }
    );
    return response.venueReport;
  } catch (error) {
    console.error('Error fetching venue report:', error);
    return null;
  }
}

// Update venue report title/notes
export async function updateVenueReport(
  partyId: string,
  data: { title?: string | null; notes?: string | null }
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/venue-report`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error updating venue report:', error);
    return false;
  }
}

// Publish venue report
export async function publishVenueReport(
  partyId: string,
  password?: string
): Promise<{ venueReportSlug: string; publicUrl: string } | null> {
  try {
    return await apiRequest<{ success: boolean; venueReportSlug: string; publicUrl: string }>(
      `/api/parties/${partyId}/venue-report/publish`,
      {
        method: 'POST',
        body: password ? { password } : undefined,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error publishing venue report:', error);
    return null;
  }
}

// Unpublish venue report
export async function unpublishVenueReport(partyId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/venue-report/publish`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error unpublishing venue report:', error);
    return false;
  }
}

// Check if published venue report requires password (public)
export async function checkVenueReportPassword(
  slug: string
): Promise<{ requiresPassword: boolean; name: string; title: string | null } | null> {
  try {
    return await apiRequest<{ requiresPassword: boolean; name: string; title: string | null }>(
      `/api/reports/public/${slug}/venue/check`,
      { method: 'GET', requireAuth: false }
    );
  } catch {
    return null;
  }
}

// Fetch published venue report (public, with optional password)
export async function fetchPublicVenueReport(
  slug: string,
  password?: string
): Promise<{ venueReport: VenueReport } | null> {
  try {
    const params = password ? `?password=${encodeURIComponent(password)}` : '';
    return await apiRequest<{ venueReport: VenueReport }>(
      `/api/reports/public/${slug}/venue${params}`,
      {
        method: 'GET',
        requireAuth: false,
      }
    );
  } catch (error) {
    console.error('Error fetching public venue report:', error);
    return null;
  }
}
