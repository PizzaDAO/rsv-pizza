import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables. Please set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your .env.local file.');
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

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

// Types for database tables
export interface DbParty {
  id: string;
  name: string;
  invite_code: string;
  custom_url: string | null;
  host_name: string | null;
  date: string | null;
  duration: number | null;
  timezone: string | null;
  pizza_style: string;
  available_beverages: string[];
  available_toppings: string[];
  max_guests: number | null;
  hide_guests: boolean;
  password?: string | null;
  has_password?: boolean;
  event_image_url: string | null;
  description: string | null;
  address: string | null;
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
  hostEmail?: string
): Promise<DbParty | null> {
  // Generate default party name if not provided
  let partyName = name?.trim();
  if (!partyName) {
    // Count existing parties to generate unique name
    const { count } = await supabase
      .from('parties')
      .select('*', { count: 'exact', head: true });
    const partyNumber = (count || 0) + 1;
    partyName = `Pizza Party ${partyNumber}`;
  }

  // If host email is provided, add them as a co-host so they're linked to the event
  const coHosts = hostEmail ? [{ id: crypto.randomUUID(), name: hostName || '', email: hostEmail, showOnEvent: false }] : [];

  const { data, error } = await supabase
    .from('parties')
    .insert({
      name: partyName,
      host_name: hostName || null,
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
  const safeColumns = `
    id, name, invite_code, custom_url, host_name, date, duration, timezone, 
    pizza_style, available_beverages, available_toppings, max_guests, hide_guests, 
    event_image_url, description, address, rsvp_closed_at, co_hosts, created_at
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
  const { data, error } = await supabase
    .from('parties')
    .update({ available_beverages: availableBeverages })
    .eq('id', partyId)
    .select()
    .single();

  if (error) {
    console.error('Error updating party beverages:', error);
    return null;
  }
  return data;
}

export async function updatePartyToppings(partyId: string, availableToppings: string[]): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .update({ available_toppings: availableToppings })
    .eq('id', partyId)
    .select()
    .single();

  if (error) {
    console.error('Error updating party toppings:', error);
    return null;
  }
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
): Promise<DbGuest | null> {
  const { data, error } = await supabase
    .from('guests')
    .insert({
      party_id: partyId,
      name,
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
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding guest:', error);
    return null;
  }

  // Send confirmation email via backend API if email provided
  if (email && inviteCode) {
    try {
      await fetch(`${API_URL}/api/rsvp/${inviteCode}/send-confirmation`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          guestId: data.id,
          guestEmail: email,
          guestName: name,
        }),
      });
    } catch (emailError) {
      console.error('Failed to send confirmation email:', emailError);
      // Don't fail the RSVP if email fails
    }
  }

  return data;
}

export async function addGuestByHost(
  partyId: string,
  name: string,
  dietaryRestrictions: string[],
  likedToppings: string[],
  dislikedToppings: string[],
  likedBeverages: string[],
  dislikedBeverages: string[]
): Promise<DbGuest | null> {
  const { data, error } = await supabase
    .from('guests')
    .insert({
      party_id: partyId,
      name,
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

export async function removeGuest(guestId: string): Promise<boolean> {
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
    host_name?: string | null;
    date?: string | null;
    duration?: number | null;
    address?: string | null;
    description?: string | null;
    password?: string | null;
    custom_url?: string | null;
    event_image_url?: string | null;
    max_guests?: number | null;
    hide_guests?: boolean;
    co_hosts?: any[];
    timezone?: string | null;
  }
): Promise<boolean> {
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
  const { data: hostParties, error: hostError } = await supabase
    .from('parties')
    .select('*')
    .contains('co_hosts', [{ email: userEmail }])
    .order('date', { ascending: true, nullsFirst: false });

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
