import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw';

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
  customUrl?: string
): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .insert({
      name,
      host_name: hostName || null,
      date: date || null,
      duration: duration || null,
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
  const { data, error} = await supabase
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
  const { data, error} = await supabase
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
