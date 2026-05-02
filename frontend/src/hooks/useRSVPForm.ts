import { useState, useEffect, useCallback } from 'react';
import { addGuestToParty, getUserPreferences, saveUserPreferences, ExistingGuestData } from '../lib/supabase';
import { getExcludedToppingIds } from '../constants/options';
import { searchPizzerias, geocodeAddress } from '../lib/ordering';
import { Pizzeria } from '../types';
import { PublicEvent } from '../lib/api';
import { DbParty } from '../lib/supabase';
import { uuid } from '../lib/utils';

// ---- Types ----

/** Normalized event data both RSVPModal and RSVPPage map into */
export interface RSVPEventData {
  id: string;
  name: string;
  inviteCode: string;
  customUrl: string | null;
  address: string | null;
  eventType?: string | null;
  eventTags?: string[];
  nftEnabled?: boolean;
  nftChain?: string | null;
  eventImageUrl?: string | null;
  donationEnabled?: boolean;
  donationRecipient?: string | null;
  donationRecipientUrl?: string | null;
  availableBeverages: string[];
  availableToppings: string[];
  selectedPizzerias?: Pizzeria[];
}

export interface RSVPSubmitResult {
  guest: { id: string } | null;
  alreadyRegistered: boolean;
  requireApproval: boolean;
  updated: boolean;
  waitlisted: boolean;
  waitlistPosition: number | null;
}

export interface UseRSVPFormOptions {
  eventData: RSVPEventData;
  user: { email?: string; name?: string } | null;
  existingGuest?: ExistingGuestData | null;
  isOpen?: boolean; // for modal: only load when open; default true for RSVPPage
  onSuccess?: (result: RSVPSubmitResult) => void;
}

// ---- Mappers ----

/** Map PublicEvent (camelCase, from API) to RSVPEventData */
export function publicEventToRSVPData(event: PublicEvent): RSVPEventData {
  return {
    id: event.id,
    name: event.name,
    inviteCode: event.inviteCode,
    customUrl: event.customUrl,
    address: event.address,
    eventType: event.eventType,
    eventTags: event.eventTags,
    nftEnabled: event.nftEnabled,
    nftChain: event.nftChain,
    eventImageUrl: event.eventImageUrl,
    donationEnabled: event.donationEnabled,
    donationRecipient: event.donationRecipient,
    donationRecipientUrl: event.donationRecipientUrl,
    availableBeverages: event.availableBeverages || [],
    availableToppings: event.availableToppings || [],
    selectedPizzerias: event.selectedPizzerias,
  };
}

/** Map DbParty (snake_case, from Supabase) to RSVPEventData */
export function dbPartyToRSVPData(party: DbParty): RSVPEventData {
  return {
    id: party.id,
    name: party.name,
    inviteCode: party.invite_code,
    customUrl: party.custom_url,
    address: party.address,
    eventType: party.event_type,
    eventTags: party.event_tags,
    nftEnabled: party.nft_enabled,
    nftChain: party.nft_chain,
    eventImageUrl: party.event_image_url,
    donationEnabled: party.donation_enabled,
    donationRecipient: party.donation_recipient,
    donationRecipientUrl: party.donation_recipient_url,
    availableBeverages: party.available_beverages || [],
    availableToppings: party.available_toppings || [],
    selectedPizzerias: party.selected_pizzerias as Pizzeria[] | undefined,
  };
}

// ---- Hook ----

