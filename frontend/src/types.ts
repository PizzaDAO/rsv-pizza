export interface Topping {
  id: string;
  name: string;
  type: 'meat' | 'vegetable' | 'cheese' | 'fruit';
}

export interface Beverage {
  id: string;
  name: string;
  type: 'soda' | 'juice' | 'water' | 'other' | 'alcohol';
}

export interface Guest {
  id?: string;
  name: string;
  email?: string;
  ethereumAddress?: string;
  roles?: string[];
  mailingListOptIn?: boolean;
  dietaryRestrictions: string[];
  toppings: string[];
  dislikedToppings: string[];
  likedBeverages?: string[];
  dislikedBeverages?: string[];
  pizzeriaRankings?: string[];
  suggestedPizzerias?: Pizzeria[];
  submittedAt?: string;
  approved?: boolean | null; // null = pending, true = approved, false = declined
  checkedInAt?: string | null;
  checkedInBy?: string | null;
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

export interface CoHost {
  id: string;
  name: string;
  email?: string;
  website?: string;
  twitter?: string;
  instagram?: string;
  avatar_url?: string;
  showOnEvent?: boolean;
  canEdit?: boolean;
}

// Host profile from the user account
export interface HostProfile {
  name: string | null;
  avatar_url: string | null;
  website: string | null;
  twitter: string | null;
  instagram: string | null;
  youtube: string | null;
  tiktok: string | null;
  linkedin: string | null;
}

export interface PizzaSettings {
  size: PizzaSize;
  style: PizzaStyle;
}

export interface Party {
  id: string;
  name: string;
  inviteCode: string;
  customUrl: string | null;
  date: string | null;
  duration: number | null;
  timezone: string | null;
  hostName: string | null;
  hostProfile?: HostProfile | null; // Full host profile from user account
  userId: string | null; // Owner's user ID for access control
  pizzaStyle: string;
  availableBeverages?: string[];
  availableToppings?: string[];
  maxGuests: number | null;
  hideGuests: boolean;
  requireApproval: boolean;
  password?: string | null;
  hasPassword?: boolean;
  eventImageUrl: string | null;
  description: string | null;
  address: string | null;
  venueName: string | null;
  rsvpClosedAt: string | null;
  coHosts: CoHost[];
  selectedPizzerias?: Pizzeria[];
  eventType?: string | null; // 'standard', 'gpp', 'private', etc.
  eventTags?: string[]; // Tags for filtering/grouping
  shareToUnlock?: boolean;
  shareTweetText?: string | null;
  photoModeration?: boolean;
  nftEnabled?: boolean;
  nftChain?: string | null;
  createdAt: string;
  guests: Guest[];
  // Donation settings
  donationEnabled?: boolean;
  donationGoal?: number | null;
  donationMessage?: string | null;
  suggestedAmounts?: number[];
  donationRecipient?: string | null;
  donationRecipientUrl?: string | null;
  donationEthAddress?: string | null;
}

export interface Donation {
  id: string;
  amount: number;
  currency: string;
  status: 'pending' | 'succeeded' | 'failed' | 'refunded';
  paymentIntentId?: string;
  chargeId?: string;
  donorName?: string;
  donorEmail?: string;
  isAnonymous: boolean;
  message?: string;
  partyId: string;
  guestId?: string;
  // Crypto donation fields
  paymentMethod?: 'stripe' | 'crypto';
  chainId?: number;
  tokenSymbol?: string;
  tokenAddress?: string;
  txHash?: string;
  walletAddress?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DonationPublicStats {
  enabled: boolean;
  totalAmount?: number;
  donorCount?: number;
  goal?: number | null;
  message?: string | null;
  recipient?: string | null;
  recipientUrl?: string | null;
  suggestedAmounts?: number[];
  donationEthAddress?: string | null;
  recentDonors?: {
    name: string | null;
    message: string | null;
    createdAt: string;
  }[];
}

// Ordering types
export type OrderingProvider = 'square' | 'toast' | 'chownow' | 'doordash' | 'ubereats' | 'slice' | 'phone' | 'ai_phone';

export interface Pizzeria {
  id: string;
  placeId: string; // Google Places ID
  name: string;
  address: string;
  phone?: string;
  url?: string; // Website or ordering link
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

// Photo Gallery types
export interface Photo {
  id: string;
  partyId: string;
  url: string;
  thumbnailUrl: string | null;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  uploadedBy: string | null;
  uploaderName: string | null;
  uploaderEmail: string | null;
  caption: string | null;
  tags: string[];
  starred: boolean;
  starredAt: string | null;
  status: 'approved' | 'pending' | 'rejected';
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
  guest?: {
    id: string;
    name: string;
  } | null;
}

export interface PhotoStats {
  totalPhotos: number;
  starredPhotos: number;
  pendingPhotos: number;
  uniqueTags: string[];
  uniqueUploadersCount: number;
  photosEnabled: boolean;
}

// Display Widget types
export type DisplayContentType = 'slideshow' | 'qr_code' | 'event_info' | 'photos' | 'custom';

export interface SlideContent {
  type: 'image' | 'text' | 'qr';
  url?: string;
  content?: string;
  caption?: string;
}

export interface SlideshowConfig {
  googleSlidesUrl?: string;
  slides?: SlideContent[]; // Legacy - kept for backward compat
  transition?: 'fade' | 'slide' | 'none';
  shuffle?: boolean;
}

export interface QRCodeConfig {
  size?: 'small' | 'medium' | 'large';
  message?: string;
  showEventInfo?: boolean;
  showGuestCount?: boolean;
}

export interface PhotosConfig {
  filter?: 'all' | 'starred';
  layout?: 'grid' | 'slideshow';
  autoRefresh?: number;
  columns?: number;
  limit?: number;
}

export interface EventInfoConfig {
  showCountdown?: boolean;
  showGuestCount?: boolean;
  showLocation?: boolean;
  showDescription?: boolean;
}

export interface CustomConfig {
  html?: string;
  refreshInterval?: number;
}

export type DisplayContentConfig = SlideshowConfig | QRCodeConfig | PhotosConfig | EventInfoConfig | CustomConfig;

export interface Display {
  id: string;
  partyId: string;
  name: string;
  slug: string;
  contentType: DisplayContentType;
  contentConfig: DisplayContentConfig;
  rotationInterval: number;
  backgroundColor: string;
  showClock: boolean;
  showEventName: boolean;
  isActive: boolean;
  password?: string | null;
  lastViewedAt?: string | null;
  viewCount: number;
  physicalWidth?: string;
  physicalHeight?: string;
  resolution?: string;
  createdAt: string;
  updatedAt: string;
}

export interface DisplayViewerData {
  display: Display;
  party: {
    id: string;
    name: string;
    date: string | null;
    address: string | null;
    venueName: string | null;
    eventImageUrl: string | null;
    inviteCode: string;
    customUrl: string | null;
  };
  photos?: Photo[];
}