import { createClient } from '@supabase/supabase-js';
import {
  createPartyApi,
  updatePartyApi,
  deletePartyApi,
  addGuestByHostApi,
  removeGuestApi,
  updateGuestApprovalApi,
} from './api';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
  max_guests: number | null;
  hide_guests: boolean;
  require_approval: boolean;
  password?: string | null;
  has_password?: boolean;
  event_image_url: string | null;
  description: string | null;
  address: string | null;
  venue_name: string | null;
  rsvp_closed_at: string | null;
  co_hosts: any[];
  created_at: string;
}

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
  submitted_at: string;
  submitted_via: string;
  approved?: boolean | null; // null = pending, true = approved, false = declined
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
  hideGuests?: boolean
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
        max_guests: party.maxGuests,
        hide_guests: party.hideGuests || false,
        event_image_url: party.eventImageUrl,
        description: party.description,
        address: party.address,
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

  const coHosts = hostEmail ? [{ id: crypto.randomUUID(), name: hostName || '', email: hostEmail, showOnEvent: false }] : [];

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
    .select('*')
    .eq('invite_code', inviteCode)
    .single();

  if (error) {
    console.error('Error fetching party:', error);
    return null;
  }
  return data;
}

export async function getPartyByCustomUrl(customUrl: string): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .select('*')
    .eq('custom_url', customUrl)
    .single();

  if (error) {
    console.error('Error fetching party by custom URL:', error);
    return null;
  }
  return data;
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

// Securely verify password without fetching it
export async function verifyPartyPassword(partyId: string, passwordAttempt: string): Promise<boolean> {
  const { count, error } = await supabase
    .from('parties')
    .select('*', { count: 'exact', head: true })
    .eq('id', partyId)
    .eq('password', passwordAttempt);

  if (error) {
    console.error('Error verifying password:', error);
    return false;
  }
  return count === 1;
}

export async function getPartyByInviteCodeOrCustomUrl(slug: string): Promise<DbParty | null> {
  // Define safe columns to fetch (excluding password)
  // Note: host_name was removed - now derived from User.name via API
  const safeColumns = `
    id, name, invite_code, custom_url, date, duration, timezone,
    pizza_style, available_beverages, available_toppings, max_guests, hide_guests,
    event_image_url, description, address, rsvp_closed_at, co_hosts, created_at, user_id
  `;

  let party: DbParty | null = null;
  let error = null;

  // Try custom URL first
  const { data: customUrlData, error: customUrlError } = await supabase
    .from('parties')
    .select(safeColumns)
    .eq('custom_url', slug)
    .maybeSingle();

  if (customUrlData) {
    party = customUrlData as DbParty;
  } else {
    // If not found by custom URL, try invite code
    const { data: inviteCodeData, error: inviteCodeError } = await supabase
      .from('parties')
      .select(safeColumns)
      .eq('invite_code', slug)
      .maybeSingle();

    if (inviteCodeData) {
      party = inviteCodeData as DbParty;
    } else {
      if (customUrlError) error = customUrlError;
      if (inviteCodeError) error = inviteCodeError;
    }
  }

  if (party) {
    // Check if password exists (without fetching it)
    const { count } = await supabase
      .from('parties')
      .select('*', { count: 'exact', head: true })
      .eq('id', party.id)
      .not('password', 'is', null);

    party.has_password = count === 1;
  }

  if (!party && error) {
    console.error('Error fetching party:', error);
  }

  return party;
}

export async function getPartyWithGuests(inviteCode: string): Promise<{ party: DbParty; guests: DbGuest[] } | null> {
  const { data: party, error: partyError } = await supabase
    .from('parties')
    .select('*')
    .eq('invite_code', inviteCode)
    .single();

  if (partyError || !party) {
    console.error('Error fetching party:', partyError);
    return null;
  }

  const { data: guests, error: guestsError } = await supabase
    .from('guests')
    .select('*')
    .eq('party_id', party.id)
    .order('submitted_at', { ascending: true });

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
    .select('*')
    .eq('id', partyId)
    .single();

  return data;
}

export async function updatePartyToppings(partyId: string, availableToppings: string[]): Promise<DbParty | null> {
  // Use the updateParty function which handles API routing
  const success = await updateParty(partyId, { available_toppings: availableToppings });
  if (!success) return null;

  // Fetch the updated party
  const { data } = await supabase
    .from('parties')
    .select('*')
    .eq('id', partyId)
    .single();

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
  pizzeriaRankings?: string[]
): Promise<{ guest: DbGuest; alreadyRegistered: boolean; requireApproval: boolean; updated: boolean } | null> {
  if (!inviteCode) {
    console.error('Invite code is required to add guest');
    return null;
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
      }),
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('Error adding guest:', errorData);
      return null;
    }

    const data = await response.json();

    // Return a minimal DbGuest object (backend only returns id and name)
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
      submitted_via: 'link',
      submitted_at: new Date().toISOString(),
    } as DbGuest;

    return { guest, alreadyRegistered: data.alreadyRegistered || false, requireApproval: data.requireApproval || false, updated: data.updated || false };
  } catch (error) {
    console.error('Error adding guest:', error);
    return null;
  }
}

