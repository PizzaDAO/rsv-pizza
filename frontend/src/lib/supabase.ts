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
    const { data, error } = await supabase.storage
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
  password: string | null;
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
  submitted_at: string;
  submitted_via: string;
}

// Party operations
export async function createParty(
  name: string,
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
  timezone?: string
): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .insert({
      name,
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

export async function getPartyByInviteCodeOrCustomUrl(slug: string): Promise<DbParty | null> {
  // Try custom URL first
  const { data: customUrlData, error: customUrlError } = await supabase
    .from('parties')
    .select('*')
    .eq('custom_url', slug)
    .maybeSingle();

  if (customUrlData) {
    return customUrlData;
  }

  // If not found by custom URL, try invite code
  const { data: inviteCodeData, error: inviteCodeError } = await supabase
    .from('parties')
    .select('*')
    .eq('invite_code', slug)
    .maybeSingle();

  if (inviteCodeData) {
    return inviteCodeData;
  }

  // Neither found
  if (customUrlError) console.error('Error fetching party by custom URL:', customUrlError);
  if (inviteCodeError) console.error('Error fetching party by invite code:', inviteCodeError);
  return null;
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
  mailingListOptIn?: boolean
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
      submitted_via: 'link',
    })
    .select()
    .single();

  if (error) {
    console.error('Error adding guest:', error);
    return null;
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
    .from('users')
    .select('default_dietary_restrictions, default_liked_toppings, default_disliked_toppings, default_liked_beverages, default_disliked_beverages')
    .eq('email', email)
    .maybeSingle();

  if (error || !data) {
    return null;
  }

  return {
    dietary_restrictions: data.default_dietary_restrictions || [],
    liked_toppings: data.default_liked_toppings || [],
    disliked_toppings: data.default_disliked_toppings || [],
    liked_beverages: data.default_liked_beverages || [],
    disliked_beverages: data.default_disliked_beverages || [],
  };
}

export async function saveUserPreferences(
  email: string,
  preferences: UserPreferences
): Promise<boolean> {
  // Try to update first, if no rows affected then insert
  const { data: existingUser } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (existingUser) {
    // Update existing user
    const { error } = await supabase
      .from('users')
      .update({
        default_dietary_restrictions: preferences.dietary_restrictions,
        default_liked_toppings: preferences.liked_toppings,
        default_disliked_toppings: preferences.disliked_toppings,
        default_liked_beverages: preferences.liked_beverages,
        default_disliked_beverages: preferences.disliked_beverages,
      })
      .eq('email', email);

    if (error) {
      console.error('Error updating user preferences:', error);
      return false;
    }
  } else {
    // Insert new user with preferences
    const { error } = await supabase
      .from('users')
      .insert({
        email,
        default_dietary_restrictions: preferences.dietary_restrictions,
        default_liked_toppings: preferences.liked_toppings,
        default_disliked_toppings: preferences.disliked_toppings,
        default_liked_beverages: preferences.liked_beverages,
        default_disliked_beverages: preferences.disliked_beverages,
      });

    if (error) {
      console.error('Error creating user with preferences:', error);
      return false;
    }
  }

  return true;
}
