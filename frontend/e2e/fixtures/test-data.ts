/**
 * Test data factories for E2E tests.
 * Produces objects matching the shapes used by the RSV.Pizza frontend.
 */

/** Matches the PublicEvent interface from frontend/src/lib/api.ts */
export interface TestPublicEvent {
  id: string;
  name: string;
  inviteCode: string;
  customUrl: string | null;
  date: string | null;
  duration: number | null;
  timezone: string | null;
  pizzaStyle: string;
  availableBeverages: string[];
  availableToppings: string[];
  address: string | null;
  venueName: string | null;
  maxGuests: number | null;
  hideGuests: boolean;
  eventImageUrl: string | null;
  description: string | null;
  rsvpClosedAt: string | null;
  coHosts: any[];
  hasPassword: boolean;
  hostName: string | null;
  hostProfile: any | null;
  guestCount: number;
  userId: string | null;
  selectedPizzerias?: any[];
  eventType?: string | null;
  eventTags?: string[];
  donationEnabled?: boolean;
  donationRecipient?: string | null;
  donationRecipientUrl?: string | null;
  donationGoal?: number | null;
  donationMessage?: string | null;
  suggestedAmounts?: number[];
  donationEthAddress?: string | null;
  shareToUnlock?: boolean;
  shareTweetText?: string | null;
  photoModeration?: boolean;
  nftEnabled?: boolean;
  nftChain?: string | null;
}

export interface TestGuest {
  id: string;
  name: string;
  email: string | null;
  ethereumAddress: string | null;
  roles: string[];
  dietaryRestrictions: string[];
  toppings: string[];
  dislikedToppings: string[];
  likedBeverages: string[];
  dislikedBeverages: string[];
  mailingListOptIn: boolean;
  status: 'CONFIRMED' | 'PENDING' | 'DECLINED' | 'WAITLISTED';
  waitlistPosition: number | null;
  submittedAt: string;
  checkedInAt: string | null;
}

export interface TestRSVPResponse {
  guest: TestGuest;
  alreadyRegistered: boolean;
  requireApproval: boolean;
  updated: boolean;
  waitlisted: boolean;
  waitlistPosition: number | null;
}

let idCounter = 0;
function nextId() {
  return `test-id-${++idCounter}`;
}

/**
 * Creates a public event object with sensible defaults.
 * Override any field via the `overrides` parameter.
 */
export function makePublicEvent(overrides: Partial<TestPublicEvent> = {}): TestPublicEvent {
  return {
    id: nextId(),
    name: 'Test Pizza Party',
    inviteCode: 'abc123',
    customUrl: null,
    date: '2026-05-01T18:00:00.000Z',
    duration: 3,
    timezone: 'America/New_York',
    pizzaStyle: 'new-york',
    availableBeverages: [],
    availableToppings: [],
    address: '123 Pizza Lane, New York, NY 10001',
    venueName: null,
    maxGuests: null,
    hideGuests: false,
    eventImageUrl: null,
    description: 'A fun pizza party for testing!',
    rsvpClosedAt: null,
    coHosts: [],
    hasPassword: false,
    hostName: 'Test Host',
    hostProfile: null,
    guestCount: 5,
    userId: 'host-user-001',
    selectedPizzerias: [],
    eventType: null,
    eventTags: [],
    donationEnabled: false,
    donationRecipient: null,
    donationRecipientUrl: null,
    donationGoal: null,
    donationMessage: null,
    suggestedAmounts: [],
    donationEthAddress: null,
    shareToUnlock: false,
    shareTweetText: null,
    photoModeration: false,
    nftEnabled: false,
    nftChain: null,
    ...overrides,
  };
}

/**
 * Creates a guest object with sensible defaults.
 */
export function makeGuest(overrides: Partial<TestGuest> = {}): TestGuest {
  return {
    id: nextId(),
    name: 'Jane Doe',
    email: 'jane@example.com',
    ethereumAddress: null,
    roles: [],
    dietaryRestrictions: [],
    toppings: ['pepperoni'],
    dislikedToppings: ['anchovies'],
    likedBeverages: [],
    dislikedBeverages: [],
    mailingListOptIn: false,
    status: 'CONFIRMED',
    waitlistPosition: null,
    submittedAt: new Date().toISOString(),
    checkedInAt: null,
    ...overrides,
  };
}

/**
 * Creates a successful RSVP response.
 */
export function makeRSVPSuccess(overrides: Partial<TestRSVPResponse> = {}): TestRSVPResponse {
  const guest = makeGuest(overrides.guest as Partial<TestGuest> | undefined);
  return {
    guest,
    alreadyRegistered: false,
    requireApproval: false,
    updated: false,
    waitlisted: false,
    waitlistPosition: null,
    ...overrides,
  };
}

/**
 * Creates an RSVP response where the guest is waitlisted.
 */
export function makeWaitlistedRSVP(position = 3): TestRSVPResponse {
  return makeRSVPSuccess({
    waitlisted: true,
    waitlistPosition: position,
    guest: makeGuest({ status: 'WAITLISTED', waitlistPosition: position }),
  });
}

/**
 * Creates an RSVP response that requires host approval.
 */
export function makePendingApprovalRSVP(): TestRSVPResponse {
  return makeRSVPSuccess({
    requireApproval: true,
    guest: makeGuest({ status: 'PENDING' }),
  });
}
