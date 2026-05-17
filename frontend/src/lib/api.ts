import { Pizzeria, Donation, DonationPublicStats, Photo, PhotoStats, Sponsor, SponsorStats, SponsorStatus, SponsorshipType, VenueStatus, Venue, VenuePhoto, VenuePhotoCategory, VenueReport, Performer, PerformersResponse, EventReport, SocialPost, NotableAttendee, Staff, StaffStats, StaffStatus, Display, DisplayContentType, DisplayContentConfig, DisplayViewerData, Raffle, RafflePrize, RaffleEntry, RaffleWinner, BudgetOverview, BudgetItem, BudgetCategory, BudgetStatus, PartyKit, KitTier, ChecklistItem, ChecklistData, PageViewStats, LinkClickStats, UnderbossDashboardData, GPPRegion, AdminUser, UnderbossAdmin, ShippingKit, ShippingKitStats, ShippingCoordinator, ShippingMeResponse, SponsorUser, SponsorMeResponse, SponsorDashboardData, SponsorChecklistItem, UnifiedPartner, GraphicsAdmin, FakeDetectionResponse } from '../types';

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

// Homepage events (single-call, slim payload)
export interface UserPartyListItem {
  id: string;
  name: string;
  inviteCode: string;
  date: string | null;
  address: string | null;
  eventImageUrl: string | null;
  guestCount: number;
  role: 'host' | 'guest' | 'cohost';
}