export interface ExistingGuestData {
  id: string;
  name: string;
  email: string | null;
  ethereumAddress: string | null;
  roles: string[];
  mailingListOptIn: boolean;
  dietaryRestrictions: string[];
  likedToppings: string[];
  dislikedToppings: string[];
  likedBeverages: string[];
  dislikedBeverages: string[];
  pizzeriaRankings: string[];
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
      dietaryRestrictions: guest.dietaryRestrictions || [],
      likedToppings: guest.likedToppings || [],
      dislikedToppings: guest.dislikedToppings || [],
      likedBeverages: guest.likedBeverages || [],
      dislikedBeverages: guest.dislikedBeverages || [],
      pizzeriaRankings: guest.pizzeriaRankings || [],
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

export async function updateGuestApproval(guestId: string, approved: boolean, partyId?: string): Promise<boolean> {
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
    .select('*')
    .order('created_at', { ascending: false });

  if (error) {
    console.error('Error fetching parties:', error);
    return [];
  }
  return data || [];
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
    venue_name?: string | null;
    description?: string | null;
    password?: string | null;
    custom_url?: string | null;
    event_image_url?: string | null;
    max_guests?: number | null;
    hide_guests?: boolean;
    require_approval?: boolean;
    co_hosts?: any[];
    timezone?: string | null;
    available_beverages?: string[];
    available_toppings?: string[];
    // Sponsor settings
    sponsors_enabled?: boolean;
    sponsor_section_title?: string | null;
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
        venueName: updates.venue_name,
        maxGuests: updates.max_guests,
        hideGuests: updates.hide_guests,
        requireApproval: updates.require_approval,
        availableBeverages: updates.available_beverages,
        availableToppings: updates.available_toppings,
        password: updates.password,
        eventImageUrl: updates.event_image_url,
        description: updates.description,
        customUrl: updates.custom_url,
        coHosts: updates.co_hosts,
        sponsorsEnabled: updates.sponsors_enabled,
        sponsorSectionTitle: updates.sponsor_section_title,
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
      .select('*')
      .in('id', partyIdsAsGuest)
      .order('date', { ascending: true, nullsFirst: false });

    if (error) {
      console.error('Error fetching guest parties:', error);
    } else {
      guestParties = data || [];
    }
  }

  // Get parties where user is a host (co_hosts array contains their email)
  // Note: Using filter with text match because .contains() doesn't work well with JSONB arrays of objects
  const { data: allPartiesForHost, error: hostError } = await supabase
    .from('parties')
    .select('*')
    .order('date', { ascending: true, nullsFirst: false });

  // Filter client-side for parties where user is in co_hosts
  const normalizedEmail = userEmail.toLowerCase();
  const hostParties = (allPartiesForHost || []).filter((party: DbParty) => {
    if (!party.co_hosts || !Array.isArray(party.co_hosts)) return false;
    return party.co_hosts.some((host: any) =>
      host.email?.toLowerCase() === normalizedEmail
    );
  });

  if (hostError) {
    console.error('Error fetching host parties:', hostError);
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
  const { data, error } = await supabase
    .from('user_preferences')
    .select('dietary_restrictions, liked_toppings, disliked_toppings, liked_beverages, disliked_beverages')
    .eq('email', email)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    dietary_restrictions: data.dietary_restrictions || [],
    liked_toppings: data.liked_toppings || [],
    disliked_toppings: data.disliked_toppings || [],
    liked_beverages: data.liked_beverages || [],
    disliked_beverages: data.disliked_beverages || [],
  };
}

export async function saveUserPreferences(
  email: string,
  preferences: UserPreferences
): Promise<boolean> {
  // Use upsert to insert or update based on email
  const { error } = await supabase
    .from('user_preferences')
    .upsert({
      email,
      dietary_restrictions: preferences.dietary_restrictions,
      liked_toppings: preferences.liked_toppings,
      disliked_toppings: preferences.disliked_toppings,
      liked_beverages: preferences.liked_beverages,
      disliked_beverages: preferences.disliked_beverages,
      updated_at: new Date().toISOString(),
    }, {
      onConflict: 'email',
    });

  if (error) {
    console.error('Error saving user preferences:', error);
    return false;
  }

  return true;
}
