import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Guest, PizzaRecommendation, Topping, PizzaStyle, PizzaSize, PizzaSettings, Party, Beverage, BeverageRecommendation, WaveRecommendation } from '../types';

import { generateBeverageRecommendations } from '../utils/beverageAlgorithm';
import { generateWaveRecommendations } from '../utils/waveAlgorithm';
import { TOPPINGS, DRINK_CATEGORIES, DIETARY_OPTIONS, PIZZA_STYLES, PIZZA_SIZES } from '../constants/options';
import * as db from '../lib/supabase';
import { computeEffectiveCapUsd } from '../lib/reimbursementCap';

interface PizzaContextType {
  // Party management
  party: Party | null;
  partyLoading: boolean;
  createParty: (name: string, hostName?: string, date?: string, expectedGuests?: number, address?: string, selectedBeverages?: string[], duration?: number, password?: string, eventImageUrl?: string, description?: string, customUrl?: string) => Promise<string | null>;
  loadParty: (inviteCode: string) => Promise<boolean>;
  mergeParty: (updates: Partial<Party>) => void;
  clearParty: () => void;
  getInviteLink: () => string;
  getHostLink: () => string;
  updatePartyBeverages: (beverages: string[]) => Promise<void>;
  updatePartyToppings: (toppings: string[]) => Promise<void>;
  updatePartyDietaryOptions: (dietaryOptions: string[]) => Promise<void>;
  // Guest management
  // Note: `guests` is the visible list (excludes guests with `approved === false`).
  // `rejectedGuests` is the host-rejected list (approved === false), surfaced via
  // the "Rejected (N)" chip + RejectedGuestsModal for one-click restore.
  guests: Guest[];
  rejectedGuests: Guest[];
  // calabrese-58204: exposed so the opt-in `useGuestsRealtime` hook on host pages
  // can push live updates into context without the broad subscription that lived
  // here previously (which churned the realtime `subscription` table for every
  // public RSVPer and caused the 2026-05-19 outage). Setters write the raw list
  // and the derived `guests`/`rejectedGuests` re-compute from it.
  setGuests: (guests: Guest[]) => void;
  setParty: React.Dispatch<React.SetStateAction<Party | null>>;
  addGuest: (guest: Omit<Guest, 'id'>) => Promise<void>;
  removeGuest: (id: string) => Promise<void>;
  approveGuest: (id: string) => Promise<void>;
  declineGuest: (id: string) => Promise<void>;
  rejectGuest: (id: string) => Promise<void>;
  restoreGuest: (id: string) => Promise<void>;
  uncheckInGuest: (id: string) => Promise<void>;
  promoteGuest: (id: string) => Promise<void>;
  // Recommendations
  recommendations: PizzaRecommendation[];
  generateRecommendations: () => void;
  beverageRecommendations: BeverageRecommendation[];
  waveRecommendations: WaveRecommendation[];
  orderExpectedGuests: number | null;
  setOrderExpectedGuests: (count: number | null) => void;
  // Static data
  availableToppings: Topping[];
  availableBeverages: Beverage[];
  dietaryOptions: string[];
  pizzaStyles: PizzaStyle[];
  pizzaSizes: PizzaSize[];
  pizzaSettings: PizzaSettings;
  updatePizzaSettings: (settings: PizzaSettings) => void;
}

export const PizzaContext = createContext<PizzaContextType | undefined>(undefined);

// Re-export from constants for backward compatibility
export const availableToppings = TOPPINGS;
export const availableBeverages = DRINK_CATEGORIES;
export const dietaryOptions = [...DIETARY_OPTIONS, 'None'];
export const pizzaStyles = PIZZA_STYLES;
export const pizzaSizes = PIZZA_SIZES;

