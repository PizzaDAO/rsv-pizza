export interface Topping {
  id: string;
  name: string;
  category: 'meat' | 'vegetable' | 'cheese' | 'fruit';
}

export interface Guest {
  id?: string;
  name: string;
  dietaryRestrictions: string[];
  toppings: string[];
  dislikedToppings: string[];
}

export interface PizzaStyle {
  id: string;
  name: string;
  description: string;
}

export interface PizzaSize {
  diameter: number;
  name: string;
  servings: number;
}

export interface PizzaRecommendation {
  id: string;
  toppings: Topping[];
  guestCount: number;
  guests: Guest[];
  dietaryRestrictions: string[];
  size: PizzaSize;
  style: PizzaStyle;
  isForNonRespondents?: boolean;
  quantity?: number;
  label?: string; // e.g., "Cheese", "Pepperoni", "Veggie", "Vegan", "Gluten-Free"
}

export interface PizzaSettings {
  size: PizzaSize;
  style: PizzaStyle;
}

export interface Party {
  id: string;
  name: string;
  inviteCode: string;
  date: string | null;
  hostName: string | null;
  pizzaStyle: string;
  maxGuests: number | null;
  rsvpClosedAt: string | null;
  createdAt: string;
  guests: Guest[];
}