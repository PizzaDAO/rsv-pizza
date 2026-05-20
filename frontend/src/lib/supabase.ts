import { createClient } from '@supabase/supabase-js';
import {
  createPartyApi,
  updatePartyApi,
  deletePartyApi,
  addGuestByHostApi,
  removeGuestApi,
  updateGuestApprovalApi,
  uncheckInGuestApi,
  promoteGuestApi,
} from './api';
import { uuid } from './utils';
import { sanitizeCoHosts } from './sanitizeCoHosts';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || '').trim();

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

const SUPABASE_STORAGE_PREFIX = 'https://znpiwdvvsqaxuskpfleo.supabase.co/storage/v1/object/public/';

/**
 * Rewrite a Supabase Storage public URL to go through the Vercel edge CDN.
 * Non-matching URLs pass through unchanged.
 */
export function cdnUrl(url: string): string {
  if (!url) return url;
  if (url.startsWith(SUPABASE_STORAGE_PREFIX)) {
    return '/cdn/' + url.slice(SUPABASE_STORAGE_PREFIX.length);
  }
  return url;
}

// Helper to check if user is authenticated
function isAuthenticated(): boolean {
  return !!localStorage.getItem('authToken');
}

/**
 * Upload a profile picture to Supabase Storage and return the public URL
 * @param file The image file to upload
 * @param userId The user's ID for organizing uploads
 * @returns The public URL of the uploaded image, or null if upload failed
 */
export async function uploadProfilePicture(file: File, userId: string): Promise<string | null> {
  try {
    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${userId}/${Date.now()}.${fileExt}`;

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from('profile-pictures')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: true
      });

    if (error) {
      console.error('Error uploading profile picture:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('profile-pictures')
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Error uploading profile picture:', error);
    return null;
  }
}

/**
 * Upload an image to Supabase Storage and return the public URL
 * @param file The image file to upload
 * @param bucket The storage bucket name (default: 'event-images')
 * @returns The public URL of the uploaded image, or null if upload failed
 */
export async function uploadEventImage(file: File, bucket: string = 'event-images'): Promise<string | null> {
  try {
    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    const filePath = fileName;

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from(bucket)
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Error uploading image:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from(bucket)
      .getPublicUrl(filePath);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Error uploading image:', error);
    return null;
  }
}

/**
 * Upload a sponsor logo to Supabase Storage and return the public URL
 * @param file The image file to upload
 * @returns The public URL of the uploaded logo, or null if upload failed
 */
export async function uploadSponsorLogo(file: File): Promise<string | null> {
  try {
    // Generate unique filename
    const fileExt = file.name.split('.').pop();
    const fileName = `sponsor-logos/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    // Upload to Supabase Storage (using event-images bucket for now)
    const { error } = await supabase.storage
      .from('event-images')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Error uploading sponsor logo:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Error uploading sponsor logo:', error);
    return null;
  }
}

/**
 * Upload a co-host avatar image directly to Supabase Storage and return the public URL.
 * Used by the cohost editor's file-upload affordance.
 */
export async function uploadCoHostAvatar(file: File): Promise<string | null> {
  try {
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const fileName = `co-host-avatars/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error } = await supabase.storage.from('event-images').upload(fileName, file, {
      cacheControl: '3600',
      upsert: false,
      contentType: file.type || 'image/jpeg',
    });
    if (error) {
      console.error('uploadCoHostAvatar:', error);
      return null;
    }
    const { data } = supabase.storage.from('event-images').getPublicUrl(fileName);
    return data.publicUrl;
  } catch (error) {
    console.error('uploadCoHostAvatar:', error);
    return null;
  }
}

/**
 * Proxy an external avatar image to Supabase Storage.
 * Skips if already a Supabase URL. Falls back to original URL on failure.
 */
export async function proxyAvatarToStorage(externalUrl: string): Promise<string> {
  // Skip if empty or already a Supabase storage URL
  if (!externalUrl || externalUrl.includes('.supabase.co/storage/')) {
    return externalUrl;
  }

  try {
    const response = await fetch(externalUrl);
    if (!response.ok) return externalUrl;

    const blob = await response.blob();

    // Determine extension from content-type
    const contentType = response.headers.get('content-type') || 'image/png';
    const extMap: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/gif': 'gif',
      'image/webp': 'webp',
      'image/svg+xml': 'svg',
    };
    const ext = extMap[contentType] || 'png';

    const fileName = `co-host-avatars/${Date.now()}-${Math.random().toString(36).substring(7)}.${ext}`;

    const { error } = await supabase.storage
      .from('event-images')
      .upload(fileName, blob, {
        cacheControl: '3600',
        upsert: false,
        contentType,
      });

    if (error) {
      console.error('Error proxying avatar:', error);
      return externalUrl;
    }

    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Error proxying avatar:', error);
    return externalUrl;
  }
}

/**
 * Upload an image for use in event descriptions (Markdown).
 * Stored under `description-images/{partyId}/` in the event-images bucket.
 * @param file The image file to upload
 * @param partyId The party ID for organizing uploads
 * @returns The public URL of the uploaded image, or null if upload failed
 */
export async function uploadDescriptionImage(file: File, partyId: string): Promise<string | null> {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `description-images/${partyId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    const { error } = await supabase.storage
      .from('event-images')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Error uploading description image:', error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Error uploading description image:', error);
    return null;
  }
}

/**
 * Upload a receipt file (image or PDF) to Supabase Storage and return the public URL
 * @param file The receipt file to upload (JPEG, PNG, WebP, or PDF)
 * @param partyId The party ID for organizing uploads
 * @returns The public URL of the uploaded receipt, or null if upload failed
 */
