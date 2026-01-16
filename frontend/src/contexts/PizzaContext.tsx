import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { Guest, PizzaRecommendation, Topping, PizzaStyle, PizzaSize, PizzaSettings, Party, Beverage, BeverageRecommendation, WaveRecommendation } from '../types';
import { generatePizzaRecommendations } from '../utils/pizzaAlgorithm';
import { generateBeverageRecommendations } from '../utils/beverageAlgorithm';
import { generateWaveRecommendations } from '../utils/waveAlgorithm';
import * as db from '../lib/supabase';

interface PizzaContextType {
  // Party management
  party: Party | null;
  partyLoading: boolean;
  createParty: (name: string, hostName?: string, date?: string, expectedGuests?: number, address?: string, selectedBeverages?: string[], duration?: number, password?: string, eventImageUrl?: string, description?: string, customUrl?: string) => Promise<string | null>;
  loadParty: (inviteCode: string) => Promise<boolean>;
  clearParty: () => void;
  getInviteLink: () => string;
  getHostLink: () => string;
  updatePartyBeverages: (beverages: string[]) => Promise<void>;
  updatePartyToppings: (toppings: string[]) => Promise<void>;
  // Guest management
  guests: Guest[];
  addGuest: (guest: Omit<Guest, 'id'>) => Promise<void>;
  removeGuest: (id: string) => Promise<void>;
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

const PizzaContext = createContext<PizzaContextType | undefined>(undefined);

export const availableToppings: Topping[] = [
  { id: 'pepperoni', name: 'Pepperoni', category: 'meat' },
  { id: 'sausage', name: 'Sausage', category: 'meat' },
  { id: 'bacon', name: 'Bacon', category: 'meat' },
  { id: 'ham', name: 'Ham', category: 'meat' },
  { id: 'chicken', name: 'Chicken', category: 'meat' },
  { id: 'mushrooms', name: 'Mushrooms', category: 'vegetable' },
  { id: 'onions', name: 'Onions', category: 'vegetable' },
  { id: 'bell-peppers', name: 'Bell Peppers', category: 'vegetable' },
  { id: 'olives', name: 'Olives', category: 'vegetable' },
  { id: 'spinach', name: 'Spinach', category: 'vegetable' },
  { id: 'pineapple', name: 'Pineapple', category: 'fruit' },
  { id: 'extra-cheese', name: 'Extra Cheese', category: 'cheese' },
  { id: 'feta', name: 'Feta Cheese', category: 'cheese' },
  { id: 'jalapenos', name: 'Jalapeños', category: 'vegetable' },
  { id: 'tomatoes', name: 'Tomatoes', category: 'vegetable' },
];

export const availableBeverages: Beverage[] = [
  { id: 'water', name: 'Water', category: 'water' },
  { id: 'beer', name: 'Beer', category: 'alcohol' },
  { id: 'soda', name: 'Soda', category: 'soda' },
  { id: 'wine', name: 'Wine', category: 'alcohol' },
  { id: 'cocktail', name: 'Cocktail', category: 'alcohol' },
];

export const dietaryOptions: string[] = [
  'Vegetarian',
  'Vegan',
  'Gluten-Free',
  'Dairy-Free',
  'None',
];

export const pizzaStyles: PizzaStyle[] = [
  { id: 'neapolitan', name: 'Neapolitan', description: 'Thin crust, wood-fired, authentic Italian style' },
  { id: 'new-york', name: 'New York', description: 'Large, thin crust, foldable slices' },
  { id: 'detroit', name: 'Detroit', description: 'Square, thick crust, crispy edges' }
];

// Servings based on surface area: 18" feeds 4 people (2 slices each, 1/4 surface area per person)
// Formula: (diameter/2)² * π / (9² * π / 4) = (diameter/18)² * 4
export const pizzaSizes: PizzaSize[] = [
  { diameter: 10, name: 'Personal', servings: 1.2 },  // (10/18)² * 4 = 1.23
  { diameter: 12, name: 'Small', servings: 1.8 },     // (12/18)² * 4 = 1.78
  { diameter: 14, name: 'Medium', servings: 2.4 },    // (14/18)² * 4 = 2.42
  { diameter: 16, name: 'Large', servings: 3.2 },     // (16/18)² * 4 = 3.16
  { diameter: 18, name: 'Extra Large', servings: 4 }, // baseline
  { diameter: 20, name: 'Family', servings: 4.9 }     // (20/18)² * 4 = 4.94
];

// Convert database guest to app guest
function dbGuestToGuest(dbGuest: db.DbGuest): Guest {
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
  };
}

