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

export type GuestStatus = 'PENDING' | 'CONFIRMED' | 'DECLINED' | 'WAITLISTED';

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
  maxGuests: number | null;
  hideGuests: boolean;
  requireApproval: boolean;
  password?: string | null;
  hasPassword?: boolean;
  eventImageUrl: string | null;
  description: string | null;
  address: string | null;
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
  floorplanUrl?: string | null;
  floorplanData?: any;
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

// Sponsor CRM types
export type SponsorStatus = 'todo' | 'asked' | 'yes' | 'billed' | 'paid' | 'stuck' | 'alum' | 'skip';
export type SponsorshipType = 'cash' | 'in-kind' | 'venue' | 'pizza' | 'drinks' | 'other';

export interface Sponsor {
  id: string;
  partyId: string;
  name: string;
  website: string | null;
  brandTwitter: string | null;
  pointPerson: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  contactTwitter: string | null;
  telegram: string | null;
  status: SponsorStatus;
  amount: number | null;
  sponsorshipType: SponsorshipType | null;
  productService: string | null;
  logoUrl: string | null;
  notes: string | null;
  lastContactedAt: string | null;
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
  platform: 'twitter' | 'farcaster' | 'instagram';
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

// Rental Widget types
export type RentalShapeType = 'rectangle' | 'circle' | 'square';
export type RentalStatus = 'available' | 'reserved' | 'sold';

export interface Rental {
  id: string;
  partyId: string;
  name: string;
  description?: string | null;
  shapeType: RentalShapeType;
  color: string;
  borderColor?: string | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  price?: number | null;
  priceUnit?: string | null;
  capacity?: number | null;
  status: RentalStatus;
  bookedBy?: string | null;
  bookedEmail?: string | null;
  bookedNotes?: string | null;
  showLabel: boolean;
  showOnDisplay: boolean;
  opacity: number;
  sortOrder: number;
  createdAt?: string;
  updatedAt?: string;
}

// Floorplan display config
export interface FloorplanConfig {
  showRentals?: boolean;
  showDisplayPins?: boolean;
  showLabels?: boolean;
  showPrices?: boolean;
  showStatus?: boolean;
  refreshInterval?: number;
}

// Display Widget types
export type DisplayContentType = 'slideshow' | 'qr_code' | 'event_info' | 'photos' | 'upload' | 'floorplan' | 'custom';

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
    floorplanUrl?: string | null;
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
    contents: ['Stickers', 'Tablecloth', 'Flyers', 'Name Tags', 'Table Tents', 'Keychain', 'Pins', 'Extras'],
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
  party_kit_submitted: boolean;
  venue_added: boolean;
  budget_submitted: boolean;
}

export interface ChecklistData {
  items: ChecklistItem[];
  autoCompleteStates: AutoCompleteStates;
  seeded: boolean;
}

// ============================================
// Underboss Dashboard types
// ============================================

export type GPPRegion = 'usa' | 'canada' | 'central-america' | 'south-america' | 'western-europe' | 'eastern-europe' | 'africa' | 'india' | 'china' | 'middle-east' | 'asia' | 'oceania';

export const GPP_REGIONS: { id: GPPRegion; label: string }[] = [
  { id: 'usa', label: 'USA' },
  { id: 'canada', label: 'Canada' },
  { id: 'central-america', label: 'Central America' },
  { id: 'south-america', label: 'South America' },
  { id: 'western-europe', label: 'Western Europe' },
  { id: 'eastern-europe', label: 'Eastern Europe' },
  { id: 'africa', label: 'Africa' },
  { id: 'india', label: 'India' },
  { id: 'china', label: 'China' },
  { id: 'middle-east', label: 'Middle East' },
  { id: 'asia', label: 'Asia' },
  { id: 'oceania', label: 'Oceania' },
];

export interface UnderbossEventProgress {
  hasVenue: boolean;
  hasBudget: boolean;
  hasPartyKit: boolean;
  hasEventImage: boolean;
  hasDate: boolean;
  hasAddress: boolean;
}

export interface UnderbossEvent {
  id: string;
  name: string;
  customUrl: string | null;
  date: string | null;
  address: string | null;
  venueName: string | null;
  host: { name: string | null; email: string | null };
  coHosts: any[];
  progress: UnderbossEventProgress;
  guestCount: number;
  approvedCount: number;
  checkedInCount: number;
  photoCount: number;
  kitStatus: string | null;
  fundraisingGoal: number | null;
  totalSponsored: number;
  createdAt: string;
}

export interface UnderbossStats {
  totalEvents: number;
  totalRsvps: number;
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
// Admin Management types
// ============================================

export interface AdminUser {
  id: string;
  email: string;
  role: 'super_admin' | 'admin';
  name: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface UnderbossAdmin {
  id: string;
  name: string;
  email: string;
  region: string;
  isActive: boolean;
  notes: string | null;
  createdAt: string;
}