export async function uploadReceipt(file: File, partyId: string): Promise<string | null> {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
  if (!allowedTypes.includes(file.type)) {
    console.error('Invalid file type for receipt:', file.type);
    return null;
  }

  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    console.error('Receipt file too large:', file.size);
    return null;
  }

  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `receipts/${partyId}/${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;

    const { error } = await supabase.storage
      .from('event-images')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false
      });

    if (error) {
      console.error('Error uploading receipt:', error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(fileName);

    return urlData.publicUrl;
  } catch (error) {
    console.error('Error uploading receipt:', error);
    return null;
  }
}

/**
 * Upload a host payout photo (pizza shot OR receipt) to Supabase Storage.
 * Path: `payouts/{partyId}/{payoutTempId}/{kind}/{timestamp}-{rand}.{ext}`.
 *
 * Used by the payouts host flow (arugula-38633). The backend `/ocr-preview`
 * and `POST /payouts` endpoints validate that uploaded image URLs match this
 * exact path shape under the `event-images` bucket — so don't change the path
 * structure without updating `assertSupabasePayoutUrl` in
 * `backend/src/routes/payout.routes.ts`.
 *
 * @param file       The image file (JPEG / PNG / WebP / HEIC)
 * @param partyId    The party we're submitting a payout against
 * @param payoutTempId  A client-generated id to group files for one in-progress submission
 * @param kind       'pizza' or 'receipt' — drives OCR behavior server-side
 */
export async function uploadPayoutPhoto(
  file: File,
  partyId: string,
  payoutTempId: string,
  kind: 'pizza' | 'receipt'
): Promise<{
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
} | null> {
  const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  if (!allowedTypes.includes(file.type)) {
    console.error('Invalid file type for payout photo:', file.type);
    return null;
  }
  const maxSize = 10 * 1024 * 1024; // 10MB
  if (file.size > maxSize) {
    console.error('Payout photo too large:', file.size);
    return null;
  }

  try {
    const fileExt = (file.name.split('.').pop() || 'jpg').toLowerCase();
    const timestamp = Date.now();
    const rand = Math.random().toString(36).substring(7);
    const path = `payouts/${partyId}/${payoutTempId}/${kind}/${timestamp}-${rand}.${fileExt}`;

    const { error } = await supabase.storage
      .from('event-images')
      .upload(path, file, { cacheControl: '3600', upsert: false });

    if (error) {
      console.error('Error uploading payout photo:', error);
      return null;
    }

    const { data: urlData } = supabase.storage
      .from('event-images')
      .getPublicUrl(path);

    return {
      url: urlData.publicUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
    };
  } catch (err) {
    console.error('Error uploading payout photo:', err);
    return null;
  }
}

/**
 * Upload an event photo to Supabase Storage
 * @param file The image file to upload
 * @param partyId The party ID for organizing uploads
 * @returns Object with URL and metadata, or null if upload failed
 */
export async function uploadEventPhoto(
  file: File,
  partyId: string
): Promise<{
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
} | null> {
  try {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      console.error('Invalid file type:', file.type);
      return null;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      console.error('File too large:', file.size);
      return null;
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const fileName = `${partyId}/${timestamp}-${random}.${fileExt}`;

    // Get image dimensions
    let width: number | undefined;
    let height: number | undefined;

    try {
      const dimensions = await getImageDimensions(file);
      width = dimensions.width;
      height = dimensions.height;
    } catch (e) {
      console.warn('Could not get image dimensions:', e);
    }

    // Upload to Supabase Storage
    const { error } = await supabase.storage
      .from('event-photos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Error uploading photo:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('event-photos')
      .getPublicUrl(fileName);

    return {
      url: urlData.publicUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      width,
      height,
    };
  } catch (error) {
    console.error('Error uploading photo:', error);
    return null;
  }
}

/**
 * Upload a venue photo to Supabase Storage
 * @param file The image file to upload
 * @param partyId The party ID
 * @param venueId The venue ID
 * @returns Object with URL and metadata, or null if upload failed
 */
export async function uploadVenuePhoto(
  file: File,
  partyId: string,
  venueId: string
): Promise<{
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
} | null> {
  try {
    // Validate file type
    const allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
    if (!allowedTypes.includes(file.type)) {
      console.error('Invalid file type:', file.type);
      return null;
    }

    // Validate file size (10MB max)
    if (file.size > 10 * 1024 * 1024) {
      console.error('File too large:', file.size);
      return null;
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop() || 'jpg';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const fileName = `venues/${partyId}/${venueId}/${timestamp}-${random}.${fileExt}`;

    // Get image dimensions
    let width: number | undefined;
    let height: number | undefined;

    try {
      const dimensions = await getImageDimensions(file);
      width = dimensions.width;
      height = dimensions.height;
    } catch (e) {
      console.warn('Could not get image dimensions:', e);
    }

    // Upload to Supabase Storage (reuse event-photos bucket)
    const { error } = await supabase.storage
      .from('event-photos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Error uploading venue photo:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('event-photos')
      .getPublicUrl(fileName);

    return {
      url: urlData.publicUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      width,
      height,
    };
  } catch (error) {
    console.error('Error uploading venue photo:', error);
    return null;
  }
}

/**
 * Upload a video to Supabase Storage (event-videos bucket) and return public URL + metadata
 * @param file The video file to upload
 * @param partyId The party ID for organizing uploads
 * @returns Object with URL, metadata, and duration, or null if upload failed
 */
export async function uploadEventVideo(
  file: File,
  partyId: string
): Promise<{
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
  duration?: number;
} | null> {
  try {
    // Validate video MIME types
    const allowedVideoTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
    if (!allowedVideoTypes.includes(file.type)) {
      console.error('Invalid video file type:', file.type);
      return null;
    }

    // Validate file size (50MB max for videos)
    if (file.size > 50 * 1024 * 1024) {
      console.error('Video file too large:', file.size);
      return null;
    }

    // Get video duration and dimensions
    let duration: number | undefined;
    let width: number | undefined;
    let height: number | undefined;

    try {
      const metadata = await getVideoMetadata(file);
      duration = metadata.duration;
      width = metadata.width;
      height = metadata.height;
    } catch (e) {
      console.warn('Could not get video metadata:', e);
    }

    // Validate duration (5 minutes max)
    if (duration && duration > 300) {
      console.error('Video too long:', duration, 'seconds');
      return null;
    }

    // Generate unique filename
    const fileExt = file.name.split('.').pop() || 'mp4';
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(7);
    const fileName = `${partyId}/${timestamp}-${random}.${fileExt}`;

    // Upload to Supabase Storage (event-videos bucket)
    const { error } = await supabase.storage
      .from('event-videos')
      .upload(fileName, file, {
        cacheControl: '3600',
        upsert: false,
      });

    if (error) {
      console.error('Error uploading video:', error);
      return null;
    }

    // Get public URL
    const { data: urlData } = supabase.storage
      .from('event-videos')
      .getPublicUrl(fileName);

    return {
      url: urlData.publicUrl,
      fileName: file.name,
      fileSize: file.size,
      mimeType: file.type,
      width,
      height,
      duration,
    };
  } catch (error) {
    console.error('Error uploading video:', error);
    return null;
  }
}

/**
 * Get video metadata (duration, width, height) from a File object using HTML5 Video element
 */
function getVideoMetadata(file: File): Promise<{ duration: number; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    const objectUrl = URL.createObjectURL(file);

    video.onloadedmetadata = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({
        duration: video.duration,
        width: video.videoWidth,
        height: video.videoHeight,
      });
    };

    video.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load video metadata'));
    };

    video.src = objectUrl;
  });
}

/**
 * Get image dimensions from a File object
 */
function getImageDimensions(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve({ width: img.width, height: img.height });
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image'));
    };

    img.src = objectUrl;
  });
}

// Types for database tables
// Host profile from user account
export interface DbHostProfile {
  name: string | null;
  avatar_url: string | null;
  website: string | null;
  twitter: string | null;
  instagram: string | null;
  youtube: string | null;
  tiktok: string | null;
  linkedin: string | null;
}

export interface DbParty {
  id: string;
  name: string;
  invite_code: string;
  custom_url: string | null;
  host_name?: string | null; // Optional - comes from API (User.name), not DB column
  host_profile?: DbHostProfile | null; // Full host profile from user account
  user_id: string | null; // Owner's user ID for access control
  date: string | null;
  duration: number | null;
  timezone: string | null;
  pizza_style: string;
  available_beverages: string[];
  available_toppings: string[];
  available_dietary_options: string[];
  max_guests: number | null;
  expected_guests?: number | null;
  hide_guests: boolean;
  require_approval: boolean;
  password?: string | null;
  has_password?: boolean;
  event_image_url: string | null;
  description: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  country?: string | null;
  city?: string | null;
  place_id?: string | null;
  venue_name: string | null;
  rsvp_closed_at: string | null;
  selected_pizzerias: any[] | null;
  co_hosts: any[];
  co_hosts_public?: any[];
  share_to_unlock?: boolean;
  share_tweet_text?: string | null;
  photo_moderation?: boolean;
  nft_enabled?: boolean;
  nft_chain?: string | null;
  created_at: string;
  donation_enabled?: boolean;
  donation_goal?: number | null;
  donation_message?: string | null;
  suggested_amounts?: number[];
  donation_recipient?: string | null;
  donation_recipient_url?: string | null;
  donation_eth_address?: string | null;
  venue_report_published?: boolean;
  venue_report_slug?: string | null;
  venue_report_title?: string | null;
  venue_report_notes?: string | null;
  pinned_apps?: string[];
  region?: string | null;
  event_type?: string | null;
  event_tags?: string[];
  flyer_generated_at?: string | null;
  flyer_config?: Record<string, any> | null;
  poster_image_url?: string | null;
  poster_generated_at?: string | null;
  rollup_image_url?: string | null;
  rollup_generated_at?: string | null;
  can_edit?: boolean;
  allowed_tabs?: string[];
  hidden_gpp_photos?: string[];
  extra_gpp_photos?: string[];
  // External event links
  luma_url?: string | null;
  meetup_url?: string | null;
  eventbrite_url?: string | null;
  external_links?: Array<{label: string; url: string}>;
  // Telegram group
  telegram_group?: string | null;
  // Host Telegram bot connection
  host_telegram_chat_id?: string | null; // serialized as string from API (BigInt)
  host_telegram_link_token?: string | null;
  // Underboss status
  underboss_status?: string | null;
  // Turtle role selection toggle
  turtle_roles_enabled?: boolean;
  // Reimbursement cap (arugula-38633 v2)
  reimbursement_cap_usd?: number | null;
  reimbursement_cap_appeal_note?: string | null;
  reimbursement_cap_appealed_at?: string | null;
}

export type DbGuestStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'WAITLISTED';

export interface DbGuest {
  id: string;
  party_id: string;
  name: string;
  email?: string;
  ethereum_address?: string;
  roles?: string[];
  mailing_list_opt_in?: boolean;
  dietary_restrictions: string[];
  liked_toppings: string[];
  disliked_toppings: string[];
  liked_beverages: string[];
  disliked_beverages: string[];
  pizzeria_rankings?: string[];
  suggested_pizzerias?: any[];
  swc_opt_in?: boolean;
  swc_ca_opt_in?: boolean;
  swc_au_opt_in?: boolean;
  swc_eu_opt_in?: boolean;
  swc_uk_opt_in?: boolean;
  swc_br_opt_in?: boolean;
  ethconf_opt_in?: boolean;
  optin_ab_variant?: string | null;
  submitted_at: string;
  submitted_via: string;
  checked_in_at?: string | null;
  approved?: boolean | null; // null = pending, true = approved, false = declined
  checked_in_at?: string | null;
  checked_in_by?: string | null;
  status?: DbGuestStatus;
  waitlist_position?: number | null;
  promoted_at?: string | null;
}

// Safe column list for parties table — excludes password
export const SAFE_PARTY_COLUMNS = `
  id, name, invite_code, custom_url, date, duration, end_time, timezone,
  pizza_style, available_beverages, available_toppings, available_dietary_options, max_guests, expected_guests, hide_guests,
  require_approval, venue_name, selected_pizzerias,
  event_image_url, description, address, latitude, longitude, country, city, place_id, rsvp_closed_at, co_hosts_public, created_at, updated_at, user_id,
  donation_enabled, donation_goal, donation_message, suggested_amounts, donation_recipient,
  donation_recipient_url, donation_eth_address, share_to_unlock, share_tweet_text,
  nft_enabled, nft_chain,
  photos_enabled, photos_public, photo_moderation,
  event_type, event_tags, budget_total, budget_enabled,
  music_enabled, music_notes,
  kit_enabled, kit_deadline,
  fundraising_goal, report_recap, report_video_url, report_photos_url,
  flyer_artist, x_post_url, x_post_views, farcaster_post_url, farcaster_views,
  luma_url, luma_views, meetup_url, eventbrite_url, external_links,
  poap_event_id, poap_mints, poap_moments,
  report_published, report_public_slug,
  venue_report_published, venue_report_slug, venue_report_title, venue_report_notes,
  pinned_apps,
  region,
  flyer_generated_at,
  hidden_gpp_photos, extra_gpp_photos,
  quiz_enabled,
  telegram_group,
  host_telegram_chat_id, host_telegram_link_token,
  turtle_roles_enabled,
  underboss_status,
  flyer_config,
  poster_image_url, poster_generated_at,
  rollup_image_url, rollup_generated_at,
  reimbursement_cap_usd, reimbursement_cap_appeal_note, reimbursement_cap_appealed_at
