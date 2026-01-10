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
}

export interface PizzaSettings {
  size: PizzaSize;
  style: PizzaStyle;
}