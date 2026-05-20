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

export type UnderbossStatus = 'pending' | 'approved' | 'rejected' | 'listed' | 'hidden';

export type GuestStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'WAITLISTED' | 'INVITED';

export interface Guest {
  id?: string;
  name: string;
  email?: string;
  ethereumAddress?: string;
  walletSource?: 'manual' | 'connectkit' | 'privy-embedded' | null;
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
  status?: GuestStatus;
  waitlistPosition?: number | null;
  promotedAt?: string | null;
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
  telegram?: string;
  avatar_url?: string;
  showOnEvent?: boolean;
  canEdit?: boolean;
  isUnderboss?: boolean;
  isPartner?: boolean;
  partnerTag?: string;
  allowedTabs?: string[];
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

// Venue status tracking
export type VenueStatus = 'researching' | 'contacted' | 'negotiating' | 'confirmed' | 'deposit_paid' | 'paid_in_full' | 'declined';

// Venue photo model
export type VenuePhotoCategory = 'interior' | 'exterior' | 'capacity' | 'amenities' | 'other';

export interface VenuePhoto {
  id: string;
  venueId: string;
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width: number | null;
  height: number | null;
  caption: string | null;
  category: VenuePhotoCategory | null;
  sortOrder: number;
  createdAt: string;
}

// Venue model (for venue picker)
export interface Venue {
  id: string;
  partyId: string;
  name: string;
  address: string | null;
  website: string | null;
  capacity: number | null;
  cost: number | null;
  organization: string | null;
  latitude: number | null;
  longitude: number | null;
  pointPerson: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  status: VenueStatus;
  isSelected: boolean;
  pros: string | null;
  cons: string | null;
  notes: string | null;
  photos?: VenuePhoto[];
  createdAt: string;
  updatedAt: string;
}

// Venue Report types
export interface VenueReport {
  partyId: string;
  partyName: string;
  date?: string | null;
  timezone?: string | null;
  address?: string | null;
  venueName?: string | null;
  eventImageUrl?: string | null;
  title: string | null;
  notes: string | null;
  published?: boolean;
  slug?: string | null;
  hasPassword?: boolean;
  password?: string | null;
  venues: Venue[];
}

// Legacy VenueInfo interface (for backwards compatibility with Party fields)
export interface VenueInfo {
  status: VenueStatus | null;
  capacity: number | null;
  cost: number | null;
  pointPerson: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  organization: string | null;
  website: string | null;
  notes: string | null;
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
  availableDietaryOptions?: string[];
  maxGuests: number | null;
  expectedGuests?: number | null;
  hideGuests: boolean;
  requireApproval: boolean;
  password?: string | null;
  hasPassword?: boolean;
  eventImageUrl: string | null;
  description: string | null;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  country?: string | null;
  city?: string | null;
  placeId?: string | null;
  venueName: string | null;
  // Venue tracking fields
  venueStatus: VenueStatus | null;
  venueCapacity: number | null;
  venueCost: number | null;
  venuePointPerson: string | null;
  venueContactName: string | null;
  venueContactEmail: string | null;
  venueContactPhone: string | null;
  venueOrganization: string | null;
  venueWebsite: string | null;
  venueNotes: string | null;
  // Day-of logistics (pepperoni-58341)
  wifiInfo?: string | null;
  parkingNotes?: string | null;
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
  fundraisingGoal?: number | null;
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
  pinnedApps?: string[];
  region?: string | null;
  flyerGeneratedAt?: string | null;
  flyerConfig?: Record<string, any> | null;
  posterImageUrl?: string | null;
  posterGeneratedAt?: string | null;
  rollupImageUrl?: string | null;
  rollupGeneratedAt?: string | null;
  canEdit?: boolean;
  allowedTabs?: string[];
  hiddenGppPhotos?: string[];
  extraGppPhotos?: string[];
  // External event links
  lumaUrl?: string | null;
  meetupUrl?: string | null;
  eventbriteUrl?: string | null;
  externalLinks?: Array<{label: string; url: string}>;
  telegramGroup?: string | null;
  hostTelegramChatId?: string | null;
  hostTelegramLinkToken?: string | null;
  underbossStatus?: UnderbossStatus | null;
  turtleRolesEnabled?: boolean;
  // Reimbursement cap (arugula-38633 v2) — populated by underboss validation.
  // Banner on payout form only renders when reimbursementCapUsd != null.
  reimbursementCapUsd?: number | null;
  // arugula-38633 v2 follow-up: precedence resolution of
  // reimbursementCapUsd → max(numeric event_tags) → null. Host-facing UI
  // (Payments tab) reads THIS field; /underboss still uses the raw
  // reimbursementCapUsd. See lib/reimbursementCap.ts.
  effectiveReimbursementCapUsd?: number | null;
  reimbursementCapAppealNote?: string | null;
  reimbursementCapAppealedAt?: string | null;
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
  description?: string;
  photos?: string[];
  orderingOptions: OrderingOption[];
  offersDiscount?: boolean;
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
  photoYear: number | null;
  starred: boolean;
  starredAt: string | null;
  status: 'approved' | 'pending' | 'rejected';
  reviewedAt: string | null;
  reviewedBy: string | null;
  duration: number | null; // Video duration in seconds (null for images)
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

// Sponsor CRM types
export type SponsorStatus = 'todo' | 'asked' | 'yes' | 'billed' | 'paid' | 'stuck' | 'alum' | 'skip';
export type SponsorshipType = 'cash' | 'in-kind' | 'venue' | 'pizza' | 'drinks' | 'community' | 'other';
export type SponsorCategory = 'hardware_wallet' | 'software_wallet' | 'cex' | 'blockchain' | 'dex' | 'community' | 'custom';

export const SPONSOR_CATEGORIES: { id: SponsorCategory; label: string }[] = [
  { id: 'hardware_wallet', label: 'Hardware Wallet' },
  { id: 'software_wallet', label: 'Software Wallet' },
  { id: 'cex', label: 'CEX' },
  { id: 'blockchain', label: 'Blockchain' },
  { id: 'dex', label: 'DEX' },
  { id: 'community', label: 'Community' },
  { id: 'custom', label: 'Custom' },
];

export interface Sponsor {
  id: string;
  partyId: string;
  name: string;
  website: string | null;
  brandTwitter: string | null;
  brandInstagram: string | null;
  brandDescription: string | null;
  pointPerson: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactTwitter: string | null;
  telegram: string | null;
  brandInstagram: string | null;
  brandDescription: string | null;
  status: SponsorStatus;
  amount: number | null;
  sponsorshipType: SponsorshipType | null;
  productService: string | null;
  logoUrl: string | null;
  category: string | null;
  notes: string | null;
  sortOrder: number;
  lastContactedAt: string | null;
  intakeToken: string | null;
  intakeSubmittedAt: string | null;
  sponsorMessage: string | null;
  addedByUnderboss?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SponsorStats {
  fundraisingGoal: number | null;
  totalConfirmed: number;
  totalSponsors: number;
  statusCounts: Record<SponsorStatus, number>;
}

// Music/DJ Lineup types
export type PerformerType = 'dj' | 'live_band' | 'solo' | 'playlist';
export type PerformerStatus = 'pending' | 'confirmed' | 'cancelled';

export interface Performer {
  id: string;
  partyId: string;
  name: string;
  type: PerformerType;
  genre: string | null;
  setTime: string | null;
  setDuration: number | null;
  sortOrder: number;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  instagram: string | null;
  soundcloud: string | null;
  status: PerformerStatus;
  equipmentProvided: boolean;
  equipmentNotes: string | null;
  fee: number | null;
  feePaid: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PerformersResponse {
  performers: Performer[];
  musicEnabled: boolean;
  musicNotes: string | null;
}

// Song type for music widget
export type MusicPlatform = 'spotify' | 'apple_music' | 'youtube' | 'soundcloud' | 'other';

export interface Song {
  id: string;
  partyId: string;
  title: string;
  artist: string;
  platform: MusicPlatform;
  url: string | null;
  fileUrl: string | null;
  addedBy: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface Playlist {
  id: string;
  partyId: string;
  name: string;
  platform: MusicPlatform;
  url: string;
  description: string | null;
  sortOrder: number;
  createdAt: string;
}

// Report Widget types
export interface SocialPost {
  id: string;
  partyId: string;
  platform: 'twitter' | 'farcaster' | 'instagram' | 'facebook' | 'linkedin';
  url: string;
  authorHandle: string | null;
  title: string | null;
  views: number | null;
  sortOrder: number;
  createdAt: string;
}

export interface NotableAttendee {
  id: string;
  partyId: string;
  name: string;
  link: string | null;
  guestId: string | null;
  email: string | null;
  sortOrder: number;
  createdAt: string;
}

export interface ReportStats {
  totalRsvps: number;
  approvedGuests: number;
  mailingListSignups: number;
  walletAddresses: number;
  roleBreakdown: Record<string, number>;
}

export interface PageViewStats {
  totalViews: number;
  uniqueViews: number;
  dailyViews: { date: string; total: number; unique: number }[];
  topReferrers: { referrer: string; count: number }[];
}

export interface LinkClickStats {
  totalClicks: number;
  uniqueClickers: number;
  links: {
    url: string;
    linkType: string;
    linkLabel: string | null;
    totalClicks: number;
    uniqueClicks: number;
  }[];
  dailyClicks: { date: string; total: number; unique: number }[];
}

export interface EventReport {
  // Event details
  id: string;
  name: string;
  date: string | null;
  timezone: string | null;
  venueName: string | null;
  address: string | null;
  eventImageUrl: string | null;
  description: string | null;
  coHosts: CoHost[];
  host: {
    name: string | null;
    profilePictureUrl: string | null;
  } | null;