export async function fetchMyEvents(): Promise<UserPartyListItem[]> {
  const res = await apiRequest<{ parties: UserPartyListItem[] }>('/api/parties/my-events');
  return res.parties;
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
  placeId?: string;
  maxGuests?: number;
  hideGuests?: boolean;
  requireApproval?: boolean;
  availableBeverages?: string[];
  availableToppings?: string[];
  availableDietaryOptions?: string[];
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
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
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
  availableDietaryOptions?: string[];
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
  flyerGeneratedAt?: string | null;
  flyerConfig?: Record<string, any> | null;
  posterImageUrl?: string | null;
  posterGeneratedAt?: string | null;
  rollupImageUrl?: string | null;
  rollupGeneratedAt?: string | null;
  hiddenGppPhotos?: string[];
  extraGppPhotos?: string[];
  lumaUrl?: string | null;
  meetupUrl?: string | null;
  eventbriteUrl?: string | null;
  externalLinks?: Array<{label: string; url: string}>;
  country?: string | null;
  expectedGuests?: number | null;
  telegramGroup?: string | null;
  hostTelegramLinkToken?: string | null;
  turtleRolesEnabled?: boolean;
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
      placeId: data.placeId,
      venueName: data.venueName,
      maxGuests: data.maxGuests,
      hideGuests: data.hideGuests,
      requireApproval: data.requireApproval,
      availableBeverages: data.availableBeverages,
      availableToppings: data.availableToppings,
      availableDietaryOptions: data.availableDietaryOptions,
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
      latitude: data.latitude,
      longitude: data.longitude,
      placeId: data.placeId,
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
      availableDietaryOptions: data.availableDietaryOptions,
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
      flyerGeneratedAt: data.flyerGeneratedAt,
      flyerConfig: data.flyerConfig,
      posterImageUrl: data.posterImageUrl,
      posterGeneratedAt: data.posterGeneratedAt,
      rollupImageUrl: data.rollupImageUrl,
      rollupGeneratedAt: data.rollupGeneratedAt,
      hiddenGppPhotos: data.hiddenGppPhotos,
      extraGppPhotos: data.extraGppPhotos,
      lumaUrl: data.lumaUrl,
      meetupUrl: data.meetupUrl,
      eventbriteUrl: data.eventbriteUrl,
      externalLinks: data.externalLinks,
      country: data.country,
      expectedGuests: data.expectedGuests,
      telegramGroup: data.telegramGroup,
      hostTelegramLinkToken: data.hostTelegramLinkToken,
      turtleRolesEnabled: data.turtleRolesEnabled,
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

// Bulk CSV invites (Promo app → POST /api/v1/parties/:partyId/guests/bulk-invite)
export interface BulkInviteResult {
  sent: string[];
  failed: Array<{ email: string; reason: string }>;
  skipped: Array<{ email: string; reason: string }>;
  createdGuestIds: string[];
}

export async function bulkInviteGuests(
  partyId: string,
  guests: Array<{ name: string; email: string }>,
  customMessage?: string,
  testOnly?: boolean
): Promise<BulkInviteResult> {
  return apiRequest<BulkInviteResult>(
    `/api/v1/parties/${partyId}/guests/bulk-invite`,
    {
      method: 'POST',
      body: { guests, customMessage, ...(testOnly && { testOnly: true }) },
    }
  );
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
export interface PublicEventSponsor {
  id: string;
  name: string;
  website: string | null;
  brandDescription: string | null;
  logoUrl: string | null;
  brandTwitter: string | null;
}

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
  availableDietaryOptions: string[];
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
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
  underbossStatus?: string | null;
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
  hiddenGppPhotos?: string[];
  extraGppPhotos?: string[];
  telegramGroup?: string | null;
  turtleRolesEnabled?: boolean;
  sponsors?: PublicEventSponsor[];
  pageViewStats?: { totalViews: number; uniqueVisitors: number };
}

// Public Event API (no auth required)
export async function getEventBySlug(slug: string): Promise<PublicEvent | { redirect: true; slug: string } | null> {
  try {
    const response = await fetch(`${API_URL}/api/events/${slug}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await response.json();

    // Handle redirect response from slug aliases (301)
    if (data.redirect) {
      return { redirect: true, slug: data.slug };
    }

    if (!response.ok) {
      return null;
    }

    return data.event || null;
  } catch (error) {
    console.error('Error fetching event:', error);
    return null;
  }
}

// One Sheet interest form
export interface OneSheetInterestData {
  name: string;
  email: string;
  company: string;
  message?: string;
}

export async function submitOneSheetInterest(slug: string, data: OneSheetInterestData): Promise<{ success: boolean; id: string }> {
  const response = await fetch(`${API_URL}/api/events/${slug}/interest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    const err = new Error(error.message || error.error || `API error: ${response.status}`);
    (err as any).status = response.status;
    throw err;
  }

  return response.json();
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
  photoYear?: number;
  duration?: number; // Video duration in seconds
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
  data: { caption?: string; tags?: string[]; starred?: boolean; status?: string; photoYear?: number | null }
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

// Get available photo tags for a party (defaults + confirmed sponsor names)
export async function getPhotoTags(partyId: string): Promise<{ tags: string[]; defaultTags: string[]; sponsorTags: string[] } | null> {
  try {
    return await apiRequest<{ tags: string[]; defaultTags: string[]; sponsorTags: string[] }>(`/api/parties/${partyId}/photos/tags`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photo tags:', error);
    return null;
  }
}

// Sponsor CRM API functions

export interface CreateSponsorData {
  name: string;
  website?: string;
  brandTwitter?: string;
  brandInstagram?: string;
  brandDescription?: string;
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
  category?: string;
}

export interface UpdateSponsorData extends Partial<CreateSponsorData> {}

export interface SponsorFilters {
  status?: SponsorStatus;
  sortBy?: 'createdAt' | 'name' | 'amount' | 'lastContactedAt' | 'status';
  sortDir?: 'asc' | 'desc';
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
    if (filters.sortDir) params.append('sortDir', filters.sortDir);

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

// Reorder sponsors (host only) — persists sortOrder for flyer logo row
export async function reorderSponsors(
  partyId: string,
  sponsorIds: string[]
): Promise<{ sponsors: Sponsor[] } | null> {
  try {
    return await apiRequest<{ sponsors: Sponsor[] }>(
      `/api/parties/${partyId}/sponsors/reorder`,
      {
        method: 'PATCH',
        body: { sponsorIds },
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error reordering sponsors:', error);
    throw error;
  }
}

// Performer/Music API functions

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
  cityFormattedName?: string;
  cityLat?: number;
  cityLng?: number;
  timezone?: string;
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

// Unified sponsors (event + underboss partners)
export async function getUnifiedSponsors(partyId: string): Promise<{ partners: UnifiedPartner[] }> {
  return apiRequest<{ partners: UnifiedPartner[] }>(`/api/parties/${partyId}/sponsors/unified`);
}

export async function ensureUnderbossSponsors(
  partyId: string,
  sponsorUserIds: string[]
): Promise<{ createdSponsorIds: string[] }> {
  return apiRequest<{ createdSponsorIds: string[] }>(
    `/api/parties/${partyId}/sponsors/ensure-from-underboss`,
    {
      method: 'POST',
      body: { sponsorUserIds },
    }
  );
}

// Partner Intake Form API functions

export interface PartnerIntakeData {
  name?: string;
  website?: string;
  brandTwitter?: string;
  brandInstagram?: string;
  brandDescription?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTwitter?: string;
  telegram?: string;
  sponsorshipType?: SponsorshipType | null;
  productService?: string;
  logoUrl?: string;
  sponsorMessage?: string;
}

export interface PartnerIntakeResponse {
  sponsor: {
    name: string;
    website: string | null;
    brandTwitter: string | null;
    brandInstagram: string | null;
    brandDescription: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactTwitter: string | null;
    telegram: string | null;
    sponsorshipType: string | null;
    productService: string | null;
    logoUrl: string | null;
    sponsorMessage: string | null;
    intakeSubmittedAt: string | null;
  };
  eventName: string;
}

// Public: Get partner intake data by token (no auth)
export async function getPartnerIntake(token: string): Promise<PartnerIntakeResponse | null> {
  try {
    const response = await fetch(`${API_URL}/api/partner-intake/${token}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('Failed to fetch intake data');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching partner intake:', error);
    return null;
  }
}

// Public: Submit partner intake form (no auth)
export async function submitPartnerIntake(token: string, data: PartnerIntakeData): Promise<boolean> {
  const response = await fetch(`${API_URL}/api/partner-intake/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Submission failed' }));
    throw new Error(error.message || 'Failed to submit intake form');
  }
  return true;
}

// Auth: Generate partner intake token
export async function generatePartnerIntakeToken(
  partyId: string,
  sponsorId: string
): Promise<{ token: string; url: string } | null> {
  try {
    return await apiRequest<{ token: string; url: string }>(
      `/api/partner-intake/generate-token/${partyId}/${sponsorId}`,
      { method: 'POST', requireAuth: true }
    );
  } catch (error) {
    console.error('Error generating intake token:', error);
    throw error;
  }
}

// Auth: Revoke partner intake token
export async function revokePartnerIntakeToken(
  partyId: string,
  sponsorId: string
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/partner-intake/revoke-token/${partyId}/${sponsorId}`,
      { method: 'DELETE', requireAuth: true }
    );
    return true;
  } catch (error) {
    console.error('Error revoking intake token:', error);
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

// Venue API functions

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
  latitude?: number;
  longitude?: number;
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

// Report API functions

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

// Track link click on event page (public, fire-and-forget)
export function trackLinkClick(slug: string, url: string, linkType: string, linkLabel?: string): void {
  const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
  fetch(`${apiUrl}/api/events/${slug}/click`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, linkType, linkLabel: linkLabel || null }),
  }).catch(() => {});
}

// Track RSVP funnel step (public, fire-and-forget)
export function trackRsvpFunnel(slug: string, step: 'rsvp_opened' | 'rsvp_step1_complete'): void {
  const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
  fetch(`${apiUrl}/api/events/${slug}/funnel`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step }),
  }).catch(() => {});
}

// Get link click stats (host only)
export async function getLinkClickStats(partyId: string): Promise<LinkClickStats | null> {
  try {
    return await apiRequest<LinkClickStats>(`/api/parties/${partyId}/report/link-clicks`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching link click stats:', error);
    return null;
  }
}

// Staff API functions (host only)

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

// Display API functions

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

// Raffle API Functions

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

// Checklist API functions

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

// Underboss Dashboard API

// Admin Management API

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

// Underboss Admin API (management)

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

// GPP NFT Settings
export async function fetchGppNftSettings(): Promise<{ nftEnabled: boolean; nftChain: string }> {
  return apiRequest<{ nftEnabled: boolean; nftChain: string }>('/api/admin/gpp-nft');
}

export async function updateGppNftSettings(data: { nftEnabled: boolean; nftChain?: string }): Promise<{ updatedCount: number }> {
  return apiRequest<{ updatedCount: number }>('/api/admin/gpp-nft', {
    method: 'PATCH',
    body: data,
  });
}

// GPP Checklist Defaults
export interface ChecklistDefault {
  name: string;
  dueDate: string | null;
  sortOrder: number;
  isAuto: boolean;
  autoRule: string | null;
  linkTab: string | null;
}

export async function fetchChecklistDefaults(): Promise<{ items: ChecklistDefault[] }> {
  return apiRequest<{ items: ChecklistDefault[] }>('/api/admin/checklist-defaults');
}

export async function updateChecklistDefaults(items: Array<{ name: string; dueDate?: string | null; sortOrder?: number; newName?: string; linkTab?: string | null }>): Promise<{ totalUpdated: number }> {
  return apiRequest<{ totalUpdated: number }>('/api/admin/checklist-defaults', {
    method: 'PATCH',
    body: { items },
  });
}

export async function addChecklistDefault(data: { name: string; dueDate?: string | null; linkTab?: string | null }): Promise<{ createdCount: number }> {
  return apiRequest<{ createdCount: number }>('/api/admin/checklist-defaults', {
    method: 'POST',
    body: data,
  });
}

export async function deleteChecklistDefault(name: string): Promise<{ success: boolean; totalDeleted: number }> {
  return apiRequest<{ success: boolean; totalDeleted: number }>(`/api/admin/checklist-defaults/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

// Underboss Dashboard API

// Fetch current user's underboss status
export interface UnderbossMeResponse {
  isAdmin: boolean;
  isUnderboss: boolean;
  isGraphicsAdmin?: boolean;
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

// Fetch fake-event detection review queue (blackolive-74932)
export async function fetchFakeDetection(): Promise<FakeDetectionResponse> {
  return apiRequest<FakeDetectionResponse>('/api/underboss/fake-detection');
}

// Update host status on an event (underboss auth)
export async function updateHostStatus(
  partyId: string,
  hostStatus: 'new' | 'alum' | 'pro' | null
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/host-status`, {
    method: 'PATCH',
    body: { hostStatus },
  });
}

// Update underboss status on an event (underboss auth)
export async function updateUnderbossStatus(
  partyId: string,
  status: 'pending' | 'approved' | 'rejected' | 'listed' | 'hidden'
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/status`, {
    method: 'PATCH',
    body: { status },
  });
}

// Update host tags on an event (underboss auth)
export async function updateHostTags(
  partyId: string,
  tags: string[]
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/tags`, {
    method: 'PATCH',
    body: { tags },
  });
}

// Update underboss notes on an event (underboss auth)
export async function updateUnderbossNotes(
  partyId: string,
  notes: string | null
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/notes`, {
    method: 'PATCH',
    body: { notes },
  });
}

// Update expected guests on an event (underboss auth)
export async function updateExpectedGuests(
  partyId: string,
  expectedGuests: number | null
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/expected-guests`, {
    method: 'PATCH',
    body: { expectedGuests },
  });
}

// Bulk update underboss status (underboss auth)
export async function bulkUpdateUnderbossStatus(partyIds: string[], status: 'pending' | 'approved' | 'rejected'): Promise<void> {
  await apiRequest('/api/underboss/events/bulk-status', {
    method: 'PATCH',
    body: { partyIds, status },
  });
}

// Bulk delete events (underboss auth)
export async function bulkDeleteEvents(partyIds: string[]): Promise<void> {
  await apiRequest('/api/underboss/events/bulk-delete', {
    method: 'DELETE',
    body: { partyIds },
  });
}

// Bulk update event tags (underboss auth)
export async function bulkUpdateEventTags(
  partyIds: string[],
  tags: string[],
  action: 'add' | 'remove' | 'set'
): Promise<void> {
  await apiRequest('/api/underboss/events/bulk-event-tags', {
    method: 'PATCH',
    body: { partyIds, tags, action },
  });
}

// City Status API (Underboss)

export interface CityStatusMap {
  [cityKey: string]: { status: string; priority: boolean; updatedBy: string | null; updatedAt: string };
}

export async function fetchCityStatuses(): Promise<CityStatusMap> {
  return apiRequest<CityStatusMap>('/api/underboss/city-statuses');
}

export async function updateCityStatus(
  cityKey: string,
  patch: { status?: 'created' | 'skip' | 'todo'; priority?: boolean }
): Promise<void> {
  await apiRequest('/api/underboss/city-statuses', {
    method: 'PATCH',
    body: { cityKey, ...patch },
  });
}

// Shipping Dashboard API

// Fetch current user's shipping role
export async function fetchShippingMe(): Promise<ShippingMeResponse> {
  return apiRequest<ShippingMeResponse>('/api/shipping/me');
}

// Fetch shipping kit stats
export async function fetchShippingStats(): Promise<{ stats: ShippingKitStats }> {
  return apiRequest<{ stats: ShippingKitStats }>('/api/shipping/stats');
}

// Fetch shipping kits with filters
export interface ShippingKitFilters {
  status?: string;
  tier?: string;
  country?: string;
  region?: string;
  search?: string;
  sort?: string;
}

export async function fetchShippingKits(filters?: ShippingKitFilters): Promise<{ kits: ShippingKit[] }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
  }
  const qs = params.toString();
  return apiRequest<{ kits: ShippingKit[] }>(`/api/shipping/kits${qs ? `?${qs}` : ''}`);
}

// Update a single shipping kit
export async function updateShippingKit(kitId: string, data: {
  status?: string;
  allocatedTier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  adminNotes?: string;
}): Promise<{ kit: ShippingKit }> {
  return apiRequest<{ kit: ShippingKit }>(`/api/shipping/kits/${kitId}`, {
    method: 'PATCH',
    body: data,
  });
}

// Bulk update shipping kits
export async function bulkUpdateShippingKits(kitIds: string[], updates: {
  status?: string;
  allocatedTier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  adminNotes?: string;
}): Promise<{ updated: number }> {
  return apiRequest<{ updated: number }>('/api/shipping/kits/bulk-update', {
    method: 'PATCH',
    body: { kitIds, updates },
  });
}

// Import tracking numbers in bulk from CSV
export async function importShippingTracking(items: { kitId: string; trackingNumber?: string; trackingUrl?: string }[]): Promise<{ updated: number; skipped: number; notFound: string[] }> {
  return apiRequest<{ updated: number; skipped: number; notFound: string[] }>('/api/shipping/kits/import-tracking', {
    method: 'POST',
    body: { items },
  });
}

// Export shipping kits CSV
export async function exportShippingKitsCsv(filters?: ShippingKitFilters): Promise<Blob> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
  }
  const qs = params.toString();
  const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
  const token = localStorage.getItem('authToken');
  const response = await fetch(`${API_URL}/api/shipping/kits/export${qs ? `?${qs}` : ''}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to export CSV');
  }
  return response.blob();
}

// Coordinator management (admin only)
export async function fetchShippingCoordinators(): Promise<{ coordinators: ShippingCoordinator[] }> {
  return apiRequest<{ coordinators: ShippingCoordinator[] }>('/api/shipping/admin/coordinators');
}

export async function createShippingCoordinator(data: { name: string; email: string; regions: string[]; notes?: string }): Promise<{ coordinator: ShippingCoordinator }> {
  return apiRequest<{ coordinator: ShippingCoordinator }>('/api/shipping/admin/coordinators', {
    method: 'POST',
    body: data,
  });
}

export async function updateShippingCoordinator(id: string, data: { name?: string; email?: string; regions?: string[]; notes?: string; isActive?: boolean }): Promise<{ coordinator: ShippingCoordinator }> {
  return apiRequest<{ coordinator: ShippingCoordinator }>(`/api/shipping/admin/coordinators/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deactivateShippingCoordinator(id: string): Promise<void> {
  await apiRequest(`/api/shipping/admin/coordinators/${id}`, { method: 'DELETE' });
}

// Venue Photo API functions

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

// Venue Report API functions

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

// Telegram broadcast API functions

export interface BroadcastGroup {
  chatId: string;
  city: string;
  country: string;
}

export interface BroadcastResult {
  chatId: string;
  city: string;
  success: boolean;
  error?: string;
}

export interface BroadcastResponse {
  results: BroadcastResult[];
  sent: number;
  failed: number;
}

export async function sendTelegramBroadcast(
  groups: BroadcastGroup[],
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None'
): Promise<BroadcastResponse> {
  return apiRequest<BroadcastResponse>('/api/underboss/telegram/broadcast', {
    method: 'POST',
    body: { groups, message, parseMode },
  });
}

export async function sendTelegramTest(
  chatId: string,
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None'
): Promise<BroadcastResult> {
  return apiRequest<BroadcastResult>('/api/underboss/telegram/test', {
    method: 'POST',
    body: { chatId, message, parseMode },
  });
}

// Host Telegram (bot-DM) API functions — backed by sausage-24183 backend routes.

export interface BroadcastHost {
  partyId: string;
  city: string;
  hostName: string;
}

export async function sendHostTelegramBroadcast(
  hosts: BroadcastHost[],
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None'
): Promise<BroadcastResponse> {
  return apiRequest<BroadcastResponse>('/api/underboss/telegram/host-broadcast', {
    method: 'POST',
    body: { hosts, message, parseMode },
  });
}

export async function sendHostTelegramTest(
  partyId: string,
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None'
): Promise<BroadcastResult> {
  return apiRequest<BroadcastResult>('/api/underboss/telegram/host-test', {
    method: 'POST',
    body: { partyId, message, parseMode },
  });
}

export async function mintHostTelegramConnectToken(
  partyId: string
): Promise<{ token: string; deeplink: string }> {
  return apiRequest<{ token: string; deeplink: string }>(`/api/parties/${partyId}/connect-token`, {
    method: 'POST',
  });
}

export async function disconnectHostTelegram(
  partyId: string
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/parties/${partyId}/host-telegram`, {
    method: 'DELETE',
  });
}

// Sponsor Dashboard API

export async function fetchSponsorMe(): Promise<SponsorMeResponse> {
  return apiRequest<SponsorMeResponse>('/api/sponsor/me');
}

export async function fetchSponsorEvents(tag?: string): Promise<SponsorDashboardData> {
  const params = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return apiRequest<SponsorDashboardData>(`/api/sponsor/events${params}`);
}

// Admin-only time-series for partner dashboard chart
export type PartnerTimeSeriesRange = '6hr' | '24hr' | '3d' | '7d';

export interface PartnerTimeSeriesPoint {
  timestamp: string;
  rsvps: number;
  impressions: number;
  clicks: number;
}

export interface PartnerTimeSeriesResponse {
  range: PartnerTimeSeriesRange;
  bucket: 'hour';
  since: string;
  points: PartnerTimeSeriesPoint[];
}

export async function fetchSponsorEventsTimeSeries(
  range: PartnerTimeSeriesRange = '24hr',
  tag?: string
): Promise<PartnerTimeSeriesResponse> {
  const params = new URLSearchParams();
  params.set('range', range);
  if (tag) params.set('tag', tag);
  return apiRequest<PartnerTimeSeriesResponse>(`/api/sponsor/events/timeseries?${params.toString()}`);
}

export async function toggleSponsorChecklistItem(itemId: string): Promise<{ item: SponsorChecklistItem }> {
  return apiRequest<{ item: SponsorChecklistItem }>(`/api/sponsor/checklist/${itemId}/toggle`, {
    method: 'POST',
  });
}

export async function updatePartnerEventNote(partyId: string, notes: string): Promise<{ success: boolean; notes: string }> {
  return apiRequest<{ success: boolean; notes: string }>('/api/sponsor/notes', {
    method: 'PUT',
    body: { partyId, notes },
  });
}

// Sponsor User Admin API

export async function fetchSponsorUsers(): Promise<{ sponsorUsers: SponsorUser[]; tagCounts: Record<string, number> }> {
  return apiRequest<{ sponsorUsers: SponsorUser[]; tagCounts: Record<string, number> }>('/api/sponsor-users/list');
}

export interface SponsorUserCreateData {
  email: string;
  tag: string;
  name?: string;
  notes?: string;
  coHostName?: string;
  coHostWebsite?: string;
  coHostTwitter?: string;
  coHostInstagram?: string;
  coHostAvatarUrl?: string;
  coHostLogoUrl?: string;
  autoCoHost?: boolean;
  autoSponsor?: boolean;
  coHostShowOnEvent?: boolean;
  coHostCanEdit?: boolean;
  coHostAllowedTabs?: string[] | null;
  category?: string;
  brandDescription?: string;
}

export async function createSponsorUser(data: SponsorUserCreateData): Promise<{ sponsorUser: SponsorUser; syncedCount: number }> {
  return apiRequest<{ sponsorUser: SponsorUser; syncedCount: number }>('/api/sponsor-users', {
    method: 'POST',
    body: data,
  });
}

export interface SponsorUserUpdateData {
  email?: string;
  name?: string;
  tag?: string;
  notes?: string;
  isActive?: boolean;
  coHostName?: string;
  coHostWebsite?: string;
  coHostTwitter?: string;
  coHostInstagram?: string;
  coHostAvatarUrl?: string;
  coHostLogoUrl?: string;
  autoCoHost?: boolean;
  autoSponsor?: boolean;
  coHostShowOnEvent?: boolean;
  coHostCanEdit?: boolean;
  coHostAllowedTabs?: string[] | null;
  category?: string;
  brandDescription?: string;
}

export async function updateSponsorUser(id: string, data: SponsorUserUpdateData): Promise<{ sponsorUser: SponsorUser; syncedCount: number }> {
  return apiRequest<{ sponsorUser: SponsorUser; syncedCount: number }>(`/api/sponsor-users/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteSponsorUser(id: string): Promise<void> {
  await apiRequest(`/api/sponsor-users/${id}`, { method: 'DELETE' });
}

// Reorder sponsor users (admin) — updates descriptionSortOrder based on array position
export async function reorderSponsorUsers(sponsorUserIds: string[]): Promise<void> {
  await apiRequest('/api/sponsor-users/reorder', {
    method: 'PATCH',
    body: { sponsorUserIds },
  });
}

// User Sponsorship Profile

export interface UserSponsorshipEntry {
  id: string;
  brandName: string;
  brandLogo: string | null;
  brandDescription: string | null;
  brandInstagram: string | null;
  sponsorshipType: string | null;
  amount: number | null;
  status: string;
  intakeSubmittedAt: string;
  party: {
    id: string;
    name: string;
    customUrl: string | null;
    date: string | null;
    eventImageUrl: string | null;
  };
}

export async function getUserSponsorships(): Promise<UserSponsorshipEntry[]> {
  return apiRequest<UserSponsorshipEntry[]>('/api/user/sponsorships');
}

// GPP Default Description Admin API

export interface GppDescriptionData {
  defaultDescription: string;
  totalGppEvents: number;
  defaultCount: number;
  customizedEvents: Array<{
    id: string;
    name: string;
    customUrl: string | null;
    inviteCode: string;
    descriptionPreview: string;
  }>;
}

export async function fetchGppDescription(): Promise<GppDescriptionData> {
  return apiRequest<GppDescriptionData>('/api/admin/gpp-description');
}

export async function updateGppDescription(description: string): Promise<{
  success: boolean;
  updatedCount: number;
  skippedCount: number;
  newDefault: string;
}> {
  return apiRequest('/api/admin/gpp-description', {
    method: 'PATCH',
    body: { description },
  });
}

// ── QR Peer Attestation Check-In ──

export interface VouchResponse {
  success: boolean;
  alreadyCheckedIn?: boolean;
  guest?: {
    id: string;
    name: string;
    checkedInAt: string;
  };
  message?: string;
}

/** Host/co-host self-check-in (bootstraps the chain of trust) */
export async function hostSelfCheckIn(inviteCode: string): Promise<VouchResponse> {
  return apiRequest<VouchResponse>(`/api/checkin/${inviteCode}/self-host`, {
    method: 'POST',
  });
}

/** Vouch for another guest — caller must already be checked in */
export async function vouchForGuest(inviteCode: string, targetGuestId: string): Promise<VouchResponse> {
  return apiRequest<VouchResponse>(`/api/checkin/${inviteCode}/vouch`, {
    method: 'POST',
    body: { targetGuestId },
  });
}

// ── Post-Event Discount Claim ──

export interface DiscountStatusResponse {
  guestName: string;
  isCheckedIn: boolean;
  hasEnded: boolean;
  discountClaimedAt: string | null;
}

export interface DiscountClaimResponse {
  success: boolean;
  alreadyClaimed: boolean;
  claimedAt: string;
}

/** Get discount eligibility status for a guest (no auth required) */
export async function getDiscountStatus(inviteCode: string, guestId: string): Promise<DiscountStatusResponse> {
  return apiRequest<DiscountStatusResponse>(`/api/checkin/${inviteCode}/${guestId}/discount`, {
    requireAuth: false,
  });
}

/** Claim post-event discount for a checked-in guest (no auth required) */
export async function claimDiscount(inviteCode: string, guestId: string): Promise<DiscountClaimResponse> {
  return apiRequest<DiscountClaimResponse>(`/api/checkin/${inviteCode}/${guestId}/discount`, {
    method: 'POST',
    requireAuth: false,
  });
}

// ── Graphics Admin Management ──

export async function fetchGraphicsAdminList(): Promise<GraphicsAdmin[]> {
  const data = await apiRequest<{ admins: GraphicsAdmin[] }>('/api/graphics-admin/list');
  return data.admins;
}

export async function addGraphicsAdmin(data: { email: string; name?: string }): Promise<GraphicsAdmin> {
  const result = await apiRequest<{ admin: GraphicsAdmin }>('/api/graphics-admin/add', {
    method: 'POST',
    body: data,
  });
  return result.admin;
}

export async function removeGraphicsAdmin(id: string): Promise<void> {
  await apiRequest(`/api/graphics-admin/${id}`, { method: 'DELETE' });
}

// GPP Pizzerias Map
export interface GPPPizzeriaMapItem {
  id: string;
  name: string;
  address: string;
  url?: string;
  rating?: number;
  reviewCount?: number;
  description?: string;
  photoUrl?: string;
  placeId?: string;
  location: { lat: number; lng: number };
  eventCity: string;
  eventSlug: string;
  eventId: string;
}

export async function fetchGppPizzerias(): Promise<GPPPizzeriaMapItem[]> {
  return apiRequest<GPPPizzeriaMapItem[]>('/api/gpp/pizzerias', { requireAuth: false });
}

export async function saveGppPizzeriaPhoto(eventId: string, placeId: string, photoUrl: string): Promise<void> {
  await apiRequest(`/api/gpp/pizzerias/${eventId}/photo`, {
    method: 'PATCH',
    body: { placeId, photoUrl },
    requireAuth: false,
  });
}

// GPP Events Map
export interface GPPEventMapItem {
  id: string;
  name: string;
  city: string;
  slug: string;
  date: string | null;
  venueName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rsvpCount: number;
  country: string | null;
  underbossStatus?: string | null;
  eventTags?: string[];
}

interface GPPEventApiResponse {
  id: string;
  name: string;
  city: string;
  customUrl: string | null;
  inviteCode: string;
  date: string | null;
  venueName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  guestCount: number;
  country: string | null;
  underbossStatus?: string | null;
  eventTags?: string[];
}

interface GPPEventsApiPayload {
  events: GPPEventApiResponse[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchGppEventsForMap(force?: boolean, curated?: boolean, includeAll?: boolean): Promise<GPPEventMapItem[]> {
  const params: string[] = ['limit=2000'];
  if (curated) params.push('curated=1');
  // `statuses=all` is the auth-gated path on the backend — only returns
  // rejected/hidden events when the caller is an authenticated underboss/admin.
  // Unauthenticated callers silently fall back to the filtered view.
  if (includeAll) params.push('statuses=all');
  if (force) params.push(`_t=${Date.now()}`);
  const url = `/api/gpp/events?${params.join('&')}`;
  const data = await apiRequest<GPPEventsApiPayload>(url, {
    requireAuth: false,
  });
  let events = (data.events || []).map((e) => ({
    id: e.id,
    name: e.name,
    city: e.city,
    slug: e.customUrl || e.inviteCode,
    date: e.date,
    venueName: e.venueName,
    address: e.address,
    latitude: e.latitude,
    longitude: e.longitude,
    rsvpCount: e.guestCount ?? 0,
    country: e.country,
    underbossStatus: e.underbossStatus,
    eventTags: e.eventTags ?? [],
  }));
  if (curated) {
    events = events.filter((e) => e.underbossStatus === 'approved' || e.underbossStatus === 'listed');
  }
  return events;
}

// GPP Partners (aggregated across approved GPP events)
export interface GPPPartner {
  name: string;
  logoUrl: string;
  website: string | null;
  brandDescription: string | null;
  brandTwitter: string | null;
  brandInstagram: string | null;
  category: string | null;
  eventCount: number;
  events: { slug: string; city: string; sponsorId: string }[];
}

export interface GPPPartnersResponse {
  partners: GPPPartner[];
  total: number;
  generatedAt: string;
}

export async function fetchGppPartners(): Promise<GPPPartnersResponse> {
  return apiRequest<GPPPartnersResponse>('/api/gpp/partners', { requireAuth: false });
}

// RSVP Funnel Stats (Underboss dashboard)

export interface FunnelEventStats {
  eventId: string;
  eventName: string;
  city: string;
  views: number;
  opened: number;
  step1Complete: number;
  submitted: number;
}

export interface FunnelStats {
  events: FunnelEventStats[];
  totals: {
    views: number;
    opened: number;
    step1Complete: number;
    submitted: number;
  };
}

// Fetch RSVP funnel stats for admin dashboard
export async function fetchFunnelStats(regions?: string[]): Promise<FunnelStats | null> {
  try {
    const params = regions && regions.length > 0 ? `?regions=${regions.join(',')}` : '';
    return await apiRequest<FunnelStats>(`/api/admin/funnel-stats${params}`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching funnel stats:', error);
    return null;
  }
}

// ── Guest Scorecard ──

export interface ScorecardItem {
  id: string;
  guestId: string;
  partyId: string;
  itemKey: string;
  completed: boolean;
  completedAt: string | null;
  proofUrl: string | null;
  proofType: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
}

export interface ScorecardResponse {
  items: ScorecardItem[];
  pizzaChefScore: number;
  totalItems: number;
}

export interface CompleteScorecardResponse {
  item: ScorecardItem;
  pizzaChefScore: number;
  totalItems: number;
}

export async function getScorecard(inviteCode: string): Promise<ScorecardResponse> {
  return apiRequest<ScorecardResponse>(`/api/scorecard/${inviteCode}`);
}

export async function completeScorecardItem(
  inviteCode: string,
  itemKey: string,
  proofUrl?: string,
  proofType?: string
): Promise<CompleteScorecardResponse> {
  return apiRequest<CompleteScorecardResponse>(`/api/scorecard/${inviteCode}/complete`, {
    method: 'POST',
    body: { itemKey, proofUrl, proofType },
  });
}