// Convert database party to app party
function dbPartyToParty(dbParty: db.DbParty, guests: Guest[]): Party {
  return {
    id: dbParty.id,
    name: dbParty.name,
    inviteCode: dbParty.invite_code,
    customUrl: dbParty.custom_url,
    date: dbParty.date,
    duration: dbParty.duration,
    timezone: dbParty.timezone,
    hostName: dbParty.host_name,
    pizzaStyle: dbParty.pizza_style,
    availableBeverages: dbParty.available_beverages || [],
    availableToppings: dbParty.available_toppings || [],
    maxGuests: dbParty.max_guests,
    password: dbParty.password,
    eventImageUrl: dbParty.event_image_url,
    description: dbParty.description,
    address: dbParty.address,
    rsvpClosedAt: dbParty.rsvp_closed_at,
    coHosts: dbParty.co_hosts || [],
    createdAt: dbParty.created_at,
    guests,
  };
}

export const PizzaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [party, setParty] = useState<Party | null>(null);
  const [partyLoading, setPartyLoading] = useState(false);
  const [guests, setGuests] = useState<Guest[]>([]);
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

  // Subscribe to real-time guest updates when party exists
  useEffect(() => {
    if (!party) return;

    const unsubscribe = db.subscribeToGuests(party.id, (dbGuests) => {
      const updatedGuests = dbGuests.map(dbGuestToGuest);
      setGuests(updatedGuests);
      setParty(prev => prev ? { ...prev, guests: updatedGuests } : null);
    });

    return unsubscribe;
  }, [party?.id]);

  useEffect(() => {
    localStorage.setItem('pizzaPartySettings', JSON.stringify(pizzaSettings));
  }, [pizzaSettings]);

  const createParty = async (name: string, hostName?: string, date?: string, expectedGuests?: number, address?: string, selectedBeverages?: string[], duration?: number, password?: string, eventImageUrl?: string, description?: string, customUrl?: string): Promise<string | null> => {
    setPartyLoading(true);
    try {
      const dbParty = await db.createParty(name, hostName, date, pizzaSettings.style.id, expectedGuests, address, selectedBeverages, duration, password, eventImageUrl, description, customUrl);
      if (dbParty) {
        const newParty = dbPartyToParty(dbParty, []);
        setParty(newParty);
        setGuests([]);
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
        const loadedParty = dbPartyToParty(result.party, partyGuests);
        setParty(loadedParty);
        setGuests(partyGuests);
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
    setGuests([]);
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
      setGuests(prev => [...prev, newGuest]);
      setParty(prev => prev ? { ...prev, guests: [...prev.guests, newGuest] } : null);
    }
  };

  const removeGuest = async (id: string) => {
    const success = await db.removeGuest(id);
    if (success) {
      setGuests(prev => prev.filter(g => g.id !== id));
      setParty(prev => prev ? { ...prev, guests: prev.guests.filter(g => g.id !== id) } : null);
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
      setParty(updatedParty);
    }
  };

  const generateRecommendations = () => {
    if (!party) return;

    // Generate wave-based recommendations (handles both single and multi-wave)
    // Pass orderExpectedGuests as override if set
    const waves = generateWaveRecommendations(guests, pizzaSettings.style, party, availableBeverages, orderExpectedGuests);
    setWaveRecommendations(waves);

    // Also update single recommendations for backward compatibility
    setRecommendations(waves[0]?.pizzas || []);
    setBeverageRecommendations(waves[0]?.beverages || []);
  };

  return (
    <PizzaContext.Provider value={{
      party,
      partyLoading,
      createParty,
      loadParty,
      clearParty,
      getInviteLink,
      getHostLink,
      updatePartyBeverages,
      updatePartyToppings,
      guests,
      addGuest,
      removeGuest,
      recommendations,
      generateRecommendations,
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