`;

/**
 * Normalize a Supabase party row: copy co_hosts_public → co_hosts so the rest
 * of the codebase can continue reading party.co_hosts.  The raw co_hosts column
 * is now hidden from anon/authenticated; only co_hosts_public is returned.
 */
function normalizePartyCoHosts<T extends Record<string, any>>(party: T): T {
  if (party && party.co_hosts_public !== undefined && party.co_hosts === undefined) {
    party.co_hosts = party.co_hosts_public;
  }
  return party;
}

// Party operations
export async function createParty(
  name?: string,
  hostName?: string,
  date?: string,
  pizzaStyle: string = 'new-york',
  expectedGuests?: number,
  address?: string,
  availableBeverages?: string[],
  duration?: number,
  password?: string,
  eventImageUrl?: string,
  description?: string,
  customUrl?: string,
  timezone?: string,
  hostEmail?: string,
  hideGuests?: boolean,
  placeId?: string,
  venueName?: string,
  city?: string
): Promise<DbParty | null> {
  // Use API if authenticated (secure path)
  if (isAuthenticated()) {
    try {
      const result = await createPartyApi({
        name,
        hostName,
        date,
        pizzaStyle,
        maxGuests: expectedGuests,
        address,
        placeId,
        venueName,
        city,
        availableBeverages,
        duration,
        password,
        eventImageUrl,
        description,
        customUrl,
        timezone,
        hideGuests,
      });

      // Convert API response to DbParty format
      const party = result.party;
      return {
        id: party.id,
        name: party.name,
        invite_code: party.inviteCode,
        custom_url: party.customUrl,
        host_name: party.hostName,
        user_id: party.userId,
        date: party.date,
        duration: party.duration,
        timezone: party.timezone,
        pizza_style: party.pizzaStyle,
        available_beverages: party.availableBeverages || [],
        available_toppings: party.availableToppings || [],
        available_dietary_options: party.availableDietaryOptions || [],
        max_guests: party.maxGuests,
        hide_guests: party.hideGuests || false,
        event_image_url: party.eventImageUrl,
        description: party.description,
        address: party.address,
        place_id: party.placeId,
        rsvp_closed_at: party.rsvpClosedAt,
        co_hosts: party.coHosts || [],
        created_at: party.createdAt,
      };
    } catch (error) {
      console.error('Error creating party via API:', error);
      return null;
    }
  }

  // Fallback to direct Supabase (for unauthenticated users - will fail after RLS lockdown)
  console.warn('Creating party without authentication - this will fail after security lockdown');

  // Generate default party name if not provided
  let partyName = name?.trim();
  if (!partyName) {
    const { count } = await supabase
      .from('parties')
      .select('*', { count: 'exact', head: true });
    const partyNumber = (count || 0) + 1;
    partyName = `Pizza Party ${partyNumber}`;
  }

  const coHosts = hostEmail ? [{ id: uuid(), name: hostName || '', email: hostEmail, showOnEvent: false }] : [];

  const { data, error } = await supabase
    .from('parties')
    .insert({
      name: partyName,
      // Note: host_name removed - now derived from User.name via user_id relationship
      date: date || null,
      duration: duration || null,
      timezone: timezone || null,
      pizza_style: pizzaStyle,
      available_beverages: availableBeverages || [],
      max_guests: expectedGuests || null,
      password: password || null,
      event_image_url: eventImageUrl || null,
      description: description || null,
      custom_url: customUrl || null,
      address: address || null,
      place_id: placeId || null,
      venue_name: venueName || null,
      city: city || null,
      co_hosts: coHosts,
    })
    .select()
    .single();

  if (error) {
    console.error('Error creating party:', error);
    return null;
  }

  if (hostEmail && data) {
    await supabase
      .from('guests')
      .insert({
        party_id: data.id,
        name: hostName || 'Host',
        email: hostEmail.toLowerCase(),
        dietary_restrictions: [],
        liked_toppings: [],
        disliked_toppings: [],
        liked_beverages: [],
        disliked_beverages: [],
        submitted_via: 'host',
      });
  }

  return data;
}

export async function getPartyByInviteCode(inviteCode: string): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .eq('invite_code', inviteCode)
    .single();

  if (error) {
    console.error('Error fetching party:', error);
    return null;
  }
  if (data) {
    normalizePartyCoHosts(data);
    data.co_hosts = sanitizeCoHosts(data.co_hosts);
  }
  return data;
}

/**
 * For a GPP party that is NOT approved, find another GPP party in the same
 * city that IS approved. Returns null if no replacement exists. Used to
 * redirect old-email-link visitors to a sanctioned party.
 */
export async function findApprovedGppPartyInCity(
  city: string,
  excludeId: string,
): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .eq('event_type', 'gpp')
    .eq('city', city)
    .eq('underboss_status', 'approved')
    .neq('id', excludeId)
    .limit(1)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    console.error('Error finding approved GPP party in city:', error);
    return null;
  }
  return (data as DbParty | null) ?? null;
}

export async function getPartyByCustomUrl(customUrl: string): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .eq('custom_url', customUrl.toLowerCase())
    .single();

  if (error && error.code !== 'PGRST116') {
    console.error('Error fetching party by custom URL:', error);
    return null;
  }

  let party = data;

  // Alias fallback: check slug_aliases if not found by custom_url
  if (!party) {
    const { data: aliasData } = await supabase
      .from('slug_aliases')
      .select('party_id')
      .eq('old_slug', customUrl.toLowerCase())
      .maybeSingle();

    if (aliasData) {
      const { data: partyData } = await supabase
        .from('parties')
        .select(SAFE_PARTY_COLUMNS)
        .eq('id', aliasData.party_id)
        .single();
      party = partyData;
    }
  }

  if (party) {
    normalizePartyCoHosts(party);
    party.co_hosts = sanitizeCoHosts(party.co_hosts);
  }
  return party;
}

// Reserved slugs that can't be used as custom party URLs
const RESERVED_SLUGS = [
  'login',
  'new',
  'account',
  'auth',
  'parties',
  'rsvp',
  'host',
  'api',
  'admin',
  'settings',
  'profile',
  'about',
  'help',
  'terms',
  'privacy',
  'contact',
];

export interface SlugValidationResult {
  valid: boolean;
  error?: string;
}

export async function validateCustomSlug(
  slug: string,
  currentPartyId?: string
): Promise<SlugValidationResult> {
  // Check if slug is empty
  if (!slug || !slug.trim()) {
    return { valid: true }; // Empty is fine, it just won't have a custom URL
  }

  const normalizedSlug = slug.toLowerCase().trim();

  // Check minimum length
  if (normalizedSlug.length < 3) {
    return { valid: false, error: 'URL must be at least 3 characters' };
  }

  // Check format (only lowercase letters, numbers, and hyphens)
  if (!/^[a-z0-9-]+$/.test(normalizedSlug)) {
    return { valid: false, error: 'URL can only contain letters, numbers, and hyphens' };
  }

  // Check reserved slugs
  if (RESERVED_SLUGS.includes(normalizedSlug)) {
    return { valid: false, error: 'This URL is reserved' };
  }

  // Check if slug is already taken by another party
  const { data: existingParty } = await supabase
    .from('parties')
    .select('id')
    .eq('custom_url', normalizedSlug)
    .maybeSingle();

  if (existingParty && existingParty.id !== currentPartyId) {
    return { valid: false, error: 'This URL is already taken' };
  }

  return { valid: true };
}

// Verify event password via backend API (password column is not readable by anon)
export async function verifyPartyPassword(inviteCode: string, passwordAttempt: string): Promise<boolean> {
  try {
    const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
    const response = await fetch(`${apiUrl}/api/rsvp/${inviteCode}/verify-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: passwordAttempt }),
    });
    if (!response.ok) return false;
    const data = await response.json();
    return data.valid === true;
  } catch (error) {
    console.error('Error verifying password:', error);
    return false;
  }
}