// Convert database guest to app guest
export function dbGuestToGuest(dbGuest: db.DbGuest): Guest {
  return {
    id: dbGuest.id,
    name: dbGuest.name,
    email: dbGuest.email,
    ethereumAddress: dbGuest.ethereum_address,
    roles: dbGuest.roles,
    mailingListOptIn: dbGuest.mailing_list_opt_in,
    dietaryRestrictions: dbGuest.dietary_restrictions,
    toppings: dbGuest.liked_toppings,
    dislikedToppings: dbGuest.disliked_toppings,
    likedBeverages: dbGuest.liked_beverages || [],
    dislikedBeverages: dbGuest.disliked_beverages || [],
    pizzeriaRankings: dbGuest.pizzeria_rankings || [],
    suggestedPizzerias: dbGuest.suggested_pizzerias || [],
    submittedAt: dbGuest.submitted_at,
    checkedInAt: dbGuest.checked_in_at ?? null,
    approved: dbGuest.approved ?? null,
    checkedInBy: dbGuest.checked_in_by ?? null,
    status: dbGuest.status || 'CONFIRMED',
    waitlistPosition: dbGuest.waitlist_position || null,
    promotedAt: dbGuest.promoted_at || null,
  };
}

// Convert database party to app party
export function dbPartyToParty(dbParty: db.DbParty, guests: Guest[]): Party {
  return {
    id: dbParty.id,
    name: dbParty.name,
    inviteCode: dbParty.invite_code,
    customUrl: dbParty.custom_url,
    date: dbParty.date,
    duration: dbParty.duration,
    timezone: dbParty.timezone,
    hostName: dbParty.host_name,
    userId: dbParty.user_id,
    pizzaStyle: dbParty.pizza_style,
    availableBeverages: dbParty.available_beverages || [],
    availableToppings: dbParty.available_toppings || [],
    availableDietaryOptions: dbParty.available_dietary_options || [],
    maxGuests: dbParty.max_guests,
    expectedGuests: dbParty.expected_guests || null,
    hideGuests: dbParty.hide_guests || false,
    requireApproval: dbParty.require_approval || false,
    password: dbParty.password,
    hasPassword: dbParty.has_password,
    eventImageUrl: dbParty.event_image_url,
    description: dbParty.description,
    address: dbParty.address,
    latitude: dbParty.latitude || null,
    longitude: dbParty.longitude || null,
    country: dbParty.country || null,
    city: dbParty.city || null,
    placeId: dbParty.place_id || null,
    rsvpClosedAt: dbParty.rsvp_closed_at,
    coHosts: dbParty.co_hosts || dbParty.co_hosts_public || [],
    selectedPizzerias: dbParty.selected_pizzerias || [],
    venueName: dbParty.venue_name,
    shareToUnlock: dbParty.share_to_unlock || false,
    shareTweetText: dbParty.share_tweet_text || null,
    photoModeration: dbParty.photo_moderation || false,
    nftEnabled: dbParty.nft_enabled || false,
    nftChain: dbParty.nft_chain || null,
    createdAt: dbParty.created_at,
    donationEnabled: dbParty.donation_enabled || false,
    donationGoal: dbParty.donation_goal || null,
    donationMessage: dbParty.donation_message || null,
    suggestedAmounts: dbParty.suggested_amounts || null,
    donationRecipient: dbParty.donation_recipient || null,
    donationRecipientUrl: dbParty.donation_recipient_url || null,
    donationEthAddress: dbParty.donation_eth_address || null,
    pinnedApps: (dbParty.pinned_apps as string[]) ?? [],
    region: dbParty.region || null,
    flyerGeneratedAt: dbParty.flyer_generated_at || null,
    flyerConfig: dbParty.flyer_config || null,
    posterImageUrl: dbParty.poster_image_url || null,
    posterGeneratedAt: dbParty.poster_generated_at || null,
    rollupImageUrl: dbParty.rollup_image_url || null,
    rollupGeneratedAt: dbParty.rollup_generated_at || null,
    eventType: dbParty.event_type || null,
    eventTags: dbParty.event_tags || [],
    canEdit: dbParty.can_edit || false,
    allowedTabs: dbParty.allowed_tabs,
    hiddenGppPhotos: (dbParty.hidden_gpp_photos as string[]) || [],
    extraGppPhotos: (dbParty.extra_gpp_photos as string[]) || [],
    lumaUrl: dbParty.luma_url || null,
    meetupUrl: dbParty.meetup_url || null,
    eventbriteUrl: dbParty.eventbrite_url || null,
    externalLinks: dbParty.external_links || [],
    telegramGroup: dbParty.telegram_group || null,
    hostTelegramChatId: dbParty.host_telegram_chat_id ? String(dbParty.host_telegram_chat_id) : null,
    hostTelegramLinkToken: dbParty.host_telegram_link_token || null,
    underbossStatus: (dbParty.underboss_status as any) || null,
    turtleRolesEnabled: dbParty.turtle_roles_enabled || false,
    reimbursementCapUsd: dbParty.reimbursement_cap_usd != null ? Number(dbParty.reimbursement_cap_usd) : null,
    // arugula-38633 v2 follow-up: numeric-tag fallback. Computed client-side
    // because the host party flows through Supabase (not /api/parties/:id).
    effectiveReimbursementCapUsd: computeEffectiveCapUsd({
      reimbursementCapUsd: dbParty.reimbursement_cap_usd,
      eventTags: dbParty.event_tags,
    }),
    reimbursementCapAppealNote: dbParty.reimbursement_cap_appeal_note ?? null,
    reimbursementCapAppealedAt: dbParty.reimbursement_cap_appealed_at ?? null,
    // Day-of logistics (pepperoni-58341)
    wifiInfo: dbParty.wifi_info ?? null,
    parkingNotes: dbParty.parking_notes ?? null,
    // quattro-71244: gamified-dashboard goal targets.
    hostGoals: dbParty.host_goals ?? null,
    guests,
  };
}

