import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Guest, PizzaRecommendation, Topping, PizzaStyle, PizzaSize, PizzaSettings } from '../types';
import { generatePizzaRecommendations } from '../utils/pizzaAlgorithm';

interface PizzaContextType {
  guests: Guest[];
  addGuest: (guest: Guest) => void;
  removeGuest: (id: string) => void;
  updateGuest: (id: string, guest: Guest) => void;
  recommendations: PizzaRecommendation[];
  generateRecommendations: () => void;
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

export const PizzaProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [guests, setGuests] = useState<Guest[]>(() => {
    const savedGuests = localStorage.getItem('pizzaPartyGuests');
    return savedGuests ? JSON.parse(savedGuests) : [];
  });
  
  const [recommendations, setRecommendations] = useState<PizzaRecommendation[]>([]);
  
  const [pizzaSettings, setPizzaSettings] = useState<PizzaSettings>(() => {
    const savedSettings = localStorage.getItem('pizzaPartySettings');
    return savedSettings ? JSON.parse(savedSettings) : {
      size: pizzaSizes[3], // Default to Large (16")
      style: pizzaStyles[1] // Default to New York
    };
  });

  useEffect(() => {
    localStorage.setItem('pizzaPartyGuests', JSON.stringify(guests));
  }, [guests]);

  useEffect(() => {
    localStorage.setItem('pizzaPartySettings', JSON.stringify(pizzaSettings));
  }, [pizzaSettings]);

  const addGuest = (guest: Guest) => {
    setGuests([...guests, { ...guest, id: crypto.randomUUID() }]);
  };

  const removeGuest = (id: string) => {
    setGuests(guests.filter(guest => guest.id !== id));
  };

  const updateGuest = (id: string, updatedGuest: Guest) => {
    setGuests(guests.map(guest => guest.id === id ? { ...updatedGuest, id } : guest));
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