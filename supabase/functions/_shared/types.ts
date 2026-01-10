export type OrderingProvider = 'square' | 'toast' | 'chownow' | 'doordash' | 'ubereats' | 'slice' | 'phone';

export interface Pizzeria {
  id: string;
  placeId: string;
  name: string;
  address: string;
  phone?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: number;
  isOpen?: boolean;
  distance?: number;
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
  merchantId?: string;
  deepLink?: string;
  estimatedTime?: number;
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

export interface SquareOrderRequest {
  locationId: string;
  items: OrderItem[];
  customerName: string;
  customerPhone?: string;
  customerEmail?: string;
  fulfillmentType: 'PICKUP' | 'DELIVERY';
  deliveryAddress?: string;
  scheduledTime?: string;
}

export interface SquareOrderResponse {
  success: boolean;
  orderId?: string;
  error?: string;
  checkoutUrl?: string;
}