  // Report-specific fields
  reportRecap: string | null;
  reportVideoUrl: string | null;
  reportPhotosUrl: string | null;
  flyerArtist: string | null;
  flyerArtistUrl: string | null;

  // KPIs
  xPostUrl: string | null;
  xPostViews: number | null;
  farcasterPostUrl: string | null;
  farcasterViews: number | null;
  lumaUrl: string | null;
  lumaViews: number | null;
  poapEventId: string | null;
  poapMints: number | null;
  poapMoments: number | null;

  // Report settings
  reportPublished?: boolean;
  reportPublicSlug?: string | null;
  reportPassword?: string | null;
  reportStatsConfig?: Record<string, { override?: number | null; hidden?: boolean }> | null;

  // Related data
  socialPosts: SocialPost[];
  notableAttendees: NotableAttendee[];
  featuredPhotos: Photo[];

  // Wallet addresses for CSV export
  walletAddressList?: string[];

  // Calculated stats
  stats: ReportStats;
}

// Staffing types
export type StaffStatus = 'invited' | 'confirmed' | 'declined' | 'checked_in';

export interface Staff {
  id: string;
  partyId: string;
  name: string;
  email: string | null;
  phone: string | null;
  role: string;
  status: StaffStatus;
  confirmedAt: string | null;
  checkedInAt: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StaffStats {
  totalStaff: number;
  byStatus: {
    invited: number;
    confirmed: number;
    declined: number;
    checked_in: number;
  };
  uniqueRoles: string[];
}

// Display Widget types
export type DisplayContentType = 'slideshow' | 'qr_code' | 'event_info' | 'photos' | 'upload' | 'custom';

export interface SlideContent {
  type: 'image' | 'text' | 'qr';
  url?: string;
  content?: string;
  caption?: string;
}

export interface SlideshowConfig {
  googleSlidesUrl?: string;
  slides?: SlideContent[];
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

export interface UploadConfig {
  mediaUrl?: string;
  mediaType?: 'image' | 'video';
}

export interface CustomConfig {
  html?: string;
  refreshInterval?: number;
}

export type DisplayContentConfig = SlideshowConfig | QRCodeConfig | PhotosConfig | EventInfoConfig | UploadConfig | CustomConfig;

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

// Budget Widget types
export type BudgetCategory = 'pizza' | 'drinks' | 'venue' | 'supplies' | 'entertainment' | 'tips' | 'other';
export type BudgetStatus = 'pending' | 'paid';

export const BUDGET_CATEGORIES: { id: BudgetCategory; label: string; icon: string }[] = [
  { id: 'pizza', label: 'Pizza', icon: 'Pizza' },
  { id: 'drinks', label: 'Drinks', icon: 'Wine' },
  { id: 'venue', label: 'Venue', icon: 'Home' },
  { id: 'supplies', label: 'Supplies', icon: 'Package' },
  { id: 'entertainment', label: 'Entertainment', icon: 'Music' },
  { id: 'tips', label: 'Tips', icon: 'Heart' },
  { id: 'other', label: 'Other', icon: 'MoreHorizontal' },
];

export interface BudgetItem {
  id: string;
  partyId: string;
  name: string;
  category: BudgetCategory;
  cost: number;
  status: BudgetStatus;
  pointPerson: string | null;
  notes: string | null;
  receiptUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BudgetCategoryTotal {
  total: number;
  paid: number;
  pending: number;
  count: number;
}

export interface BudgetOverview {
  budgetEnabled: boolean;
  budgetTotal: number | null;
  totalSpent: number;
  totalPaid: number;
  totalPending: number;
  remaining: number | null;
  categoryTotals: Record<BudgetCategory, BudgetCategoryTotal>;
  items: BudgetItem[];
}

// Raffle Widget types
export type RaffleStatus = 'draft' | 'open' | 'closed' | 'drawn';

export interface Raffle {
  id: string;
  partyId: string;
  name: string;
  description: string | null;
  status: RaffleStatus;
  entriesPerGuest: number;
  createdAt: string;
  updatedAt: string;
  prizes: RafflePrize[];
  entries: RaffleEntry[];
  winners: RaffleWinner[];
  _count?: {
    entries: number;
  };
}

export interface RafflePrize {
  id: string;
  raffleId: string;
  name: string;
  description: string | null;
  imageUrl: string | null;
  quantity: number;
  createdAt: string;
}

export interface RaffleEntry {
  id: string;
  raffleId: string;
  guestId: string;
  createdAt: string;
  guest?: {
    id: string;
    name: string;
  };
}

export interface RaffleWinner {
  id: string;
  raffleId: string;
  prizeId: string;
  guestId: string;
  claimedAt: string | null;
  createdAt: string;
  guest?: {
    id: string;
    name: string;
  };
  prize?: {
    id: string;
    name: string;
  };
}

// Party Kit types
export type KitTier = 'basic' | 'large' | 'deluxe';
export type KitStatus = 'pending' | 'approved' | 'shipped' | 'delivered' | 'declined';

export interface PartyKit {
  id: string;
  partyId: string;
  requestedTier: KitTier;
  allocatedTier: KitTier | null;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
  status: KitStatus;
  trackingNumber: string | null;
  trackingUrl: string | null;
  notes: string | null;
  adminNotes: string | null;
  requestedAt: string;
  approvedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface KitTierInfo {
  id: KitTier;
  name: string;
  description: string;
  contents: string[];
}

export const KIT_TIERS: KitTierInfo[] = [
  {
    id: 'basic',
    name: 'Basic Kit',
    description: 'Essential party supplies',
    contents: ['Stickers', 'Tablecloth', 'Flyers'],
  },
  {
    id: 'large',
    name: 'Large Kit',
    description: 'Everything in Basic plus more',
    contents: ['Stickers', 'Tablecloth', 'Flyers', 'Name Tags', 'Table Tents'],
  },
  {
    id: 'deluxe',
    name: 'Deluxe Kit',
    description: 'The complete party package',
    contents: ['Stickers', 'Tablecloth', 'Flyers', 'Name Tags', 'Table Tents', 'Keychain', 'Extras'],
  },
];

// Checklist Widget types
export interface ChecklistItem {
  id: string;
  partyId: string;
  name: string;
  dueDate: string | null;
  completed: boolean;
  completedAt: string | null;
  isAuto: boolean;
  autoRule: string | null;
  linkTab: string | null;
  sortOrder: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AutoCompleteStates {
  event_created: boolean;
  party_kit_submitted: boolean;
  venue_added: boolean;
  budget_submitted: boolean;
  team_built?: boolean;
  pizzerias_selected?: boolean;
  underboss_reviewed?: boolean;
}

export interface ChecklistData {
  items: ChecklistItem[];
  autoCompleteStates: AutoCompleteStates;
  seeded: boolean;
}

// Underboss Dashboard types

export type GPPRegion = 'usa' | 'canada' | 'central-america' | 'south-america' | 'western-europe' | 'eastern-europe' | 'west-africa' | 'east-africa' | 'south-africa' | 'india' | 'china' | 'middle-east' | 'asia' | 'oceania';

export const GPP_REGIONS: { id: GPPRegion; label: string }[] = [
  { id: 'usa', label: 'USA' },
  { id: 'canada', label: 'Canada' },
  { id: 'central-america', label: 'Central America' },
  { id: 'south-america', label: 'South America' },
  { id: 'western-europe', label: 'Western Europe' },
  { id: 'eastern-europe', label: 'Eastern Europe' },
  { id: 'west-africa', label: 'West Africa' },
  { id: 'east-africa', label: 'East Africa' },
  { id: 'south-africa', label: 'South Africa' },
  { id: 'india', label: 'India' },
  { id: 'china', label: 'China' },
  { id: 'middle-east', label: 'Middle East' },
  { id: 'asia', label: 'Asia' },
  { id: 'oceania', label: 'Oceania' },
];

export type HostStatus = 'new' | 'alum' | 'pro';

export interface UnderbossEventProgress {
  hasCreatedEvent: boolean;
  hasPartyKit: boolean;
  hasCoHosts: boolean;
  hasVenue: boolean;
  hasBudget: boolean;
  hasSponsors: boolean;
  hasPrepared: boolean;
  hasSocialPosts: boolean;
  hasThrown: boolean;
}

export interface UnderbossEvent {
  id: string;
  name: string;
  inviteCode: string;
  customUrl: string | null;
  date: string | null;
  address: string | null;
  venueName: string | null;
  region?: string | null;
  eventImageUrl: string | null;
  timezone: string | null;
  duration: number | null;
  country?: string | null;
  city?: string | null;
  host: { name: string | null; email: string | null };
  hostTelegram?: string | null;
  hostTelegramConnected?: boolean;
  coHosts: any[];
  progress: UnderbossEventProgress;
  guestCount: number;
  invitedCount: number;
  approvedCount: number;
  checkedInCount: number;
  photoCount: number;
  kitStatus: string | null;
  fundraisingGoal: number | null;
  totalSponsored: number;
  hostStatus: HostStatus | null;
  underbossStatus: UnderbossStatus;
  hostTags: string[];
  eventTags: string[];
  underbossNotes: string | null;
  expectedGuests: number | null;
  telegramGroup?: string | null;
  createdAt: string;
  flyerGeneratedAt: string | null;
  flyerConfig?: Record<string, any> | null;
  latestSponsorAt: string | null;
  flyerStale: boolean;
  // Reimbursement cap (arugula-38633 v2) — set by underboss after validating
  // the heuristic. NULL means "not yet validated".
  reimbursementCapUsd?: number | null;
  reimbursementCapAppealNote?: string | null;
  reimbursementCapAppealedAt?: string | null;
}

export interface UnderbossStats {
  totalEvents: number;
  totalRsvps: number;
  totalInvited: number;
  totalApproved: number;
  eventsWithVenue: number;
  eventsWithBudget: number;
  eventsWithKit: number;
  completionRate: {
    venue: number;
    budget: number;
    partyKit: number;
  };
  avgRsvpsPerEvent: number;
}

export interface UnderbossDashboardData {
  region: string;
  underboss: { name: string; email: string };
  stats: UnderbossStats;
  events: UnderbossEvent[];
}

// ============================================
// Fake-event detection (blackolive-74932)
// ============================================

export type FakeDetectionTier = 'high' | 'medium' | 'low' | 'clean';

export interface FakeFlag {
  id: string;
  name: string;
  fired: boolean;
  weight: number;
  detail: string;
  evidence?: Record<string, unknown>;
}

export interface FakeDetectionRow {
  id: string;
  name: string;
  customUrl: string | null;
  country: string | null;
  region: string | null;
  underbossStatus: string | null;
  hostName: string | null;
  hostEmail: string | null;
  rsvpCount: number;
  maxGuests: number | null;
  score: number;
  tier: FakeDetectionTier;
  flags: FakeFlag[];
}

export interface FakeDetectionResponse {
  rows: FakeDetectionRow[];
  meta: {
    totalEvents: number;
    sybilWalletCount: number;
    scope: 'admin' | 'regions';
    regions: string[] | null;
  };
}

// Admin Management types

export interface AdminUser {
  id: string;
  email: string;
  role: 'super_admin' | 'admin' | 'payment_admin';
  name: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface GraphicsAdmin {
  id: string;
  email: string;
  name: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface UnderbossAdmin {
  id: string;
  name: string;
  email: string;
  region: string;
  regions: string[];
  cities: string[];
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}

// Shipping Dashboard types

export interface ShippingKit {
  id: string;
  partyId: string;
  partyName: string;
  eventDate: string | null;
  region: string | null;
  hostName: string | null;
  hostEmail: string | null;
  eventAddress: string | null;
  eventVenue: string | null;
  underbossStatus: UnderbossStatus;
  /**
   * Placeholder rows (events with no kit request) send an empty string here;
   * widened from `KitTier` to allow that.
   */
  requestedTier: KitTier | '';
  allocatedTier: KitTier | null;
  recipientName: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  state: string | null;
  postalCode: string;
  country: string;
  phone: string | null;
  /**
   * Real kits use the `KitStatus` enum. Placeholder rows (events with no
   * `party_kits` row) send the sentinel `'no_request'`.
   */
  status: KitStatus | 'no_request';
  trackingNumber: string | null;
  trackingUrl: string | null;
  notes: string | null;
  adminNotes: string | null;
  requestedAt: string;
  approvedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  /** Non-declined, non-invited guest count for this kit's event. */
  rsvpCount: number;
  /** True when this row is a placeholder for an event with no kit request. */
  isPlaceholder?: boolean;
}

export interface ShippingKitStats {
  total: number;
  pending: number;
  approved: number;
  shipped: number;
  delivered: number;
  declined: number;
  /** GPP-approved events in scope that have not submitted a kit request. */
  noRequest: number;
  byCountry: Record<string, number>;
  byTier: Record<string, number>;
}

export interface ShippingCoordinator {
  id: string;
  name: string;
  email: string;
  regions: string[];
  isActive: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ShippingMeResponse {
  role: 'admin' | 'coordinator' | null;
  regions: string[];
  name: string | null;
  email: string;
}

// Sponsor Dashboard types

export interface SponsorUser {
  id: string;
  email: string;
  name: string | null;
  tag: string;
  isActive: boolean;
  notes: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
  coHostName: string | null;
  coHostWebsite: string | null;
  coHostTwitter: string | null;
  coHostInstagram: string | null;
  coHostAvatarUrl: string | null;
  coHostLogoUrl: string | null;
  autoCoHost: boolean;
  autoSponsor: boolean;
  coHostShowOnEvent: boolean;
  coHostCanEdit: boolean;
  coHostAllowedTabs: string[] | null;
  category: string | null;
  brandDescription: string | null;
  descriptionSortOrder: number;
}

export interface SponsorChecklistItem {
  id: string;
  name: string;
  completed: boolean;
  completedAt: string | null;
  dueDate: string | null;
  sortOrder: number;
}

export interface SponsorDashboardEvent {
  id: string;
  name: string;
  slug: string;
  reportPublicSlug: string | null;
  date: string | null;
  createdAt: string;
  timezone: string | null;
  address: string | null;
  venueName: string | null;
  region: string | null;
  telegramGroup: string | null;
  eventImageUrl: string | null;
  underbossStatus?: UnderbossStatus;
  hostName: string | null;
  hostProfile: {
    name: string | null;
    avatar_url: string | null;
    website: string | null;
    twitter: string | null;
    instagram: string | null;
  } | null;
  coHosts: CoHost[];
  rsvpCount: number;
  invitedCount: number;
  approvedCount: number;
  maxGuests: number | null;
  expectedGuests?: number | null;
  budget: {
    total: number;
    spent: number;
    paid: number;
    pending: number;
    remaining: number | null;
  } | null;
  progress?: {
    hasPartyKit: boolean;
    hasCoHosts: boolean;
    hasVenue: boolean;
    hasBudget: boolean;
    hasSponsors: boolean;
    hasSocialPosts: boolean;
    hasThrown: boolean;
  };
  sponsorStatuses?: string[];
  sponsorCount?: number;
  clickStats?: {
    totalClicks: number;
    uniqueClickers: number;
    byLink?: {
      url: string;
      linkType: string;
      linkLabel: string | null;
      clicks: number;
      uniqueClickers: number;
    }[];
  };
  impressions?: {
    totalViews: number;
    uniqueVisitors: number;
  };
  partnerNotes: string | null;
  photoCount: number;
  checklist: SponsorChecklistItem[];
  // Admin-only: newsletter signup counts per event. Field is absent for non-admins.
  newsletterSignups?: {
    pizzadao: number;
    swc: number;
    swcCa: number;
    swcAu: number;
    swcEu: number;
    swcUk: number;
    swcBr: number;
  };
}

export interface SponsorMeResponse {
  isSponsor: boolean;
  isAdmin: boolean;
  sponsor: {
    id: string;
    email: string;
    name: string | null;
    tag: string;
  } | null;
  sponsors?: {
    id: string;
    email: string;
    name: string | null;
    tag: string;
  }[];
}

export interface SponsorDashboardData {
  sponsor: {
    name: string | null;
    email: string;
    tag: string;
  } | null;
  isAdmin: boolean;
  tag: string | null;
  events: SponsorDashboardEvent[];
}

// Unified partner (merges event-level Sponsor with underboss SponsorUser)
export interface UnifiedPartner {
  id: string;
  sponsorId?: string;
  sponsorUserId?: string;
  source: 'event' | 'underboss';
  name: string;
  brandDescription: string;
  logoUrl: string | null;
  avatarUrl: string | null;
  website: string | null;
  sortOrder: number;
}

// ============================================
// Host Payouts (arugula-38633)
// ============================================
export type PayoutStatus = 'pending' | 'approved' | 'rejected' | 'paid' | 'failed';
export type PayoutMethod = 'mercury_card' | 'wire' | 'usdc_base';

export interface PayoutDocument {
  id: string;
  kind: 'pizza' | 'receipt';
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  ocrAmount: number | null;
  ocrCurrency: string | null;
  ocrConfidence: number | null;
  ocrError: string | null;
  sortOrder: number;
}

export interface BankDetails {
  // arugula-38633 (follow-up): the wire form was replaced with a single
  // "email for bank correspondence" field — our bank emails the host to
  // complete the transaction. Legacy rows (created before this change) still
  // carry the full account-holder + routing/IBAN payload, so all fields are
  // kept here as optional for backwards-compatible display in admin views.
  email?: string;
  accountHolderName?: string;
  bankName?: string;
  bankAddress?: string;
  // US bank
  routingNumber?: string;
  accountNumber?: string;
  // International
  iban?: string;
  swift?: string;
  // Free-form notes (e.g. intermediary bank)
  notes?: string;
}

export interface PayoutAuditEntry {
  id: string;
  action: 'create' | 'approve' | 'reject' | 'edit_amount' | 'mark_paid' | 'mark_failed' | 'retry' | 'cancel';
  oldStatus: string | null;
  newStatus: string | null;
  oldAmount: number | null;
  newAmount: number | null;
  actorEmail: string;
  actorKind: 'admin' | 'super_admin' | 'payment_admin' | 'host' | 'system';
  note: string | null;
  createdAt: string;
}


export interface Payout {
  id: string;
  partyId: string;
  hostUserId: string;
  originalAmount: number;
  originalCurrency: string;
  exchangeRate: number;
  extractedAmountUsd: number;
  finalAmountUsd: number;
  status: PayoutStatus;
  // arugula-38633 v3 follow-up: null when the host submitted before setting
  // their payment details. Admin can patch later, or ask the host to set
  // them via PaymentDetailsCard.
  payoutMethod: PayoutMethod | null;
  payoutWalletAddress: string | null;
  payoutBankDetails: BankDetails | null;
  mercuryCardId: string | null;
  mercuryCardLast4: string | null;
  hostNotes: string | null;
  adminNotes: string | null;
  rejectionReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  transactionHash: string | null;
  wireReference: string | null;
  externalProofUrl: string | null;
  createdAt: string;
  updatedAt: string;
  documents: PayoutDocument[];
}

/**
 * Input for "Record External Payment" — payments made OUTSIDE the system
 * (Venmo, manual bank, etc.) recorded by an admin so the host's "paid so far"
 * is accurate and there's an audit trail. See backend
 * `POST /api/admin/payouts/external`.
 */
export interface ExternalPaymentInput {
  partyId: string;
  hostUserId: string;
  finalAmountUsd: number;
  /** 'other' is accepted client-side and mapped to 'wire' server-side (DB CHECK only allows the 3). */
  payoutMethod: PayoutMethod | 'other';
  paidAt?: string;            // ISO date — defaults to now if omitted
  transactionHash?: string;   // for usdc_base
  wireReference?: string;     // for wire / other
  mercuryCardLast4?: string;  // for mercury_card
  externalProofUrl?: string;
  adminNotes: string;         // REQUIRED — must explain why this is being recorded
}

// Admin-list payout: includes embedded party + host info
export interface AdminPayout extends Payout {
  party: {
    id: string;
    name: string;
    inviteCode: string;
    customUrl: string | null;
    /** Host's planning number (arugula-38633 v2 follow-up). */
    expectedGuests: number | null;
    /**
     * Count of confirmed direct RSVPs — excludes bulk-invited rows.
     * Backend filter: status='CONFIRMED' AND submittedVia IN ('link','rsvp','api').
     */
    rsvpCount: number;
    /**
     * arugula-38633 (cap-everywhere): resolved reimbursement cap shown on
     * the /payments admin dashboard rows + review modal. null = no cap.
     * Precedence: underboss-validated `reimbursementCapUsd` → max numeric
     * `event_tags` → null. See backend/src/helpers/reimbursementCap.ts.
     */
    effectiveReimbursementCapUsd: number | null;
  };
  host: {
    id: string;
    name: string | null;
    email: string | null;
  };
}

export interface AdminPayoutDetail extends AdminPayout {
  audits: PayoutAuditEntry[];
}

export interface AdminPayoutFilters {
  status?: PayoutStatus | 'all';
  payoutMethod?: PayoutMethod | 'all';
  partyId?: string;
  hostEmail?: string;
  currency?: string;
  dateFrom?: string;
  dateTo?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminPayoutTotals {
  byStatus: Record<string, number>;
  byMethod: Record<string, number>;
  totalUsdPending: number;
  totalUsdPaid: number;
  totalUsdThisMonth: number;
  avgUsd: number;
  awaitingReview: number;
}

export interface AdminPayoutsResponse {
  payouts: AdminPayout[];
  nextCursor: string | null;
  totals: AdminPayoutTotals;
}

export interface OcrPreviewResult {
  amount: number;             // USD-converted total
  currency: 'USD';
  originalAmount: number;
  originalCurrency: string;
  exchangeRate: number;
  confidence: number;
  items?: string[];
  fxSource: 'jsdelivr' | 'frankfurter' | 'fallback' | 'usd-passthrough' | 'unknown';
  conversionNote?: string;
}