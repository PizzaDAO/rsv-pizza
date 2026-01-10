import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Guest, PizzaRecommendation, Topping, PizzaStyle, PizzaSize, PizzaSettings, Party } from '../types';
import { generatePizzaRecommendations } from '../utils/pizzaAlgorithm';

interface PizzaContextType {
  // Party management
  party: Party | null;
  createParty: (name: string, hostName?: string, date?: string) => void;
  clearParty: () => void;
  getInviteLink: () => string;
  // Guest management
  guests: Guest[];
  addGuest: (guest: Guest) => void;
  removeGuest: (id: string) => void;
  updateGuest: (id: string, guest: Guest) => void;
  // Recommendations
  recommendations: PizzaRecommendation[];
  generateRecommendations: () => void;
  // Static data
  availableToppings: Topping[];
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

export const dietaryOptions: string[] = [
  'Vegetarian',
  'Vegan',
  'Gluten-Free',
  'Dairy-Free',
  'None',
];

export const pizzaStyles: PizzaStyle[] = [
  {
    id: 'neapolitan',
    name: 'Neapolitan',
    description: 'Thin crust, wood-fired, authentic Italian style'
  },
  {
    id: 'new-york',
    name: 'New York',
    description: 'Large, thin crust, foldable slices'
  },
  {
    id: 'detroit',
    name: 'Detroit',
    description: 'Square, thick crust, crispy edges'
  }
];

export const pizzaSizes: PizzaSize[] = [
  { diameter: 10, name: 'Personal', servings: 1 },
  { diameter: 12, name: 'Small', servings: 2 },
  { diameter: 14, name: 'Medium', servings: 3 },
  { diameter: 16, name: 'Large', servings: 4 },
  { diameter: 18, name: 'Extra Large', servings: 5 },
  { diameter: 20, name: 'Family', servings: 6 }
];

// Generate a short invite code
function generateInviteCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// Get all parties from localStorage
function getStoredParties(): Record<string, Party> {
  const stored = localStorage.getItem('rsvpizza_parties');
  return stored ? JSON.parse(stored) : {};
}

// Save parties to localStorage
function saveParties(parties: Record<string, Party>) {
  localStorage.setItem('rsvpizza_parties', JSON.stringify(parties));
}

// Get party by invite code
export function getPartyByInviteCode(inviteCode: string): Party | null {
  const parties = getStoredParties();
  return Object.values(parties).find(p => p.inviteCode === inviteCode) || null;
}

// Add guest to party by invite code
export function addGuestToParty(inviteCode: string, guest: Omit<Guest, 'id'>): Guest | null {
  const parties = getStoredParties();
  const party = Object.values(parties).find(p => p.inviteCode === inviteCode);

  if (!party) return null;

  const newGuest: Guest = {
    ...guest,
    id: crypto.randomUUID(),
  };

  party.guests.push(newGuest);
  parties[party.id] = party;
  saveParties(parties);

  return newGuest;
}

export const PizzaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [party, setParty] = useState<Party | null>(() => {
    const savedPartyId = localStorage.getItem('rsvpizza_currentParty');
    if (savedPartyId) {
      const parties = getStoredParties();
      return parties[savedPartyId] || null;
    }
    return null;
  });

  const [guests, setGuests] = useState<Guest[]>(() => {
    if (party) return party.guests;
    const savedGuests = localStorage.getItem('pizzaPartyGuests');
    return savedGuests ? JSON.parse(savedGuests) : [];
  });

  const [recommendations, setRecommendations] = useState<PizzaRecommendation[]>([]);

  const [pizzaSettings, setPizzaSettings] = useState<PizzaSettings>(() => {
    const savedSettings = localStorage.getItem('pizzaPartySettings');
    return savedSettings ? JSON.parse(savedSettings) : {
      size: pizzaSizes[3],
      style: pizzaStyles[1]
    };
  });

  // Sync guests with party
  useEffect(() => {
    if (party) {
      const parties = getStoredParties();
      if (parties[party.id]) {
        parties[party.id].guests = guests;
        saveParties(parties);
        setParty({ ...party, guests });
      }
    } else {
      localStorage.setItem('pizzaPartyGuests', JSON.stringify(guests));
    }
  }, [guests]);

  useEffect(() => {
    localStorage.setItem('pizzaPartySettings', JSON.stringify(pizzaSettings));
  }, [pizzaSettings]);

  const createParty = (name: string, hostName?: string, date?: string) => {
    const newParty: Party = {
      id: crypto.randomUUID(),
      name,
      inviteCode: generateInviteCode(),
      date: date || null,
      hostName: hostName || null,
      pizzaStyle: pizzaSettings.style.id,
      maxGuests: null,
      rsvpClosedAt: null,
      createdAt: new Date().toISOString(),
      guests: guests, // Keep existing guests
    };

    const parties = getStoredParties();
    parties[newParty.id] = newParty;
    saveParties(parties);

    localStorage.setItem('rsvpizza_currentParty', newParty.id);
    setParty(newParty);
  };

  const clearParty = () => {
    localStorage.removeItem('rsvpizza_currentParty');
    setParty(null);
  };

  const getInviteLink = (): string => {
    if (!party) return '';
    const baseUrl = window.location.origin + window.location.pathname;
    return `${baseUrl}#/rsvp/${party.inviteCode}`;
  };

  const addGuest = (guest: Guest) => {
    const newGuest = { ...guest, id: crypto.randomUUID() };
    setGuests(prev => [...prev, newGuest]);
  };

  const removeGuest = (id: string) => {
    setGuests(prev => prev.filter(guest => guest.id !== id));
  };

  const updateGuest = (id: string, updatedGuest: Guest) => {
    setGuests(prev => prev.map(guest => guest.id === id ? { ...updatedGuest, id } : guest));
  };

  const updatePizzaSettings = (settings: PizzaSettings) => {
    setPizzaSettings(settings);
  };

  const generateRecommendations = () => {
    const newRecommendations = generatePizzaRecommendations(guests, pizzaSettings.style);
    setRecommendations(newRecommendations);
  };

  return (
    <PizzaContext.Provider value={{
      party,
      createParty,
      clearParty,
      getInviteLink,
      guests,
      addGuest,
      removeGuest,
      updateGuest,
      recommendations,
      generateRecommendations,
      availableToppings,
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