export async function getPartyByInviteCodeOrCustomUrl(slug: string): Promise<DbParty | null> {
  const normalizedSlug = slug.toLowerCase();
  let party: DbParty | null = null;
  let error = null;

  // Try custom URL first
  const { data: customUrlData, error: customUrlError } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .eq('custom_url', normalizedSlug)
    .maybeSingle();

  if (customUrlData) {
    party = customUrlData as DbParty;
  } else {
    // If not found by custom URL, try invite code
    const { data: inviteCodeData, error: inviteCodeError } = await supabase
      .from('parties')
      .select(SAFE_PARTY_COLUMNS)
      .eq('invite_code', normalizedSlug)
      .maybeSingle();

    if (inviteCodeData) {
      party = inviteCodeData as DbParty;
    } else {
      // Alias fallback: check slug_aliases
      const { data: aliasData } = await supabase
        .from('slug_aliases')
        .select('party_id')
        .eq('old_slug', normalizedSlug)
        .maybeSingle();

      if (aliasData) {
        const { data: aliasPartyData } = await supabase
          .from('parties')
          .select(SAFE_PARTY_COLUMNS)
          .eq('id', aliasData.party_id)
          .maybeSingle();

        if (aliasPartyData) {
          party = aliasPartyData as DbParty;
        }
      }

      if (!party) {
        if (customUrlError) error = customUrlError;
        if (inviteCodeError) error = inviteCodeError;
      }
    }
  }

  if (party) {
    // Check if password exists (without fetching it)
    const { count } = await supabase
      .from('parties')
      .select('id', { count: 'exact', head: true })
      .eq('id', party.id)
      .not('password', 'is', null);

    party.has_password = count === 1;
    normalizePartyCoHosts(party);
    party.co_hosts = sanitizeCoHosts(party.co_hosts);
  }

  if (!party && error) {
    console.error('Error fetching party:', error);
  }

  return party;
}

