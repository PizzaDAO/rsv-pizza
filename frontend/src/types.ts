export interface Topping {
  id: string;
  name: string;
  category: 'meat' | 'vegetable' | 'cheese' | 'fruit';
}

export interface Beverage {
  id: string;
  name: string;
  category: 'soda' | 'juice' | 'water' | 'other';
}

export interface Guest {
  id?: string;
  name: string;
  dietaryRestrictions: string[];
  toppings: string[];
  dislikedToppings: string[];
  likedBeverages?: string[];
  dislikedBeverages?: string[];
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

// Half of a split pizza (for half-and-half pizzas)
export interface PizzaHalf {
  toppings: Topping[];
  guests: Guest[];
  dietaryRestrictions: string[];
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
  // Half-and-half support
  isHalfAndHalf?: boolean;
  leftHalf?: PizzaHalf;
  rightHalf?: PizzaHalf;
}

export interface BeverageRecommendation {
  id: string;
  beverage: Beverage;
  quantity: number;
  guestCount: number;
  isForNonRespondents?: boolean;
  label?: string;
}

export interface Wave {
  id: string;
  arrivalTime: Date;
  guestAllocation: number;
  weight: number;
  label: string;
}

export interface WaveRecommendation {
  wave: Wave;
  pizzas: PizzaRecommendation[];
  beverages: BeverageRecommendation[];
  totalPizzas: number;
  totalBeverages: number;
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
  duration: number | null;
  hostName: string | null;
  pizzaStyle: string;
  availableBeverages?: string[];
  maxGuests: number | null;
  password: string | null;
  address: string | null;
  rsvpClosedAt: string | null;
  createdAt: string;
  guests: Guest[];
}

// Ordering types
export type OrderingProvider = 'square' | 'toast' | 'chownow' | 'doordash' | 'ubereats' | 'slice' | 'phone' | 'ai_phone';

export interface Pizzeria {
  id: string;
  placeId: string; // Google Places ID
  name: string;
  address: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number; // 1-4
  isOpen?: boolean;
  distance?: number; // meters
  location: {
    lat: number;
    lng: number;
  };
  photos?: string[];
  orderingOptions: OrderingOption[];
}

export interface OrderingOption {
  provider: OrderingProvider;
  available: boolean;
  merchantId?: string; // Provider-specific ID (e.g., Square location ID)
  deepLink?: string; // URL to open platform with this pizzeria
  estimatedTime?: number; // minutes
  deliveryFee?: number;
  minOrder?: number;
}

export interface OrderItem {
  name: string;
  description: string;
  quantity: number;
  size: string;
  toppings: string[];
  dietaryNotes: string[];
  priceEstimate?: number;
}

export interface Order {
  id: string;
  partyId: string;
  pizzeria: Pizzeria;
  provider: OrderingProvider;
  items: OrderItem[];
  subtotal?: number;
  tax?: number;
  deliveryFee?: number;
  total?: number;
  status: OrderStatus;
  externalOrderId?: string;
  createdAt: string;
  updatedAt: string;
}

export type OrderStatus =
  | 'draft'
  | 'pending'
  | 'confirmed'
  | 'preparing'
  | 'ready'
  | 'out_for_delivery'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'failed';