export function useRSVPForm(options: UseRSVPFormOptions) {
  const { eventData, user, existingGuest, onSuccess } = options;
  const isOpen = options.isOpen ?? true; // default true for page usage
  const isEditing = !!existingGuest;

  // Step navigation
  const [step, setStep] = useState(1);

  // Step 1 - Personal Info
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [ethereumAddress, setEthereumAddress] = useState('');
  const [walletValidation, setWalletValidation] = useState<'idle' | 'valid' | 'invalid'>('idle');
  const [roles, setRoles] = useState<string[]>([]);
  const [mailingListOptIn, setMailingListOptIn] = useState(false);
  const [swcOptIn, setSwcOptIn] = useState(false);
  const [showSwcInfoModal, setShowSwcInfoModal] = useState(false);
  const [swcCaOptIn, setSwcCaOptIn] = useState(false);
  const [showSwcCaInfoModal, setShowSwcCaInfoModal] = useState(false);
  const [swcAuOptIn, setSwcAuOptIn] = useState(false);
  const [showSwcAuInfoModal, setShowSwcAuInfoModal] = useState(false);
  const [ethconfOptIn, setEthconfOptIn] = useState(false);

  // Step 2 - Pizza Preferences
  const [dietaryRestrictions, setDietaryRestrictions] = useState<string[]>([]);
  const [likedToppings, setLikedToppings] = useState<string[]>([]);
  const [dislikedToppings, setDislikedToppings] = useState<string[]>(['anchovies']);
  const [likedBeverages, setLikedBeverages] = useState<string[]>([]);
  const [dislikedBeverages, setDislikedBeverages] = useState<string[]>([]);
  const [saveToProfile, setSaveToProfile] = useState(false);
  const [preferencesLoaded, setPreferencesLoaded] = useState(false);

  // Submission state
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [alreadyRegistered, setAlreadyRegistered] = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);
  const [wasUpdated, setWasUpdated] = useState(false);
  const [waitlisted, setWaitlisted] = useState(false);
  const [waitlistPosition, setWaitlistPosition] = useState<number | null>(null);
  const [guestId, setGuestId] = useState<string | null>(null);

  // Pizzeria state
  const [nearbyPizzerias, setNearbyPizzerias] = useState<Pizzeria[]>([]);
  const [pizzeriaRankings, setPizzeriaRankings] = useState<string[]>([]);
  const [loadingPizzerias, setLoadingPizzerias] = useState(false);
  const [suggestedPizzerias, setSuggestedPizzerias] = useState<Pizzeria[]>([]);
  const [showSuggestModal, setShowSuggestModal] = useState(false);
  const [venueLocation, setVenueLocation] = useState<{ lat: number; lng: number } | null>(null);

  // Computed values
  const isSwcEvent = (eventData.eventTags || []).includes('swc');
  const isSwcCaEvent = (eventData.eventTags || []).includes('swccanada');
  const isSwcAuEvent = (eventData.eventTags || []).includes('swcau');
  const isEthconfEvent = (eventData.eventTags || []).includes('ethconf');
  const excludedToppings = getExcludedToppingIds(dietaryRestrictions);

  // ---- Validate wallet address ----
  const validateWalletAddress = useCallback((address: string) => {
    if (!address.trim()) {
      setWalletValidation('idle');
      return;
    }
    const ethAddressRegex = /^0x[a-fA-F0-9]{40}$/;
    const ensRegex = /^[a-zA-Z0-9-]+\.(eth|xyz|com|org|io|co|app|dev|id)$/;
    if (ethAddressRegex.test(address.trim()) || ensRegex.test(address.trim())) {
      setWalletValidation('valid');
    } else {
      setWalletValidation('invalid');
    }
  }, []);

  // ---- Reset form (used by modal on re-open) ----
  const resetForm = useCallback(() => {
    setSubmitted(false);
    setAlreadyRegistered(false);
    setPendingApproval(false);
    setWasUpdated(false);
    setWaitlisted(false);
    setWaitlistPosition(null);
    setGuestId(null);
    setStep(1);
    setError(null);
    setSwcOptIn(false);
    setShowSwcInfoModal(false);

    // Pre-fill with existing guest data if editing
    if (existingGuest) {
      setName(existingGuest.name);
      setEmail(existingGuest.email || '');
      setEthereumAddress(existingGuest.ethereumAddress || '');
      setRoles(existingGuest.roles);
      setMailingListOptIn(existingGuest.mailingListOptIn);
      setDietaryRestrictions(existingGuest.dietaryRestrictions);
      setLikedToppings(existingGuest.likedToppings);
      setDislikedToppings(existingGuest.dislikedToppings);
      setLikedBeverages(existingGuest.likedBeverages);
      setDislikedBeverages(existingGuest.dislikedBeverages);
      setPizzeriaRankings(existingGuest.pizzeriaRankings);
      setSuggestedPizzerias(existingGuest.suggestedPizzerias || []);
      setPreferencesLoaded(true);
    }
  }, [existingGuest]);

  // ---- Effects ----

  // Load saved preferences when user is logged in or when email matches
  useEffect(() => {
    async function loadSavedPreferences() {
      const emailToCheck = user?.email || email;
      if (!emailToCheck || preferencesLoaded) return;

      const prefs = await getUserPreferences(emailToCheck);
      if (prefs) {
        if (prefs.dietary_restrictions.length > 0) setDietaryRestrictions(prefs.dietary_restrictions);
        if (prefs.liked_toppings.length > 0) setLikedToppings(prefs.liked_toppings);
        if (prefs.disliked_toppings.length > 0) setDislikedToppings(prefs.disliked_toppings);
        if (prefs.liked_beverages.length > 0) setLikedBeverages(prefs.liked_beverages);
        if (prefs.disliked_beverages.length > 0) setDislikedBeverages(prefs.disliked_beverages);
        setPreferencesLoaded(true);
        if (user?.email) {
          setSaveToProfile(true);
        }
      }
    }
    if (isOpen) {
      loadSavedPreferences();
    }
  }, [user?.email, email, preferencesLoaded, isOpen]);

  // Auto-deselect liked toppings that conflict with dietary restrictions
  useEffect(() => {
    const excluded = getExcludedToppingIds(dietaryRestrictions);
    if (excluded.size > 0) {
      setLikedToppings(prev => prev.filter(id => !excluded.has(id)));
    }
  }, [dietaryRestrictions]);

  // Pre-fill email/name if user is logged in
  useEffect(() => {
    if (isOpen) {
      if (user?.email && !email) setEmail(user.email);
      if (user?.name && !name) setName(user.name);
    }
  }, [user, isOpen]);

  // Merge existing suggested pizzerias into nearby list when editing
  useEffect(() => {
    if (isOpen && isEditing && existingGuest?.suggestedPizzerias) {
      const sug = (existingGuest.suggestedPizzerias as any[]).filter((s: any) => s && s.name);
      if (sug.length > 0) {
        setNearbyPizzerias(prev => {
          const newOnes = sug.filter((s: any) => !prev.some(p => p.id === s.id));
          return newOnes.length > 0 ? [...prev, ...newOnes] : prev;
        });
      }
    }
  }, [isOpen, isEditing, existingGuest]);

  // Fetch pizzerias based on event data
  useEffect(() => {
    async function fetchPizzerias() {
      if (!isOpen) return;

      // If host has selected specific pizzerias, use those
      if (eventData.selectedPizzerias && eventData.selectedPizzerias.length > 0) {
        setNearbyPizzerias(eventData.selectedPizzerias);
        if (eventData.address) {
          geocodeAddress(eventData.address).then(loc => { if (loc) setVenueLocation(loc); });
        }
        return;
      }

      // Otherwise, fall back to auto-fetching based on address
      if (!eventData.address) return;

      setLoadingPizzerias(true);
      try {
        const location = await geocodeAddress(eventData.address);
        if (location) setVenueLocation(location);
        if (location) {
          const results = await searchPizzerias(location.lat, location.lng);
          setNearbyPizzerias(results.slice(0, 3));
        }
      } catch (err) {
        console.error('Failed to fetch pizzerias:', err);
      } finally {
        setLoadingPizzerias(false);
      }
    }
    fetchPizzerias();
  }, [eventData.address, eventData.selectedPizzerias, isOpen]);

  // ---- Handlers ----

  const toggleRole = useCallback((role: string) => {
    setRoles(prev => prev.includes(role) ? prev.filter(r => r !== role) : [...prev, role]);
  }, []);

  const toggleDietary = useCallback((option: string) => {
    setDietaryRestrictions(prev => prev.includes(option) ? prev.filter(d => d !== option) : [...prev, option]);
  }, []);

  const handleToppingLike = useCallback((id: string) => {
    setDislikedToppings(prev => prev.filter(t => t !== id));
    setLikedToppings(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }, []);

  const handleToppingDislike = useCallback((id: string) => {
    setLikedToppings(prev => prev.filter(t => t !== id));
    setDislikedToppings(prev => prev.includes(id) ? prev.filter(t => t !== id) : [...prev, id]);
  }, []);

  const handleDrinkLike = useCallback((id: string) => {
    setDislikedBeverages(prev => prev.filter(b => b !== id));
    setLikedBeverages(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  }, []);

  const handleDrinkDislike = useCallback((id: string) => {
    setLikedBeverages(prev => prev.filter(b => b !== id));
    setDislikedBeverages(prev => prev.includes(id) ? prev.filter(b => b !== id) : [...prev, id]);
  }, []);

  const handlePizzeriaClick = useCallback((pizzeriaId: string) => {
    setPizzeriaRankings(prev => {
      const currentIndex = prev.indexOf(pizzeriaId);
      if (currentIndex === -1) return [...prev, pizzeriaId];
      return prev.filter(id => id !== pizzeriaId);
    });
  }, []);

  const handleSuggestPizzeria = useCallback((place: Partial<Pizzeria>) => {
    const pizzeria: Pizzeria = {
      id: place.id || `suggested-${uuid()}`,
      placeId: place.placeId || '',
      name: place.name || '',
      address: place.address || '',
      phone: place.phone,
      url: place.url,
      rating: place.rating,
      reviewCount: place.reviewCount,
      priceLevel: place.priceLevel,
      isOpen: place.isOpen,
      location: place.location || { lat: 0, lng: 0 },
      orderingOptions: place.orderingOptions || [],
    };

    setSuggestedPizzerias(prev => [...prev, pizzeria]);
    setNearbyPizzerias(prev => {
      if (prev.some(p => p.id === pizzeria.id)) return prev;
      return [...prev, pizzeria];
    });
    setShowSuggestModal(false);
  }, []);

  const handleStep1Continue = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError('Please enter your name');
      return;
    }
    setError(null);
    setStep(2);
  }, [name]);

  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();

    const inviteCode = eventData.customUrl || eventData.inviteCode;
    if (!inviteCode) {
      setError('Invalid invite code');
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const result = await addGuestToParty(
        eventData.id,
        name.trim(),
        dietaryRestrictions,
        likedToppings,
        dislikedToppings,
        likedBeverages,
        dislikedBeverages,
        email.trim() || undefined,
        ethereumAddress.trim() || undefined,
        roles,
        mailingListOptIn,
        inviteCode,
        pizzeriaRankings.length > 0 ? pizzeriaRankings : undefined,
        suggestedPizzerias.length > 0 ? suggestedPizzerias : undefined,
        swcOptIn || undefined,
        swcCaOptIn || undefined,
        swcAuOptIn || undefined,
        ethconfOptIn || undefined,
      );

      if (result) {
        // Save preferences to profile if checkbox is checked and email is provided
        if (saveToProfile && email.trim() && !result.alreadyRegistered) {
          await saveUserPreferences(email.trim(), {
            dietary_restrictions: dietaryRestrictions,
            liked_toppings: likedToppings,
            disliked_toppings: dislikedToppings,
            liked_beverages: likedBeverages,
            disliked_beverages: dislikedBeverages,
          });
        }
        setAlreadyRegistered(result.alreadyRegistered);
        setPendingApproval(result.requireApproval);
        setWasUpdated(isEditing || result.updated);
        setWaitlisted(result.waitlisted);
        setWaitlistPosition(result.waitlistPosition);
        setGuestId(result.guest?.id || null);
        setSubmitted(true);

        onSuccess?.({
          guest: result.guest ? { id: result.guest.id } : null,
          alreadyRegistered: result.alreadyRegistered,
          requireApproval: result.requireApproval,
          updated: isEditing || result.updated,
          waitlisted: result.waitlisted,
          waitlistPosition: result.waitlistPosition,
        });
      } else {
        setError('Failed to submit. Please try again.');
      }
    } catch (err) {
      setError('Failed to submit. The party may no longer exist.');
    }

    setSubmitting(false);
  }, [
    eventData, name, email, ethereumAddress, roles, mailingListOptIn,
    dietaryRestrictions, likedToppings, dislikedToppings, likedBeverages,
    dislikedBeverages, pizzeriaRankings, suggestedPizzerias, swcOptIn, swcCaOptIn, swcAuOptIn, ethconfOptIn,
    saveToProfile, isEditing, onSuccess,
  ]);

  return {
    // Step navigation
    step,
    setStep,

    // Step 1 fields
    name,
    setName,
    email,
    setEmail,
    ethereumAddress,
    setEthereumAddress,
    walletValidation,
    setWalletValidation,
    validateWalletAddress,
    roles,
    setRoles,
    toggleRole,
    mailingListOptIn,
    setMailingListOptIn,
    swcOptIn,
    setSwcOptIn,
    showSwcInfoModal,
    setShowSwcInfoModal,
    swcCaOptIn,
    setSwcCaOptIn,
    showSwcCaInfoModal,
    setShowSwcCaInfoModal,
    swcAuOptIn,
    setSwcAuOptIn,
    showSwcAuInfoModal,
    setShowSwcAuInfoModal,
    ethconfOptIn,
    setEthconfOptIn,

    // Step 2 fields
    dietaryRestrictions,
    setDietaryRestrictions,
    toggleDietary,
    likedToppings,
    setLikedToppings,
    dislikedToppings,
    setDislikedToppings,
    likedBeverages,
    setLikedBeverages,
    dislikedBeverages,
    setDislikedBeverages,
    handleToppingLike,
    handleToppingDislike,
    handleDrinkLike,
    handleDrinkDislike,
    saveToProfile,
    setSaveToProfile,
    preferencesLoaded,

    // Submission state
    submitting,
    error,
    setError,
    submitted,
    setSubmitted,
    alreadyRegistered,
    setAlreadyRegistered,
    pendingApproval,
    setPendingApproval,
    wasUpdated,
    setWasUpdated,
    waitlisted,
    setWaitlisted,
    waitlistPosition,
    setWaitlistPosition,
    guestId,
    setGuestId,

    // Pizzeria state
    nearbyPizzerias,
    setNearbyPizzerias,
    pizzeriaRankings,
    setPizzeriaRankings,
    loadingPizzerias,
    suggestedPizzerias,
    setSuggestedPizzerias,
    showSuggestModal,
    setShowSuggestModal,
    venueLocation,
    handlePizzeriaClick,
    handleSuggestPizzeria,

    // Handlers
    handleStep1Continue,
    handleSubmit,

    // Computed
    isSwcEvent,
    isSwcCaEvent,
    isSwcAuEvent,
    isEthconfEvent,
    isEditing,
    excludedToppings,
    availableBeverages: eventData.availableBeverages,
    availableToppings: eventData.availableToppings,

    // Reset
    resetForm,
  };
}