export async function getPartyWithGuests(inviteCode: string): Promise<{ party: DbParty; guests: DbGuest[] } | null> {
  // Single query: match on custom_url OR invite_code
  const { data: partyData, error: partyError } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .or(`custom_url.eq.${inviteCode},invite_code.eq.${inviteCode}`)
    .maybeSingle();

  if (partyError) {
    console.error('Error fetching party:', partyError);
  }

  let party: DbParty | null = partyData;

  // Alias fallback: check slug_aliases if not found
  if (!party) {
    const { data: aliasData } = await supabase
      .from('slug_aliases')
      .select('party_id')
      .eq('old_slug', inviteCode)
      .maybeSingle();

    if (aliasData) {
      const { data: aliasPartyData } = await supabase
        .from('parties')
        .select(SAFE_PARTY_COLUMNS)
        .eq('id', aliasData.party_id)
        .maybeSingle();
      party = aliasPartyData;
    }
  }

  if (!party) {
    return null;
  }

  // Normalize: Supabase returns co_hosts_public (sanitized), copy to co_hosts
  normalizePartyCoHosts(party);

  // Run co-host enrichment and guest fetch in parallel
  const enrichPromise = (async () => {
    if (party!.co_hosts && Array.isArray(party!.co_hosts) && party!.co_hosts.length > 0) {
      try {
        const token = localStorage.getItem('authToken');
        if (token) {
          const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
          const response = await fetch(`${apiUrl}/api/parties/${party!.id}`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            if (data.party?.coHosts) {
              party!.co_hosts = data.party.coHosts;
            }
            if (data.party?.canEdit !== undefined) {
              party!.can_edit = data.party.canEdit;
            }
            if (data.party?.allowedTabs !== undefined) {
              party!.allowed_tabs = data.party.allowedTabs;
            }
          }
        }
      } catch (err) {
        console.warn('Could not enrich co-host profiles via API:', err);
      }
    }
  })();

  const guestsPromise = supabase
    .from('guests')
    .select('*')
    .eq('party_id', party.id)
    .order('submitted_at', { ascending: true });

  const [, { data: guests, error: guestsError }] = await Promise.all([enrichPromise, guestsPromise]);

  if (guestsError) {
    console.error('Error fetching guests:', guestsError);
    return { party, guests: [] };
  }

  return { party, guests: guests || [] };
}

export async function updatePartyBeverages(partyId: string, availableBeverages: string[]): Promise<DbParty | null> {
  // Use the updateParty function which handles API routing
  const success = await updateParty(partyId, { available_beverages: availableBeverages });
  if (!success) return null;

  // Fetch the updated party
  const { data } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .eq('id', partyId)
    .single();

  if (data) normalizePartyCoHosts(data);
  return data;
}

export async function updatePartyToppings(partyId: string, availableToppings: string[]): Promise<DbParty | null> {
  // Use the updateParty function which handles API routing
  const success = await updateParty(partyId, { available_toppings: availableToppings });
  if (!success) return null;

  // Fetch the updated party
  const { data } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .eq('id', partyId)
    .single();

  if (data) normalizePartyCoHosts(data);
  return data;
}

export async function updatePartyDietaryOptions(partyId: string, availableDietaryOptions: string[]): Promise<DbParty | null> {
  // Use the updateParty function which handles API routing
  const success = await updateParty(partyId, { available_dietary_options: availableDietaryOptions });
  if (!success) return null;

  // Fetch the updated party
  const { data } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .eq('id', partyId)
    .single();

  if (data) normalizePartyCoHosts(data);
  return data;
}

// Guest operations
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3006';