export const PizzaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [party, setParty] = useState<Party | null>(null);
  const [partyLoading, setPartyLoading] = useState(false);
  // `allGuests` is the raw list from the DB (includes rejected guests).
  // `guests` and `rejectedGuests` are derived below so downstream consumers
  // never see rejected guests unless they specifically opt in.
  const [allGuests, setAllGuests] = useState<Guest[]>([]);
  const guests = React.useMemo(() => allGuests.filter(g => g.approved !== false), [allGuests]);
  const rejectedGuests = React.useMemo(() => allGuests.filter(g => g.approved === false), [allGuests]);
  const [recommendations, setRecommendations] = useState<PizzaRecommendation[]>([]);
  const [beverageRecommendations, setBeverageRecommendations] = useState<BeverageRecommendation[]>([]);
  const [waveRecommendations, setWaveRecommendations] = useState<WaveRecommendation[]>([]);
  const [orderExpectedGuests, setOrderExpectedGuests] = useState<number | null>(null);

  const [pizzaSettings, setPizzaSettings] = useState<PizzaSettings>(() => {
    const savedSettings = localStorage.getItem('pizzaPartySettings');
    return savedSettings ? JSON.parse(savedSettings) : {
      size: pizzaSizes[3],
      style: pizzaStyles[1]
    };
  });

  // Note: Party loading is now handled by the page components (HostPage, RSVPPage)
  // based on the URL parameters. localStorage is only used to remember the last
  // party for the home page redirect.

  // calabrese-58204: Realtime guest subscription is now OPT-IN per page via
  // `useGuestsRealtime(partyId, onChange)` from `frontend/src/hooks/useGuestsRealtime.ts`.
  // The previous global subscription here opened a Supabase Realtime channel for
  // every public RSVPer (RSVPPage loads PizzaContext too), which churned the
  // realtime `subscription` table and pinned WAL processing — site outage
  // 2026-05-19. Do NOT re-add a subscription here. See plans/calabrese-58204-pool-exhaustion-fix.md.

  useEffect(() => {
    localStorage.setItem('pizzaPartySettings', JSON.stringify(pizzaSettings));
  }, [pizzaSettings]);

  const createParty = async (name: string, hostName?: string, date?: string, expectedGuests?: number, address?: string, selectedBeverages?: string[], duration?: number, password?: string, eventImageUrl?: string, description?: string, customUrl?: string): Promise<string | null> => {
    setPartyLoading(true);
    try {
      const dbParty = await db.createParty({
        name,
        hostName,
        date,
        pizzaStyle: pizzaSettings.style.id,
        expectedGuests,
        address,
        availableBeverages: selectedBeverages,
        duration,
        password,
        eventImageUrl,
        description,
        customUrl,
      });
      if (dbParty) {
        const newParty = dbPartyToParty(dbParty, []);
        setParty(newParty);
        setAllGuests([]);
        localStorage.setItem('rsvpizza_currentPartyCode', dbParty.invite_code);
        return dbParty.invite_code;
      }
      return null;
    } catch (error) {
      console.error('Error creating party in context:', error);
      return null;
    } finally {
      setPartyLoading(false);
    }
  };

  const mergeParty = useCallback((updates: Partial<Party>) => {
    setParty(prev => prev ? { ...prev, ...updates } : prev);
  }, []);

  const loadParty = useCallback(async (inviteCode: string): Promise<boolean> => {
    // Clear existing state before loading new party
    setRecommendations([]);
    setBeverageRecommendations([]);
    setWaveRecommendations([]);
    setPartyLoading(true);
    try {
      const result = await db.getPartyWithGuests(inviteCode);
      if (result) {
        const partyGuests = result.guests.map(dbGuestToGuest);
        // party.guests is the visible list — filter rejected guests out.
        const visibleGuests = partyGuests.filter(g => g.approved !== false);
        const loadedParty = dbPartyToParty(result.party, visibleGuests);
        setParty(loadedParty);
        setAllGuests(partyGuests);
        localStorage.setItem('rsvpizza_currentPartyCode', inviteCode);
        return true;
      }
      return false;
    } finally {
      setPartyLoading(false);
    }
  }, []);

  const clearParty = () => {
    localStorage.removeItem('rsvpizza_currentPartyCode');
    setParty(null);
    setAllGuests([]);
    setRecommendations([]);
    setBeverageRecommendations([]);
    setWaveRecommendations([]);
  };

  const getInviteLink = (): string => {
    if (!party) return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}/rsvp/${party.inviteCode}`;
  };

  const getHostLink = (): string => {
    if (!party) return '';
    const baseUrl = window.location.origin;
    return `${baseUrl}/host/${party.inviteCode}`;
  };

  const addGuest = async (guest: Omit<Guest, 'id'>) => {
    if (!party) return;

    const dbGuest = await db.addGuestByHost(
      party.id,
      guest.name,
      guest.dietaryRestrictions,
      guest.toppings,
      guest.dislikedToppings,
      guest.likedBeverages || [],
      guest.dislikedBeverages || []
    );

    if (dbGuest) {
      const newGuest = dbGuestToGuest(dbGuest);
      setAllGuests(prev => [...prev, newGuest]);
      // newly-added guests are never rejected, so push into party.guests too
      setParty(prev => prev ? { ...prev, guests: [...prev.guests, newGuest] } : null);
    }
  };

  const removeGuest = async (id: string) => {
    const success = await db.removeGuest(id, party?.id);
    if (success) {
      setAllGuests(prev => prev.filter(g => g.id !== id));
      setParty(prev => prev ? { ...prev, guests: prev.guests.filter(g => g.id !== id) } : null);
    }
  };

  const approveGuest = async (id: string) => {
    const success = await db.updateGuestApproval(id, true, party?.id);
    if (success) {
      setAllGuests(prev => prev.map(g => g.id === id ? { ...g, approved: true } : g));
      setParty(prev => prev ? {
        ...prev,
        guests: prev.guests.map(g => g.id === id ? { ...g, approved: true } : g)
      } : null);
    }
  };

  const declineGuest = async (id: string) => {
    const success = await db.updateGuestApproval(id, false, party?.id);
    if (success) {
      setAllGuests(prev => prev.map(g => g.id === id ? { ...g, approved: false } : g));
      // a declined guest disappears from the visible (party.guests) list
      setParty(prev => prev ? {
        ...prev,
        guests: prev.guests.filter(g => g.id !== id)
      } : null);
    }
  };

  // Host-facing soft-reject: same wire as declineGuest but with an
  // optimistic-revert path. Used by the new "Reject" buttons on TableRow,
  // GuestCard, GuestBasicCard, etc.
  const rejectGuest = async (id: string) => {
    if (!party?.inviteCode) return;
    const previousAll = allGuests;
    // Optimistic: mark guest as approved=false locally → derived `guests`
    // drops it, derived `rejectedGuests` picks it up.
    setAllGuests(prev => prev.map(g => g.id === id ? { ...g, approved: false } : g));
    setParty(prev => prev ? { ...prev, guests: prev.guests.filter(g => g.id !== id) } : null);
    const success = await db.updateGuestApproval(id, false, party.id);
    if (!success) {
      // Revert by restoring previous list + reloading from server.
      setAllGuests(previousAll);
      await loadParty(party.inviteCode);
    }
  };

  // Restore a previously-rejected guest by bumping them back to needs-approval
  // (approved=null). They reappear in the visible list with the Approve/Decline
  // pair, so the host has to click Approve to re-confirm — making restore a
  // deliberate two-step action instead of a one-click un-do that re-confirms
  // by side effect.
  const restoreGuest = async (id: string) => {
    if (!party?.inviteCode) return;
    const previousAll = allGuests;
    const restored = previousAll.find(g => g.id === id);
    // Optimistic: flip approved=null → guest reappears in visible list as pending.
    setAllGuests(prev => prev.map(g => g.id === id ? { ...g, approved: null } : g));
    if (restored) {
      const restoredGuest: Guest = { ...restored, approved: null };
      setParty(prev => prev ? { ...prev, guests: [...prev.guests, restoredGuest] } : null);
    }
    const success = await db.updateGuestApproval(id, null, party.id);
    if (!success) {
      setAllGuests(previousAll);
      await loadParty(party.inviteCode);
    }
  };

  // Un-check-in: hosts can undo a mis-tap by clearing checkedInAt/checkedInBy.
  // Backend route DELETE /api/checkin/:inviteCode/:guestId is idempotent.
  const uncheckInGuest = async (id: string) => {
    if (!party?.inviteCode) return;
    const previousAll = allGuests;
    // Optimistic: clear local checkedInAt
    setAllGuests(prev => prev.map(g => g.id === id ? { ...g, checkedInAt: null, checkedInBy: null } : g));
    setParty(prev => prev ? {
      ...prev,
      guests: prev.guests.map(g => g.id === id ? { ...g, checkedInAt: null, checkedInBy: null } : g)
    } : null);
    const success = await db.uncheckInGuest(id, { id: party.id, inviteCode: party.inviteCode });
    if (!success) {
      // Revert by restoring previous local state + reload from server.
      setAllGuests(previousAll);
      await loadParty(party.inviteCode);
    }
  };

  const promoteGuest = async (id: string) => {
    if (!party) return;
    const success = await db.promoteGuest(id, party.id);
    if (success) {
      setAllGuests(prev => prev.map(g =>
        g.id === id
          ? { ...g, status: 'CONFIRMED', waitlistPosition: null, promotedAt: new Date().toISOString() }
          : g.status === 'WAITLISTED' && g.waitlistPosition && g.waitlistPosition > (prev.find(p => p.id === id)?.waitlistPosition || 0)
            ? { ...g, waitlistPosition: g.waitlistPosition - 1 }
            : g
      ));
      setParty(prev => prev ? {
        ...prev,
        guests: prev.guests.map(g =>
          g.id === id
            ? { ...g, status: 'CONFIRMED', waitlistPosition: null, promotedAt: new Date().toISOString() }
            : g.status === 'WAITLISTED' && g.waitlistPosition && g.waitlistPosition > (prev.guests.find(p => p.id === id)?.waitlistPosition || 0)
              ? { ...g, waitlistPosition: g.waitlistPosition - 1 }
              : g
        )
      } : null);
    }
  };

  const updatePizzaSettings = (settings: PizzaSettings) => {
    setPizzaSettings(settings);
  };

  const updatePartyBeverages = async (beverages: string[]) => {
    if (!party) return;

    const dbParty = await db.updatePartyBeverages(party.id, beverages);
    if (dbParty) {
      const updatedParty = dbPartyToParty(dbParty, guests);
      // Preserve canEdit/allowedTabs — re-fetch from Supabase loses these computed fields
      updatedParty.canEdit = party.canEdit;
      updatedParty.allowedTabs = party.allowedTabs;
      setParty(updatedParty);
      // Regenerate beverage recommendations with new beverage selection
      if (beverages.length > 0) {
        const newBeverageRecs = generateBeverageRecommendations(
          guests,
          beverages,
          availableBeverages,
          party.maxGuests
        );
        setBeverageRecommendations(newBeverageRecs);
      } else {
        setBeverageRecommendations([]);
      }
    }
  };

  const updatePartyToppings = async (toppings: string[]) => {
    if (!party) return;

    const dbParty = await db.updatePartyToppings(party.id, toppings);
    if (dbParty) {
      const updatedParty = dbPartyToParty(dbParty, guests);
      // Preserve canEdit/allowedTabs — re-fetch from Supabase loses these computed fields
      updatedParty.canEdit = party.canEdit;
      updatedParty.allowedTabs = party.allowedTabs;
      setParty(updatedParty);
    }
  };

  const updatePartyDietaryOptions = async (dietaryOptions: string[]) => {
    if (!party) return;

    const dbParty = await db.updatePartyDietaryOptions(party.id, dietaryOptions);
    if (dbParty) {
      const updatedParty = dbPartyToParty(dbParty, guests);
      // Preserve canEdit/allowedTabs — re-fetch from Supabase loses these computed fields
      updatedParty.canEdit = party.canEdit;
      updatedParty.allowedTabs = party.allowedTabs;
      setParty(updatedParty);
    }
  };

  const generateRecommendations = () => {
    if (!party) return;

    // Generate wave-based recommendations (handles both single and multi-wave)
    // Pass orderExpectedGuests as override if set
    const activeGuests = guests.filter(g => g.status !== 'INVITED');
    const waves = generateWaveRecommendations(activeGuests, pizzaSettings.style, party, availableBeverages, orderExpectedGuests);
    setWaveRecommendations(waves);

    // Also update single recommendations for backward compatibility
    setRecommendations(waves[0]?.pizzas || []);
    setBeverageRecommendations(waves[0]?.beverages || []);
  };

  // Update pizza quantity in recommendations
  const updatePizzaQuantity = (pizzaId: string, newQuantity: number) => {
    if (newQuantity <= 0) {
      // Remove the pizza if quantity is 0 or less
      removePizza(pizzaId);
      return;
    }

    setRecommendations(prev =>
      prev.map(p => p.id === pizzaId ? { ...p, quantity: newQuantity } : p)
    );

    // Also update wave recommendations
    setWaveRecommendations(prev =>
      prev.map(wave => ({
        ...wave,
        pizzas: wave.pizzas.map(p => p.id === pizzaId ? { ...p, quantity: newQuantity } : p),
        totalPizzas: wave.pizzas.reduce((sum, p) => sum + (p.id === pizzaId ? newQuantity : (p.quantity || 1)), 0),
      }))
    );
  };

  // Remove pizza from recommendations
  const removePizza = (pizzaId: string) => {
    setRecommendations(prev => prev.filter(p => p.id !== pizzaId));

    // Also update wave recommendations
    setWaveRecommendations(prev =>
      prev.map(wave => ({
        ...wave,
        pizzas: wave.pizzas.filter(p => p.id !== pizzaId),
        totalPizzas: wave.pizzas.filter(p => p.id !== pizzaId).reduce((sum, p) => sum + (p.quantity || 1), 0),
      }))
    );
  };

  return (
    <PizzaContext.Provider value={{
      party,
      partyLoading,
      createParty,
      loadParty,
      mergeParty,
      clearParty,
      getInviteLink,
      getHostLink,
      updatePartyBeverages,
      updatePartyToppings,
      updatePartyDietaryOptions,
      guests,
      rejectedGuests,
      setGuests: setAllGuests,
      setParty,
      addGuest,
      removeGuest,
      approveGuest,
      declineGuest,
      rejectGuest,
      restoreGuest,
      uncheckInGuest,
      promoteGuest,
      recommendations,
      generateRecommendations,
      updatePizzaQuantity,
      removePizza,
      beverageRecommendations,
      waveRecommendations,
      orderExpectedGuests,
      setOrderExpectedGuests,
      availableToppings,
      availableBeverages,
      dietaryOptions,
      pizzaStyles,
      pizzaSizes,
      pizzaSettings,
      updatePizzaSettings,
    }}>
      {children}
    </PizzaContext.Provider>
  );
};

export const usePizza = () => {
  const context = useContext(PizzaContext);
  if (context === undefined) {
    throw new Error('usePizza must be used within a PizzaProvider');
  }
  return context;
};
