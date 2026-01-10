import { createClient } from '@supabase/supabase-js';

const supabaseUrl = 'https://znpiwdvvsqaxuskpfleo.supabase.co';
const supabaseAnonKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InpucGl3ZHZ2c3FheHVza3BmbGVvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjgwMjA0ODQsImV4cCI6MjA4MzU5NjQ4NH0.yAb2_JOtyYD0uqvqoPufzc5kG2pNjyqd1pC97UViXuw';

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Types for database tables
export interface DbParty {
  id: string;
  name: string;
  invite_code: string;
  host_name: string | null;
  date: string | null;
  pizza_style: string;
  max_guests: number | null;
  rsvp_closed_at: string | null;
  created_at: string;
}

export interface DbGuest {
  id: string;
  party_id: string;
  name: string;
  dietary_restrictions: string[];
  liked_toppings: string[];
  disliked_toppings: string[];
  submitted_at: string;
  submitted_via: string;
}

// Party operations
export async function createParty(name: string, hostName?: string, date?: string, pizzaStyle: string = 'new-york'): Promise<DbParty | null> {
  const { data, error } = await supabase
    .from('parties')
    .insert({
      name,
      host_name: hostName || null,
      date: date || null,
      pizza_style: pizzaStyle,
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

// Guest operations
export async function addGuestToParty(
  partyId: string,
  name: string,
  dietaryRestrictions: string[],
  likedToppings: string[],
  dislikedToppings: string[]
): Promise<DbGuest | null> {
  const { data, error } = await supabase
    .from('guests')
    .insert({
      party_id: partyId,
      name,
      dietary_restrictions: dietaryRestrictions,
      liked_toppings: likedToppings,
      disliked_toppings: dislikedToppings,
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
  dislikedToppings: string[]
): Promise<DbGuest | null> {
  const { data, error } = await supabase
    .from('guests')
    .insert({
      party_id: partyId,
      name,
      dietary_restrictions: dietaryRestrictions,
      liked_toppings: likedToppings,
      disliked_toppings: dislikedToppings,
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