export async function addGuestToParty(
  partyId: string,
  name: string,
  dietaryRestrictions: string[],
  likedToppings: string[],
  dislikedToppings: string[],
  likedBeverages: string[],
  dislikedBeverages: string[],
  email?: string,
  ethereumAddress?: string,
  roles?: string[],
  mailingListOptIn?: boolean,
  inviteCode?: string,
  pizzeriaRankings?: string[],
  suggestedPizzerias?: any[],
  swcOptIn?: boolean,
  swcCaOptIn?: boolean,
  swcAuOptIn?: boolean,
  swcEuOptIn?: boolean,
  swcUkOptIn?: boolean,
  swcBrOptIn?: boolean,
  ethconfOptIn?: boolean,
  optinAbVariant?: 'control' | 'variant' | null,
  visitorSessionId?: string,
): Promise<{ guest: DbGuest; alreadyRegistered: boolean; requireApproval: boolean; updated: boolean; waitlisted: boolean; waitlistPosition: number | null }> {
  if (!inviteCode) {
    console.error('Invite code is required to add guest');
    throw new Error('Invite code is required to submit RSVP');
  }

  try {
    const response = await fetch(`${API_URL}/api/rsvp/${inviteCode}/guest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        email: email || null,
        ethereumAddress: ethereumAddress || null,
        roles: roles || [],
        mailingListOptIn: mailingListOptIn || false,
        dietaryRestrictions,
        likedToppings,
        dislikedToppings,
        likedBeverages,
        dislikedBeverages,
        pizzeriaRankings: pizzeriaRankings || [],
        suggestedPizzerias: suggestedPizzerias || [],
        swcOptIn: swcOptIn || false,
        swcCaOptIn: swcCaOptIn || false,
        swcAuOptIn: swcAuOptIn || false,
        swcEuOptIn: swcEuOptIn || false,
        swcUkOptIn: swcUkOptIn || false,
        swcBrOptIn: swcBrOptIn || false,
        ethconfOptIn: ethconfOptIn || false,
        optinAbVariant: optinAbVariant ?? null,
        visitorSessionId: visitorSessionId ?? null,
      }),
    });

    if (!response.ok) {
      let errorData: any = null;
      try {
        errorData = await response.json();
      } catch {}
      console.error('Error adding guest:', errorData);
      const message = errorData?.error?.message || errorData?.message || `HTTP ${response.status}`;
      throw new Error(message);
    }

    const data = await response.json();

    // Return a minimal DbGuest object (backend returns id, name, status, waitlistPosition)
    const guest = {
      id: data.guest.id,
      party_id: partyId,
      name: data.guest.name,
      email: email || null,
      ethereum_address: ethereumAddress || null,
      roles: roles || [],
      mailing_list_opt_in: mailingListOptIn || false,
      dietary_restrictions: dietaryRestrictions,
      liked_toppings: likedToppings,
      disliked_toppings: dislikedToppings,
      liked_beverages: likedBeverages,
      disliked_beverages: dislikedBeverages,
      pizzeria_rankings: pizzeriaRankings || [],
      suggested_pizzerias: suggestedPizzerias || [],
      swc_opt_in: swcOptIn || false,
      swc_ca_opt_in: swcCaOptIn || false,
      swc_au_opt_in: swcAuOptIn || false,
      swc_eu_opt_in: swcEuOptIn || false,
      swc_uk_opt_in: swcUkOptIn || false,
      swc_br_opt_in: swcBrOptIn || false,
      ethconf_opt_in: ethconfOptIn || false,
      optin_ab_variant: optinAbVariant ?? null,
      submitted_via: 'link',
      submitted_at: new Date().toISOString(),
      status: data.guest.status || 'CONFIRMED',
      waitlist_position: data.guest.waitlistPosition || null,
    } as DbGuest;

    return {
      guest,
      alreadyRegistered: data.alreadyRegistered || false,
      requireApproval: data.requireApproval || false,
      updated: data.updated || false,
      waitlisted: data.waitlisted || false,
      waitlistPosition: data.waitlistPosition || null,
    };
  } catch (error) {
    console.error('Error adding guest:', error);
    throw error;
  }
}

export interface ExistingGuestData {
  id: string;
  name: string;
  email: string | null;
  ethereumAddress: string | null;
  roles: string[];
  mailingListOptIn: boolean;
  optinAbVariant: 'control' | 'variant' | null;
  dietaryRestrictions: string[];
  likedToppings: string[];
  dislikedToppings: string[];
  likedBeverages: string[];
  dislikedBeverages: string[];
  pizzeriaRankings: string[];
  suggestedPizzerias: any[];
  status: DbGuestStatus;
  checkedInAt: string | null;
  checkedInBy: string | null;
}

export async function getExistingGuest(
  inviteCode: string,
  email: string
): Promise<ExistingGuestData | null> {
  try {
    const response = await fetch(`${API_URL}/api/rsvp/${inviteCode}/guest/${encodeURIComponent(email)}`);

    if (!response.ok) {
      if (response.status === 404) {
        return null;
      }
      console.error('Error fetching guest:', await response.text());
      return null;
    }

    const data = await response.json();
    const guest = data.guest;

    return {
      id: guest.id,
      name: guest.name,
      email: guest.email,
      ethereumAddress: guest.ethereumAddress,
      roles: guest.roles || [],
      mailingListOptIn: guest.mailingListOptIn || false,
      optinAbVariant: guest.optinAbVariant === 'control' || guest.optinAbVariant === 'variant' ? guest.optinAbVariant : null,
      dietaryRestrictions: guest.dietaryRestrictions || [],
      likedToppings: guest.likedToppings || [],
      dislikedToppings: guest.dislikedToppings || [],
      likedBeverages: guest.likedBeverages || [],
      dislikedBeverages: guest.dislikedBeverages || [],
      pizzeriaRankings: guest.pizzeriaRankings || [],
      suggestedPizzerias: guest.suggestedPizzerias || [],
      status: guest.status || 'CONFIRMED',
      checkedInAt: guest.checkedInAt || null,
      checkedInBy: guest.checkedInBy || null,
    };
  } catch (error) {
    console.error('Error fetching guest:', error);
    return null;
  }
}

export async function addGuestByHost(
  partyId: string,
  name: string,
  dietaryRestrictions: string[],
  likedToppings: string[],
  dislikedToppings: string[],
  likedBeverages: string[],
  dislikedBeverages: string[],
  email?: string
): Promise<DbGuest | null> {
  // Use API if authenticated (secure path)
  if (isAuthenticated()) {
    try {
      const result = await addGuestByHostApi(partyId, {
        name,
        email,
        dietaryRestrictions,
        likedToppings,
        dislikedToppings,
        likedBeverages,
        dislikedBeverages,
      });

      const guest = result.guest;
      return {
        id: guest.id,
        party_id: guest.partyId,
        name: guest.name,
        email: guest.email,
        dietary_restrictions: guest.dietaryRestrictions || [],
        liked_toppings: guest.likedToppings || [],
        disliked_toppings: guest.dislikedToppings || [],
        liked_beverages: guest.likedBeverages || [],
        disliked_beverages: guest.dislikedBeverages || [],
        submitted_at: guest.submittedAt,
        submitted_via: guest.submittedVia,
      };
    } catch (error) {
      console.error('Error adding guest via API:', error);
      return null;
    }
  }

  // Fallback to direct Supabase
  const { data, error } = await supabase
    .from('guests')
    .insert({
      party_id: partyId,
      name,
      email: email ? email.toLowerCase() : null,
      dietary_restrictions: dietaryRestrictions,
      liked_toppings: likedToppings,
      disliked_toppings: dislikedToppings,
      liked_beverages: likedBeverages,
      disliked_beverages: dislikedBeverages,
      submitted_via: 'host',
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding guest:', error);
    return null;
  }
  return data;
}

export async function removeGuest(guestId: string, partyId?: string): Promise<boolean> {
  // Use API if authenticated and partyId provided (secure path)
  if (isAuthenticated() && partyId) {
    try {
      await removeGuestApi(partyId, guestId);
      return true;
    } catch (error) {
      console.error('Error removing guest via API:', error);
      return false;
    }
  }

  // Fallback to direct Supabase
  const { error } = await supabase
    .from('guests')
    .delete()
    .eq('id', guestId);

  if (error) {
    console.error('Error removing guest:', error);
    return false;
  }
  return true;
}

export async function updateGuestApproval(guestId: string, approved: boolean | null, partyId?: string): Promise<boolean> {
  // Use API if authenticated and partyId provided (secure path)
  if (isAuthenticated() && partyId) {
    try {
      await updateGuestApprovalApi(partyId, guestId, approved);
      return true;
    } catch (error) {
      console.error('Error updating guest approval via API:', error);
      return false;
    }
  }

  // Fallback to direct Supabase (will fail after RLS lockdown)
  const { error } = await supabase
    .from('guests')
    .update({ approved })
    .eq('id', guestId);

  if (error) {
    console.error('Error updating guest approval:', error);
    return false;
  }
  return true;
}

// Un-check-in a guest (host-side undo). Resolves invite code from party and calls
// DELETE /api/checkin/:inviteCode/:guestId. Idempotent on backend.
export async function uncheckInGuest(guestId: string, party: { id: string; inviteCode: string } | null | undefined): Promise<boolean> {
  if (!party?.inviteCode) {
    console.error('uncheckInGuest: missing party invite code');
    return false;
  }
  try {
    await uncheckInGuestApi(party.inviteCode, guestId);
    return true;
  } catch (error) {
    console.error('Error un-checking-in guest via API:', error);
    return false;
  }
}

export async function promoteGuest(guestId: string, partyId: string): Promise<boolean> {
  // Use API if authenticated (secure path)
  if (isAuthenticated()) {
    try {
      await promoteGuestApi(partyId, guestId);
      return true;
    } catch (error) {
      console.error('Error promoting guest via API:', error);
      return false;
    }
  }

  console.error('Must be authenticated to promote guest');
  return false;
}

export async function getGuestsByPartyId(partyId: string): Promise<DbGuest[]> {
  const { data, error } = await supabase
    .from('guests')
    .select('*')
    .eq('party_id', partyId)
    .order('submitted_at', { ascending: true });

  if (error) {
    console.error('Error fetching guests:', error);
    return [];
  }
  return data || [];
}

// Check if a user is already a guest at a party by email
export async function isUserGuestAtParty(partyId: string, email: string): Promise<boolean> {
  if (!email) return false;

  const { count, error } = await supabase
    .from('guests')
    .select('*', { count: 'exact', head: true })
    .eq('party_id', partyId)
    .eq('email', email.toLowerCase());

  if (error) {
    console.error('Error checking guest status:', error);
    return false;
  }
  return (count || 0) > 0;
}

// Check if a user is a host of a party (by checking co_hosts array)
export function isUserHostOfParty(party: DbParty, email: string): boolean {
  if (!email || !party.co_hosts) return false;

  const normalizedEmail = email.toLowerCase();
  return party.co_hosts.some((host: any) =>
    host.email?.toLowerCase() === normalizedEmail
  );
}

// Get all parties
export async function getAllParties(): Promise<DbParty[]> {
  const { data, error } = await supabase
    .from('parties')
    .select(SAFE_PARTY_COLUMNS)
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching parties:', error);
    return [];
  }
  return (data || []).map(p => {
    normalizePartyCoHosts(p);
    return { ...p, co_hosts: sanitizeCoHosts(p.co_hosts) };
  });
}

// Subscribe to guest changes (real-time)
export function subscribeToGuests(partyId: string, callback: (guests: DbGuest[]) => void) {
  const channel = supabase
    .channel(`guests:${partyId}`)
    .on(
      'postgres_changes',
      {
        event: '*',
        schema: 'public',
        table: 'guests',
        filter: `party_id=eq.${partyId}`,
      },
      async () => {
        // Refetch all guests when any change occurs
        const guests = await getGuestsByPartyId(partyId);
        callback(guests);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}

// Update party details
export async function updateParty(
  partyId: string,
  updates: {
    name?: string;
    // Note: host_name removed - now derived from User.name via user_id relationship
    date?: string | null;
    duration?: number | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    country?: string | null;
    city?: string | null;
    place_id?: string | null;
    venue_name?: string | null;
    // Venue tracking fields
    venueStatus?: string | null;
    venueCapacity?: number | null;
    venueCost?: number | null;
    venuePointPerson?: string | null;
    venueContactName?: string | null;
    venueContactEmail?: string | null;
    venueContactPhone?: string | null;
    venueOrganization?: string | null;
    venueWebsite?: string | null;
    venueNotes?: string | null;
    description?: string | null;
    password?: string | null;
    custom_url?: string | null;
    event_image_url?: string | null;
    max_guests?: number | null;
    expected_guests?: number | null;
    hide_guests?: boolean;
    require_approval?: boolean;
    co_hosts?: any[];
    timezone?: string | null;
    available_beverages?: string[];
    available_toppings?: string[];
    selected_pizzerias?: any[];  // Pizzeria objects
    donation_enabled?: boolean;
    donation_goal?: number | null;
    donation_message?: string | null;
    suggested_amounts?: number[];
    donation_recipient?: string | null;
    donation_recipient_url?: string | null;
    donation_eth_address?: string | null;
    share_to_unlock?: boolean;
    share_tweet_text?: string | null;
    photo_moderation?: boolean;
    nft_enabled?: boolean;
    nft_chain?: string | null;
    music_enabled?: boolean;
    music_notes?: string | null;
    venue_report_title?: string | null;
    venue_report_notes?: string | null;
    pinned_apps?: string[];
    region?: string | null;
    flyer_generated_at?: string | null;
    flyer_config?: Record<string, any> | null;
    poster_image_url?: string | null;
    poster_generated_at?: string | null;
    rollup_image_url?: string | null;
    rollup_generated_at?: string | null;
    hidden_gpp_photos?: string[];
    extra_gpp_photos?: string[];
    luma_url?: string | null;
    meetup_url?: string | null;
    eventbrite_url?: string | null;
    external_links?: Array<{label: string; url: string}>;
    telegram_group?: string | null;
    host_telegram_link_token?: string | null;
    turtle_roles_enabled?: boolean;
    reimbursement_cap_usd?: number | null;
  }
): Promise<boolean> {
  // Use API if authenticated (secure path)
  if (isAuthenticated()) {
    try {
      await updatePartyApi(partyId, {
        name: updates.name,
        date: updates.date,
        duration: updates.duration,
        timezone: updates.timezone,
        address: updates.address,
        latitude: updates.latitude,
        longitude: updates.longitude,
        country: updates.country,
        city: updates.city,
        placeId: updates.place_id,
        venueName: updates.venue_name,
        // Venue tracking fields
        venueStatus: updates.venueStatus as any,
        venueCapacity: updates.venueCapacity,
        venueCost: updates.venueCost,
        venuePointPerson: updates.venuePointPerson,
        venueContactName: updates.venueContactName,
        venueContactEmail: updates.venueContactEmail,
        venueContactPhone: updates.venueContactPhone,
        venueOrganization: updates.venueOrganization,
        venueWebsite: updates.venueWebsite,
        venueNotes: updates.venueNotes,
        maxGuests: updates.max_guests,
        expectedGuests: updates.expected_guests,
        hideGuests: updates.hide_guests,
        requireApproval: updates.require_approval,
        availableBeverages: updates.available_beverages,
        availableToppings: updates.available_toppings,
        availableDietaryOptions: updates.available_dietary_options,
        selectedPizzerias: updates.selected_pizzerias,
        password: updates.password,
        eventImageUrl: updates.event_image_url,
        description: updates.description,
        customUrl: updates.custom_url,
        coHosts: updates.co_hosts,
        donationEnabled: updates.donation_enabled,
        donationGoal: updates.donation_goal,
        donationMessage: updates.donation_message,
        suggestedAmounts: updates.suggested_amounts,
        donationRecipient: updates.donation_recipient,
        donationRecipientUrl: updates.donation_recipient_url,
        donationEthAddress: updates.donation_eth_address,
        shareToUnlock: updates.share_to_unlock,
        shareTweetText: updates.share_tweet_text,
        photoModeration: updates.photo_moderation,
        nftEnabled: updates.nft_enabled,
        nftChain: updates.nft_chain,
        musicEnabled: updates.music_enabled,
        musicNotes: updates.music_notes,
        venueReportTitle: updates.venue_report_title,
        venueReportNotes: updates.venue_report_notes,
        pinnedApps: updates.pinned_apps,
        region: updates.region,
        flyerGeneratedAt: updates.flyer_generated_at,
        flyerConfig: updates.flyer_config,
        posterImageUrl: updates.poster_image_url,
        posterGeneratedAt: updates.poster_generated_at,
        rollupImageUrl: updates.rollup_image_url,
        rollupGeneratedAt: updates.rollup_generated_at,
        hiddenGppPhotos: updates.hidden_gpp_photos,
        extraGppPhotos: updates.extra_gpp_photos,
        lumaUrl: updates.luma_url,
        meetupUrl: updates.meetup_url,
        eventbriteUrl: updates.eventbrite_url,
        externalLinks: updates.external_links,
        telegramGroup: updates.telegram_group,
        hostTelegramLinkToken: updates.host_telegram_link_token,
        turtleRolesEnabled: updates.turtle_roles_enabled,
        reimbursementCapUsd: updates.reimbursement_cap_usd,
      });
      return true;
    } catch (error) {
      console.error('Error updating party via API:', error);
      return false;
    }
  }

  // Fallback to direct Supabase
  const { error } = await supabase
    .from('parties')
    .update(updates)
    .eq('id', partyId);

  if (error) {
    console.error('Error updating party:', error);
    return false;
  }
  return true;
}

export async function deleteParty(partyId: string): Promise<boolean> {
  // Use API if authenticated (secure path)
  if (isAuthenticated()) {
    try {
      await deletePartyApi(partyId);
      return true;
    } catch (error) {
      console.error('Error deleting party via API:', error);
      return false;
    }
  }

  // Fallback to direct Supabase
  const { error } = await supabase
    .from('parties')
    .delete()
    .eq('id', partyId);

  if (error) {
    console.error('Error deleting party:', error);
    return false;
  }
  return true;
}

// Get parties for a user (RSVP'd or hosting)
export interface UserParty extends DbParty {
  userRole: 'host' | 'guest';
  guestCount?: number;
}

export async function getUserParties(userEmail: string): Promise<UserParty[]> {
  // First, get all parties where the user is a guest (via email)
  const { data: guestEntries, error: guestError } = await supabase
    .from('guests')
    .select('party_id')
    .eq('email', userEmail);

  if (guestError) {
    console.error('Error fetching guest entries:', guestError);
  }

  const partyIdsAsGuest = guestEntries?.map(g => g.party_id) || [];

  // Get parties where user is a guest
  let guestParties: DbParty[] = [];
  if (partyIdsAsGuest.length > 0) {
    const { data, error } = await supabase
      .from('parties')
      .select(SAFE_PARTY_COLUMNS)
      .in('id', partyIdsAsGuest)
      .order('date', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('Error fetching guest parties:', error);
    } else {
      guestParties = (data || []).map(p => {
        normalizePartyCoHosts(p);
        return { ...p, co_hosts: sanitizeCoHosts(p.co_hosts) };
      });
    }
  }

  // Get parties where user is a co-host via backend endpoint
  // This replaces the old approach of downloading ALL parties and filtering client-side
  let hostPartyIds: string[] = [];
  try {
    const token = localStorage.getItem('authToken');
    if (token) {
      const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
      const resp = await fetch(`${apiUrl}/api/parties/by-cohost?email=${encodeURIComponent(userEmail)}`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (resp.ok) {
        const data = await resp.json();
        hostPartyIds = data.partyIds || [];
      }
    }
  } catch (err) {
    console.warn('Could not fetch co-host parties from backend:', err);
  }

  let hostParties: DbParty[] = [];
  if (hostPartyIds.length > 0) {
    const { data, error: hostError } = await supabase
      .from('parties')
      .select(SAFE_PARTY_COLUMNS)
      .in('id', hostPartyIds)
      .order('date', { ascending: true, nullsFirst: false });

    if (hostError) {
      console.error('Error fetching host parties:', hostError);
    } else {
      hostParties = (data || []).map(p => {
        normalizePartyCoHosts(p);
        return { ...p, co_hosts: sanitizeCoHosts(p.co_hosts) };
      });
    }
  }

  // Combine and deduplicate
  const partyMap = new Map<string, UserParty>();

  // Add host parties first (host role takes priority)
  for (const party of hostParties || []) {
    partyMap.set(party.id, { ...party, userRole: 'host' });
  }

  // Add guest parties (only if not already a host)
  for (const party of guestParties) {
    if (!partyMap.has(party.id)) {
      partyMap.set(party.id, { ...party, userRole: 'guest' });
    }
  }

  // Get guest counts for each party
  const allPartyIds = Array.from(partyMap.keys());
  if (allPartyIds.length > 0) {
    for (const partyId of allPartyIds) {
      const { count, error } = await supabase
        .from('guests')
        .select('*', { count: 'exact', head: true })
        .eq('party_id', partyId);

      if (!error && count !== null) {
        const party = partyMap.get(partyId);
        if (party) {
          party.guestCount = count;
        }
      }
    }
  }

  // Convert to array and sort by date
  const parties = Array.from(partyMap.values());
  parties.sort((a, b) => {
    if (!a.date && !b.date) return 0;
    if (!a.date) return 1;
    if (!b.date) return -1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  return parties;
}

// Get upcoming parties (future or no date set) for a user
export async function getUpcomingUserParties(userEmail: string): Promise<UserParty[]> {
  const allParties = await getUserParties(userEmail);
  const now = new Date();

  // Filter to only upcoming parties (date is null or in the future)
  return allParties.filter(party => {
    if (!party.date) return true; // Include parties without a date
    return new Date(party.date) >= now;
  });
}

// User preferences types and functions
export interface UserPreferences {
  dietary_restrictions: string[];
  liked_toppings: string[];
  disliked_toppings: string[];
  liked_beverages: string[];
  disliked_beverages: string[];
}

export async function getUserPreferences(email: string): Promise<UserPreferences | null> {
  try {
    const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
    const response = await fetch(`${apiUrl}/api/preferences?email=${encodeURIComponent(email)}`);

    if (!response.ok) return null;

    const { preferences } = await response.json();
    if (!preferences) return null;

    return {
      dietary_restrictions: preferences.dietary_restrictions || [],
      liked_toppings: preferences.liked_toppings || [],
      disliked_toppings: preferences.disliked_toppings || [],
      liked_beverages: preferences.liked_beverages || [],
      disliked_beverages: preferences.disliked_beverages || [],
    };
  } catch (error) {
    console.error('Error loading user preferences:', error);
    return null;
  }
}

export async function saveUserPreferences(
  email: string,
  preferences: UserPreferences
): Promise<boolean> {
  try {
    const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
    const response = await fetch(`${apiUrl}/api/preferences`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, preferences }),
    });

    if (!response.ok) {
      console.error('Error saving user preferences:', await response.text());
      return false;
    }

    return true;
  } catch (error) {
    console.error('Error saving user preferences:', error);
    return false;
  }
}

export async function getExperimentFlag(key: string): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from('experiment_flags')
      .select('enabled')
      .eq('key', key)
      .single();
    if (error || !data) return false;
    return data.enabled === true;
  } catch {
    return false;
  }
}

// ============================================
