import { Pizzeria, Donation, DonationPublicStats, Photo, PhotoStats, Sponsor, SponsorStats, SponsorStatus, SponsorshipType, VenueStatus, Venue, VenuePhoto, VenuePhotoCategory, VenueReport, Performer, PerformersResponse, EventReport, SocialPost, NotableAttendee, Staff, StaffStats, StaffStatus, Display, DisplayContentType, DisplayContentConfig, DisplayViewerData, Raffle, RafflePrize, RaffleEntry, RaffleWinner, BudgetOverview, BudgetItem, BudgetCategory, BudgetStatus, PartyKit, KitTier, ChecklistItem, ChecklistData, PageViewStats, LinkClickStats, UnderbossDashboardData, GPPRegion, AdminUser, UnderbossAdmin, ShippingKit, ShippingKitStats, ShippingCoordinator, ShippingMeResponse, SponsorUser, SponsorMeResponse, SponsorDashboardData, ConsolidatedReport, SponsorChecklistItem, UnifiedPartner, GraphicsAdmin, FakeDetectionResponse, Payout, AdminPayout, AdminPayoutDetail, AdminPayoutFilters, AdminPayoutsResponse, BankDetails, PayoutMethod, OcrPreviewResult, ExternalPaymentInput, HostGoals, PrepayQueueRow, WalletPaidTotal, ReceiptLibraryEntry, PartyPayoutsResponse, ReceiptLineItem, PayoutDocument, TaxForm, TaxFormType, TaxFormStatus } from '../types';
// pancetta-92103: region portal → underlying parties.region slug map. Used by
// `buildPayoutQuery` to expand the /payments admin Regions multi-select into
// the existing `?regions=` query the backend already accepts.
import { PAYMENTS_REGION_SCOPES, type PaymentsRegionPortal } from '../utils/regions';

// Authenticated API helper functions
const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();

function getAuthToken(): string | null {
  return localStorage.getItem('authToken');
}

interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: any;
  requireAuth?: boolean;
}

// Custom event name for auth expiration
export const AUTH_EXPIRED_EVENT = 'auth-expired';

export async function apiRequest<T>(
  endpoint: string,
  options: ApiOptions = {}
): Promise<T> {
  const { method = 'GET', body, requireAuth = true } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (requireAuth) {
    const token = getAuthToken();
    if (!token) {
      throw new Error('Not authenticated');
    }
    headers['Authorization'] = `Bearer ${token}`;
  } else {
    // Still send token if available (for optionalAuth endpoints)
    const token = getAuthToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }

  const response = await fetch(`${API_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    // Handle 401 Unauthorized - token expired or invalid
    if (response.status === 401 && requireAuth) {
      // Clear the invalid token
      localStorage.removeItem('authToken');
      localStorage.removeItem('user');

      // Dispatch custom event for AuthContext to handle
      window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT));
    }

    const error = await response.json().catch(() => ({ message: 'Request failed' }));

    // caprino-92104: surface the structured error code from the backend's
    // AppError shape (`{ error: { message, code } }`) so callers that need to
    // branch on it (e.g. ReceiptEditor on FX_RATE_UNAVAILABLE) can do so
    // without parsing the message string. Plain `new Error()` callers ignore
    // the extra property.
    const err = new Error(
      error.message || error.error?.message || `API error: ${response.status}`,
    ) as Error & { code?: string };
    if (typeof error.error?.code === 'string') err.code = error.error.code;
    else if (typeof error.code === 'string') err.code = error.code;
    throw err;
  }

  return response.json();
}

// parmigiano-58729: approval-gated Day-Of broadcast URLs. Backend returns
// `eligible: false` for non-GPP or non-approved events; `eligible: true` with
// null URLs means env vars aren't set yet (card shows "Coming soon").
export interface BroadcastUrlsResponse {
  zoomUrl: string | null;
  zoomMeetingId: string | null;
  zoomPasscode: string | null;
  streamyardUrl: string | null;
  eligible: boolean;
}

export function fetchBroadcastUrls(partyId: string): Promise<BroadcastUrlsResponse> {
  return apiRequest<BroadcastUrlsResponse>(`/api/parties/${partyId}/broadcast-urls`);
}

// Homepage events (single-call, slim payload)
export interface UserPartyListItem {
  id: string;
  name: string;
  inviteCode: string;
  date: string | null;
  address: string | null;
  eventImageUrl: string | null;
  guestCount: number;
  role: 'host' | 'guest' | 'cohost';
  // porchetta-81402: HomePage renders a "Cancelled" pill on cancelled events.
  cancelledAt?: string | null;
}

export async function fetchMyEvents(): Promise<UserPartyListItem[]> {
  const res = await apiRequest<{ parties: UserPartyListItem[] }>('/api/parties/my-events');
  return res.parties;
}

// Cities currently hosting a GPP event — drives underboss city scope picker.
export interface EventCity {
  city: string;
  count: number;
}

export async function fetchEventCities(): Promise<EventCity[]> {
  try {
    const res = await fetch(`${API_URL}/api/cities`);
    if (!res.ok) return [];
    const data = await res.json();
    return data.cities || [];
  } catch {
    return [];
  }
}

// Party API functions
export interface CreatePartyData {
  name?: string;
  hostName?: string;
  date?: string;
  duration?: number;
  timezone?: string;
  pizzaSize?: string;
  pizzaStyle?: string;
  address?: string;
  placeId?: string;
  venueName?: string | null;
  city?: string;
  // calzone-71208: country + lat/lng must round-trip from autocomplete on create.
  country?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  maxGuests?: number;
  hideGuests?: boolean;
  requireApproval?: boolean;
  availableBeverages?: string[];
  availableToppings?: string[];
  availableDietaryOptions?: string[];
  password?: string;
  eventImageUrl?: string;
  description?: string;
  customUrl?: string;
  coHosts?: any[];
  shareToUnlock?: boolean;
  shareTweetText?: string | null;
}

export interface UpdatePartyData {
  name?: string;
  hostName?: string;
  date?: string | null;
  duration?: number | null;
  timezone?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  venueName?: string | null;
  // Venue tracking fields
  venueStatus?: VenueStatus | null;
  venueCapacity?: number | null;
  venueCost?: number | null;
  venuePointPerson?: string | null;
  venueContactName?: string | null;
  venueContactEmail?: string | null;
  venueContactPhone?: string | null;
  venueOrganization?: string | null;
  venueWebsite?: string | null;
  venueNotes?: string | null;
  maxGuests?: number | null;
  hideGuests?: boolean;
  requireApproval?: boolean;
  availableBeverages?: string[];
  availableToppings?: string[];
  availableDietaryOptions?: string[];
  showToppingsOnRsvp?: boolean;
  selectedPizzerias?: any[];
  password?: string | null;
  eventImageUrl?: string | null;
  description?: string | null;
  customUrl?: string | null;
  coHosts?: any[];
  donationEnabled?: boolean;
  donationGoal?: number | null;
  donationMessage?: string | null;
  suggestedAmounts?: number[];
  donationRecipient?: string | null;
  donationRecipientUrl?: string | null;
  donationEthAddress?: string | null;
  donationAmountsPublic?: boolean;
  shareToUnlock?: boolean;
  shareTweetText?: string | null;
  photoModeration?: boolean;
  nftEnabled?: boolean;
  nftChain?: string | null;
  fundraisingGoal?: number | null;
  musicEnabled?: boolean;
  musicNotes?: string | null;
  venueReportTitle?: string | null;
  venueReportNotes?: string | null;
  pinnedApps?: string[];
  region?: string | null;
  flyerGeneratedAt?: string | null;
  flyerConfig?: Record<string, any> | null;
  posterImageUrl?: string | null;
  posterGeneratedAt?: string | null;
  rollupImageUrl?: string | null;
  rollupGeneratedAt?: string | null;
  hiddenGppPhotos?: string[];
  extraGppPhotos?: string[];
  lumaUrl?: string | null;
  meetupUrl?: string | null;
  eventbriteUrl?: string | null;
  externalLinks?: Array<{label: string; url: string}>;
  country?: string | null;
  city?: string | null;
  expectedGuests?: number | null;
  estimatedAttendance?: number | null;
  targetAttendance?: number | null;
  expectedAttendance?: number | null;
  eventTags?: string[];
  telegramGroup?: string | null;
  hostTelegramLinkToken?: string | null;
  turtleRolesEnabled?: boolean;
  surveyEnabled?: boolean;
  // margherita-58471: T-4h reminder opt-out at the party level.
  remindersEnabled?: boolean;
  reimbursementCapUsd?: number | null;
  // culatello-92106: admin-only per-event gate for the salame-92110 tax-form
  // requirement. Hosts who PATCH this get silently dropped (backend gate).
  taxFormRequired?: boolean;
  // Day-of logistics (pepperoni-58341)
  wifiInfo?: string | null;
  parkingNotes?: string | null;
  // quattro-71244: Gamified dashboard host-set goals (JSONB).
  hostGoals?: HostGoals | null;
  // porchetta-81402: edit cancellation reason via PATCH (cancel/reinstate go
  // through dedicated POST endpoints).
  cancellationReason?: string | null;
}

export async function createPartyApi(data: CreatePartyData) {
  return apiRequest<{ party: any }>('/api/parties', {
    method: 'POST',
    body: {
      name: data.name,
      hostName: data.hostName,
      date: data.date,
      duration: data.duration,
      timezone: data.timezone,
      pizzaSize: data.pizzaSize || 'large',
      pizzaStyle: data.pizzaStyle || 'new-york',
      address: data.address,
      placeId: data.placeId,
      venueName: data.venueName,
      city: data.city,
      country: data.country,
      latitude: data.latitude,
      longitude: data.longitude,
      maxGuests: data.maxGuests,
      hideGuests: data.hideGuests,
      requireApproval: data.requireApproval,
      availableBeverages: data.availableBeverages,
      availableToppings: data.availableToppings,
      availableDietaryOptions: data.availableDietaryOptions,
      password: data.password,
      eventImageUrl: data.eventImageUrl,
      description: data.description,
      customUrl: data.customUrl,
      coHosts: data.coHosts,
      shareToUnlock: data.shareToUnlock,
      shareTweetText: data.shareTweetText,
    },
  });
}

export async function updatePartyApi(partyId: string, data: UpdatePartyData) {
  return apiRequest<{ party: any }>(`/api/parties/${partyId}`, {
    method: 'PATCH',
    body: {
      name: data.name,
      hostName: data.hostName,
      date: data.date,
      duration: data.duration,
      timezone: data.timezone,
      address: data.address,
      latitude: data.latitude,
      longitude: data.longitude,
      placeId: data.placeId,
      venueName: data.venueName,
      // Venue tracking fields
      venueStatus: data.venueStatus,
      venueCapacity: data.venueCapacity,
      venueCost: data.venueCost,
      venuePointPerson: data.venuePointPerson,
      venueContactName: data.venueContactName,
      venueContactEmail: data.venueContactEmail,
      venueContactPhone: data.venueContactPhone,
      venueOrganization: data.venueOrganization,
      venueWebsite: data.venueWebsite,
      venueNotes: data.venueNotes,
      maxGuests: data.maxGuests,
      hideGuests: data.hideGuests,
      requireApproval: data.requireApproval,
      availableBeverages: data.availableBeverages,
      availableToppings: data.availableToppings,
      availableDietaryOptions: data.availableDietaryOptions,
      showToppingsOnRsvp: data.showToppingsOnRsvp,
      selectedPizzerias: data.selectedPizzerias,
      password: data.password,
      eventImageUrl: data.eventImageUrl,
      description: data.description,
      customUrl: data.customUrl,
      coHosts: data.coHosts,
      donationEnabled: data.donationEnabled,
      donationGoal: data.donationGoal,
      donationMessage: data.donationMessage,
      suggestedAmounts: data.suggestedAmounts,
      donationRecipient: data.donationRecipient,
      donationRecipientUrl: data.donationRecipientUrl,
      donationEthAddress: data.donationEthAddress,
      donationAmountsPublic: data.donationAmountsPublic,
      shareToUnlock: data.shareToUnlock,
      shareTweetText: data.shareTweetText,
      photoModeration: data.photoModeration,
      nftEnabled: data.nftEnabled,
      nftChain: data.nftChain,
      fundraisingGoal: data.fundraisingGoal,
      musicEnabled: data.musicEnabled,
      musicNotes: data.musicNotes,
      venueReportTitle: data.venueReportTitle,
      venueReportNotes: data.venueReportNotes,
      pinnedApps: data.pinnedApps,
      region: data.region,
      flyerGeneratedAt: data.flyerGeneratedAt,
      flyerConfig: data.flyerConfig,
      posterImageUrl: data.posterImageUrl,
      posterGeneratedAt: data.posterGeneratedAt,
      rollupImageUrl: data.rollupImageUrl,
      rollupGeneratedAt: data.rollupGeneratedAt,
      hiddenGppPhotos: data.hiddenGppPhotos,
      extraGppPhotos: data.extraGppPhotos,
      lumaUrl: data.lumaUrl,
      meetupUrl: data.meetupUrl,
      eventbriteUrl: data.eventbriteUrl,
      externalLinks: data.externalLinks,
      country: data.country,
      city: data.city,
      expectedGuests: data.expectedGuests,
      estimatedAttendance: data.estimatedAttendance,
      targetAttendance: data.targetAttendance,
      expectedAttendance: data.expectedAttendance,
      eventTags: data.eventTags,
      telegramGroup: data.telegramGroup,
      hostTelegramLinkToken: data.hostTelegramLinkToken,
      turtleRolesEnabled: data.turtleRolesEnabled,
      surveyEnabled: data.surveyEnabled,
      remindersEnabled: data.remindersEnabled,
      reimbursementCapUsd: data.reimbursementCapUsd,
      taxFormRequired: data.taxFormRequired,
      // Day-of logistics (pepperoni-58341)
      wifiInfo: data.wifiInfo,
      parkingNotes: data.parkingNotes,
      // quattro-71244: gamified-dashboard goal targets.
      hostGoals: data.hostGoals,
      // porchetta-81402: edit cancellation reason via PATCH.
      cancellationReason: data.cancellationReason,
    },
  });
}

/**
 * quattro-71244: Convenience for the gamified dashboard's inline goal-setting
 * UI. Thin wrapper around `updatePartyApi` so callers don't need to know about
 * the broader UpdatePartyData shape.
 */
export async function updateHostGoals(partyId: string, hostGoals: HostGoals) {
  return updatePartyApi(partyId, { hostGoals });
}

// arancini-58492: Natural-language Event Assistant.
export interface AssistantProposedChange {
  /** snake_case field key understood by `updateParty`. */
  key: string;
  /** The proposed value to apply when accepted. */
  value: unknown;
  label: string;
  currentDisplay: string;
  proposedDisplay: string;
  reason?: string;
}

export interface EventAssistantResponse {
  assistantMessage: string;
  clarifyingQuestion?: string;
  proposedChanges: AssistantProposedChange[];
  // gricia-58502: server-side log row id for this proposal (null if logging
  // failed). Echo it back via `eventAssistantFeedback` to record the host's
  // accepted/rejected keys + apply outcome.
  proposalId?: string | null;
}

export interface AssistantHistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

/**
 * Ask the Event Assistant to turn a plain-English instruction into a structured
 * diff of editable event fields. The backend NEVER writes — it only proposes;
 * the caller applies the host-accepted subset via `updateParty`.
 */
export async function eventAssistant(
  partyId: string,
  instruction: string,
  history: AssistantHistoryTurn[] = [],
): Promise<EventAssistantResponse> {
  return apiRequest<EventAssistantResponse>(`/api/parties/${partyId}/assistant`, {
    method: 'POST',
    body: { instruction, conversationHistory: history },
  });
}

/**
 * gricia-58502: report Event Assistant feedback — which proposed keys the host
 * accepted/rejected and whether applying them succeeded. Best-effort and
 * fire-and-forget: errors are swallowed so logging never affects the host's UX.
 */
export async function eventAssistantFeedback(
  partyId: string,
  body: {
    proposalId: string;
    acceptedKeys: string[];
    rejectedKeys: string[];
    applied: boolean;
    error?: string;
  },
): Promise<void> {
  try {
    await apiRequest(`/api/parties/${partyId}/assistant/feedback`, {
      method: 'POST',
      body,
    });
  } catch {
    // Swallow — feedback logging is non-load-bearing.
  }
}

/**
 * bottarga-92104: shared constant for the "possible scam" manual flag. Stored
 * as a value in `parties.event_tags` (alongside other tags) so existing tag
 * filters / chip strips / the fake-detection scorer's event_tags-aware
 * heuristics pick it up automatically without a separate column.
 *
 * Toggled from the /payments by-city Actions menu (PayoutsByPartyTable). Both
 * directions are reversible; per the reversible-action convention there is no
 * confirm modal.
 */
export const POSSIBLE_SCAM_TAG = 'possible-scam';

/**
 * bottarga-92104: toggle the `possible-scam` tag on a party's `event_tags`
 * array via the existing PATCH /api/parties/:id endpoint. Returns the next
 * tag array so callers can patch local state without a full refetch.
 *
 * `currentTags` is what the caller currently has in hand (the by-party row's
 * `party.eventTags`); we union/remove in-place rather than blindly setting
 * to keep other tags intact (SWC Hub, prepay, etc.).
 *
 * Audit: backend logs the eventTags change as part of its normal PATCH log;
 * a dedicated audit row is not required since the tag itself is the durable
 * signal (visible from any read of the party).
 */
export async function flagPartyAsScam(
  partyId: string,
  currentTags: string[],
  flag: boolean,
): Promise<{ eventTags: string[] }> {
  const set = new Set(currentTags ?? []);
  if (flag) {
    set.add(POSSIBLE_SCAM_TAG);
  } else {
    set.delete(POSSIBLE_SCAM_TAG);
  }
  const nextTags = Array.from(set);
  await updatePartyApi(partyId, { eventTags: nextTags });
  return { eventTags: nextTags };
}

/**
 * panuozzo-58217: free-text "custom tags" managed from the /payments by-city ⋮
 * menu by admins + underbosses. Stored in `parties.event_tags` namespaced with
 * a `custom:` prefix so they never collide with functional tags (`go`,
 * `possible-scam`, SWC/GPP filters). Add/remove both go through the same
 * `updatePartyApi` → PATCH /api/parties/:id pass-through used by the scam flag,
 * so permissions (admins + scoped underbosses) come for free. Reversible, so no
 * confirm modal.
 */
export const CUSTOM_TAG_PREFIX = 'custom:';

export function getCustomTagLabels(tags?: string[] | null): string[] {
  return (tags ?? [])
    .filter((t) => t.startsWith(CUSTOM_TAG_PREFIX))
    .map((t) => t.slice(CUSTOM_TAG_PREFIX.length))
    .filter(Boolean);
}

export function normalizeCustomTagLabel(raw: string): string {
  let s = (raw ?? '').trim().replace(/\s+/g, ' ');
  while (s.toLowerCase().startsWith(CUSTOM_TAG_PREFIX)) s = s.slice(CUSTOM_TAG_PREFIX.length).trim();
  return s.slice(0, 40);
}

export async function addCustomTag(
  partyId: string, currentTags: string[], rawLabel: string,
): Promise<{ eventTags: string[] }> {
  const label = normalizeCustomTagLabel(rawLabel);
  if (!label) return { eventTags: currentTags ?? [] };
  const existing = getCustomTagLabels(currentTags).map((l) => l.toLowerCase());
  const nextTags = existing.includes(label.toLowerCase())
    ? [...(currentTags ?? [])]
    : [...(currentTags ?? []), `${CUSTOM_TAG_PREFIX}${label}`];
  await updatePartyApi(partyId, { eventTags: nextTags });
  return { eventTags: nextTags };
}

export async function removeCustomTag(
  partyId: string, currentTags: string[], label: string,
): Promise<{ eventTags: string[] }> {
  const full = `${CUSTOM_TAG_PREFIX}${label}`;
  const nextTags = (currentTags ?? []).filter((t) => t !== full);
  await updatePartyApi(partyId, { eventTags: nextTags });
  return { eventTags: nextTags };
}

/**
 * crocchetta-92106 + crocchetta-92107: Send the "Make sure you've uploaded
 * receipts and photos to rsv.pizza/<custom_url>" reminder via the Molto
 * Benny Telegram bot.
 *
 * Two messages, same body:
 *   1. DM to the primary host (uses `parties.host_telegram_chat_id`; skipped
 *      with a reason when the host hasn't linked Telegram).
 *   2. Post to the **city's** Telegram group chat. tonda-58293: the backend
 *      now resolves the group chat_id from `city_telegram_groups` (keyed by
 *      the city derived from the party name) — the client no longer passes a
 *      `groupChatId`. When no group is on file the backend skips with
 *      `groupReason: 'no city TG group set'`.
 *
 * Backend returns per-channel success + skip reason so the UI can render an
 * accurate partial-success toast. Triggered from the /payments by-city ⋮
 * menu (PayoutsByPartyTable).
 */
export interface SendTgReceiptsReminderResponse {
  hostDmSent: boolean;
  hostDmReason?: string;
  groupSent: boolean;
  groupReason?: string;
}

export async function sendTgReceiptsReminder(
  partyId: string,
): Promise<SendTgReceiptsReminderResponse> {
  return apiRequest<SendTgReceiptsReminderResponse>(
    `/api/admin/payouts/${partyId}/tg-receipts-reminder`,
    {
      method: 'POST',
      requireAuth: true,
    },
  );
}

/**
 * Sibling of {@link sendTgReceiptsReminder}: sends a "submit your payout wallet
 * address at rsv.pizza/host/<slug>/payments" reminder via the Molto Benny
 * Telegram bot — DM to the primary host + post to the city's group chat. Same
 * per-channel success + skip-reason contract. Unlike the receipts reminder this
 * does NOT persist a sent-at timestamp. tonda-58293: group chat_id resolved
 * server-side; no `groupChatId` arg.
 */
export async function sendTgWalletReminder(
  partyId: string,
): Promise<SendTgReceiptsReminderResponse> {
  return apiRequest<SendTgReceiptsReminderResponse>(
    `/api/admin/payouts/${partyId}/tg-wallet-reminder`,
    {
      method: 'POST',
      requireAuth: true,
    },
  );
}

/**
 * tonda-58293: DB-first read of the city → Telegram group mapping. Replaces
 * the client-side Google Sheet fetch (`fetchTelegramGroups()`) for sends.
 * Returns rows from `city_telegram_groups` scoped to the caller's cities
 * (admins/region-only UBs get all). `chatId` is a string (BigInt-safe).
 * Mounted at `/api/underboss/telegram/groups` (underboss-scoped auth).
 */
export interface CityTelegramGroupRow {
  id: string;
  cityKey: string;
  chatId: string | null;
  chatUrl: string | null;
  title: string | null;
  country: string | null;
  region: string | null;
  underboss: string | null;
  isSupergroup: boolean;
  source: string;
  lastVerifiedAt: string | null;
}

export async function fetchCityTelegramGroups(): Promise<CityTelegramGroupRow[]> {
  const res = await apiRequest<{ groups: CityTelegramGroupRow[] }>(
    `/api/underboss/telegram/groups`,
    { method: 'GET', requireAuth: true },
  );
  return res.groups;
}

/**
 * tonda-58293 Phase 2: Telegram Groups gap report. Returns every GPP city
 * (the universe) LEFT JOINed against `city_telegram_groups`, plus the pending
 * (unassigned) bot captures. chatIds are strings (BigInt-safe).
 * Mounted at `/api/underboss/telegram/groups/status` (underboss-scoped auth).
 */
export interface TelegramGroupCityStatus {
  cityKey: string;
  hasChatId: boolean;
  isSupergroup: boolean;
  source: string | null;
  lastVerifiedAt: string | null;
  chatUrl: string | null;
  region: string | null;
  country: string | null;
}

export interface TelegramPendingCapture {
  chatId: string;
  title: string | null;
  chatType: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
}

export interface TelegramGroupsStatus {
  cities: TelegramGroupCityStatus[];
  pendingCaptures: TelegramPendingCapture[];
}

export async function fetchTelegramGroupsStatus(): Promise<TelegramGroupsStatus> {
  return apiRequest<TelegramGroupsStatus>(
    `/api/underboss/telegram/groups/status`,
    { method: 'GET', requireAuth: true },
  );
}

/**
 * Assign a pending capture (by chatId) to a city. Writes through to
 * `city_telegram_groups` so reminders/broadcasts can use it immediately.
 */
export async function assignTelegramGroup(
  chatId: string,
  cityKey: string,
): Promise<{ ok: boolean; cityKey: string; chatId: string }> {
  return apiRequest(
    `/api/underboss/telegram/groups/assign`,
    { method: 'POST', requireAuth: true, body: { chatId, cityKey } },
  );
}

export interface TelegramGroupTestResult {
  cityKey: string;
  ok: boolean;
  skipped?: boolean;
  reason?: string;
  chatId?: string;
  migratedTo?: string;
}

/** Send a one-off test message to a city's Telegram group. */
export async function testCityTelegramGroup(
  cityKey: string,
): Promise<TelegramGroupTestResult> {
  return apiRequest<TelegramGroupTestResult>(
    `/api/underboss/telegram/groups/${encodeURIComponent(cityKey)}/test`,
    { method: 'POST', requireAuth: true },
  );
}

export interface TelegramGroupRefreshResult {
  cityKey: string;
  ok: boolean;
  migrated?: boolean;
  reason?: string;
  /** chatId echoed on failure (string, BigInt-safe). */
  chatId?: string;
  group?: TelegramGroupCityStatus & { id: string; chatId: string | null };
}

/**
 * tonda-58293 Phase 2: re-verify a city's KNOWN Telegram group via getChat.
 * Updates title / is_supergroup / last_verified_at, and persists the new id if
 * the group migrated to a supergroup. 400 if the city has no chat_id yet.
 */
export async function refreshCityTelegramGroup(
  cityKey: string,
): Promise<TelegramGroupRefreshResult> {
  return apiRequest<TelegramGroupRefreshResult>(
    `/api/underboss/telegram/groups/${encodeURIComponent(cityKey)}/refresh`,
    { method: 'POST', requireAuth: true },
  );
}

/**
 * mortadella-92106: set admin-only city notes on a party. Backed by the
 * dedicated `PATCH /api/admin/parties/:partyId/admin-notes` endpoint so
 * the generic host-accessible PATCH whitelist doesn't have to gate this
 * admin-only field.
 *
 * Pass `null` (or an empty string — the server normalizes) to clear the
 * column. Returns the persisted value so the caller can reconcile against
 * any concurrent edit.
 */
export async function setCityAdminNotes(
  partyId: string,
  notes: string | null,
): Promise<{ adminNotes: string | null }> {
  const res = await apiRequest<{ ok: boolean; party: { id: string; adminNotes: string | null } }>(
    `/api/admin/parties/${partyId}/admin-notes`,
    {
      method: 'PATCH',
      body: { notes },
    },
  );
  return { adminNotes: res.party.adminNotes };
}

/**
 * City-level payment approval. Admin can approve a total amount for the city
 * before sending payment. Pass null to clear the approval.
 */
export interface ApproveCityResponse {
  partyId: string;
  partyName: string;
  paymentsApprovedUsd: number | null;
  paymentsApprovedAt: string | null;
}

export async function approveCity(
  partyId: string,
  amountUsd: number | null,
): Promise<ApproveCityResponse> {
  return apiRequest<ApproveCityResponse>(
    `/api/admin/payouts/${partyId}/approve-city`,
    {
      method: 'POST',
      requireAuth: true,
      body: { amountUsd },
    },
  );
}

/**
 * bufalina-60733: Fake-detection risk scores for a set of GPP parties, used to
 * badge the payments-admin by-city table + gate the send-payment confirm.
 *
 * Compact map keyed by party id; `clean`/sub-10 parties are omitted server-side
 * so the badge self-hides for them. Best-effort — callers should `.catch(()=>{})`.
 */
export interface FakeDetectionScoreEntry {
  score: number;
  tier: string;
  topFlags: string[];
  /** Every fired flag with its weight, highest first. Optional because preview
   *  frontends hit the prod backend, which may not yet return this field. */
  flags?: { detail: string; weight: number }[];
}

export type FakeDetectionScoreMap = Record<string, FakeDetectionScoreEntry>;

export async function fetchFakeDetectionScores(
  partyIds: string[],
): Promise<{ scores: FakeDetectionScoreMap }> {
  return apiRequest<{ scores: FakeDetectionScoreMap }>(
    '/api/admin/payouts/fake-detection-scores',
    {
      method: 'POST',
      requireAuth: true,
      body: { partyIds },
    },
  );
}

/**
 * quattro-71244: Fetches this party's rank against peer GPP events.
 * Returns null on 401/403/404/network failure so callers (the LeaderboardPill)
 * can gracefully hide instead of crashing the dashboard.
 */
export async function getLeaderboardRank(
  partyId: string,
  metric: string = 'totalRsvps',
): Promise<{ rank: number; total: number; topPercent: number; scope: 'gpp-season' | 'gpp-all' } | null> {
  try {
    return await apiRequest<{ rank: number; total: number; topPercent: number; scope: 'gpp-season' | 'gpp-all' }>(
      `/api/parties/${partyId}/leaderboard-rank?metric=${encodeURIComponent(metric)}`,
      { method: 'GET', requireAuth: true },
    );
  } catch (error) {
    // Graceful hide — leaderboard is decorative, not load-bearing.
    return null;
  }
}

export async function deletePartyApi(partyId: string) {
  // porchetta-81402: the backend handler is now a soft-cancel alias — the row
  // and its children stay intact. New code should call `cancelPartyApi` to
  // pass an optional reason; this helper is kept for back-compat.
  return apiRequest<{ success: boolean }>(`/api/parties/${partyId}`, {
    method: 'DELETE',
  });
}

// porchetta-81402: cancel + reinstate. Reason is optional free text — the
// backend trims and truncates to 500 chars. Reinstate symmetrically clears
// the cancel columns and does NOT touch rsvp_closed_at.
export async function cancelPartyApi(partyId: string, reason?: string) {
  return apiRequest<{ success: boolean; party: any }>(`/api/parties/${partyId}/cancel`, {
    method: 'POST',
    body: { reason: reason || null },
  });
}

export async function reinstatePartyApi(partyId: string) {
  return apiRequest<{ success: boolean; party: any }>(`/api/parties/${partyId}/reinstate`, {
    method: 'POST',
  });
}

// Guest API functions (host actions)
export async function addGuestByHostApi(
  partyId: string,
  data: {
    name: string;
    email?: string;
    dietaryRestrictions?: string[];
    likedToppings?: string[];
    dislikedToppings?: string[];
    likedBeverages?: string[];
    dislikedBeverages?: string[];
  }
) {
  return apiRequest<{ guest: any; alreadyExists?: boolean }>(`/api/parties/${partyId}/guests`, {
    method: 'POST',
    body: data,
  });
}

export async function removeGuestApi(partyId: string, guestId: string) {
  return apiRequest<{ success: boolean }>(`/api/parties/${partyId}/guests/${guestId}`, {
    method: 'DELETE',
  });
}

// Bulk import of guests from a Luma/Meetup/Eventbrite/CSV export.
// See plans/calzone-83291-guest-list-import.md.
export interface ImportGuestsResult {
  inserted: number;
  skipped: Array<{ email: string; reason: string }>;
  errors: Array<{ index: number; reason: string }>;
  createdGuestIds: string[];
}

export interface ImportGuestRow {
  name: string;
  email?: string | null;
  status?: 'CONFIRMED' | 'INVITED' | 'WAITLISTED' | 'CHECKED_IN';
  approved?: boolean | null;
}

export async function importGuestsApi(
  partyId: string,
  data: {
    guests: ImportGuestRow[];
    sourcePlatform: 'luma' | 'meetup' | 'eventbrite' | 'csv';
  }
): Promise<ImportGuestsResult> {
  return apiRequest<ImportGuestsResult>(`/api/parties/${partyId}/guests/import`, {
    method: 'POST',
    body: data,
  });
}

export async function updateGuestApprovalApi(partyId: string, guestId: string, approved: boolean | null) {
  return apiRequest<{ guest: any }>(`/api/parties/${partyId}/guests/${guestId}/approve`, {
    method: 'PATCH',
    body: { approved },
  });
}

export async function promoteGuestApi(partyId: string, guestId: string) {
  return apiRequest<{ guest: any }>(`/api/parties/${partyId}/guests/${guestId}/promote`, {
    method: 'POST',
  });
}

// Bulk CSV invites (Promo app → POST /api/v1/parties/:partyId/guests/bulk-invite)
export interface BulkInviteResult {
  sent: string[];
  failed: Array<{ email: string; reason: string }>;
  skipped: Array<{ email: string; reason: string }>;
  createdGuestIds: string[];
}

export async function bulkInviteGuests(
  partyId: string,
  guests: Array<{ name: string; email: string }>,
  customMessage?: string,
  testOnly?: boolean
): Promise<BulkInviteResult> {
  return apiRequest<BulkInviteResult>(
    `/api/v1/parties/${partyId}/guests/bulk-invite`,
    {
      method: 'POST',
      body: { guests, customMessage, ...(testOnly && { testOnly: true }) },
    }
  );
}

// Public RSVP API (no auth required)
export async function submitRsvpApi(
  inviteCode: string,
  data: {
    name: string;
    email?: string;
    ethereumAddress?: string;
    roles?: string[];
    mailingListOptIn?: boolean;
    dietaryRestrictions?: string[];
    likedToppings?: string[];
    dislikedToppings?: string[];
    likedBeverages?: string[];
    dislikedBeverages?: string[];
    pizzeriaRankings?: string[];
  }
) {
  return apiRequest<{ success: boolean; guest: any; message: string }>(
    `/api/rsvp/${inviteCode}/guest`,
    {
      method: 'POST',
      body: data,
      requireAuth: false,
    }
  );
}

// Host profile type for API responses
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

// Public event data type
export interface PublicEventSponsor {
  id: string;
  name: string;
  website: string | null;
  brandDescription: string | null;
  logoUrl: string | null;
  brandTwitter: string | null;
}

export interface PublicEvent {
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
  availableDietaryOptions: string[];
  showToppingsOnRsvp?: boolean;
  address: string | null;
  latitude?: number | null;
  longitude?: number | null;
  placeId?: string | null;
  venueName: string | null;
  country?: string | null;
  city?: string | null;
  maxGuests: number | null;
  hideGuests: boolean;
  eventImageUrl: string | null;
  description: string | null;
  rsvpClosedAt: string | null;
  coHosts: any[];
  hasPassword: boolean;
  hostName: string | null;
  hostProfile: HostProfile | null;
  guestCount: number;
  userId: string | null;
  selectedPizzerias?: Pizzeria[];
  eventType?: string | null;
  underbossStatus?: string | null;
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
  photosEnabled?: boolean;
  photosPublic?: boolean;
  nftEnabled?: boolean;
  nftChain?: string | null;
  hiddenGppPhotos?: string[];
  extraGppPhotos?: string[];
  telegramGroup?: string | null;
  turtleRolesEnabled?: boolean;
  sponsors?: PublicEventSponsor[];
  pageViewStats?: { totalViews: number; uniqueVisitors: number };
  // Reimbursement cap (arugula-38633 v2) — public so the host-facing payout
  // banner can render before re-loading the Party context. NULL when an
  // underboss has not validated yet.
  reimbursementCapUsd?: number | null;
  // arugula-38633 v2 follow-up: precedence resolution of
  // reimbursementCapUsd → max(numeric event_tags) → null. Host-facing UI
  // reads this; /underboss still uses the raw reimbursementCapUsd.
  effectiveReimbursementCapUsd?: number | null;
  // porchetta-81402: soft-cancel state. cancelledAt non-null = EventPage
  // shows a cancelled banner + replaces the RSVP button with a notice card.
  cancelledAt?: string | null;
  cancellationReason?: string | null;
}

// Public Event API (no auth required)
export async function getEventBySlug(
  slug: string,
  year?: number | string | null,
): Promise<PublicEvent | { redirect: true; slug: string } | null> {
  try {
    // soppressata-50927: thread the optional ?year= param to the year-aware
    // resolver. Send the caller's auth token when present so admins/in-scope
    // underbosses can preview gated GPP27 (2027) events pre-launch.
    const qs = year != null && `${year}`.length > 0 ? `?year=${encodeURIComponent(`${year}`)}` : '';
    const token = getAuthToken();
    const response = await fetch(`${API_URL}/api/events/${slug}${qs}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });

    const data = await response.json();

    // Handle redirect response from slug aliases (301)
    if (data.redirect) {
      return { redirect: true, slug: data.slug };
    }

    if (!response.ok) {
      return null;
    }

    return data.event || null;
  } catch (error) {
    console.error('Error fetching event:', error);
    return null;
  }
}

// One Sheet interest form
export interface OneSheetInterestData {
  name: string;
  email: string;
  company: string;
  message?: string;
}

export async function submitOneSheetInterest(slug: string, data: OneSheetInterestData): Promise<{ success: boolean; id: string }> {
  const response = await fetch(`${API_URL}/api/events/${slug}/interest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    const err = new Error(error.message || error.error || `API error: ${response.status}`);
    (err as any).status = response.status;
    throw err;
  }

  return response.json();
}

// Donation API functions

// Get donation stats for a party (public)
export async function getDonationStats(partyId: string): Promise<DonationPublicStats | null> {
  try {
    const response = await apiRequest<DonationPublicStats>(
      `/api/parties/${partyId}/donations/public`,
      {
        method: 'GET',
        requireAuth: false,
      }
    );
    return response;
  } catch (error) {
    console.error('Error fetching donation stats:', error);
    return null;
  }
}

// Get donations list for a party (host only)
export async function getDonations(partyId: string): Promise<{
  donations: Donation[];
  summary: { totalAmount: number; totalCount: number; currency: string };
} | null> {
  try {
    return await apiRequest<{
      donations: Donation[];
      summary: { totalAmount: number; totalCount: number; currency: string };
    }>(`/api/parties/${partyId}/donations`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching donations:', error);
    return null;
  }
}

// Create a donation record
export async function createDonation(
  partyId: string,
  data: {
    amount: number;
    currency?: string;
    paymentIntentId?: string;
    chargeId?: string;
    donorName?: string;
    donorEmail?: string;
    isAnonymous?: boolean;
    message?: string;
    guestId?: string;
    // Crypto donation fields
    paymentMethod?: 'stripe' | 'crypto';
    chainId?: number;
    tokenSymbol?: string;
    tokenAddress?: string;
    txHash?: string;
    walletAddress?: string;
  }
): Promise<{ donation: Donation } | null> {
  try {
    return await apiRequest<{ donation: Donation }>(
      `/api/parties/${partyId}/donations`,
      {
        method: 'POST',
        body: data,
        requireAuth: false, // Public endpoint for guests
      }
    );
  } catch (error) {
    console.error('Error creating donation:', error);
    return null;
  }
}

// Update donation status (after webhook or payment confirmation)
export async function updateDonationStatus(
  partyId: string,
  donationId: string,
  data: { status?: string; chargeId?: string }
): Promise<{ donation: Donation } | null> {
  try {
    return await apiRequest<{ donation: Donation }>(
      `/api/parties/${partyId}/donations/${donationId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: false, // Called from client after payment
      }
    );
  } catch (error) {
    console.error('Error updating donation status:', error);
    return null;
  }
}

// Photo API functions
export interface PhotoUploadData {
  url: string;
  thumbnailUrl?: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  width?: number;
  height?: number;
  uploaderName?: string;
  uploaderEmail?: string;
  guestId?: string;
  caption?: string;
  tags?: string[];
  photoYear?: number;
  duration?: number; // Video duration in seconds
}

export interface PhotosListResponse {
  photos: Photo[];
  total: number;
  limit: number;
  offset: number;
}

export interface PhotoFilters {
  starred?: boolean;
  tag?: string;
  uploadedBy?: string;
  status?: 'approved' | 'pending' | 'rejected' | 'all';
  limit?: number;
  offset?: number;
}

// Get photos for a party (public endpoint)
export async function getPartyPhotos(
  partyId: string,
  filters: PhotoFilters = {}
): Promise<PhotosListResponse | null> {
  try {
    const params = new URLSearchParams();
    if (filters.starred) params.append('starred', 'true');
    if (filters.tag) params.append('tag', filters.tag);
    if (filters.uploadedBy) params.append('uploadedBy', filters.uploadedBy);
    if (filters.status) params.append('status', filters.status);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    const queryString = params.toString();
    const url = `/api/parties/${partyId}/photos${queryString ? `?${queryString}` : ''}`;

    return await apiRequest<PhotosListResponse>(url, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photos:', error);
    return null;
  }
}

// Upload a photo (public endpoint - guest can upload)
export async function uploadPhoto(
  partyId: string,
  data: PhotoUploadData
): Promise<{ photo: Photo } | null> {
  try {
    return await apiRequest<{ photo: Photo }>(`/api/parties/${partyId}/photos`, {
      method: 'POST',
      body: data,
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error uploading photo:', error);
    return null;
  }
}

// Get single photo details
export async function getPhoto(
  partyId: string,
  photoId: string
): Promise<{ photo: Photo } | null> {
  try {
    return await apiRequest<{ photo: Photo }>(`/api/parties/${partyId}/photos/${photoId}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photo:', error);
    return null;
  }
}

// Update photo (host only)
export async function updatePhoto(
  partyId: string,
  photoId: string,
  data: { caption?: string; tags?: string[]; starred?: boolean; status?: string; photoYear?: number | null }
): Promise<{ photo: Photo } | null> {
  try {
    return await apiRequest<{ photo: Photo }>(`/api/parties/${partyId}/photos/${photoId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating photo:', error);
    return null;
  }
}

// Delete photo (host or uploader)
export async function deletePhoto(
  partyId: string,
  photoId: string,
  uploaderEmail?: string
): Promise<boolean> {
  try {
    const params = uploaderEmail ? `?uploaderEmail=${encodeURIComponent(uploaderEmail)}` : '';
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/photos/${photoId}${params}`, {
      method: 'DELETE',
      requireAuth: false,
    });
    return true;
  } catch (error) {
    console.error('Error deleting photo:', error);
    return false;
  }
}

// Restore a soft-deleted photo (super-admin only). provolone-58931.
export async function restorePhoto(partyId: string, photoId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/photos/${photoId}/restore`, {
      method: 'POST',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error restoring photo:', error);
    return false;
  }
}

// Get photo statistics
export async function getPhotoStats(partyId: string): Promise<PhotoStats | null> {
  try {
    return await apiRequest<PhotoStats>(`/api/parties/${partyId}/photos/stats`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photo stats:', error);
    return null;
  }
}

// Batch review photos (host only)
export async function batchReviewPhotos(
  partyId: string,
  photoIds: string[],
  status: 'approved' | 'rejected'
): Promise<{ updated: number } | null> {
  try {
    return await apiRequest<{ updated: number }>(`/api/parties/${partyId}/photos/batch-review`, {
      method: 'POST',
      body: { photoIds, status },
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error batch reviewing photos:', error);
    return null;
  }
}

// salame-58195: toggle the current user's thumbs-up vote on a photo.
// Logged-in users only. Returns { voted, voteCount } on success, null on error.
export async function togglePhotoVote(
  partyId: string,
  photoId: string,
): Promise<{ voted: boolean; voteCount: number } | null> {
  try {
    return await apiRequest<{ voted: boolean; voteCount: number }>(
      `/api/parties/${partyId}/photos/${photoId}/vote`,
      {
        method: 'POST',
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error toggling photo vote:', error);
    return null;
  }
}

// napoletana-58210: toggle the current user's thumbs-up vote on a
// payout-sourced photo. The /photos feed + event-page galleries union the
// `photos` table with payout-document pizza photos; voting on the payout
// side uses a separate table so we need a separate endpoint. Callers should
// dispatch on `photo.source` and pass `photo.payoutId`.
export async function togglePayoutPhotoVote(
  payoutId: string,
  docId: string,
): Promise<{ voted: boolean; voteCount: number } | null> {
  try {
    return await apiRequest<{ voted: boolean; voteCount: number }>(
      `/api/payouts/${payoutId}/documents/${docId}/vote`,
      {
        method: 'POST',
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error toggling payout photo vote:', error);
    return null;
  }
}

// Get available photo tags for a party (defaults + confirmed sponsor names)
export async function getPhotoTags(partyId: string): Promise<{ tags: string[]; defaultTags: string[]; sponsorTags: string[] } | null> {
  try {
    return await apiRequest<{ tags: string[]; defaultTags: string[]; sponsorTags: string[] }>(`/api/parties/${partyId}/photos/tags`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching photo tags:', error);
    return null;
  }
}

// Sponsor CRM API functions

export interface CreateSponsorData {
  name: string;
  website?: string;
  brandTwitter?: string;
  brandInstagram?: string;
  brandDescription?: string;
  pointPerson?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTwitter?: string;
  telegram?: string;
  status?: SponsorStatus;
  amount?: number | null;
  sponsorshipType?: SponsorshipType | null;
  productService?: string;
  logoUrl?: string;
  notes?: string;
  lastContactedAt?: string | null;
  category?: string;
}

export interface UpdateSponsorData extends Partial<CreateSponsorData> {}

export interface SponsorFilters {
  status?: SponsorStatus;
  sortBy?: 'createdAt' | 'name' | 'amount' | 'lastContactedAt' | 'status';
  sortDir?: 'asc' | 'desc';
}

// Get all sponsors for a party
export async function getSponsors(
  partyId: string,
  filters: SponsorFilters = {}
): Promise<{ sponsors: Sponsor[] } | null> {
  try {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.sortBy) params.append('sortBy', filters.sortBy);
    if (filters.sortDir) params.append('sortDir', filters.sortDir);

    const queryString = params.toString();
    const url = `/api/parties/${partyId}/sponsors${queryString ? `?${queryString}` : ''}`;

    return await apiRequest<{ sponsors: Sponsor[] }>(url, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching sponsors:', error);
    return null;
  }
}

// Reorder sponsors (host only) — persists sortOrder for flyer logo row
export async function reorderSponsors(
  partyId: string,
  sponsorIds: string[]
): Promise<{ sponsors: Sponsor[] } | null> {
  try {
    return await apiRequest<{ sponsors: Sponsor[] }>(
      `/api/parties/${partyId}/sponsors/reorder`,
      {
        method: 'PATCH',
        body: { sponsorIds },
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error reordering sponsors:', error);
    throw error;
  }
}

// Performer/Music API functions

export interface CreatePerformerData {
  name: string;
  type?: 'dj' | 'live_band' | 'solo' | 'playlist';
  genre?: string;
  setTime?: string;
  setDuration?: number;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  instagram?: string;
  soundcloud?: string;
  status?: 'pending' | 'confirmed' | 'cancelled';
  equipmentProvided?: boolean;
  equipmentNotes?: string;
  fee?: number;
  feePaid?: boolean;
  notes?: string;
}

export interface UpdatePerformerData {
  name?: string;
  type?: 'dj' | 'live_band' | 'solo' | 'playlist';
  genre?: string | null;
  setTime?: string | null;
  setDuration?: number | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
  instagram?: string | null;
  soundcloud?: string | null;
  status?: 'pending' | 'confirmed' | 'cancelled';
  equipmentProvided?: boolean;
  equipmentNotes?: string | null;
  fee?: number | null;
  feePaid?: boolean;
  notes?: string | null;
}

// Get performers for a party (public endpoint)
export async function getPerformers(partyId: string): Promise<PerformersResponse | null> {
  try {
    return await apiRequest<PerformersResponse>(`/api/parties/${partyId}/performers`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching performers:', error);
    return null;
  }
}

// GPP API functions
export interface CreateGPPEventData {
  city: string;
  hostName: string;
  email: string;
  telegram?: string;
  country?: string;
  countryCode?: string;
  cityFormattedName?: string;
  cityLat?: number;
  cityLng?: number;
  timezone?: string;
}

export interface GPPEventResponse {
  success: boolean;
  event: {
    id: string;
    name: string;
    inviteCode: string;
    eventType: string;
    eventTags: string[];
  };
  hostPageUrl: string;
  eventPageUrl: string;
  message: string;
}

export async function createGPPEvent(data: CreateGPPEventData): Promise<GPPEventResponse> {
  return apiRequest<GPPEventResponse>('/api/gpp/events', {
    method: 'POST',
    body: data,
    requireAuth: false,
  });
}

export async function verifyTweet(slug: string, tweetUrl: string): Promise<{ verified: boolean; error?: string }> {
  return apiRequest(`/api/events/${slug}/verify-tweet`, {
    method: 'POST',
    body: { tweetUrl },
    requireAuth: false,
  });
}

// Check-in API functions

// provolone-39042: attestation history for "Checked in by X" attribution.
export interface Attestation {
  kind: 'host_admin' | 'peer_guest' | 'self_host';
  name: string | null;
  email: string | null;
  at: string;
}

export interface CheckInResponse {
  success: boolean;
  alreadyCheckedIn: boolean;
  guest: {
    id: string;
    name: string;
    email?: string;
    checkedInAt: string;
    checkedInBy?: string;
  };
  message: string;
  attestations?: Attestation[];
}

export async function checkInGuest(inviteCode: string, guestId: string): Promise<CheckInResponse> {
  return apiRequest<CheckInResponse>(`/api/checkin/${inviteCode}/${guestId}`, {
    method: 'POST',
    requireAuth: true,
  });
}

// Un-check-in: DELETE /api/checkin/:inviteCode/:guestId
// Backend nulls checkedInAt/checkedInBy and emits guest.checkin_undone webhook.
// Idempotent (200 if already unchecked). Returns 400 GUEST_REJECTED if guest is rejected.
export interface UnCheckInResponse {
  success: boolean;
  notCheckedIn?: boolean;
  guest: {
    id: string;
    name: string;
    email?: string;
    checkedInAt: null;
    checkedInBy: null;
  };
  message: string;
}

export async function uncheckInGuestApi(inviteCode: string, guestId: string): Promise<UnCheckInResponse> {
  return apiRequest<UnCheckInResponse>(`/api/checkin/${inviteCode}/${guestId}`, {
    method: 'DELETE',
    requireAuth: true,
  });
}

export interface CheckInStatusResponse {
  guest: {
    id: string;
    name: string;
    email?: string;
    checkedInAt?: string;
    checkedInBy?: string;
  };
  isCheckedIn: boolean;
  callerIsTarget?: boolean;
  callerIsHost?: boolean;
  attestations?: Attestation[];
}

export async function getCheckInStatus(inviteCode: string, guestId: string): Promise<CheckInStatusResponse> {
  return apiRequest<CheckInStatusResponse>(`/api/checkin/${inviteCode}/${guestId}`, {
    method: 'GET',
    requireAuth: true,
  });
}

// Get sponsor pipeline statistics
export async function getSponsorStats(partyId: string): Promise<SponsorStats | null> {
  try {
    return await apiRequest<SponsorStats>(`/api/parties/${partyId}/sponsors/stats`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching sponsor stats:', error);
    return null;
  }
}

// Create a new sponsor
export async function createSponsor(
  partyId: string,
  data: CreateSponsorData
): Promise<{ sponsor: Sponsor } | null> {
  try {
    return await apiRequest<{ sponsor: Sponsor }>(`/api/parties/${partyId}/sponsors`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating sponsor:', error);
    throw error;
  }
}

// Get single sponsor details
export async function getSponsor(
  partyId: string,
  sponsorId: string
): Promise<{ sponsor: Sponsor } | null> {
  try {
    return await apiRequest<{ sponsor: Sponsor }>(`/api/parties/${partyId}/sponsors/${sponsorId}`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching sponsor:', error);
    return null;
  }
}

// Update a sponsor
export async function updateSponsor(
  partyId: string,
  sponsorId: string,
  data: UpdateSponsorData
): Promise<{ sponsor: Sponsor } | null> {
  try {
    return await apiRequest<{ sponsor: Sponsor }>(`/api/parties/${partyId}/sponsors/${sponsorId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating sponsor:', error);
    throw error;
  }
}

// Delete a sponsor
export async function deleteSponsor(partyId: string, sponsorId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/sponsors/${sponsorId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting sponsor:', error);
    return false;
  }
}

// Unified sponsors (event + underboss partners)
export async function getUnifiedSponsors(partyId: string): Promise<{ partners: UnifiedPartner[] }> {
  return apiRequest<{ partners: UnifiedPartner[] }>(`/api/parties/${partyId}/sponsors/unified`);
}

export async function ensureUnderbossSponsors(
  partyId: string,
  sponsorUserIds: string[]
): Promise<{ createdSponsorIds: string[] }> {
  return apiRequest<{ createdSponsorIds: string[] }>(
    `/api/parties/${partyId}/sponsors/ensure-from-underboss`,
    {
      method: 'POST',
      body: { sponsorUserIds },
    }
  );
}

// Partner Intake Form API functions

export interface PartnerIntakeData {
  name?: string;
  website?: string;
  brandTwitter?: string;
  brandInstagram?: string;
  brandDescription?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  contactTwitter?: string;
  telegram?: string;
  sponsorshipType?: SponsorshipType | null;
  productService?: string;
  logoUrl?: string;
  sponsorMessage?: string;
}

export interface PartnerIntakeResponse {
  sponsor: {
    name: string;
    website: string | null;
    brandTwitter: string | null;
    brandInstagram: string | null;
    brandDescription: string | null;
    contactName: string | null;
    contactEmail: string | null;
    contactPhone: string | null;
    contactTwitter: string | null;
    telegram: string | null;
    sponsorshipType: string | null;
    productService: string | null;
    logoUrl: string | null;
    sponsorMessage: string | null;
    intakeSubmittedAt: string | null;
  };
  eventName: string;
}

// Public: Get partner intake data by token (no auth)
export async function getPartnerIntake(token: string): Promise<PartnerIntakeResponse | null> {
  try {
    const response = await fetch(`${API_URL}/api/partner-intake/${token}`);
    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error('Failed to fetch intake data');
    }
    return await response.json();
  } catch (error) {
    console.error('Error fetching partner intake:', error);
    return null;
  }
}

// Public: Submit partner intake form (no auth)
export async function submitPartnerIntake(token: string, data: PartnerIntakeData): Promise<boolean> {
  const response = await fetch(`${API_URL}/api/partner-intake/${token}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Submission failed' }));
    throw new Error(error.message || 'Failed to submit intake form');
  }
  return true;
}

// Auth: Generate partner intake token
export async function generatePartnerIntakeToken(
  partyId: string,
  sponsorId: string
): Promise<{ token: string; url: string } | null> {
  try {
    return await apiRequest<{ token: string; url: string }>(
      `/api/partner-intake/generate-token/${partyId}/${sponsorId}`,
      { method: 'POST', requireAuth: true }
    );
  } catch (error) {
    console.error('Error generating intake token:', error);
    throw error;
  }
}

// Auth: Revoke partner intake token
export async function revokePartnerIntakeToken(
  partyId: string,
  sponsorId: string
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/partner-intake/revoke-token/${partyId}/${sponsorId}`,
      { method: 'DELETE', requireAuth: true }
    );
    return true;
  } catch (error) {
    console.error('Error revoking intake token:', error);
    return false;
  }
}

// Update fundraising goal for a party
export async function updateFundraisingGoal(
  partyId: string,
  fundraisingGoal: number | null
): Promise<{ party: any } | null> {
  try {
    return await apiRequest<{ party: any }>(`/api/parties/${partyId}`, {
      method: 'PATCH',
      body: { fundraisingGoal },
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating fundraising goal:', error);
    throw error;
  }
}

// Venue API functions

export interface VenueCreateData {
  name: string;
  address?: string;
  website?: string;
  capacity?: number;
  cost?: number;
  organization?: string;
  pointPerson?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  status?: VenueStatus;
  notes?: string;
  pros?: string;
  cons?: string;
  latitude?: number;
  longitude?: number;
}

export interface VenueUpdateData extends Partial<VenueCreateData> {}

// Get all venues for a party
export async function getVenues(partyId: string): Promise<Venue[]> {
  try {
    const response = await apiRequest<{ venues: Venue[] }>(`/api/parties/${partyId}/venues`, {
      method: 'GET',
      requireAuth: true,
    });
    return response.venues;
  } catch (error) {
    console.error('Error fetching venues:', error);
    return [];
  }
}

// Create a new venue
export async function createVenue(partyId: string, data: VenueCreateData): Promise<Venue | null> {
  try {
    const response = await apiRequest<{ venue: Venue }>(`/api/parties/${partyId}/venues`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
    return response.venue;
  } catch (error) {
    console.error('Error creating venue:', error);
    throw error;
  }
}

// Update a venue
export async function updateVenue(partyId: string, venueId: string, data: VenueUpdateData): Promise<Venue | null> {
  try {
    const response = await apiRequest<{ venue: Venue }>(`/api/parties/${partyId}/venues/${venueId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
    return response.venue;
  } catch (error) {
    console.error('Error updating venue:', error);
    throw error;
  }
}

// Delete a venue
export async function deleteVenue(partyId: string, venueId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/venues/${venueId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting venue:', error);
    return false;
  }
}

// Select a venue as the event location
export async function selectVenue(partyId: string, venueId: string): Promise<{ venue: Venue; party: any } | null> {
  try {
    const response = await apiRequest<{ venue: Venue; party: any }>(`/api/parties/${partyId}/venues/${venueId}/select`, {
      method: 'PATCH',
      requireAuth: true,
    });
    return response;
  } catch (error) {
    console.error('Error selecting venue:', error);
    throw error;
  }
}

// Deselect a venue
export async function deselectVenue(partyId: string, venueId: string): Promise<Venue | null> {
  try {
    const response = await apiRequest<{ venue: Venue }>(`/api/parties/${partyId}/venues/${venueId}/deselect`, {
      method: 'PATCH',
      requireAuth: true,
    });
    return response.venue;
  } catch (error) {
    console.error('Error deselecting venue:', error);
    throw error;
  }
}

// Add a performer (host only)
export async function addPerformer(
  partyId: string,
  data: CreatePerformerData
): Promise<{ performer: Performer } | null> {
  try {
    return await apiRequest<{ performer: Performer }>(`/api/parties/${partyId}/performers`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error adding performer:', error);
    throw error;
  }
}

// Update a performer (host only)
export async function updatePerformer(
  partyId: string,
  performerId: string,
  data: UpdatePerformerData
): Promise<{ performer: Performer } | null> {
  try {
    return await apiRequest<{ performer: Performer }>(
      `/api/parties/${partyId}/performers/${performerId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating performer:', error);
    throw error;
  }
}

// Delete a performer (host only)
export async function deletePerformer(
  partyId: string,
  performerId: string
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/performers/${performerId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting performer:', error);
    return false;
  }
}

// Reorder performers (host only)
export async function reorderPerformers(
  partyId: string,
  performerIds: string[]
): Promise<{ performers: Performer[] } | null> {
  try {
    return await apiRequest<{ performers: Performer[] }>(
      `/api/parties/${partyId}/performers/reorder`,
      {
        method: 'PATCH',
        body: { performerIds },
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error reordering performers:', error);
    throw error;
  }
}

// Report API functions

// Get full report data (host only)
export async function getReport(partyId: string): Promise<{ report: EventReport } | null> {
  try {
    return await apiRequest<{ report: EventReport }>(`/api/parties/${partyId}/report`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching report:', error);
    return null;
  }
}

// Update report fields (host only)
export interface UpdateReportData {
  reportRecap?: string | null;
  reportVideoUrl?: string | null;
  reportPhotosUrl?: string | null;
  flyerArtist?: string | null;
  xPostUrl?: string | null;
  xPostViews?: number | null;
  farcasterPostUrl?: string | null;
  farcasterViews?: number | null;
  lumaUrl?: string | null;
  lumaViews?: number | null;
  poapEventId?: string | null;
  poapMints?: number | null;
  poapMoments?: number | null;
}

export async function updateReport(
  partyId: string,
  data: UpdateReportData
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/report`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error updating report:', error);
    return false;
  }
}

// Publish report
export async function publishReport(
  partyId: string,
  password?: string
): Promise<{ reportPublicSlug: string; publicUrl: string } | null> {
  try {
    return await apiRequest<{ success: boolean; reportPublicSlug: string; publicUrl: string }>(
      `/api/parties/${partyId}/report/publish`,
      {
        method: 'POST',
        body: password ? { password } : undefined,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error publishing report:', error);
    return null;
  }
}

// Check if published report requires password
export async function checkReportPassword(
  publicSlug: string
): Promise<{ requiresPassword: boolean; name: string } | null> {
  try {
    return await apiRequest<{ requiresPassword: boolean; name: string }>(
      `/api/reports/public/${publicSlug}/check`,
      { method: 'GET', requireAuth: false }
    );
  } catch {
    return null;
  }
}

// Fetch published report (public, with optional password)
export async function fetchPublicReport(
  publicSlug: string,
  password?: string
): Promise<any> {
  const params = password ? `?password=${encodeURIComponent(password)}` : '';
  return apiRequest(`/api/reports/public/${publicSlug}${params}`, {
    method: 'GET',
    requireAuth: false,
  });
}

// Unpublish report
export async function unpublishReport(partyId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/report/publish`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error unpublishing report:', error);
    return false;
  }
}

// Add social post
export async function addSocialPost(
  partyId: string,
  data: { platform: string; url: string; authorHandle?: string; title?: string; views?: number | null }
): Promise<{ socialPost: SocialPost } | null> {
  try {
    return await apiRequest<{ socialPost: SocialPost }>(
      `/api/parties/${partyId}/report/social-posts`,
      {
        method: 'POST',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error adding social post:', error);
    return null;
  }
}

// Delete social post
export async function deleteSocialPost(partyId: string, postId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/report/social-posts/${postId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting social post:', error);
    return false;
  }
}

// Add notable attendee
export async function addNotableAttendee(
  partyId: string,
  data: { name: string; link?: string; guestId?: string }
): Promise<{ notableAttendee: NotableAttendee } | null> {
  try {
    return await apiRequest<{ notableAttendee: NotableAttendee }>(
      `/api/parties/${partyId}/report/notable-attendees`,
      {
        method: 'POST',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error adding notable attendee:', error);
    return null;
  }
}

// Delete notable attendee
export async function deleteNotableAttendee(partyId: string, attendeeId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/report/notable-attendees/${attendeeId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting notable attendee:', error);
    return false;
  }
}

// Delete notable attendee by guest ID
export async function deleteNotableAttendeeByGuestId(partyId: string, guestId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/report/notable-attendees/by-guest/${guestId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting notable attendee by guest ID:', error);
    return false;
  }
}

// Get notable guest IDs for a party
export async function getNotableGuestIds(partyId: string): Promise<string[]> {
  try {
    const result = await apiRequest<{ guestIds: string[] }>(
      `/api/parties/${partyId}/report/notable-attendees/guest-ids`,
      {
        method: 'GET',
        requireAuth: true,
      }
    );
    return result.guestIds;
  } catch (error) {
    console.error('Error fetching notable guest IDs:', error);
    return [];
  }
}

// Get public report by slug (no auth)
export async function getPublicReport(slug: string): Promise<{ report: EventReport } | null> {
  try {
    return await apiRequest<{ report: EventReport }>(`/api/reports/public/${slug}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching public report:', error);
    return null;
  }
}

// Get page view stats (host only)
export async function getPageViewStats(partyId: string): Promise<PageViewStats | null> {
  try {
    return await apiRequest<PageViewStats>(`/api/parties/${partyId}/report/views`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching page view stats:', error);
    return null;
  }
}

// Track link click on event page (public, fire-and-forget)
export function trackLinkClick(slug: string, url: string, linkType: string, linkLabel?: string): void {
  const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
  fetch(`${apiUrl}/api/events/${slug}/click`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, linkType, linkLabel: linkLabel || null }),
  }).catch(() => {});
}

// Track RSVP funnel step (public, fire-and-forget)
export function trackRsvpFunnel(slug: string, step: 'rsvp_opened' | 'rsvp_step1_complete'): void {
  const apiUrl = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
  fetch(`${apiUrl}/api/events/${slug}/funnel`, {
    method: 'POST',
    keepalive: true,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ step }),
  }).catch(() => {});
}

// Get link click stats (host only)
export async function getLinkClickStats(partyId: string): Promise<LinkClickStats | null> {
  try {
    return await apiRequest<LinkClickStats>(`/api/parties/${partyId}/report/link-clicks`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching link click stats:', error);
    return null;
  }
}

// Staff API functions (host only)

export interface StaffListResponse {
  staff: Staff[];
  total: number;
  limit: number;
  offset: number;
}

export interface StaffFilters {
  status?: StaffStatus;
  role?: string;
  limit?: number;
  offset?: number;
}

export interface CreateStaffData {
  name: string;
  email?: string;
  phone?: string;
  role: string;
  status?: StaffStatus;
  notes?: string;
}

export interface UpdateStaffData {
  name?: string;
  email?: string | null;
  phone?: string | null;
  role?: string;
  status?: StaffStatus;
  notes?: string | null;
}

// Get all staff for a party
export async function getPartyStaff(
  partyId: string,
  filters: StaffFilters = {}
): Promise<StaffListResponse | null> {
  try {
    const params = new URLSearchParams();
    if (filters.status) params.append('status', filters.status);
    if (filters.role) params.append('role', filters.role);
    if (filters.limit) params.append('limit', filters.limit.toString());
    if (filters.offset) params.append('offset', filters.offset.toString());

    const queryString = params.toString();
    const url = `/api/parties/${partyId}/staff${queryString ? `?${queryString}` : ''}`;

    return await apiRequest<StaffListResponse>(url, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching staff:', error);
    return null;
  }
}

// Get staff statistics
export async function getStaffStats(partyId: string): Promise<StaffStats | null> {
  try {
    return await apiRequest<StaffStats>(`/api/parties/${partyId}/staff/stats`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching staff stats:', error);
    return null;
  }
}

// Add a new staff member
export async function createStaff(
  partyId: string,
  data: CreateStaffData
): Promise<{ staff: Staff } | null> {
  try {
    return await apiRequest<{ staff: Staff }>(`/api/parties/${partyId}/staff`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating staff:', error);
    return null;
  }
}

// Update a staff member
export async function updateStaff(
  partyId: string,
  staffId: string,
  data: UpdateStaffData
): Promise<{ staff: Staff } | null> {
  try {
    return await apiRequest<{ staff: Staff }>(`/api/parties/${partyId}/staff/${staffId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating staff:', error);
    return null;
  }
}

// Delete a staff member
export async function deleteStaff(partyId: string, staffId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/staff/${staffId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting staff:', error);
    return false;
  }
}

// Display API functions

export interface CreateDisplayData {
  name: string;
  contentType?: DisplayContentType;
  contentConfig?: DisplayContentConfig;
  rotationInterval?: number;
  backgroundColor?: string;
  showClock?: boolean;
  showEventName?: boolean;
  password?: string;
}

export interface UpdateDisplayData {
  name?: string;
  contentType?: DisplayContentType;
  contentConfig?: DisplayContentConfig;
  rotationInterval?: number;
  backgroundColor?: string;
  showClock?: boolean;
  showEventName?: boolean;
  isActive?: boolean;
  password?: string | null;
}

// List displays for a party
export async function getPartyDisplays(partyId: string): Promise<{ displays: Display[] } | null> {
  try {
    return await apiRequest<{ displays: Display[] }>(`/api/parties/${partyId}/displays`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching displays:', error);
    return null;
  }
}

// Create a new display
export async function createDisplay(
  partyId: string,
  data: CreateDisplayData
): Promise<{ display: Display } | null> {
  try {
    return await apiRequest<{ display: Display }>(`/api/parties/${partyId}/displays`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating display:', error);
    return null;
  }
}

// Get display details
export async function getDisplay(
  partyId: string,
  displayId: string
): Promise<{ display: Display } | null> {
  try {
    return await apiRequest<{ display: Display }>(`/api/parties/${partyId}/displays/${displayId}`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching display:', error);
    return null;
  }
}

// Update display
export async function updateDisplay(
  partyId: string,
  displayId: string,
  data: UpdateDisplayData
): Promise<{ display: Display } | null> {
  try {
    return await apiRequest<{ display: Display }>(`/api/parties/${partyId}/displays/${displayId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating display:', error);
    return null;
  }
}

// Delete display
export async function deleteDisplay(partyId: string, displayId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/displays/${displayId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting display:', error);
    return false;
  }
}

// Get display for public viewer (no auth)
export async function getDisplayForViewer(
  partyId: string,
  slug: string,
  password?: string
): Promise<DisplayViewerData | null> {
  try {
    const params = password ? `?password=${encodeURIComponent(password)}` : '';
    return await apiRequest<DisplayViewerData>(`/api/display/view/${partyId}/${slug}${params}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching display for viewer:', error);
    return null;
  }
}

// Get photos for display (for live refresh)
export async function getDisplayPhotos(
  partyId: string,
  slug: string,
  since?: string
): Promise<{ photos: Photo[] } | null> {
  try {
    const params = since ? `?since=${encodeURIComponent(since)}` : '';
    return await apiRequest<{ photos: Photo[] }>(`/api/display/view/${partyId}/${slug}/photos${params}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching display photos:', error);
    return null;
  }
}

// Raffle API Functions

export async function getRaffles(partyId: string): Promise<{ raffles: Raffle[] } | null> {
  try {
    return await apiRequest<{ raffles: Raffle[] }>(`/api/parties/${partyId}/raffles`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching raffles:', error);
    return null;
  }
}

export async function getRaffle(partyId: string, raffleId: string): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles/${raffleId}`, {
      method: 'GET',
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error fetching raffle:', error);
    return null;
  }
}

export async function createRaffle(
  partyId: string,
  data: { name: string; description?: string; entriesPerGuest?: number }
): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating raffle:', error);
    return null;
  }
}

export async function updateRaffle(
  partyId: string,
  raffleId: string,
  data: { name?: string; description?: string; status?: string; entriesPerGuest?: number }
): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles/${raffleId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating raffle:', error);
    return null;
  }
}

export async function deleteRaffle(partyId: string, raffleId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/raffles/${raffleId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting raffle:', error);
    return false;
  }
}

export async function addRafflePrize(
  partyId: string,
  raffleId: string,
  data: { name: string; description?: string; imageUrl?: string; quantity?: number }
): Promise<{ prize: RafflePrize } | null> {
  try {
    return await apiRequest<{ prize: RafflePrize }>(`/api/parties/${partyId}/raffles/${raffleId}/prizes`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error adding prize:', error);
    return null;
  }
}

export async function updateRafflePrize(
  partyId: string,
  raffleId: string,
  prizeId: string,
  data: { name?: string; description?: string; imageUrl?: string; quantity?: number }
): Promise<{ prize: RafflePrize } | null> {
  try {
    return await apiRequest<{ prize: RafflePrize }>(`/api/parties/${partyId}/raffles/${raffleId}/prizes/${prizeId}`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating prize:', error);
    return null;
  }
}

export async function deleteRafflePrize(partyId: string, raffleId: string, prizeId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/raffles/${raffleId}/prizes/${prizeId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting prize:', error);
    return false;
  }
}

export async function enterRaffle(
  partyId: string,
  raffleId: string,
  guestId: string
): Promise<{ entry: RaffleEntry } | null> {
  try {
    return await apiRequest<{ entry: RaffleEntry }>(`/api/parties/${partyId}/raffles/${raffleId}/enter`, {
      method: 'POST',
      body: { guestId },
      requireAuth: false,
    });
  } catch (error) {
    console.error('Error entering raffle:', error);
    throw error;
  }
}

export async function drawRaffleWinners(partyId: string, raffleId: string): Promise<{ raffle: Raffle } | null> {
  try {
    return await apiRequest<{ raffle: Raffle }>(`/api/parties/${partyId}/raffles/${raffleId}/draw`, {
      method: 'POST',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error drawing winners:', error);
    throw error;
  }
}

export async function claimRafflePrize(
  partyId: string,
  raffleId: string,
  winnerId: string
): Promise<{ winner: RaffleWinner } | null> {
  try {
    return await apiRequest<{ winner: RaffleWinner }>(`/api/parties/${partyId}/raffles/${raffleId}/winners/${winnerId}/claim`, {
      method: 'POST',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error claiming prize:', error);
    return null;
  }
}

export async function unclaimRafflePrize(
  partyId: string,
  raffleId: string,
  winnerId: string
): Promise<{ winner: RaffleWinner } | null> {
  try {
    return await apiRequest<{ winner: RaffleWinner }>(`/api/parties/${partyId}/raffles/${raffleId}/winners/${winnerId}/claim`, {
      method: 'DELETE',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error unclaiming prize:', error);
    return null;
  }
}

// Budget API functions

// Get budget overview and items
export async function getBudget(partyId: string): Promise<BudgetOverview | null> {
  try {
    return await apiRequest<BudgetOverview>(`/api/parties/${partyId}/budget`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching budget:', error);
    return null;
  }
}

// Update budget settings
export async function updateBudgetSettings(
  partyId: string,
  data: { budgetEnabled?: boolean; budgetTotal?: number | null }
): Promise<{ budgetEnabled: boolean; budgetTotal: number | null } | null> {
  try {
    return await apiRequest<{ budgetEnabled: boolean; budgetTotal: number | null }>(
      `/api/parties/${partyId}/budget/settings`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating budget settings:', error);
    return null;
  }
}

// Create budget item
export interface CreateBudgetItemData {
  name: string;
  category: BudgetCategory;
  cost: number;
  status?: BudgetStatus;
  pointPerson?: string;
  notes?: string;
  receiptUrl?: string;
}

export async function createBudgetItem(
  partyId: string,
  data: CreateBudgetItemData
): Promise<{ item: BudgetItem } | null> {
  try {
    return await apiRequest<{ item: BudgetItem }>(`/api/parties/${partyId}/budget/items`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating budget item:', error);
    return null;
  }
}

// Update budget item
export async function updateBudgetItem(
  partyId: string,
  itemId: string,
  data: Partial<CreateBudgetItemData>
): Promise<{ item: BudgetItem } | null> {
  try {
    return await apiRequest<{ item: BudgetItem }>(
      `/api/parties/${partyId}/budget/items/${itemId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating budget item:', error);
    return null;
  }
}

// Delete budget item
export async function deleteBudgetItem(partyId: string, itemId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/budget/items/${itemId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting budget item:', error);
    return false;
  }
}

// Restore a soft-deleted budget item (super-admin only). provolone-58931.
export async function restoreBudgetItem(partyId: string, itemId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/budget/items/${itemId}/restore`, {
      method: 'POST',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error restoring budget item:', error);
    return false;
  }
}

// Toggle budget item status
export async function toggleBudgetItemStatus(
  partyId: string,
  itemId: string
): Promise<{ item: BudgetItem } | null> {
  try {
    return await apiRequest<{ item: BudgetItem }>(
      `/api/parties/${partyId}/budget/items/${itemId}/toggle-status`,
      {
        method: 'POST',
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error toggling budget item status:', error);
    return null;
  }
}

// Party Kit API functions

export interface KitRequestData {
  requestedTier?: KitTier;
  recipientName: string;
  addressLine1: string;
  addressLine2?: string;
  city: string;
  state?: string;
  postalCode: string;
  country?: string;
  phone?: string;
  notes?: string;
}

export interface KitResponse {
  kitEnabled: boolean;
  kitDeadline: string | null;
  kit: PartyKit | null;
}

// Get kit request for a party
export async function getPartyKit(partyId: string): Promise<KitResponse | null> {
  try {
    return await apiRequest<KitResponse>(`/api/parties/${partyId}/kit`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching kit:', error);
    return null;
  }
}

// Submit a kit request
export async function submitKitRequest(
  partyId: string,
  data: KitRequestData
): Promise<{ kit: PartyKit } | null> {
  try {
    return await apiRequest<{ kit: PartyKit }>(`/api/parties/${partyId}/kit`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error submitting kit request:', error);
    throw error;
  }
}

// Update a kit request
export async function updateKitRequest(
  partyId: string,
  data: Partial<KitRequestData>
): Promise<{ kit: PartyKit } | null> {
  try {
    return await apiRequest<{ kit: PartyKit }>(`/api/parties/${partyId}/kit`, {
      method: 'PATCH',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error updating kit request:', error);
    throw error;
  }
}

// Cancel a kit request
export async function cancelKitRequest(partyId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/kit`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error canceling kit request:', error);
    return false;
  }
}

// Checklist API functions

// Get checklist items + auto-complete states
export async function getChecklist(partyId: string): Promise<ChecklistData | null> {
  try {
    return await apiRequest<ChecklistData>(`/api/parties/${partyId}/checklist`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching checklist:', error);
    return null;
  }
}

// Seed default GPP checklist items (idempotent)
export async function seedChecklist(partyId: string): Promise<{ items: ChecklistItem[]; seeded: boolean } | null> {
  try {
    return await apiRequest<{ items: ChecklistItem[]; seeded: boolean }>(`/api/parties/${partyId}/checklist/seed`, {
      method: 'POST',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error seeding checklist:', error);
    return null;
  }
}

// Create a custom checklist item
export async function createChecklistItem(
  partyId: string,
  data: { name: string; dueDate?: string | null }
): Promise<{ item: ChecklistItem } | null> {
  try {
    return await apiRequest<{ item: ChecklistItem }>(`/api/parties/${partyId}/checklist/items`, {
      method: 'POST',
      body: data,
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error creating checklist item:', error);
    return null;
  }
}

// Update a checklist item
export async function updateChecklistItem(
  partyId: string,
  itemId: string,
  data: { name?: string; dueDate?: string | null; sortOrder?: number }
): Promise<{ item: ChecklistItem } | null> {
  try {
    return await apiRequest<{ item: ChecklistItem }>(
      `/api/parties/${partyId}/checklist/items/${itemId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error updating checklist item:', error);
    return null;
  }
}

// Delete a custom checklist item
export async function deleteChecklistItem(partyId: string, itemId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(`/api/parties/${partyId}/checklist/items/${itemId}`, {
      method: 'DELETE',
      requireAuth: true,
    });
    return true;
  } catch (error) {
    console.error('Error deleting checklist item:', error);
    return false;
  }
}

// Toggle manual completion of a checklist item
export async function toggleChecklistItem(
  partyId: string,
  itemId: string
): Promise<{ item: ChecklistItem } | null> {
  try {
    return await apiRequest<{ item: ChecklistItem }>(
      `/api/parties/${partyId}/checklist/items/${itemId}/toggle`,
      {
        method: 'POST',
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error toggling checklist item:', error);
    return null;
  }
}

// Underboss Dashboard API

// Admin Management API

export async function fetchAdminMe(): Promise<{ isAdmin: boolean; role?: string; email?: string; name?: string; id?: string }> {
  return apiRequest('/api/admin/me');
}

export async function fetchAdminList(): Promise<AdminUser[]> {
  const result = await apiRequest<{ admins: AdminUser[] }>('/api/admin/list');
  return result.admins;
}

export async function addAdmin(data: { email: string; name?: string; role?: string }): Promise<AdminUser> {
  const result = await apiRequest<{ admin: AdminUser }>('/api/admin/add', {
    method: 'POST',
    body: data,
  });
  return result.admin;
}

export async function removeAdmin(id: string): Promise<void> {
  await apiRequest(`/api/admin/${id}`, { method: 'DELETE' });
}

// fontina-91827: admin-only lookup for a party's current owner email + name.
// Used by TransferOwnershipModal so the admin UI can render "Currently owned
// by X (email)" without depending on the host-gated cohosts/full endpoint.
export async function fetchPartyOwner(partyId: string): Promise<{
  partyId: string;
  ownerId: string | null;
  ownerEmail: string | null;
  ownerName: string | null;
}> {
  return apiRequest(`/api/admin/parties/${partyId}/owner`);
}

// fontina-91827: admin-only event ownership transfer. Atomically updates
// parties.user_id, removes the old owner from co_hosts, deletes their
// party_payment_opt_ins row, and canonicalizes the new owner with
// canEdit:true + showOnEvent:true in the cohost array.
export async function transferEventOwnership(
  partyId: string,
  body: {
    newOwnerEmail: string;
    removeOldFromCoHosts?: boolean;
    deleteOldOptIn?: boolean;
    note?: string;
  },
): Promise<{ ok: true; partyId: string; newOwnerId: string; newOwnerEmail: string }> {
  return apiRequest(`/api/admin/parties/${partyId}/transfer-ownership`, {
    method: 'POST',
    body,
  });
}

// Underboss Admin API (management)

export async function fetchUnderbossList(): Promise<UnderbossAdmin[]> {
  const result = await apiRequest<{ underbosses: UnderbossAdmin[] }>('/api/underboss/admin/list');
  return result.underbosses;
}

export async function createUnderboss(data: { name: string; email: string; regions: string[]; cities?: string[]; notes?: string }): Promise<{ underboss: UnderbossAdmin }> {
  return apiRequest('/api/underboss/admin/create', {
    method: 'POST',
    body: data,
  });
}

export async function updateUnderboss(id: string, data: { regions?: string[]; cities?: string[] }): Promise<UnderbossAdmin> {
  const result = await apiRequest<{ underboss: UnderbossAdmin }>(`/api/underboss/admin/${id}`, {
    method: 'PATCH',
    body: data,
  });
  return result.underboss;
}

export async function deactivateUnderboss(id: string): Promise<void> {
  await apiRequest(`/api/underboss/admin/${id}`, { method: 'DELETE' });
}

// GPP NFT Settings
export async function fetchGppNftSettings(): Promise<{ nftEnabled: boolean; nftChain: string }> {
  return apiRequest<{ nftEnabled: boolean; nftChain: string }>('/api/admin/gpp-nft');
}

export async function updateGppNftSettings(data: { nftEnabled: boolean; nftChain?: string }): Promise<{ updatedCount: number }> {
  return apiRequest<{ updatedCount: number }>('/api/admin/gpp-nft', {
    method: 'PATCH',
    body: data,
  });
}

// GPP Checklist Defaults
export interface ChecklistDefault {
  name: string;
  dueDate: string | null;
  sortOrder: number;
  isAuto: boolean;
  autoRule: string | null;
  linkTab: string | null;
}

export async function fetchChecklistDefaults(): Promise<{ items: ChecklistDefault[] }> {
  return apiRequest<{ items: ChecklistDefault[] }>('/api/admin/checklist-defaults');
}

export async function updateChecklistDefaults(items: Array<{ name: string; dueDate?: string | null; sortOrder?: number; newName?: string; linkTab?: string | null }>): Promise<{ totalUpdated: number }> {
  return apiRequest<{ totalUpdated: number }>('/api/admin/checklist-defaults', {
    method: 'PATCH',
    body: { items },
  });
}

export async function addChecklistDefault(data: { name: string; dueDate?: string | null; linkTab?: string | null }): Promise<{ createdCount: number }> {
  return apiRequest<{ createdCount: number }>('/api/admin/checklist-defaults', {
    method: 'POST',
    body: data,
  });
}

export async function deleteChecklistDefault(name: string): Promise<{ success: boolean; totalDeleted: number }> {
  return apiRequest<{ success: boolean; totalDeleted: number }>(`/api/admin/checklist-defaults/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
}

// Underboss Dashboard API

// Fetch current user's underboss status
export interface UnderbossMeResponse {
  isAdmin: boolean;
  isUnderboss: boolean;
  isGraphicsAdmin?: boolean;
  region: string | null;
  regions: string[];
  cities?: string[];
  name: string | null;
  email: string;
}

export async function fetchUnderbossMe(): Promise<UnderbossMeResponse> {
  return apiRequest<UnderbossMeResponse>('/api/underboss/me');
}

// Fetch underboss dashboard data (JWT auth)
export async function fetchUnderbossDashboard(
  region: GPPRegion | 'all'
): Promise<UnderbossDashboardData> {
  return apiRequest<UnderbossDashboardData>(`/api/underboss/${region}`);
}

// Fetch fake-event detection review queue (blackolive-74932)
export async function fetchFakeDetection(): Promise<FakeDetectionResponse> {
  return apiRequest<FakeDetectionResponse>('/api/underboss/fake-detection');
}

// Update host status on an event (underboss auth)
export async function updateHostStatus(
  partyId: string,
  hostStatus: 'new' | 'alum' | 'pro' | null
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/host-status`, {
    method: 'PATCH',
    body: { hostStatus },
  });
}

// Update underboss status on an event (underboss auth)
export async function updateUnderbossStatus(
  partyId: string,
  status: 'pending' | 'approved' | 'rejected' | 'listed' | 'hidden'
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/status`, {
    method: 'PATCH',
    body: { status },
  });
}

// Update host tags on an event (underboss auth)
export async function updateHostTags(
  partyId: string,
  tags: string[]
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/tags`, {
    method: 'PATCH',
    body: { tags },
  });
}

// Update underboss notes on an event (underboss auth)
export async function updateUnderbossNotes(
  partyId: string,
  notes: string | null
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/notes`, {
    method: 'PATCH',
    body: { notes },
  });
}

// Update expected guests on an event (underboss auth)
export async function updateExpectedGuests(
  partyId: string,
  expectedGuests: number | null
): Promise<void> {
  await apiRequest(`/api/underboss/event/${partyId}/expected-guests`, {
    method: 'PATCH',
    body: { expectedGuests },
  });
}

// Bulk update underboss status (underboss auth)
export async function bulkUpdateUnderbossStatus(partyIds: string[], status: 'pending' | 'approved' | 'rejected'): Promise<void> {
  await apiRequest('/api/underboss/events/bulk-status', {
    method: 'PATCH',
    body: { partyIds, status },
  });
}

// Bulk soft-cancel events (underboss auth). ziti-58475: this no longer hard-deletes;
// it sets cancelledAt/cancelledBy server-side, so the rows, their children (guests,
// sponsors, RSVPs) and public URLs are preserved and the events can be reinstated.
// Name + endpoint kept unchanged to avoid churn at call sites.
export async function bulkDeleteEvents(partyIds: string[]): Promise<void> {
  await apiRequest('/api/underboss/events/bulk-delete', {
    method: 'DELETE',
    body: { partyIds },
  });
}

// Bulk update event tags (underboss auth)
export async function bulkUpdateEventTags(
  partyIds: string[],
  tags: string[],
  action: 'add' | 'remove' | 'set'
): Promise<void> {
  await apiRequest('/api/underboss/events/bulk-event-tags', {
    method: 'PATCH',
    body: { partyIds, tags, action },
  });
}

// City Status API (Underboss)

export interface CityStatusMap {
  [cityKey: string]: { status: string; priority: boolean; notes: string | null; updatedBy: string | null; updatedAt: string };
}

export async function fetchCityStatuses(): Promise<CityStatusMap> {
  return apiRequest<CityStatusMap>('/api/underboss/city-statuses');
}

export async function updateCityStatus(
  cityKey: string,
  patch: { status?: 'created' | 'skip' | 'todo'; priority?: boolean }
): Promise<void> {
  await apiRequest('/api/underboss/city-statuses', {
    method: 'PATCH',
    body: { cityKey, ...patch },
  });
}

export async function updateCityNotes(cityKey: string, notes: string | null): Promise<void> {
  await apiRequest('/api/underboss/city-statuses', {
    method: 'PATCH',
    body: { cityKey, notes },
  });
}

// Shipping Dashboard API

// Fetch current user's shipping role
export async function fetchShippingMe(): Promise<ShippingMeResponse> {
  return apiRequest<ShippingMeResponse>('/api/shipping/me');
}

// Fetch shipping kit stats
export async function fetchShippingStats(): Promise<{ stats: ShippingKitStats }> {
  return apiRequest<{ stats: ShippingKitStats }>('/api/shipping/stats');
}

// Fetch shipping kits with filters
export interface ShippingKitFilters {
  status?: string;
  tier?: string;
  country?: string;
  region?: string;
  search?: string;
  sort?: string;
}

export async function fetchShippingKits(filters?: ShippingKitFilters): Promise<{ kits: ShippingKit[] }> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
  }
  const qs = params.toString();
  return apiRequest<{ kits: ShippingKit[] }>(`/api/shipping/kits${qs ? `?${qs}` : ''}`);
}

// Update a single shipping kit
export async function updateShippingKit(kitId: string, data: {
  status?: string;
  allocatedTier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  adminNotes?: string;
}): Promise<{ kit: ShippingKit }> {
  return apiRequest<{ kit: ShippingKit }>(`/api/shipping/kits/${kitId}`, {
    method: 'PATCH',
    body: data,
  });
}

// Bulk update shipping kits
export async function bulkUpdateShippingKits(kitIds: string[], updates: {
  status?: string;
  allocatedTier?: string;
  trackingNumber?: string;
  trackingUrl?: string;
  adminNotes?: string;
}): Promise<{ updated: number }> {
  return apiRequest<{ updated: number }>('/api/shipping/kits/bulk-update', {
    method: 'PATCH',
    body: { kitIds, updates },
  });
}

// Import tracking numbers in bulk from CSV
export async function importShippingTracking(items: { kitId: string; trackingNumber?: string; trackingUrl?: string }[]): Promise<{ updated: number; skipped: number; notFound: string[] }> {
  return apiRequest<{ updated: number; skipped: number; notFound: string[] }>('/api/shipping/kits/import-tracking', {
    method: 'POST',
    body: { items },
  });
}

// Export shipping kits CSV
export async function exportShippingKitsCsv(filters?: ShippingKitFilters): Promise<Blob> {
  const params = new URLSearchParams();
  if (filters) {
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.append(key, value);
    });
  }
  const qs = params.toString();
  const API_URL = (import.meta.env.VITE_API_URL || 'http://localhost:3006').trim();
  const token = localStorage.getItem('authToken');
  const response = await fetch(`${API_URL}/api/shipping/kits/export${qs ? `?${qs}` : ''}`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  if (!response.ok) {
    throw new Error('Failed to export CSV');
  }
  return response.blob();
}

// salumi-89172: shipping coordinator's own shipping-purpose payouts (uploaded
// receipts for postage / packing / supplies they paid out of pocket).
export async function fetchMyShippingPayouts(): Promise<import('../types').ShippingPayout[]> {
  const res = await apiRequest<{ payouts: import('../types').ShippingPayout[] }>(
    '/api/shipping/my-payouts',
    { requireAuth: true },
  );
  return res.payouts;
}

// Coordinator management (admin only)
export async function fetchShippingCoordinators(): Promise<{ coordinators: ShippingCoordinator[] }> {
  return apiRequest<{ coordinators: ShippingCoordinator[] }>('/api/shipping/admin/coordinators');
}

export async function createShippingCoordinator(data: { name: string; email: string; regions: string[]; notes?: string }): Promise<{ coordinator: ShippingCoordinator }> {
  return apiRequest<{ coordinator: ShippingCoordinator }>('/api/shipping/admin/coordinators', {
    method: 'POST',
    body: data,
  });
}

export async function updateShippingCoordinator(id: string, data: { name?: string; email?: string; regions?: string[]; notes?: string; isActive?: boolean }): Promise<{ coordinator: ShippingCoordinator }> {
  return apiRequest<{ coordinator: ShippingCoordinator }>(`/api/shipping/admin/coordinators/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deactivateShippingCoordinator(id: string): Promise<void> {
  await apiRequest(`/api/shipping/admin/coordinators/${id}`, { method: 'DELETE' });
}

// Venue Photo API functions

// Create venue photo record
export async function createVenuePhoto(
  partyId: string,
  venueId: string,
  data: {
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    width?: number;
    height?: number;
    caption?: string;
    category?: VenuePhotoCategory;
  }
): Promise<VenuePhoto | null> {
  try {
    const response = await apiRequest<{ photo: VenuePhoto }>(
      `/api/parties/${partyId}/venues/${venueId}/photos`,
      {
        method: 'POST',
        body: data,
        requireAuth: true,
      }
    );
    return response.photo;
  } catch (error) {
    console.error('Error creating venue photo:', error);
    throw error;
  }
}

// List venue photos
export async function getVenuePhotos(
  partyId: string,
  venueId: string
): Promise<VenuePhoto[]> {
  try {
    const response = await apiRequest<{ photos: VenuePhoto[] }>(
      `/api/parties/${partyId}/venues/${venueId}/photos`,
      {
        method: 'GET',
        requireAuth: true,
      }
    );
    return response.photos;
  } catch (error) {
    console.error('Error fetching venue photos:', error);
    return [];
  }
}

// Update venue photo
export async function updateVenuePhoto(
  partyId: string,
  venueId: string,
  photoId: string,
  data: { caption?: string; category?: VenuePhotoCategory; sortOrder?: number }
): Promise<VenuePhoto | null> {
  try {
    const response = await apiRequest<{ photo: VenuePhoto }>(
      `/api/parties/${partyId}/venues/${venueId}/photos/${photoId}`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
    return response.photo;
  } catch (error) {
    console.error('Error updating venue photo:', error);
    throw error;
  }
}

// Delete venue photo
export async function deleteVenuePhoto(
  partyId: string,
  venueId: string,
  photoId: string
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/venues/${venueId}/photos/${photoId}`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error deleting venue photo:', error);
    return false;
  }
}

// Venue Report API functions

// Get venue report data (host only)
export async function getVenueReport(partyId: string): Promise<VenueReport | null> {
  try {
    const response = await apiRequest<{ venueReport: VenueReport }>(
      `/api/parties/${partyId}/venue-report`,
      {
        method: 'GET',
        requireAuth: true,
      }
    );
    return response.venueReport;
  } catch (error) {
    console.error('Error fetching venue report:', error);
    return null;
  }
}

// Update venue report title/notes
export async function updateVenueReport(
  partyId: string,
  data: { title?: string | null; notes?: string | null }
): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/venue-report`,
      {
        method: 'PATCH',
        body: data,
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error updating venue report:', error);
    return false;
  }
}

// Publish venue report
export async function publishVenueReport(
  partyId: string,
  password?: string
): Promise<{ venueReportSlug: string; publicUrl: string } | null> {
  try {
    return await apiRequest<{ success: boolean; venueReportSlug: string; publicUrl: string }>(
      `/api/parties/${partyId}/venue-report/publish`,
      {
        method: 'POST',
        body: password ? { password } : undefined,
        requireAuth: true,
      }
    );
  } catch (error) {
    console.error('Error publishing venue report:', error);
    return null;
  }
}

// Unpublish venue report
export async function unpublishVenueReport(partyId: string): Promise<boolean> {
  try {
    await apiRequest<{ success: boolean }>(
      `/api/parties/${partyId}/venue-report/publish`,
      {
        method: 'DELETE',
        requireAuth: true,
      }
    );
    return true;
  } catch (error) {
    console.error('Error unpublishing venue report:', error);
    return false;
  }
}

// Check if published venue report requires password (public)
export async function checkVenueReportPassword(
  slug: string
): Promise<{ requiresPassword: boolean; name: string; title: string | null } | null> {
  try {
    return await apiRequest<{ requiresPassword: boolean; name: string; title: string | null }>(
      `/api/reports/public/${slug}/venue/check`,
      { method: 'GET', requireAuth: false }
    );
  } catch {
    return null;
  }
}

// Fetch published venue report (public, with optional password)
export async function fetchPublicVenueReport(
  slug: string,
  password?: string
): Promise<{ venueReport: VenueReport } | null> {
  try {
    const params = password ? `?password=${encodeURIComponent(password)}` : '';
    return await apiRequest<{ venueReport: VenueReport }>(
      `/api/reports/public/${slug}/venue${params}`,
      {
        method: 'GET',
        requireAuth: false,
      }
    );
  } catch (error) {
    console.error('Error fetching public venue report:', error);
    return null;
  }
}

// Telegram broadcast API functions

export interface BroadcastGroup {
  chatId: string;
  city: string;
  country: string;
}

export interface BroadcastResult {
  chatId: string;
  city: string;
  success: boolean;
  error?: string;
  // pesto-58496: false when a USED {link}/{appLink} token resolved to empty for
  // this recipient (message sent without the link). Older prod backends omit
  // this field entirely — undefined must NOT be treated as a warning.
  linkResolved?: boolean;
}

export interface BroadcastResponse {
  results: BroadcastResult[];
  sent: number;
  failed: number;
  // guanciale-58491: how many not-connected hosts got the message via email
  // fallback (present on host-broadcast responses only).
  emailed?: number;
  // guanciale-58491: true when a broadcastId matched an existing log row and the
  // send was short-circuited (double-send guard).
  duplicate?: boolean;
}

// guanciale-58491: host-DM coverage report over the in-scope GPP audience.
export interface HostCoverageUnlinked {
  partyId: string;
  city: string;
  hostName: string | null;
  hostEmail: string | null;
  hostTelegram: string | null;
}

export interface HostCoverageResponse {
  total: number;
  linked: number;
  unlinked: number;
  hasHandleNoChat: number;
  noHandleNoChat: number;
  unlinkedHosts: HostCoverageUnlinked[];
}

// guanciale-58491: a linked host in the in-scope audience (for "All hosts").
export interface HostAudienceRow {
  partyId: string;
  city: string;
  hostName: string | null;
  hostTelegram: string | null;
  connected: boolean;
}

export async function fetchHostCoverage(): Promise<HostCoverageResponse> {
  return apiRequest<HostCoverageResponse>('/api/underboss/telegram/host-coverage', {
    method: 'GET',
  });
}

export async function inviteUnlinkedHosts(): Promise<{
  emailed: number;
  skipped: number;
  noEmail: number;
}> {
  return apiRequest('/api/underboss/telegram/invite-unlinked', { method: 'POST' });
}

export async function fetchHostAudience(): Promise<HostAudienceRow[]> {
  const res = await apiRequest<{ hosts: HostAudienceRow[] }>(
    '/api/underboss/telegram/host-audience',
    { method: 'GET' },
  );
  return res.hosts;
}

export async function sendTelegramBroadcast(
  groups: BroadcastGroup[],
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None',
  // parmigiano-58493: chosen app tab for the {appLink} token (null = none).
  appTab: string | null = null
): Promise<BroadcastResponse> {
  return apiRequest<BroadcastResponse>('/api/underboss/telegram/broadcast', {
    method: 'POST',
    body: { groups, message, parseMode, appTab },
  });
}

export async function sendTelegramTest(
  chatId: string,
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None'
): Promise<BroadcastResult> {
  return apiRequest<BroadcastResult>('/api/underboss/telegram/test', {
    method: 'POST',
    body: { chatId, message, parseMode },
  });
}

// Host Telegram (bot-DM) API functions — backed by sausage-24183 backend routes.

export interface BroadcastHost {
  partyId: string;
  city: string;
  hostName: string;
}

export async function sendHostTelegramBroadcast(
  hosts: BroadcastHost[],
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None',
  // parmigiano-58493: chosen app tab for the {appLink} token (null = none).
  appTab: string | null = null,
  // guanciale-58491: client-minted UUID double-send guard (null = none).
  broadcastId: string | null = null
): Promise<BroadcastResponse> {
  return apiRequest<BroadcastResponse>('/api/underboss/telegram/host-broadcast', {
    method: 'POST',
    body: { hosts, message, parseMode, appTab, broadcastId },
  });
}

export async function sendHostTelegramTest(
  partyId: string,
  message: string,
  parseMode: 'HTML' | 'Markdown' | 'None' = 'None'
): Promise<BroadcastResult> {
  return apiRequest<BroadcastResult>('/api/underboss/telegram/host-test', {
    method: 'POST',
    body: { partyId, message, parseMode },
  });
}

export async function mintHostTelegramConnectToken(
  partyId: string
): Promise<{ token: string; deeplink: string }> {
  return apiRequest<{ token: string; deeplink: string }>(`/api/parties/${partyId}/connect-token`, {
    method: 'POST',
  });
}

export async function disconnectHostTelegram(
  partyId: string
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/parties/${partyId}/host-telegram`, {
    method: 'DELETE',
  });
}

// Sponsor Dashboard API

export async function fetchSponsorMe(): Promise<SponsorMeResponse> {
  return apiRequest<SponsorMeResponse>('/api/sponsor/me');
}

export async function fetchSponsorEvents(tag?: string): Promise<SponsorDashboardData> {
  const params = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return apiRequest<SponsorDashboardData>(`/api/sponsor/events${params}`);
}

// pecorino-64118: consolidated cross-event partner report (private, full rollup).
// pecorino-64118 follow-up: optional admin-only `approvedOnly` opt-in filter
// (non-admins are server-scoped to approved-only regardless).
export async function fetchSponsorConsolidatedReport(
  tag?: string,
  approvedOnly?: boolean
): Promise<ConsolidatedReport> {
  const parts: string[] = [];
  if (tag) parts.push(`tag=${encodeURIComponent(tag)}`);
  if (approvedOnly) parts.push('approvedOnly=1');
  const params = parts.length > 0 ? `?${parts.join('&')}` : '';
  return apiRequest<ConsolidatedReport>(`/api/sponsor/report${params}`);
}

// scamorza-71819: AI-share token management for the partner consolidated report.
// The token is a long-lived bearer that powers the public read-only
// `/api/sponsor/report/ai/:token` endpoint pasted into LLM assistants.
export interface PartnerAiShareTokenResponse {
  token: string | null;
  url: string | null;
  tag: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}

export async function getPartnerAiShareToken(
  tag?: string
): Promise<PartnerAiShareTokenResponse> {
  const params = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return apiRequest<PartnerAiShareTokenResponse>(`/api/sponsor/ai-share-token${params}`);
}

export async function createPartnerAiShareToken(
  tag?: string
): Promise<PartnerAiShareTokenResponse> {
  const params = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return apiRequest<PartnerAiShareTokenResponse>(`/api/sponsor/ai-share-token${params}`, {
    method: 'POST',
  });
}

export async function revokePartnerAiShareToken(
  tag?: string
): Promise<{ success: boolean }> {
  const params = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return apiRequest<{ success: boolean }>(`/api/sponsor/ai-share-token${params}`, {
    method: 'DELETE',
  });
}

// soppressata-72251: per-partner BizDev industry report (companies-only, no PII).
// Lives behind GET /api/bizdev?partner={tag}. Auth: admin / underboss / own-tag
// sponsor (server-authoritative). Uses a bespoke fetch (not apiRequest) so the
// page can branch on the HTTP status — 401/403/404 each render a distinct state,
// and a 401 here must NOT clear the auth token (apiRequest does that on 401).
export interface BizdevCompany {
  company: string;
  rsvpCount: number;
  eventCount: number;
  confidence: 'high' | 'medium';
}

export interface BizdevBucket {
  bucketId: string;
  label: string;
  companies: BizdevCompany[];
}

export interface BizdevReport {
  tag: string;
  label: string;
  blurb: string;
  scope: 'approved-gpp';
  coverage: {
    events: number;
    totalEmails: number;
    matched: number;
    personal: number;
    internal: number;
    distinctCompanies: number;
  };
  featured: BizdevBucket[];
  other: BizdevBucket[];
}

export class BizdevReportError extends Error {
  status: number;
  code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'BizdevReportError';
    this.status = status;
    this.code = code;
  }
}

export async function fetchBizdevReport(partner: string): Promise<BizdevReport> {
  const token = getAuthToken();
  const res = await fetch(
    `${API_URL}/api/bizdev?partner=${encodeURIComponent(partner)}`,
    { headers: token ? { Authorization: `Bearer ${token}` } : {} }
  );
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message = body?.error?.message || body?.message || `Request failed (${res.status})`;
    const code = body?.error?.code || body?.code;
    throw new BizdevReportError(res.status, message, code);
  }
  return res.json();
}

// pecorino-64118 follow-up: download list of guest emails opted into a partner's
// newsletter (ethconf + SWC family). Errors with 400 NO_NEWSLETTER for tags
// without a newsletter (e.g. pizzadao).
export async function fetchPartnerNewsletterEmails(
  tag?: string
): Promise<{
  rows: { email: string; name: string; city: string }[];
  emails: string[];
  count: number;
  tag: string;
  optinField: string;
}> {
  const params = tag ? `?tag=${encodeURIComponent(tag)}` : '';
  return apiRequest<{
    rows: { email: string; name: string; city: string }[];
    emails: string[];
    count: number;
    tag: string;
    optinField: string;
  }>(`/api/sponsor/newsletter-emails${params}`);
}

// Admin-only time-series for partner dashboard chart
export type PartnerTimeSeriesRange = '6hr' | '24hr' | '3d' | '7d';

export interface PartnerTimeSeriesPoint {
  timestamp: string;
  rsvps: number;
  impressions: number;
  clicks: number;
}

export interface PartnerTimeSeriesResponse {
  range: PartnerTimeSeriesRange;
  bucket: 'hour';
  since: string;
  points: PartnerTimeSeriesPoint[];
}

export async function fetchSponsorEventsTimeSeries(
  range: PartnerTimeSeriesRange = '24hr',
  tag?: string
): Promise<PartnerTimeSeriesResponse> {
  const params = new URLSearchParams();
  params.set('range', range);
  if (tag) params.set('tag', tag);
  return apiRequest<PartnerTimeSeriesResponse>(`/api/sponsor/events/timeseries?${params.toString()}`);
}

export async function toggleSponsorChecklistItem(itemId: string): Promise<{ item: SponsorChecklistItem }> {
  return apiRequest<{ item: SponsorChecklistItem }>(`/api/sponsor/checklist/${itemId}/toggle`, {
    method: 'POST',
  });
}

export async function updatePartnerEventNote(partyId: string, notes: string): Promise<{ success: boolean; notes: string }> {
  return apiRequest<{ success: boolean; notes: string }>('/api/sponsor/notes', {
    method: 'PUT',
    body: { partyId, notes },
  });
}

// Sponsor User Admin API

export async function fetchSponsorUsers(): Promise<{ sponsorUsers: SponsorUser[]; tagCounts: Record<string, number> }> {
  return apiRequest<{ sponsorUsers: SponsorUser[]; tagCounts: Record<string, number> }>('/api/sponsor-users/list');
}

export interface SponsorUserCreateData {
  email: string;
  tag: string;
  name?: string;
  notes?: string;
  coHostName?: string;
  coHostWebsite?: string;
  coHostTwitter?: string;
  coHostInstagram?: string;
  coHostAvatarUrl?: string;
  coHostLogoUrl?: string;
  autoCoHost?: boolean;
  autoSponsor?: boolean;
  coHostShowOnEvent?: boolean;
  coHostCanEdit?: boolean;
  coHostAllowedTabs?: string[] | null;
  category?: string;
  brandDescription?: string;
}

export async function createSponsorUser(data: SponsorUserCreateData): Promise<{ sponsorUser: SponsorUser; syncedCount: number }> {
  return apiRequest<{ sponsorUser: SponsorUser; syncedCount: number }>('/api/sponsor-users', {
    method: 'POST',
    body: data,
  });
}

export interface SponsorUserUpdateData {
  email?: string;
  name?: string;
  tag?: string;
  notes?: string;
  isActive?: boolean;
  coHostName?: string;
  coHostWebsite?: string;
  coHostTwitter?: string;
  coHostInstagram?: string;
  coHostAvatarUrl?: string;
  coHostLogoUrl?: string;
  autoCoHost?: boolean;
  autoSponsor?: boolean;
  coHostShowOnEvent?: boolean;
  coHostCanEdit?: boolean;
  coHostAllowedTabs?: string[] | null;
  category?: string;
  brandDescription?: string;
}

export async function updateSponsorUser(id: string, data: SponsorUserUpdateData): Promise<{ sponsorUser: SponsorUser; syncedCount: number }> {
  return apiRequest<{ sponsorUser: SponsorUser; syncedCount: number }>(`/api/sponsor-users/${id}`, {
    method: 'PATCH',
    body: data,
  });
}

export async function deleteSponsorUser(id: string): Promise<void> {
  await apiRequest(`/api/sponsor-users/${id}`, { method: 'DELETE' });
}

// Reorder sponsor users (admin) — updates descriptionSortOrder based on array position
export async function reorderSponsorUsers(sponsorUserIds: string[]): Promise<void> {
  await apiRequest('/api/sponsor-users/reorder', {
    method: 'PATCH',
    body: { sponsorUserIds },
  });
}

// User Sponsorship Profile

export interface UserSponsorshipEntry {
  id: string;
  brandName: string;
  brandLogo: string | null;
  brandDescription: string | null;
  brandInstagram: string | null;
  sponsorshipType: string | null;
  amount: number | null;
  status: string;
  intakeSubmittedAt: string;
  party: {
    id: string;
    name: string;
    customUrl: string | null;
    date: string | null;
    eventImageUrl: string | null;
  };
}

export async function getUserSponsorships(): Promise<UserSponsorshipEntry[]> {
  return apiRequest<UserSponsorshipEntry[]>('/api/user/sponsorships');
}

// GPP Default Description Admin API

export interface GppDescriptionData {
  defaultDescription: string;
  totalGppEvents: number;
  defaultCount: number;
  customizedEvents: Array<{
    id: string;
    name: string;
    customUrl: string | null;
    inviteCode: string;
    descriptionPreview: string;
  }>;
}

export async function fetchGppDescription(): Promise<GppDescriptionData> {
  return apiRequest<GppDescriptionData>('/api/admin/gpp-description');
}

export async function updateGppDescription(description: string): Promise<{
  success: boolean;
  updatedCount: number;
  skippedCount: number;
  newDefault: string;
}> {
  return apiRequest('/api/admin/gpp-description', {
    method: 'PATCH',
    body: { description },
  });
}

// Social Post Recap Copy (grissini-58481)

export async function fetchSocialPostConfig(): Promise<{ template: string; adjectives: string[] }> {
  return apiRequest<{ template: string; adjectives: string[] }>('/api/config/social-post');
}

export async function updateSocialPostConfig(body: {
  template: string;
  adjectives: string[];
}): Promise<{ success: boolean; config: { template: string; adjectives: string[] } }> {
  return apiRequest('/api/admin/social-post', {
    method: 'PATCH',
    body,
  });
}

// ── QR Peer Attestation Check-In ──

export interface VouchResponse {
  success: boolean;
  alreadyCheckedIn?: boolean;
  guest?: {
    id: string;
    name: string;
    checkedInAt: string;
  };
  message?: string;
  attestations?: Attestation[];
}

/** Host/co-host self-check-in (bootstraps the chain of trust) */
export async function hostSelfCheckIn(inviteCode: string): Promise<VouchResponse> {
  return apiRequest<VouchResponse>(`/api/checkin/${inviteCode}/self-host`, {
    method: 'POST',
  });
}

/** Vouch for another guest — caller must already be checked in */
export async function vouchForGuest(inviteCode: string, targetGuestId: string): Promise<VouchResponse> {
  return apiRequest<VouchResponse>(`/api/checkin/${inviteCode}/vouch`, {
    method: 'POST',
    body: { targetGuestId },
  });
}

// ── Post-Event Discount Claim ──

export interface DiscountStatusResponse {
  guestName: string;
  isCheckedIn: boolean;
  hasEnded: boolean;
  discountClaimedAt: string | null;
}

export interface DiscountClaimResponse {
  success: boolean;
  alreadyClaimed: boolean;
  claimedAt: string;
}

/** Get discount eligibility status for a guest (no auth required) */
export async function getDiscountStatus(inviteCode: string, guestId: string): Promise<DiscountStatusResponse> {
  return apiRequest<DiscountStatusResponse>(`/api/checkin/${inviteCode}/${guestId}/discount`, {
    requireAuth: false,
  });
}

/** Claim post-event discount for a checked-in guest (no auth required) */
export async function claimDiscount(inviteCode: string, guestId: string): Promise<DiscountClaimResponse> {
  return apiRequest<DiscountClaimResponse>(`/api/checkin/${inviteCode}/${guestId}/discount`, {
    method: 'POST',
    requireAuth: false,
  });
}

// ── Graphics Admin Management ──

export async function fetchGraphicsAdminList(): Promise<GraphicsAdmin[]> {
  const data = await apiRequest<{ admins: GraphicsAdmin[] }>('/api/graphics-admin/list');
  return data.admins;
}

export async function addGraphicsAdmin(data: { email: string; name?: string }): Promise<GraphicsAdmin> {
  const result = await apiRequest<{ admin: GraphicsAdmin }>('/api/graphics-admin/add', {
    method: 'POST',
    body: data,
  });
  return result.admin;
}

export async function removeGraphicsAdmin(id: string): Promise<void> {
  await apiRequest(`/api/graphics-admin/${id}`, { method: 'DELETE' });
}

// GPP Pizzerias Map
export interface GPPPizzeriaMapItem {
  id: string;
  name: string;
  address: string;
  url?: string;
  rating?: number;
  reviewCount?: number;
  description?: string;
  photoUrl?: string;
  placeId?: string;
  location: { lat: number; lng: number };
  eventCity: string;
  eventSlug: string;
  eventId: string;
}

export async function fetchGppPizzerias(): Promise<GPPPizzeriaMapItem[]> {
  return apiRequest<GPPPizzeriaMapItem[]>('/api/gpp/pizzerias', { requireAuth: false });
}

export async function saveGppPizzeriaPhoto(eventId: string, placeId: string, photoUrl: string): Promise<void> {
  await apiRequest(`/api/gpp/pizzerias/${eventId}/photo`, {
    method: 'PATCH',
    body: { placeId, photoUrl },
    requireAuth: false,
  });
}

// GPP Events Map
export interface GPPEventMapItem {
  id: string;
  name: string;
  city: string;
  slug: string;
  date: string | null;
  venueName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  rsvpCount: number;
  country: string | null;
  underbossStatus?: string | null;
  eventTags?: string[];
  telegramGroup: string | null;
  hostTelegram?: string | null;
  coHostTelegrams?: string[];
  eventImageUrl?: string | null;
}

interface GPPEventApiResponse {
  id: string;
  name: string;
  city: string;
  customUrl: string | null;
  inviteCode: string;
  date: string | null;
  venueName: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  guestCount: number;
  country: string | null;
  underbossStatus?: string | null;
  eventTags?: string[];
  telegramGroup: string | null;
  hostTelegram?: string | null;
  coHostTelegrams?: string[];
  eventImageUrl?: string | null;
}

interface GPPEventsApiPayload {
  events: GPPEventApiResponse[];
  total: number;
  limit: number;
  offset: number;
}

export async function fetchGppEventsForMap(force?: boolean, curated?: boolean, includeAll?: boolean, swcOnly?: boolean): Promise<GPPEventMapItem[]> {
  const params: string[] = ['limit=2000'];
  if (curated) params.push('curated=1');
  // `statuses=all` is the auth-gated path on the backend — only returns
  // rejected/hidden events when the caller is an authenticated underboss/admin.
  // Unauthenticated callers silently fall back to the filtered view.
  if (includeAll) params.push('statuses=all');
  // cacciatore-72814: SWC-only filter for /map/swc. Backend filters server-side
  // by `eventTags` containing any "swc*" tag except the bare "swc" tag.
  if (swcOnly) params.push('swcOnly=true');
  if (force) params.push(`_t=${Date.now()}`);
  const url = `/api/gpp/events?${params.join('&')}`;
  const data = await apiRequest<GPPEventsApiPayload>(url, {
    requireAuth: false,
  });
  let events = (data.events || []).map((e) => ({
    id: e.id,
    name: e.name,
    city: e.city,
    slug: e.customUrl || e.inviteCode,
    date: e.date,
    venueName: e.venueName,
    address: e.address,
    latitude: e.latitude,
    longitude: e.longitude,
    rsvpCount: e.guestCount ?? 0,
    country: e.country,
    underbossStatus: e.underbossStatus,
    eventTags: e.eventTags ?? [],
    telegramGroup: e.telegramGroup ?? null,
    hostTelegram: e.hostTelegram ?? null,
    coHostTelegrams: e.coHostTelegrams ?? [],
    eventImageUrl: e.eventImageUrl ?? null,
  }));
  if (curated) {
    events = events.filter((e) => e.underbossStatus === 'approved');
  }
  return events;
}

// GPP Partners (aggregated across approved GPP events)
export interface GPPPartner {
  name: string;
  logoUrl: string;
  website: string | null;
  brandDescription: string | null;
  brandTwitter: string | null;
  brandInstagram: string | null;
  category: string | null;
  eventCount: number;
  events: { slug: string; city: string; sponsorId: string }[];
}

export interface GPPPartnersResponse {
  partners: GPPPartner[];
  total: number;
  generatedAt: string;
}

export async function fetchGppPartners(): Promise<GPPPartnersResponse> {
  return apiRequest<GPPPartnersResponse>('/api/gpp/partners', { requireAuth: false });
}

// stromboli-71593: Public leaderboard (approved GPP parties + countries)

export type LeaderboardWindow = 'all' | 'year';

export interface LeaderboardPartyRow {
  rank: number;
  id: string;
  name: string;
  hostName: string | null;
  city: string | null;
  slug: string;
  url: string;
  country: string | null;
  countryCode: string | null;
  eventImageUrl: string | null;
  score: number;
  breakdown: {
    linkRsvps: number;
    inviteRsvps: number;
    checkIns: number;
    photos: number;
    // panzerotti-58931: de-duped scorecard points contributed to this party's
    // unified score.
    scorecard: number;
  };
}

export interface LeaderboardCountryRow {
  rank: number;
  country: string;
  countryCode: string | null;
  partyCount: number;
  score: number;
}

// panzerotti-58931: top-100 checked-in guests by per-guest de-duped scorecard
// score (privacy "First L.").
export interface LeaderboardGuestRow {
  rank: number;
  name: string;
  city: string | null;
  country: string | null;
  countryCode: string | null;
  score: number;
}

export interface LeaderboardResponse {
  window: LeaderboardWindow;
  computedAt: string;
  parties: {
    rows: LeaderboardPartyRow[];
    total: number;
    limit: number;
    offset: number;
  };
  countries: {
    rows: LeaderboardCountryRow[];
    total: number;
  };
  guests: {
    rows: LeaderboardGuestRow[];
    total: number;
  };
}

export async function fetchLeaderboard(
  windowKey: LeaderboardWindow = 'all',
  limit = 50,
  offset = 0,
): Promise<LeaderboardResponse> {
  const params = new URLSearchParams();
  params.set('window', windowKey);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  return apiRequest<LeaderboardResponse>(
    `/api/leaderboard?${params.toString()}`,
    { requireAuth: false },
  );
}

// RSVP Funnel Stats (Underboss dashboard)

export interface FunnelEventStats {
  eventId: string;
  eventName: string;
  city: string;
  views: number;
  opened: number;
  step1Complete: number;
  submitted: number;
}

export interface FunnelStats {
  events: FunnelEventStats[];
  totals: {
    views: number;
    opened: number;
    step1Complete: number;
    submitted: number;
  };
}

// Fetch RSVP funnel stats for admin dashboard
export async function fetchFunnelStats(regions?: string[]): Promise<FunnelStats | null> {
  try {
    const params = regions && regions.length > 0 ? `?regions=${regions.join(',')}` : '';
    return await apiRequest<FunnelStats>(`/api/admin/funnel-stats${params}`, {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching funnel stats:', error);
    return null;
  }
}

export interface OptinABArm {
  arm: 'control' | 'variant';
  n: number;
  pizzadaoOptins: number;
  pizzadaoOptinPct: number;
  swcOptins: number;
  swcOptinPct: number;
}

export interface OptinABRegion {
  tag: string;
  label: string;
  arms: OptinABArm[];
}

export interface OptinABResults {
  regions: OptinABRegion[];
}

export async function fetchOptinABResults(): Promise<OptinABResults | null> {
  try {
    return await apiRequest<OptinABResults>('/api/admin/experiments/optin-ab', {
      method: 'GET',
      requireAuth: true,
    });
  } catch (error) {
    console.error('Error fetching opt-in A/B results:', error);
    return null;
  }
}

export interface ExperimentFlag {
  key: string;
  enabled: boolean;
  description: string | null;
  updatedAt: string;
  updatedBy: string | null;
}

export async function fetchExperimentFlags(): Promise<ExperimentFlag[] | null> {
  try {
    const res = await apiRequest<{ flags: ExperimentFlag[] }>('/api/admin/experiments/flags', {
      method: 'GET',
      requireAuth: true,
    });
    return res.flags;
  } catch (error) {
    console.error('Error fetching experiment flags:', error);
    return null;
  }
}

export async function setExperimentFlag(key: string, enabled: boolean): Promise<ExperimentFlag | null> {
  try {
    const res = await apiRequest<{ flag: ExperimentFlag }>(`/api/admin/experiments/flags/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: { enabled },
      requireAuth: true,
    });
    return res.flag;
  } catch (error) {
    console.error('Error setting experiment flag:', error);
    return null;
  }
}

// ── lasagna-49278: RSVP opt-in checkbox config admin ──
// Same row shape as the renderer hook (frontend/src/hooks/useRsvpCheckboxConfig.ts).
export interface RsvpCheckboxAdminRow {
  id: string;
  party_id: string | null;
  position: number;
  active: boolean;
  required_tags: string[];
  excluded_tags: string[];
  always_show: boolean;
  opt_in_fields: string[];
  combined_group: string | null;
  label_i18n_key: string | null;
  label_default: string | null;
  label_overrides: Record<string, string>;
  info_modal_i18n_ns: string | null;
  info_modal_privacy_url: string | null;
  info_modal_terms_url: string | null;
  info_modal_terms_key: string | null;
  modal_overrides: Record<string, unknown>;
  accent_color: string;
  updated_at?: string;
  updated_by?: string | null;
}

export type RsvpCheckboxAdminInput = Partial<Omit<RsvpCheckboxAdminRow, 'updated_at' | 'updated_by'>> & { id?: string };

export async function listRsvpCheckboxes(partyId?: string): Promise<RsvpCheckboxAdminRow[]> {
  const qs = partyId ? `?party_id=${encodeURIComponent(partyId)}` : '';
  const res = await apiRequest<{ checkboxes: RsvpCheckboxAdminRow[] }>(`/api/admin/rsvp-checkboxes${qs}`);
  return res.checkboxes;
}

export async function createRsvpCheckbox(body: RsvpCheckboxAdminInput): Promise<RsvpCheckboxAdminRow> {
  const res = await apiRequest<{ checkbox: RsvpCheckboxAdminRow }>('/api/admin/rsvp-checkboxes', {
    method: 'POST',
    body,
  });
  return res.checkbox;
}

export async function updateRsvpCheckbox(
  id: string,
  partyId: string | null,
  body: RsvpCheckboxAdminInput,
): Promise<RsvpCheckboxAdminRow> {
  const qs = partyId ? `?party_id=${encodeURIComponent(partyId)}` : '';
  const res = await apiRequest<{ checkbox: RsvpCheckboxAdminRow }>(
    `/api/admin/rsvp-checkboxes/${encodeURIComponent(id)}${qs}`,
    { method: 'PATCH', body },
  );
  return res.checkbox;
}

export async function deleteRsvpCheckbox(id: string, partyId?: string): Promise<void> {
  const qs = partyId ? `?party_id=${encodeURIComponent(partyId)}` : '';
  await apiRequest<{ deleted: boolean }>(
    `/api/admin/rsvp-checkboxes/${encodeURIComponent(id)}${qs}`,
    { method: 'DELETE' },
  );
}

// ── Guest Scorecard ──

export interface ScorecardItem {
  id: string;
  guestId: string;
  partyId: string;
  itemKey: string;
  completed: boolean;
  completedAt: string | null;
  proofUrl: string | null;
  proofType: string | null;
  metadata: Record<string, any>;
  createdAt: string;
  updatedAt: string;
  /** panzerotti-58931: game category, derived server-side. */
  category?: 'mission' | 'photo';
}

export interface ScorecardResponse {
  items: ScorecardItem[];
  pizzaChefScore: number;
  totalItems: number;
  /** panzerotti-58931 Phase 2.1: the calling guest's judged "Best Of" wins. */
  bestOfWins?: { superlativeKey: string; label: string }[];
}

export interface CompleteScorecardResponse {
  item: ScorecardItem;
  pizzaChefScore: number;
  totalItems: number;
}

export async function getScorecard(inviteCode: string): Promise<ScorecardResponse> {
  return apiRequest<ScorecardResponse>(`/api/scorecard/${inviteCode}`);
}

export async function completeScorecardItem(
  inviteCode: string,
  itemKey: string,
  proofUrl?: string,
  proofType?: string
): Promise<CompleteScorecardResponse> {
  return apiRequest<CompleteScorecardResponse>(`/api/scorecard/${inviteCode}/complete`, {
    method: 'POST',
    body: { itemKey, proofUrl, proofType },
  });
}

// panzerotti-58931: party check-in game — leaderboard + superlatives

export interface LeaderboardEntry {
  guestId: string;
  name: string;
  score: number;
  isCurrentUser: boolean;
}

export interface LeaderboardResponse {
  leaderboard: LeaderboardEntry[];
}

export async function getPartyLeaderboard(inviteCode: string): Promise<LeaderboardResponse> {
  return apiRequest<LeaderboardResponse>(`/api/scorecard/${inviteCode}/leaderboard`);
}

// panzerotti-58931: the worldwide game leaderboard (guests / parties /
// countries) was merged into the unified public board. Use `fetchLeaderboard()`
// above — its response now carries `guests`, `parties`, and `countries`. The
// old `/api/scorecard-leaderboard` endpoint and its types were removed.

// panzerotti-58931 Phase 2.1: admin Best Of judging queue

export interface UnderbossSuperlativeRow {
  id: string;
  superlativeKey: string;
  guestName: string;
  partyName: string;
  city: string | null;
  country: string | null;
  photoUrl: string;
  numericValue: number | null;
  status: string;
}

export interface UnderbossSuperlativeGroup {
  superlativeKey: string;
  label: string;
  submissions: UnderbossSuperlativeRow[];
}

export async function getUnderbossSuperlatives(): Promise<{ groups: UnderbossSuperlativeGroup[] }> {
  return apiRequest<{ groups: UnderbossSuperlativeGroup[] }>('/api/underboss/superlatives');
}

export async function markSuperlative(
  id: string,
  status: 'winner' | 'rejected' | 'pending'
): Promise<{ submission: { id: string; status: string } }> {
  return apiRequest<{ submission: { id: string; status: string } }>(
    `/api/underboss/superlatives/${id}`,
    { method: 'PATCH', body: { status } }
  );
}

export interface SuperlativeSubmission {
  id: string;
  guestId: string;
  partyId: string;
  superlativeKey: string;
  photoUrl: string;
  numericValue: number | null;
  status: string;
  judgedBy: string | null;
  judgedAt: string | null;
  createdAt: string;
}

export async function submitSuperlative(
  inviteCode: string,
  body: { superlativeKey: string; photoUrl: string; numericValue?: number | null }
): Promise<{ submission: SuperlativeSubmission }> {
  return apiRequest<{ submission: SuperlativeSubmission }>(`/api/scorecard/${inviteCode}/superlative`, {
    method: 'POST',
    body,
  });
}

// Logo cleanup (graphics admin)

export interface LogoCleanupSponsor {
  sponsorId: string;
  partyId: string;
  partySlug: string;
  partyName: string;
  partyCity: string;
  partnerName: string;
}

export interface LogoCleanupItem {
  logoUrl: string;
  classification: 'white_bg_png' | 'jpeg_white';
  sponsors: LogoCleanupSponsor[];
  sponsorUserId: string | null;
  sponsorUserName: string | null;
  eventCount: number;
}

export async function fetchLogoBgAudit(): Promise<{ items: LogoCleanupItem[] }> {
  return apiRequest<{ items: LogoCleanupItem[] }>('/api/admin/logo-bg-audit', {
    requireAuth: true,
  });
}

export async function applyLogoBgFix(
  logoUrl: string
): Promise<{ newUrl: string; sponsorsUpdated: number; sponsorUserUpdated: boolean }> {
  return apiRequest<{ newUrl: string; sponsorsUpdated: number; sponsorUserUpdated: boolean }>(
    '/api/admin/logo-bg-audit/apply',
    {
      method: 'POST',
      requireAuth: true,
      body: { logoUrl },
    }
  );
}

/**
 * Manual replacement: upload a graphics-admin-supplied file from disk to
 * replace the original logo, instead of auto-stripping the white background.
 * Reads the File via FileReader, strips the data-URL prefix, and POSTs the
 * raw base64 to the backend.
 */
export async function applyLogoBgFixUpload(
  originalUrl: string,
  file: File
): Promise<{ newUrl: string; sponsorsUpdated: number; sponsorUserUpdated: boolean }> {
  const fileBase64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('Failed to read file as data URL'));
        return;
      }
      const commaIdx = result.indexOf(',');
      if (commaIdx < 0) {
        reject(new Error('Unexpected FileReader output'));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsDataURL(file);
  });

  return apiRequest<{ newUrl: string; sponsorsUpdated: number; sponsorUserUpdated: boolean }>(
    '/api/admin/logo-bg-audit/apply-upload',
    {
      method: 'POST',
      requireAuth: true,
      body: {
        logoUrl: originalUrl,
        fileBase64,
        contentType: file.type,
      },
    }
  );
}

// ============================================
// Admin Host Payouts (arugula-38633 — PR 4)
// ============================================

function buildPayoutQuery(filters: AdminPayoutFilters | undefined): string {
  if (!filters) return '';
  const params = new URLSearchParams();
  if (filters.status && filters.status !== 'all') params.set('status', filters.status);
  if (filters.payoutMethod && filters.payoutMethod !== 'all') params.set('payoutMethod', filters.payoutMethod);
  if (filters.partyId) params.set('partyId', filters.partyId);
  // salame-83472: unified search — host email|name OR party name.
  if (filters.search) params.set('search', filters.search);
  // bruschetta-58291: country filter — exact-match `parties.country`.
  if (filters.country && filters.country !== 'all') params.set('country', filters.country);
  // mascarpone-49102: tag filter — single event_tag "has" match.
  if (filters.tag && filters.tag !== 'all') params.set('tag', filters.tag);
  if (filters.currency && filters.currency !== 'all') params.set('currency', filters.currency);
  // salumi-89172: purpose filter — 'event' | 'shipping' | 'all'. Omitted = show both.
  if (filters.purpose && filters.purpose !== 'all') params.set('purpose', filters.purpose);
  if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
  if (filters.dateTo) params.set('dateTo', filters.dateTo);
  // arancino-92103: sort order. Omit when default to keep URLs clean.
  if (filters.sort && filters.sort !== 'created_desc') params.set('sort', filters.sort);
  if (filters.cursor) params.set('cursor', filters.cursor);
  if (filters.limit) params.set('limit', String(filters.limit));
  // argentina-92103: regional scope for /payments/latam (and any future
  // regional portal). CSV of `parties.region` values; backend filters the
  // query, totals, and per-row aggregates by region when present.
  // pancetta-92103: also expand `regionPortals` (admin /payments multi-select
  // state — one or more portal slugs like 'latam' / 'na') into their
  // underlying `parties.region` slugs and merge with `regions` so the backend
  // sees a single CSV. Deduped via Set so the SA-overlap (Africa + SouthAfrica
  // both include `south-africa`) collapses cleanly.
  const regionSet = new Set<string>(filters.regions ?? []);
  if (filters.regionPortals && filters.regionPortals.length > 0) {
    for (const portal of filters.regionPortals) {
      const scope = PAYMENTS_REGION_SCOPES[portal as PaymentsRegionPortal];
      if (scope) {
        for (const r of scope) regionSet.add(r);
      }
    }
  }
  if (regionSet.size > 0) {
    params.set('regions', Array.from(regionSet).join(','));
  }
  // pinsa-92103: hide-closed-cities toggle on the by-city view. Backend
  // accepts `hideClosed=true`; the LIST endpoint ignores it.
  if (filters.hideClosed) {
    params.set('hideClosed', 'true');
  }
  // stracchino-92108: hide possible-scam-flagged cities on the by-city view.
  if (filters.hideScams) {
    params.set('hideScams', 'true');
  }
  // coppa-92106: opt-in proven-paid predicate for the Payments-ledger view.
  if (filters.provenOnly) {
    params.set('provenOnly', 'true');
  }
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/**
 * argentina-92103: small helper for endpoints that don't accept the full
 * AdminPayoutFilters object — appends `?regions=` when supplied.
 */
function regionsQuery(regions?: string[]): string {
  if (!regions || regions.length === 0) return '';
  return `?regions=${encodeURIComponent(regions.join(','))}`;
}

export async function listAdminPayouts(filters?: AdminPayoutFilters): Promise<AdminPayoutsResponse> {
  return apiRequest<AdminPayoutsResponse>(`/api/admin/payouts${buildPayoutQuery(filters)}`);
}

/**
 * etruria-92103: group-by-city view of the /payments admin queue. Reuses
 * `buildPayoutQuery` so every filter scopes the underlying payouts BEFORE the
 * server groups them. Returns one row per party with status aggregates +
 * receipt count + last activity, plus the underlying AdminPayouts so the
 * expansion section can render with the existing PayoutRow.
 */
export async function fetchPayoutsByParty(
  filters?: AdminPayoutFilters,
): Promise<PartyPayoutsResponse> {
  return apiRequest<PartyPayoutsResponse>(
    `/api/admin/payouts/by-party${buildPayoutQuery(filters)}`,
  );
}

export async function getAdminPayout(
  id: string,
  opts?: { regions?: string[] },
): Promise<AdminPayoutDetail> {
  const res = await apiRequest<{ payout: AdminPayoutDetail }>(
    `/api/admin/payouts/${id}${regionsQuery(opts?.regions)}`,
  );
  return res.payout;
}

export async function updateAdminPayout(
  id: string,
  fields: {
    finalAmountUsd?: number;
    adminNotes?: string | null;
    payoutMethod?: PayoutMethod;
    payoutWalletAddress?: string | null;
    payoutBankDetails?: BankDetails | null;
    note?: string;
    /**
     * lasagna-92103: previously the admin override for the acciuga-62583
     * per-submission $675 cap. The backend admin PATCH no longer enforces
     * the cap (admin amount is canonical), so this field is now a no-op
     * kept only for back-compat with any caller that still sets it. Safe
     * to omit.
     */
    allowOverSubmissionCap?: boolean;
  },
  /**
   * cannelloni-92103: regional underbosses can edit payouts on parties in
   * their region. The backend PATCH gate (`requireAdminOrRegionalUnderboss`)
   * needs the `regions=` CSV query to verify scope. Admins ignore it.
   */
  opts?: { regions?: string[] },
): Promise<AdminPayout> {
  const res = await apiRequest<{ payout: AdminPayout }>(
    `/api/admin/payouts/${id}${regionsQuery(opts?.regions)}`,
    {
      method: 'PATCH',
      body: fields,
    },
  );
  return res.payout;
}

/**
 * agnolotti-58291: per-receipt admin OCR correction. Updates ONLY the
 * `ocrAmount` and `ocrCurrency` on a single `payout_documents` row — does NOT
 * touch the parent payout's `finalAmountUsd`. Use the normal
 * `updateAdminPayout` edit-amount path when an admin wants to recompute the
 * payout total.
 *
 * Sending `null` clears the field; sending `undefined` (i.e. omitting it from
 * the object) leaves it untouched.
 *
 * taralli-92104: the same endpoint now also accepts `ocrLineItems` (an array
 * of structured line items the admin edited in the reviewer modal). The
 * backend replaces the JSONB column wholesale — no merge — and writes a
 * separate `edit_documents` audit row when the line items change.
 *
 * Returns the updated document row shape — same fields as
 * `AdminPayoutDetail.documents[]` minus the uploader join.
 */
export async function updatePayoutDocument(
  docId: string,
  patch: {
    ocrAmount?: number | null;
    ocrCurrency?: string | null;
    // caprino-92104: original-currency amount. When sent alongside
    // `ocrCurrency`, the backend runs `convertToUSD(originalAmount,
    // ocrCurrency)` and persists the recomputed USD value + exchange
    // rate. Sending originalAmount alone (without ocrCurrency) re-runs
    // FX against the receipt's existing currency.
    originalAmount?: number | null;
    ocrLineItems?: ReceiptLineItem[] | null;
    // culatello-92104: admin-toggleable duplicate flag. Reversible.
    isDuplicate?: boolean;
    // provola-92106: admin-toggleable "ineligible for reimbursement" flag.
    // Distinct from `isDuplicate` (legitimate purchase but doesn't qualify
    // under policy — alcohol, tips, personal items). Reversible. Same
    // exclusion semantics as `isDuplicate` everywhere it's read.
    ineligible?: boolean;
  },
): Promise<{
  id: string;
  kind: 'pizza' | 'receipt';
  url: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  ocrAmount: number | null;
  ocrCurrency: string | null;
  ocrConfidence: number | null;
  originalAmount: number | null;
  originalCurrency: string | null;
  exchangeRate: number | null;
  ocrLineItems: ReceiptLineItem[] | null;
  isDuplicate: boolean;
  // provola-92106: echoed back so callers can sync their optimistic
  // override against the server-authoritative value after PATCH.
  ineligible: boolean;
  ocrError: string | null;
  sortOrder: number;
  uploadedByUserId: string | null;
}> {
  const res = await apiRequest<{ document: any }>(
    `/api/admin/payouts/documents/${docId}`,
    { method: 'PATCH', body: patch },
  );
  return res.document;
}

/**
 * culatello-92104: typed wrapper for the per-receipt "Mark duplicate" toggle.
 * Thin convenience over `updatePayoutDocument({ isDuplicate })` so the
 * reviewer modal callsite reads as the action it performs. Reversible —
 * pass `false` to un-mark.
 */
export async function markReceiptDuplicate(
  docId: string,
  isDuplicate: boolean,
) {
  return updatePayoutDocument(docId, { isDuplicate });
}

/**
 * provola-92106: typed wrapper for the per-receipt "Mark ineligible" toggle.
 * Mirrors `markReceiptDuplicate` above. Semantically distinct from duplicate
 * — ineligibles are legitimate purchases the host paid for that don't
 * qualify under the reimbursement policy (alcohol, tips, personal items).
 * Reversible — pass `false` to un-mark. Independent of `isDuplicate` (both
 * flags can be true on the same row, though the UI prefers duplicate as the
 * primary visual signal).
 */
export async function markReceiptIneligible(
  docId: string,
  ineligible: boolean,
) {
  return updatePayoutDocument(docId, { ineligible });
}

/**
 * marinara-61455: image-authenticity (AI-generated / doctored) admin check.
 *
 * Manual, on-demand tool that judges whether a payment-receipt image or a host
 * event-cover image is AI-generated or doctored. Returns a cached verdict +
 * confidence + reasons. Advisory only — the verdict flags for human review, it
 * never auto-rejects. Mirrors the `markReceiptDuplicate` thin-wrapper pattern.
 */
export type ImageAuthenticityVerdict = 'authentic' | 'suspicious' | 'likely_fake';

export interface ImageAuthenticityCheck {
  id: string;
  imageUrl: string;
  sourceKind: 'receipt' | 'event_image';
  partyId: string | null;
  payoutDocumentId: string | null;
  verdict: ImageAuthenticityVerdict;
  score: number;
  reasons: unknown;
  provider: string;
  elaArtifactUrl: string | null;
  checkedAt: string;
  checkedBy: string | null;
}

/**
 * Run (or return the cached) authenticity check for an image. Pass `force:true`
 * to bypass the cache and re-run the scorer (costs an API call). Returns the
 * persisted check row plus whether it came from cache.
 */
export async function verifyImageAuthenticity(params: {
  imageUrl: string;
  sourceKind: 'receipt' | 'event_image';
  partyId?: string | null;
  payoutDocumentId?: string | null;
  force?: boolean;
}): Promise<{ check: ImageAuthenticityCheck; cached: boolean }> {
  return apiRequest<{ check: ImageAuthenticityCheck; cached: boolean }>(
    '/api/admin/image-authenticity',
    { method: 'POST', body: params },
  );
}

/**
 * Fetch the most recent cached authenticity check for an image, or `null` when
 * none exists yet. Used to render a prior verdict on lightbox open without
 * spending an API call.
 */
export async function getImageAuthenticityCheck(
  imageUrl: string,
): Promise<ImageAuthenticityCheck | null> {
  const res = await apiRequest<{ check: ImageAuthenticityCheck | null }>(
    `/api/admin/image-authenticity?imageUrl=${encodeURIComponent(imageUrl)}`,
  );
  return res.check;
}

/**
 * pancetta-92104: reset a single doc's OCR retry counter so the next backfill
 * call (or this call's inline run) re-attempts `analyzeReceipt` against the
 * receipt. Used to un-stick docs that hit the 3-attempt cap once the
 * underlying OpenAI quota issue is resolved, and as a one-click "Retry OCR"
 * affordance on rows that failed for a non-quota reason (timeout, bad image).
 *
 * `runNow: true` (default) runs analyzeReceipt synchronously and returns the
 * stamped result. `runNow: false` just clears the counters and lets the next
 * scheduled backfill batch pick it up.
 */
export async function retryPayoutDocumentOcr(
  docId: string,
  opts?: { runNow?: boolean },
): Promise<{
  document: {
    id: string;
    kind: 'pizza' | 'receipt';
    url: string;
    fileName: string;
    ocrAmount: number | null;
    ocrCurrency: string | null;
    ocrConfidence: number | null;
    originalAmount: number | null;
    originalCurrency: string | null;
    exchangeRate: number | null;
    ocrError: string | null;
    ocrAttemptedAt: string | null;
    ocrAttemptCount: number;
    ocrLineItems: ReceiptLineItem[] | null;
    sortOrder: number;
  } | null;
  ranInline: boolean;
  inlineError: string | null;
}> {
  return apiRequest(
    `/api/admin/payouts/documents/${docId}/retry-ocr`,
    { method: 'POST', body: { runNow: opts?.runNow ?? true } },
  );
}

/**
 * sfincione-58500: admin attaches a new receipt / pizza-proof / event-proof
 * document to an existing payout from the /payments review modal. The backend
 * OCRs receipts inline and mirrors pizza/event docs into the gallery, exactly
 * like the host PATCH path. Returns the freshly-created PayoutDocument; callers
 * re-fetch the payout detail to pick up recomputed receipt subtotals.
 */
export async function addAdminPayoutDocument(
  payoutId: string,
  body: {
    kind: 'receipt' | 'pizza' | 'event';
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  },
): Promise<{ document: PayoutDocument }> {
  return apiRequest(`/api/admin/payouts/${payoutId}/documents`, {
    method: 'POST',
    body,
  });
}

export async function approveAdminPayout(
  id: string,
  opts?: {
    note?: string;
    autoExecute?: boolean;
    regions?: string[];
    /**
     * nduja-92106: admin-class only. When true, the backend skips the per-
     * party reimbursement cap recheck at approve time (the same recheck that
     * bocconcini-49102 added). Mirrors `executeAdminPayout`'s salame-92103
     * override. The PayoutReviewModal Approve button sets this when the
     * amber per-party cap warning's ack Checkbox has been ticked; passes
     * through to the autoExecute branch as well.
     */
    allowOverPartyCap?: boolean;
    /**
     * guanciale-49340: admin-class only. When true, the backend skips the
     * per-address ($676) hard-cap recheck in the autoExecute usdc_base branch.
     * Mirrors `executeAdminPayout`'s per-address override. The by-city
     * SendPaymentModal sets this when the amber per-address cap warning's ack
     * Checkbox has been ticked.
     */
    allowOverPerAddressCap?: boolean;
  },
): Promise<{
  payout: AdminPayout;
  autoExecuteDeferred: boolean;
  autoExecuted?: boolean;
  autoExecuteSkippedReason?: string | null;
}> {
  return apiRequest(`/api/admin/payouts/${id}/approve${regionsQuery(opts?.regions)}`, {
    method: 'POST',
    body: {
      note: opts?.note,
      autoExecute: opts?.autoExecute,
      allowOverPartyCap: opts?.allowOverPartyCap,
      allowOverPerAddressCap: opts?.allowOverPerAddressCap,
    },
  });
}

export async function rejectAdminPayout(
  id: string,
  rejectionReason: string,
  opts?: { regions?: string[]; silent?: boolean },
): Promise<AdminPayout> {
  const res = await apiRequest<{ payout: AdminPayout }>(
    `/api/admin/payouts/${id}/reject${regionsQuery(opts?.regions)}`,
    {
      method: 'POST',
      // gouda-92103: `silent: true` suppresses host notification on reject.
      // Default omitted (= notify-as-today). Audit note records [silent].
      body: { rejectionReason, silent: opts?.silent === true ? true : undefined },
    },
  );
  return res.payout;
}

/**
 * caprino-92103: revert an `approved` payout back to `pending`. Approval
 * was a one-way door — the only "undo" was reject, which is a different
 * terminal state. This lets admins flip approved -> pending so they can
 * re-review or ask the host for more info before sending.
 *
 * Backend validates the current status is 'approved' (400 NOT_APPROVED
 * otherwise) and writes a payout_audit row with action='unapprove'.
 */
export async function unapproveAdminPayout(
  id: string,
  noteOrOpts?: string | { note?: string; regions?: string[] },
): Promise<AdminPayout> {
  // Backward-compat: callers passing a bare `note` string still work.
  const note = typeof noteOrOpts === 'string' ? noteOrOpts : noteOrOpts?.note;
  const regions = typeof noteOrOpts === 'string' ? undefined : noteOrOpts?.regions;
  const res = await apiRequest<{ payout: AdminPayout }>(
    `/api/admin/payouts/${id}/unapprove${regionsQuery(regions)}`,
    {
      method: 'POST',
      body: { note },
    },
  );
  return res.payout;
}

/**
 * brie-92108: revert a `rejected` payout back to `pending`. Rejection was a
 * one-way terminal state with no undo. This lets admins flip rejected ->
 * pending so they can re-review.
 *
 * Backend validates the current status is 'rejected' (400 NOT_REJECTED
 * otherwise) and writes a payout_audit row with action='unreject'.
 */
export async function unrejectAdminPayout(
  id: string,
  noteOrOpts?: string | { note?: string; regions?: string[] },
): Promise<AdminPayout> {
  // Backward-compat: callers passing a bare `note` string still work.
  const note = typeof noteOrOpts === 'string' ? noteOrOpts : noteOrOpts?.note;
  const regions = typeof noteOrOpts === 'string' ? undefined : noteOrOpts?.regions;
  const res = await apiRequest<{ payout: AdminPayout }>(
    `/api/admin/payouts/${id}/unreject${regionsQuery(regions)}`,
    {
      method: 'POST',
      body: { note },
    },
  );
  return res.payout;
}

/**
 * culatello-92103: revert a `paid` payout back to `approved`. The previous
 * "Revert to Pending" affordance only worked for `approved` rows — there
 * was no way to undo an out-of-band `mark-paid` (wire, mercury_card,
 * external, off-platform). This endpoint covers every payout method:
 * status flips paid -> approved and the mark-paid metadata (paidAt,
 * transactionHash, wireReference, mercuryCardId, mercuryCardLast4,
 * externalProofUrl) is cleared. The audit trail is preserved.
 *
 * Backend validates the current status is 'paid' (400 NOT_PAID otherwise)
 * and writes a payout_audit row with action='unmark_paid'.
 */
export async function revertPaidAdminPayout(
  id: string,
  opts?: { note?: string },
): Promise<AdminPayout> {
  const res = await apiRequest<{ payout: AdminPayout }>(
    `/api/admin/payouts/${id}/revert-paid`,
    {
      method: 'POST',
      body: { note: opts?.note },
    },
  );
  return res.payout;
}

/**
 * gnocchi-92104: flip an `approved` payout to `queued` (wire request sent,
 * awaiting settlement). Semantically between approved (admin signed off) and
 * paid (money actually moved). Counts toward the party's committed cap the
 * same as approved / paid / completed.
 *
 * Backend validates the current status is 'approved' (400 NOT_APPROVED
 * otherwise) and writes a payout_audit row with action='mark_queued'.
 *
 * Used primarily for wire payouts where the admin has emailed the bank but
 * the wire hasn't cleared yet; not method-gated though — admins can queue
 * any approved row.
 */
export async function markPayoutQueued(
  id: string,
  opts?: { note?: string },
): Promise<AdminPayout> {
  const res = await apiRequest<{ payout: AdminPayout }>(
    `/api/admin/payouts/${id}/mark-queued`,
    {
      method: 'POST',
      body: { note: opts?.note },
    },
  );
  return res.payout;
}

/**
 * gnocchi-92104: flip a `queued` payout back to `approved`. The "admin oops
 * un-queue" path — used when the wire request was sent in error and needs to
 * be reset before settlement (wrong recipient, duplicate request, etc.).
 *
 * Backend validates the current status is 'queued' (400 NOT_QUEUED otherwise)
 * and writes a payout_audit row with action='unmark_queued'.
 */
export async function unmarkPayoutQueued(
  id: string,
  opts?: { note?: string },
): Promise<AdminPayout> {
  const res = await apiRequest<{ payout: AdminPayout }>(
    `/api/admin/payouts/${id}/unmark-queued`,
    {
      method: 'POST',
      body: { note: opts?.note },
    },
  );
  return res.payout;
}

/**
 * argentina-92103: regional underbosses (and admins) signal "this payout is
 * ready for the payments team to pay" without actually changing status or
 * sending funds. Writes a payout_audit row + fires Telegram + email to the
 * payments-team distribution. The flag is sticky (admins see a green Flag
 * icon on the row until they execute or revert).
 */
export async function flagReadyForPayment(
  id: string,
  opts?: { regions?: string[]; note?: string },
): Promise<AdminPayoutDetail> {
  const res = await apiRequest<{ payout: AdminPayoutDetail }>(
    `/api/admin/payouts/${id}/flag-ready${regionsQuery(opts?.regions)}`,
    {
      method: 'POST',
      body: { note: opts?.note },
    },
  );
  return res.payout;
}

export async function markAdminPayoutPaid(
  id: string,
  refs: {
    wireReference?: string;
    transactionHash?: string;
    mercuryCardLast4?: string;
    mercuryCardId?: string;
    note?: string;
  },
): Promise<AdminPayout> {
  const res = await apiRequest<{ payout: AdminPayout }>(`/api/admin/payouts/${id}/mark-paid`, {
    method: 'POST',
    body: refs,
  });
  return res.payout;
}

/**
 * panettone-92103: party-level "mark party paid" preview. Returns the in-flight
 * (pending + approved) payouts for a party so MarkPartyPaidModal can render
 * the count + total + per-row breakdown before the admin confirms. Read-only.
 */
export interface MarkPartyPaidPreviewPayout {
  id: string;
  status: 'pending' | 'approved';
  finalAmountUsd: number;
  payoutMethod: PayoutMethod | null;
  hostName: string | null;
  hostEmail: string | null;
}

export interface MarkPartyPaidPreviewResponse {
  party: {
    id: string;
    name: string;
    /**
     * pinsa-92103: surfaced so the modal can pre-render the close-out body
     * when the city is already closed (rare — the by-city table normally
     * hides the entry button in that case, but PayoutReviewModal can still
     * open this modal directly).
     */
    paymentsClosedAt?: string | null;
  };
  /** In-flight (pending + approved) payouts. */
  count: number;
  /** Sum of in-flight payouts in USD. */
  totalUsd: number;
  /**
   * caciotta-92103: sum + count of payouts on this party that are already
   * `paid`. Used by the modal to warn about double-counting — if the host
   * was already paid externally and that payment was recorded as its own
   * paid row, marking the pending claim paid would inflate /payments
   * totals by 2x.
   */
  existingPaidCount: number;
  existingPaidUsd: number;
  /**
   * caciotta-92103 + provolone-92103: what 'auto' mode will do given the
   * current state. The modal default-selects the radio matching this value.
   * 'mark_pending_complete' replaces the legacy 'withdraw_pending' value
   * (which is still accepted by the backend for backward compat).
   */
  suggestedMode: 'mark_paid' | 'mark_pending_complete';
  /**
   * pinsa-92103: count of paid payouts for the party. Powers the close-out
   * body copy ("Existing paid records (N payments, $X.XX total) stay
   * unchanged"). Optional for backward-compat with cached payloads.
   */
  paidCount?: number;
  /** pinsa-92103: sum of paid payouts in USD. */
  paidTotalUsd?: number;
  /**
   * pinsa-92103: when null and `count + paidCount > 0`, the modal switches to
   * close-out mode. Mirrors `party.paymentsClosedAt` for convenience.
   */
  paymentsClosedAt?: string | null;
  /**
   * pinsa-92103: false = no payouts of any status, so admin shouldn't see
   * the Mark Paid button at all. True = at least something to action.
   * Optional for backward-compat (older payloads default to in-flight-only).
   */
  eligible?: boolean;
  payouts: MarkPartyPaidPreviewPayout[];
}

export async function fetchMarkPartyPaidPreview(
  partyId: string,
): Promise<MarkPartyPaidPreviewResponse> {
  return apiRequest<MarkPartyPaidPreviewResponse>(
    `/api/admin/parties/${partyId}/mark-paid-preview`,
  );
}

/**
 * panettone-92103: flip every in-flight (pending + approved) payout on a
 * party to `paid` in one atomic transaction. Used when the admin paid the
 * host the full amount out-of-band (Venmo / wire / etc.) and wants to close
 * out everything in one click.
 *
 * `note` is appended to each row's `admin_notes` with a timestamp and also
 * written to the per-row payout_audit row.
 *
 * `paidMethod` ('external' means "leave method unchanged") stamps the chosen
 * method on rows whose `payout_method` is currently null. Existing methods
 * are preserved so we don't lie about how an already-routed payout was paid.
 *
 * Returns `{ count, party, payoutIds }`. count=0 (HTTP 200) when there are no
 * in-flight payouts — modal renders "0 payouts to mark paid".
 */
/**
 * pinsa-92103 + caciotta-92103: response shape for POST
 * /api/admin/parties/:id/mark-paid.
 *
 * `action` distinguishes the executed path. The handler resolves caciotta's
 * `mode` first ('auto' picks between mark_paid and mark_pending_complete) and
 * then, if nothing is left in-flight after that resolution, pinsa's close-out
 * path may auto-stamp `paymentsClosedAt`.
 *
 *   - `'mark_paid'`             — flipped 1+ in-flight payouts to paid.
 *   - `'mark_pending_complete'` — closed out pending+approved rows by flipping
 *                                 them to status='completed' (provolone-92103;
 *                                 replaces caciotta's 'withdraw_pending').
 *   - `'closed'`                — no in-flight rows, but the city had paid
 *                                 history, so we stamped `paymentsClosedAt`
 *                                 as a pure close-out (pinsa).
 *   - `'already_closed'`        — no-op, city was already closed.
 *   - `'noop'`                  — no in-flight, no paid history; nothing to do.
 *
 * `mode` is preserved for backward compat with callers that pre-dated
 * `action` — for mark_paid / mark_pending_complete it mirrors `action`.
 */
export interface MarkPartyPaidResponse {
  count: number;
  mode?: 'mark_paid' | 'mark_pending_complete';
  party: {
    id: string;
    name: string;
    paymentsClosedAt?: string | null;
  };
  payoutIds: string[];
  action?:
    | 'mark_paid'
    | 'mark_pending_complete'
    | 'closed'
    | 'already_closed'
    | 'noop';
}

export async function markPartyPaid(
  partyId: string,
  body?: {
    note?: string;
    paidMethod?: PayoutMethod | 'external';
    /**
     * caciotta-92103 + provolone-92103: how to close out the in-flight rows.
     *   'mark_paid' — legacy behavior; flips pending+approved to paid.
     *   'mark_pending_complete' — flips pending+approved to status='completed'
     *     (no new paid amounts; receipts preserved). Means "the city was
     *     fully paid by the org, even if the org paid less than the claim
     *     amount." Use when marking a city paid and you want the in-flight
     *     claims closed out as completed.
     *   'auto' (default) — picks mark_pending_complete when existing paid sum
     *     >= pending+approved sum; else mark_paid.
     */
    mode?: 'mark_paid' | 'mark_pending_complete' | 'auto';
  },
): Promise<MarkPartyPaidResponse> {
  return apiRequest<MarkPartyPaidResponse>(
    `/api/admin/parties/${partyId}/mark-paid`,
    {
      method: 'POST',
      body: body ?? {},
    },
  );
}

/**
 * Undo an accidental city close. Clears `payments_closed_at` and reverts the
 * payouts the close flipped to `completed` back to their pre-close status
 * (pending / approved / queued). Returns the cleared party + how many payouts
 * were reverted. Throws 400 NOT_CLOSED if the city isn't currently closed.
 */
export interface ReopenPartyResponse {
  party: { id: string; name: string; paymentsClosedAt: string | null };
  reopenedCount: number;
  payoutIds: string[];
}

export async function reopenParty(
  partyId: string,
  note?: string,
): Promise<ReopenPartyResponse> {
  return apiRequest<ReopenPartyResponse>(
    `/api/admin/parties/${partyId}/reopen`,
    {
      method: 'POST',
      body: note ? { note } : {},
    },
  );
}

/**
 * Execute an approved payout (PR 5). Body shape is method-specific:
 *   - usdc_base    → no body required; server sends via Privy server-wallet
 *   - wire         → { wireReference: string } REQUIRED
 *   - mercury_card → { mercuryCardLast4: 'NNNN', mercuryCardId?: string, note?: string } REQUIRED
 *
 * `allowOverPerAddressCap` (bianco-89172): forwarded to the server to bypass
 * the per-address $676 cumulative cap when the admin has acknowledged the
 * warning in PayoutReviewModal.
 *
 * `allowOverPartyCap` (salame-92103): forwarded to the server to bypass the
 * per-party cap when the admin has acknowledged the over-cap warning. The
 * server appends `[override: party cap]` to the audit row's note.
 *
 * Returns the updated payout. Throws on any server-side validation/execution failure.
 */
export async function executeAdminPayout(
  id: string,
  body: {
    wireReference?: string;
    mercuryCardLast4?: string;
    mercuryCardId?: string;
    note?: string;
    allowOverPerAddressCap?: boolean;
    allowOverPartyCap?: boolean;
  } = {},
): Promise<AdminPayout> {
  const res = await apiRequest<{ payout: AdminPayout }>(`/api/admin/payouts/${id}/execute`, {
    method: 'POST',
    body,
  });
  return res.payout;
}

/**
 * salsiccia-49102: sequentially execute multiple approved USDC payouts.
 * Backend bails the whole batch (400 INSUFFICIENT_BALANCE) if the hot
 * wallet's USDC balance is less than the sum of amounts; per-row results
 * include status='paid' (+ txHash) or status='failed' (+ error).
 *
 * The backend enforces:
 *   - 50-id sanity cap per request (400 BULK_TOO_LARGE if over)
 *   - eligibility filter (USDC + approved + valid 0x wallet) — non-eligible
 *     ids are silently dropped from the response, NOT echoed back
 *   - sequential execution (nonce safety for the single-signer hot wallet)
 */
export interface BulkSendResult {
  id: string;
  success: boolean;
  status: 'paid' | 'failed';
  txHash?: string;
  error?: string;
}

export async function bulkExecutePayouts(
  ids: string[],
  opts?: { allowOverPerAddressCap?: boolean; allowOverPartyCap?: boolean },
): Promise<BulkSendResult[]> {
  const body: {
    ids: string[];
    allowOverPerAddressCap?: boolean;
    allowOverPartyCap?: boolean;
  } = { ids };
  if (opts?.allowOverPerAddressCap) body.allowOverPerAddressCap = true;
  // salame-92103: batch-level acknowledgement for the per-party cap.
  if (opts?.allowOverPartyCap) body.allowOverPartyCap = true;
  const res = await apiRequest<{ results: BulkSendResult[] }>(`/api/admin/payouts/bulk-execute`, {
    method: 'POST',
    body,
  });
  return res.results;
}

/**
 * bianco-89172: fetch the cumulative paid-USDC total for a single recipient
 * wallet, optionally with a "wouldExceed" check for a proposed additional
 * amount. Backs the per-address $676 cap warning in PayoutReviewModal +
 * BulkSendModal. Returns `wouldExceed: null` when `amount` is omitted.
 *
 * Admin-only — throws via `apiRequest` if the caller is not a payment admin.
 */
export async function fetchWalletPaidTotal(
  address: string,
  amount?: number,
): Promise<WalletPaidTotal> {
  const params = new URLSearchParams({ address });
  if (amount != null && Number.isFinite(amount)) {
    params.set('amount', String(amount));
  }
  return apiRequest<WalletPaidTotal>(
    `/api/admin/payouts/wallet-paid-total?${params.toString()}`,
  );
}

/**
 * Search-as-you-type for the Record External Payment modal (arugula-38633 v2).
 * Backend filters parties.underbossStatus === 'approved' and returns up to 20
 * matches by name/customUrl/inviteCode. Each row carries the main host plus
 * any cohosts whose email maps to a User record (others are silently
 * excluded — Payout.hostUserId must reference a real User).
 *
 * Empty / sub-2-char queries return [] from the server.
 */
export interface ApprovedPartySearchResult {
  id: string;
  name: string;
  inviteCode: string;
  hostUserId: string;
  hostCandidates: Array<{
    userId: string;
    name: string | null;
    email: string | null;
    role: 'host' | 'cohost';
  }>;
  /**
   * parmigiana-92104: surfaced so the ExternalPaymentModal can render the
   * SWC Hub reimbursement warning once a party is selected. Optional for
   * backward-compat with cached payloads during a rolling deploy — older
   * clients just skip the warning.
   */
  country?: string | null;
  /**
   * parmigiana-92104: surfaced so the ExternalPaymentModal can detect the
   * 'SWC Hub' tag even on non-US events. Optional for backward-compat.
   */
  eventTags?: string[];
}

export async function searchApprovedParties(
  query: string,
): Promise<ApprovedPartySearchResult[]> {
  const params = new URLSearchParams({ q: query });
  const res = await apiRequest<{ parties: ApprovedPartySearchResult[] }>(
    `/api/admin/payouts/parties/search?${params.toString()}`,
  );
  return res.parties;
}

/**
 * Record an OUT-OF-BAND payment (Venmo, manual bank, etc.) — creates a new
 * payout row in `paid` status immediately. arugula-38633 v2 follow-up.
 *
 * The backend maps 'other' → 'wire' for the DB CHECK; the real method intent
 * is preserved in adminNotes (e.g. "Other: Venmo").
 */
export async function recordExternalPayment(
  body: ExternalPaymentInput,
): Promise<AdminPayoutDetail> {
  const res = await apiRequest<{ payout: AdminPayoutDetail }>(
    '/api/admin/payouts/external',
    { method: 'POST', body },
  );
  return res.payout;
}

/**
 * siciliana-69183: fetch a host's saved payment details for the admin
 * HostPaymentDetailsModal (host-name click in prepay queue + payouts table).
 * Backed by `GET /api/admin/users/:userId/payment-details`. Admin-gated.
 */
export interface UserPaymentDetails {
  userId: string;
  name: string | null;
  email: string;
  preferredPayoutMethod: PayoutMethod | null;
  payoutWalletAddress: string | null;
  payoutBankDetails: { email?: string | null } | null;
  totalPayouts: number;
  latestPayoutAt: string | null;
}

export async function fetchUserPaymentDetails(userId: string): Promise<UserPaymentDetails> {
  return apiRequest<UserPaymentDetails>(
    `/api/admin/users/${encodeURIComponent(userId)}/payment-details`,
  );
}

/**
 * bismarck-92103: list approved parties flagged for prepayment whose host(s)
 * have a saved payment method, excluding parties that already have an
 * in-flight payout. Surfaced as the "Prepay queue" section on /payments.
 */
export async function fetchPrepayQueue(opts?: { regions?: string[] }): Promise<PrepayQueueRow[]> {
  const res = await apiRequest<{ rows: PrepayQueueRow[] }>(
    `/api/admin/payouts/prepay-queue${regionsQuery(opts?.regions)}`,
  );
  return res.rows;
}

/**
 * Get the running 24h USDC payout usage + remaining cap (PR 5). Used to render
 * the "Daily cap remaining: $X" hint before the admin confirms a USDC execute.
 */
export async function getUsdcDailyCapRemaining(): Promise<{
  usedUsd: number;
  capUsd: number;
  remainingUsd: number;
}> {
  return apiRequest('/api/admin/payouts/usdc-daily-cap-remaining');
}

/**
 * coppa-91827: fetch the payout hot wallet's public address + live ETH (gas)
 * and USDC balances on Base. Admin-only. Used by `HotWalletCard` at the top
 * of /payments so admins know where to deposit and can verify funds landed.
 *
 * Returns 503 if `USDC_PAYOUT_WALLET_PRIVATE_KEY` is not set on backend Vercel
 * — apiRequest will throw with the backend-provided remediation message.
 */
export interface PayoutWalletInfo {
  address: string;
  chainId: number;
  ethBalance: string;        // human-readable, e.g. "0.05273"
  ethBalanceWei: string;     // BigInt string in wei
  usdcBalance: string;       // human-readable, e.g. "1250.00"
  usdcBalanceUnits: string;  // BigInt string in 6-decimal base units
  fetchedAt: string;         // ISO timestamp
}

export async function fetchPayoutWalletInfo(): Promise<PayoutWalletInfo> {
  return apiRequest<PayoutWalletInfo>('/api/admin/payout-wallet/info');
}

/**
 * Triggers the CSV export endpoint and downloads the file to the browser.
 * Returns nothing — fires a download via a temporary <a> element.
 */
export async function exportAdminPayoutsCsv(filters?: AdminPayoutFilters): Promise<void> {
  const token = localStorage.getItem('authToken');
  if (!token) throw new Error('Not authenticated');
  const url = `${API_URL}/api/admin/payouts/export.csv${buildPayoutQuery(filters)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`CSV export failed: ${res.status}`);
  }
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = objectUrl;
  a.download = `host-payments-${new Date().toISOString().split('T')[0]}.csv`;
  a.click();
  URL.revokeObjectURL(objectUrl);
}

/**
 * Fetch the stripped-background preview PNG as a Blob. Use URL.createObjectURL()
 * on the result to bind it to an <img src>. We can't use a raw URL because the
 * endpoint requires Bearer auth, and <img> won't send Authorization headers.
 */
export async function fetchLogoBgPreviewBlob(logoUrl: string): Promise<Blob> {
  const token = localStorage.getItem('authToken');
  if (!token) throw new Error('Not authenticated');
  const url = `${API_URL}/api/admin/logo-bg-audit/preview?url=${encodeURIComponent(logoUrl)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    throw new Error(`Preview failed: ${res.status}`);
  }
  return res.blob();
}

// =============================================================================
// Host Payouts API (arugula-38633)
// =============================================================================

export interface CreatePayoutPhotoInput {
  url: string;
  fileName?: string;
  fileSize?: number;
  mimeType?: string;
  // provolone-49301: optional forwarded preview-OCR payload for receipts.
  // ocr-preview already ran gpt-4o once on upload; forwarding the
  // original-currency result lets the backend SKIP a second pass while still
  // re-locking FX server-side. USD amount/rate are never sent — the server
  // recomputes them via convertToUSD. Ignored for pizza photos.
  ocrOriginalAmount?: number;
  ocrOriginalCurrency?: string | null;
  ocrConfidence?: number;
  ocrLineItems?: unknown;
  ocrRaw?: unknown;
  ocrError?: string | null;
  // stracciatella-92114: multi-receipt-per-photo. When a single uploaded image
  // resolved to N receipts at preview time, the frontend emits N receiptPhotos
  // entries sharing url/fileName/fileSize/mimeType, each carrying its own OCR
  // fields + the 0-based index of which detected receipt it represents (and the
  // total count so the backend can label "k of n"). The backend persists one
  // payout_documents row per entry.
  sourceReceiptIndex?: number;
  sourceReceiptCount?: number;
}

export interface CreatePayoutData {
  // porchetta-58296: pizza/event photos are no longer uploaded here — the host
  // designates role photos in the gallery (photos.payout_role). Removed from
  // the create payload.
  receiptPhotos: CreatePayoutPhotoInput[];
  // porchetta-58296: host attestation that all receipts are submitted +
  // itemized. Backend rejects without it (RECEIPT_ATTESTATION_REQUIRED).
  receiptAttested?: boolean;
  hostNotes?: string;
  /**
   * arugula-38633 v3 follow-up: optional. When omitted/null, the payout is
   * persisted with payout_method=NULL and admin requests the host set their
   * payment details before execute.
   */
  payoutMethod?: PayoutMethod | null;
  payoutWalletAddress?: string;
  payoutBankDetails?: BankDetails;
  mercuryCardLast4?: string;
  finalAmountUsd?: number;
  saveAsDefault?: boolean;
  /**
   * One-shot setup: backend writes this to `parties.expectedGuests` only when
   * the party's current value is null. Sent only on the host's first payout.
   */
  estimatedAttendance?: number;
  /**
   * bismarck-92103: admin-only override. When set AND caller is an admin,
   * the resulting Payout row is credited to this User (the recipient cohost)
   * instead of the calling admin. Non-admin callers passing this field are
   * silently ignored server-side.
   */
  recipientHostUserId?: string;
  /** Optional admin-supplied note stored on the new payout. */
  adminNotes?: string;
  /**
   * salumi-89172: 'event' (default) or 'shipping'. Shipping coordinators
   * submit `purpose='shipping'` with `partyKitId` set.
   */
  purpose?: 'event' | 'shipping';
  /**
   * salumi-89172: UUID of the `party_kits` row the receipt is tied to.
   * Required when `purpose==='shipping'`; rejected for event payouts.
   */
  partyKitId?: string;
}

export async function createPayout(
  partyId: string,
  data: CreatePayoutData
): Promise<Payout> {
  const res = await apiRequest<{ payout: Payout }>(
    `/api/parties/${partyId}/payouts`,
    { method: 'POST', body: data, requireAuth: true }
  );
  return res.payout;
}

/**
 * porchetta-58296: designate (or clear) a photo's payout role. Host-only
 * PATCH on the gallery photo. Pass `null` to clear the role. Returns the
 * updated Photo, or null on failure.
 */
export async function designatePhotoRole(
  partyId: string,
  photoId: string,
  role: 'group' | 'box_stack' | 'pizza' | null
): Promise<Photo | null> {
  try {
    const res = await apiRequest<{ photo: Photo }>(
      `/api/parties/${partyId}/photos/${photoId}`,
      { method: 'PATCH', body: { payoutRole: role }, requireAuth: true }
    );
    return res.photo;
  } catch (error) {
    console.error('Error designating photo role:', error);
    return null;
  }
}

export interface PayoutSubmissionReadiness {
  hasGroupPhoto: boolean;
  hasBoxStackPhoto: boolean;
  hasPizzaPhoto: boolean;
  hasReceipt: boolean;
}

/**
 * porchetta-58296: drives the NewPayoutForm submit gate — whether the event
 * has all three designated role photos + at least one receipt.
 */
export async function fetchPayoutSubmissionReadiness(
  partyId: string
): Promise<PayoutSubmissionReadiness | null> {
  try {
    return await apiRequest<PayoutSubmissionReadiness>(
      `/api/parties/${partyId}/payouts/submission-readiness`,
      { requireAuth: true }
    );
  } catch (error) {
    console.error('Error fetching payout submission readiness:', error);
    return null;
  }
}

export async function listPayouts(partyId: string): Promise<Payout[]> {
  const res = await apiRequest<{ payouts: Payout[] }>(
    `/api/parties/${partyId}/payouts`,
    { requireAuth: true }
  );
  return res.payouts;
}

/**
 * ravioli-82931: returns every receipt the caller has submitted for this
 * party across ALL their payouts (any status, including withdrawn). Powers
 * the "Your receipts" section on PayoutsTab.
 */
export async function fetchReceiptsLibrary(partyId: string): Promise<ReceiptLibraryEntry[]> {
  const res = await apiRequest<{ receipts: ReceiptLibraryEntry[] }>(
    `/api/parties/${partyId}/payouts/receipts-library`,
    { requireAuth: true }
  );
  return res.receipts;
}

export async function getPayout(partyId: string, payoutId: string): Promise<Payout> {
  const res = await apiRequest<{ payout: Payout }>(
    `/api/parties/${partyId}/payouts/${payoutId}`,
    { requireAuth: true }
  );
  return res.payout;
}

export interface UpdatePayoutData {
  payoutMethod?: PayoutMethod;
  payoutWalletAddress?: string | null;
  payoutBankDetails?: BankDetails | null;
  mercuryCardLast4?: string | null;
  hostNotes?: string | null;
  finalAmountUsd?: number;
  /**
   * arugula-38633 (edit-receipts): hosts can swap receipts/photos on a
   * payout that is still `status === 'pending'`. New items are append-only
   * (no IDs); the backend OCRs new receipts and recomputes `finalAmountUsd`
   * unless an explicit value is supplied.
   */
  receiptPhotos?: Array<{
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
    // provolone-49301: optional forwarded preview-OCR payload (parity with
    // createPayout). When present the backend skips a second analyzeReceipt
    // pass and re-locks FX via convertToUSD.
    ocrOriginalAmount?: number;
    ocrOriginalCurrency?: string | null;
    ocrConfidence?: number;
    ocrLineItems?: unknown;
    ocrRaw?: unknown;
    ocrError?: string | null;
  }>;
  pizzaPhotos?: Array<{
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }>;
  // pomodoro-92110: event photos (cap 30) on edit. Append-only, mirror to the
  // gallery; total cap is enforced server-side against surviving docs.
  eventPhotos?: Array<{
    url: string;
    fileName: string;
    fileSize: number;
    mimeType: string;
  }>;
  /** IDs of existing payout_documents rows to delete (must belong to the payout). */
  removeDocumentIds?: string[];
}

export async function updatePayout(
  partyId: string,
  payoutId: string,
  data: UpdatePayoutData
): Promise<Payout> {
  const res = await apiRequest<{ payout: Payout }>(
    `/api/parties/${partyId}/payouts/${payoutId}`,
    { method: 'PATCH', body: data, requireAuth: true }
  );
  return res.payout;
}

export async function cancelPayout(partyId: string, payoutId: string): Promise<boolean> {
  await apiRequest<{ success: boolean }>(
    `/api/parties/${partyId}/payouts/${payoutId}`,
    { method: 'DELETE', requireAuth: true }
  );
  return true;
}

// ============================================================
// Reimbursement cap appeal (arugula-38633 v2)
// ============================================================

export interface ReimbursementCapAppealResponse {
  partyId: string;
  reimbursementCapUsd: number | null;
  reimbursementCapAppealNote: string | null;
  reimbursementCapAppealedAt: string | null;
}

/**
 * Host appeals the reimbursement cap. Endpoint lives outside the payouts
 * soft-launch gate so hosts can still register their objection even if they
 * can't yet submit payouts.
 */
export async function appealReimbursementCap(
  partyId: string,
  note: string
): Promise<ReimbursementCapAppealResponse> {
  return apiRequest<ReimbursementCapAppealResponse>(
    `/api/parties/${partyId}/reimbursement-cap/appeal`,
    { method: 'POST', body: { note }, requireAuth: true }
  );
}

/**
 * quattro-12847: Admin or scoped-underboss marks the latest open appeal as
 * reviewed. Returns the updated appeal row.
 */
export async function reviewReimbursementCapAppeal(
  partyId: string,
  reviewedNote?: string
): Promise<{
  id: string;
  partyId: string;
  reviewedAt: string | null;
  reviewedByUserId: string | null;
  reviewedNote: string | null;
}> {
  return apiRequest(
    `/api/parties/${partyId}/reimbursement-cap/appeals/review`,
    { method: 'POST', body: reviewedNote ? { reviewedNote } : {}, requireAuth: true }
  );
}

/**
 * quattro-12847: Fetch full appeal history for an event (newest first).
 * Admin, scoped underboss, host, or co-host-with-edit may view.
 */
export async function fetchReimbursementCapAppeals(
  partyId: string
): Promise<import('../types').ReimbursementCapAppealRecord[]> {
  const res = await apiRequest<{ appeals: import('../types').ReimbursementCapAppealRecord[] }>(
    `/api/parties/${partyId}/reimbursement-cap/appeals`,
    { method: 'GET', requireAuth: true }
  );
  return res.appeals;
}

export async function previewReceiptOCR(
  partyId: string,
  imageUrl: string
): Promise<OcrPreviewResult> {
  return apiRequest<OcrPreviewResult>(
    `/api/parties/${partyId}/payouts/ocr-preview`,
    { method: 'POST', body: { imageUrl }, requireAuth: true }
  );
}

// focaccia-89172: re-run the FX cascade for a host-supplied currency override.
// OCR sometimes misreads `₹` as `$` (etc.) — the host picks the correct code
// from a dropdown and we replace the row's USD amount + exchange rate in-place.
export interface ConvertFxResult {
  usdAmount: number;
  originalAmount: number;
  originalCurrency: string;
  exchangeRate: number;
  source: string;
  conversionNote?: string;
}

export async function convertFx(
  partyId: string,
  body: { originalAmount: number; originalCurrency: string }
): Promise<ConvertFxResult> {
  return apiRequest<ConvertFxResult>(
    `/api/parties/${partyId}/payouts/convert-fx`,
    { method: 'POST', body, requireAuth: true }
  );
}

// ============================================================
// Outreach (marinara-67583) — admin-only outreach tracker
// ============================================================

export type OutreachChannel = 'twitter_dm' | 'email' | 'telegram';
export type OutreachStatus = 'sent' | 'replied' | 'declined' | 'converted' | 'bounced';

export interface OutreachAttemptRow {
  id: string;
  channel: OutreachChannel;
  templateId: string;
  sentAt: string;
  sentBy: string;
  status: OutreachStatus;
  convertedPartyId: string | null;
  notes: string | null;
}

export interface OutreachCommunityRow {
  id: string;
  city: string;
  country: string | null;
  name: string;
  source: string;
  contactHandle: string | null;
  contactUrl: string;
  contactEmail: string | null;
  twitterHandle: string | null;
  telegramHandle: string | null;
  email: string | null;
  followerCount: number | null;
  priority: string | null;
  notes: string | null;
  lastAttempt: OutreachAttemptRow | null;
  attemptCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface OutreachFilters {
  city?: string;
  priority?: string;
  source?: string;
  status?: string; // 'none' | OutreachStatus | ''
}

export async function fetchOutreachCommunities(
  filters: OutreachFilters = {}
): Promise<OutreachCommunityRow[]> {
  const params = new URLSearchParams();
  if (filters.city) params.set('city', filters.city);
  if (filters.priority) params.set('priority', filters.priority);
  if (filters.source) params.set('source', filters.source);
  if (filters.status) params.set('status', filters.status);
  const qs = params.toString();
  const res = await apiRequest<{ communities: OutreachCommunityRow[] }>(
    `/api/underboss/outreach/communities${qs ? `?${qs}` : ''}`
  );
  return res.communities;
}

export async function logOutreachAttempt(body: {
  communityId: string;
  channel: OutreachChannel;
  templateId: string;
  notes?: string;
}): Promise<OutreachAttemptRow> {
  const res = await apiRequest<{ attempt: any }>(
    '/api/underboss/outreach/attempts',
    { method: 'POST', body }
  );
  return res.attempt;
}

export async function updateOutreachAttempt(
  id: string,
  body: { status?: OutreachStatus; convertedPartyId?: string | null; notes?: string | null }
): Promise<OutreachAttemptRow> {
  const res = await apiRequest<{ attempt: any }>(
    `/api/underboss/outreach/attempts/${id}`,
    { method: 'PATCH', body }
  );
  return res.attempt;
}

export interface OutreachPartySearchResult {
  id: string;
  name: string;
  customUrl: string | null;
  city: string | null;
}

export async function searchPartiesForOutreach(q: string): Promise<OutreachPartySearchResult[]> {
  const params = new URLSearchParams({ q });
  const res = await apiRequest<{ parties: OutreachPartySearchResult[] }>(
    `/api/underboss/outreach/parties-search?${params.toString()}`
  );
  return res.parties;
}

// =============================================================================
// pepperoni-58341: Day-of event app
// =============================================================================

export interface DayOfAnnouncement {
  id: string;
  partyId: string;
  sentBy: string;
  channels: string[];
  subject: string | null;
  body: string;
  recipientCount: number | null;
  sentAt: string;
  createdAt: string;
}

export interface AnnounceResponse {
  announcementId: string;
  recipientCount: number;
  channelsSent: { telegram: boolean; email: number };
}

export async function sendDayOfAnnouncement(
  partyId: string,
  payload: { subject?: string; body: string; channels: Array<'telegram' | 'email'> }
): Promise<AnnounceResponse> {
  return apiRequest<AnnounceResponse>(`/api/parties/${partyId}/announce`, {
    method: 'POST',
    body: payload,
    requireAuth: true,
  });
}

export async function listDayOfAnnouncements(partyId: string): Promise<DayOfAnnouncement[]> {
  const res = await apiRequest<{ announcements: DayOfAnnouncement[] }>(
    `/api/parties/${partyId}/announcements`,
    { method: 'GET', requireAuth: true }
  );
  return res.announcements;
}

export interface WalkInGuestResponse {
  guest: {
    id: string;
    name: string;
    email: string | null;
    checkedInAt: string | null;
    submittedVia: string;
    status: string;
    approved: boolean | null;
  };
  alreadyExisted?: boolean;
}

export async function addWalkInGuest(
  partyId: string,
  payload: { name: string; email?: string }
): Promise<WalkInGuestResponse> {
  return apiRequest<WalkInGuestResponse>(`/api/parties/${partyId}/guests/walk-in`, {
    method: 'POST',
    body: payload,
    requireAuth: true,
  });
}

// ============================================================
// User /me payout preferences (arugula-38633 v3)
// ============================================================

export interface UserMePayoutPrefs {
  preferredPayoutMethod: PayoutMethod | null;
  payoutWalletAddress: string | null;
  payoutBankDetails: BankDetails | null;
}

export interface UpdateUserMeInput {
  name?: string;
  defaultAddress?: string | null;
  preferredPayoutMethod?: PayoutMethod | null;
  payoutWalletAddress?: string | null;
  payoutBankDetails?: BankDetails | null;
  // marinara-71630 P7b: party in scope so the backend can hard-enforce
  // party-scoped reimbursement-option gating on this save path.
  partyId?: string;
}

/**
 * PATCH /api/user/me — persistent user record edits. arugula-38633 v3 added
 * the three payout-preference fields here so the Payment Details card on
 * the Payments tab can persist them in one round-trip.
 */
export async function updateUserMe(
  data: UpdateUserMeInput
): Promise<{ id: string; email: string; name?: string | null } & Partial<UserMePayoutPrefs>> {
  const res = await apiRequest<{
    user: { id: string; email: string; name?: string | null } & Partial<UserMePayoutPrefs>;
  }>('/api/user/me', { method: 'PATCH', body: data, requireAuth: true });
  return res.user;
}

// ============================================
// bufala-83291: per-event payment opt-in
// ============================================
// Toggles whether the current user is a prepay candidate for a specific
// event. User-pref autosave (`updateUserMe` above) still tracks HOW to pay;
// these endpoints control WHETHER a host is considered for a given event.

export interface PaymentOptInState {
  optedIn: boolean;
  optedInAt: string | null;
}

export function getPaymentOptIn(partyId: string): Promise<PaymentOptInState> {
  return apiRequest<PaymentOptInState>(`/api/parties/${partyId}/payment-opt-in`);
}

export async function submitPaymentOptIn(
  partyId: string
): Promise<{ optedIn: true; optedInAt: string }> {
  return apiRequest<{ optedIn: true; optedInAt: string }>(
    `/api/parties/${partyId}/payment-opt-in`,
    { method: 'POST' }
  );
}

export async function removePaymentOptIn(
  partyId: string
): Promise<{ optedIn: false }> {
  return apiRequest<{ optedIn: false }>(
    `/api/parties/${partyId}/payment-opt-in`,
    { method: 'DELETE' }
  );
}

// ============================================
// marinara-71630 P1: backend-decided reimbursement options
// ============================================
// The backend resolves which payout options a host may see (from private
// app_config country/tag rules); the frontend just renders them. Mirror of the
// backend `ResolvedOption` shape (backend/src/lib/reimbursementOptions.ts) —
// keep in sync.

export interface ResolvedReimbursementOption {
  id: string;
  label: string;
  description?: string;
  /** 'method' → selectable payout method; 'external' → informational card only. */
  kind: 'method' | 'external';
  url?: string;
  enabled: boolean;
  disabledReason?: string;
}

/**
 * Fetch the server-decided reimbursement options for a party. Host-only
 * (requires edit access). Returns `[]` when config is unseeded — callers
 * should fall back to a built-in default so the picker never renders empty.
 */
export async function fetchReimbursementOptions(
  partyId: string
): Promise<ResolvedReimbursementOption[]> {
  const res = await apiRequest<{ options: ResolvedReimbursementOption[] }>(
    `/api/parties/${partyId}/reimbursement-options`
  );
  return res.options ?? [];
}

// ============================================
// marinara-71630 P5: private pricing config
// (city tiers + sponsorship pricing + GPP27 reimbursement) sourced at runtime
// from GET /api/config/pricing instead of hardcoded in the open-source bundle.
// ============================================

export interface PricingConfig {
  cityTiers: { tier1: string[]; tier2: string[] };
  sponsorshipPricing: {
    tierConfig: Record<string, { floor: number; ceiling: number; max: number }>;
    base: number;
    roundTo: number;
  };
  reimbursement: {
    perHeadRates: Record<string, number>;
    ceilingUsd: number;
    attendanceRsvpCoefficient: number;
  };
  reimbursementCapBands: {
    bands: Record<string, { guestFloor: number; guestCeiling: number; minUsd: number; maxUsd: number }>;
    roundingIncrementUsd: number;
  };
}

/**
 * Fetch the admin/underboss-gated private pricing config. The city-tier lists
 * and the sponsorship/reimbursement dollar numbers used to be hardcoded in the
 * frontend bundle; they now live in `app_config` and are served by this
 * endpoint (requireAuth + requireUnderbossAuth). Callers should go through the
 * `usePricingConfig` hook, which caches the result across components.
 */
export async function fetchPricingConfig(): Promise<PricingConfig> {
  return apiRequest<PricingConfig>('/api/config/pricing');
}

// ============================================
// marinara-71630 P6 — payout caps for the payments-admin modals.
//
// The per-submission cap used to be hardcoded (`$675`) in 3 payments-admin
// modals for a UX-only warning + a client clamp. The real number now lives in
// `app_config` (private.payout_caps) and is served by GET /api/config/payout-caps,
// gated to the SAME viewer set that opens those modals (payments-admin OR an
// active underboss — a `payment_admin` doesn't pass the /pricing underboss gate,
// so this is a separate sibling endpoint). The backend remains the enforcement
// authority; this is purely for the warning text + CreatePrepaymentModal's clamp.
// ============================================

export interface PayoutCapsConfig {
  /** Per-submission soft cap (USD) — drives the modals' amber warnings + clamp. */
  perSubmissionMaxUsd: number;
  /** Per-recipient-address hard cap (USD). */
  perAddressHardCapUsd: number;
}

/**
 * Fetch the payments-admin payout caps. Callers should go through the
 * `usePayoutCaps` hook, which caches the result across components and supplies a
 * NEUTRAL fallback (never the real number) while loading / on error.
 */
export async function fetchPayoutCaps(): Promise<PayoutCapsConfig> {
  const res = await apiRequest<{ payoutCaps: PayoutCapsConfig }>(
    '/api/config/payout-caps',
  );
  return res.payoutCaps;
}

/**
 * taleggio-30219: resolve an ENS name (e.g. `vitalik.eth`) to its 0x address
 * via the backend's mainnet-resolver utility endpoint. Returns null on any
 * failure (404, 400, network). Caller uses this for the live-preview UX in
 * PayoutMethodPicker — actual persistence resolution happens server-side.
 */
export async function resolveEnsName(name: string): Promise<string | null> {
  try {
    const res = await fetch(
      `${API_URL}/api/ens/resolve?name=${encodeURIComponent(name)}`
    );
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.address === 'string' ? data.address : null;
  } catch {
    return null;
  }
}

// ============================================
// margherita-43821: public photos feed
// ============================================

export interface FeedPhoto {
  id: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  mimeType: string;
  duration: number | null;
  width: number | null;
  height: number | null;
  createdAt: string;
  // salame-58195: thumbs-up voting state
  voteCount: number;
  votedByMe: boolean;
  // napoletana-58210: the feed now unions the photos table with payout
  // pizza photos. `source` discriminates; `payoutId` is non-null when the
  // item came from the payouts side so the client can build the correct
  // vote-toggle URL. Older backends won't return these fields — keep the
  // type tolerant by defaulting to 'photo' / null at the call site.
  source?: 'photo' | 'payout';
  payoutId?: string | null;
  party: { id: string; slug: string; name: string; city: string | null; country: string | null };
}

export interface PhotosFeedResponse {
  photos: FeedPhoto[];
  nextCursor: string | null;
}

export interface PhotosFeedFilters {
  countries?: string[];      // raw country names (locale variants) sent to backend
  regions?: string[];        // GPP region ids
  partnerTag?: string | null;
  // sicilian-58195: shuffle support. When sort='random', backend uses MD5(id
  // || seed) as the order key so pagination + filters stay consistent.
  sort?: 'newest' | 'random';
  seed?: string | null;
  // cannoli-58292: event-year filter. Backend defaults to the current calendar
  // year when omitted; only photos uploaded after their event's start show.
  year?: number;
}

export async function getPhotosFeed(
  cursor: string | null,
  limit: number = 24,
  filters?: PhotosFeedFilters
): Promise<PhotosFeedResponse | null> {
  try {
    const params = new URLSearchParams();
    if (cursor) params.append('cursor', cursor);
    params.append('limit', String(limit));
    if (filters?.countries && filters.countries.length > 0) {
      params.append('countries', filters.countries.join(','));
    }
    if (filters?.regions && filters.regions.length > 0) {
      params.append('regions', filters.regions.join(','));
    }
    if (filters?.partnerTag) {
      params.append('partnerTag', filters.partnerTag);
    }
    if (filters?.sort === 'random' && filters.seed) {
      params.append('sort', 'random');
      params.append('seed', filters.seed);
    }
    // cannoli-58292: event-year filter.
    if (typeof filters?.year === 'number') {
      params.append('year', String(filters.year));
    }
    return await apiRequest<PhotosFeedResponse>(
      `/api/photos/feed?${params.toString()}`,
      { method: 'GET', requireAuth: false }
    );
  } catch (e) {
    console.error('Error fetching photos feed:', e);
    return null;
  }
}

export interface PhotosFeedFacets {
  countries: Array<{ name: string; count: number }>;
  // cannoli-58292: distinct event years available in the feed (desc). Older
  // backends won't return this — keep optional and default to [] at the call
  // site so the dropdown gracefully shows just the current year.
  years?: number[];
}

export async function getPhotosFeedFacets(): Promise<PhotosFeedFacets | null> {
  try {
    return await apiRequest<PhotosFeedFacets>(
      `/api/photos/feed/facets`,
      { method: 'GET', requireAuth: false }
    );
  } catch (e) {
    console.error('Error fetching photos feed facets:', e);
    return null;
  }
}

export async function getMyPartnerTags(): Promise<{ tags: string[] } | null> {
  try {
    return await apiRequest<{ tags: string[] }>(
      `/api/photos/feed/my-partner-tags`,
      { method: 'GET', requireAuth: false }
    );
  } catch (e) {
    console.error('Error fetching my partner tags:', e);
    return null;
  }
}

// ===========================================================================
// romana-61204: Post-event guest survey
// ===========================================================================

import type { SurveyQuestion, SurveyAnswers } from './surveyQuestions';

export interface SurveyFetchResponse {
  eventName: string;
  eventSlug: string;
  firstName: string;
  surveyEnabled: boolean;
  questionSet: SurveyQuestion[];
  questionSetVersion: number;
  alreadySubmitted: boolean;
  answers: SurveyAnswers | null;
}

// Public (token-based) — fetch the survey for a guest's /survey/:token link.
export async function fetchSurvey(token: string): Promise<SurveyFetchResponse> {
  return apiRequest<SurveyFetchResponse>(`/api/survey/${token}`, {
    method: 'GET',
    requireAuth: false,
  });
}

// Public (token-based) — submit (or resubmit) survey answers.
export async function submitSurvey(
  token: string,
  answers: SurveyAnswers
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(`/api/survey/${token}`, {
    method: 'POST',
    body: { answers },
    requireAuth: false,
  });
}

// Host — send the survey email to all CONFIRMED guests with an email.
export async function sendSurvey(
  partyId: string
): Promise<{ sent: number; failed: number; skipped: number }> {
  return apiRequest<{ sent: number; failed: number; skipped: number }>(
    `/api/parties/${partyId}/survey/send`,
    { method: 'POST', requireAuth: true }
  );
}

export interface SurveyResults {
  responseCount: number;
  questionSet: SurveyQuestion[];
  questionSetVersion: number;
  ratings: Record<string, { sum: number; count: number; average: number | null }>;
  yesno: Record<string, { yes: number; no: number }>;
  multiple: Record<string, Record<string, number>>;
  comments: Record<string, string[]>;
}

// Host — fetch aggregated survey results.
export async function getSurveyResults(partyId: string): Promise<SurveyResults> {
  return apiRequest<SurveyResults>(`/api/parties/${partyId}/survey/results`, {
    method: 'GET',
    requireAuth: true,
  });
}

// ---------------------------------------------------------------------------
// pugliese-58297: admin survey-question CRUD
// ---------------------------------------------------------------------------

export interface AdminSurveyQuestion extends SurveyQuestion {
  position: number;
  active: boolean;
}

export interface AdminSurveyQuestionsResponse {
  questionSet: string;
  version: number;
  questions: AdminSurveyQuestion[];
}

export async function listAdminSurveyQuestions(
  set: string = 'default'
): Promise<AdminSurveyQuestionsResponse> {
  return apiRequest<AdminSurveyQuestionsResponse>(
    `/api/admin/survey-questions?set=${encodeURIComponent(set)}`,
    { method: 'GET', requireAuth: true }
  );
}

export interface AdminSurveyQuestionInput {
  id: string;
  questionSet?: string;
  type: 'rating' | 'yesno' | 'multiple' | 'text';
  text: string;
  scale?: number | null;
  multi?: boolean;
  allowOther?: boolean;
  options?: string[];
  active?: boolean;
  position?: number;
}

export async function createAdminSurveyQuestion(
  body: AdminSurveyQuestionInput
): Promise<{ question: AdminSurveyQuestion }> {
  return apiRequest<{ question: AdminSurveyQuestion }>('/api/admin/survey-questions', {
    method: 'POST',
    body,
    requireAuth: true,
  });
}

export async function updateAdminSurveyQuestion(
  id: string,
  body: Partial<AdminSurveyQuestionInput>,
  set: string = 'default'
): Promise<{ question: AdminSurveyQuestion }> {
  return apiRequest<{ question: AdminSurveyQuestion }>(
    `/api/admin/survey-questions/${encodeURIComponent(id)}?set=${encodeURIComponent(set)}`,
    { method: 'PATCH', body, requireAuth: true }
  );
}

export async function reorderAdminSurveyQuestions(
  orderedIds: string[],
  set: string = 'default'
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>('/api/admin/survey-questions/reorder', {
    method: 'POST',
    body: { set, orderedIds },
    requireAuth: true,
  });
}

export async function updateAdminSurveyQuestionSet(
  setId: string,
  body: { version?: number }
): Promise<{ questionSet: { id: string; version: number; updatedAt: string } }> {
  return apiRequest<{ questionSet: { id: string; version: number; updatedAt: string } }>(
    `/api/admin/survey-question-sets/${encodeURIComponent(setId)}`,
    { method: 'PATCH', body, requireAuth: true }
  );
}

// ============================================
// Tax forms (salame-92110)
// ============================================

export async function getMyTaxForms(): Promise<TaxForm[]> {
  const res = await apiRequest<{ taxForms: TaxForm[] }>(`/api/tax-forms/me`, {
    requireAuth: true,
  });
  return res.taxForms;
}

export async function saveTaxFormDraft(
  formType: TaxFormType,
  formData: Record<string, any>,
): Promise<TaxForm> {
  const res = await apiRequest<{ taxForm: TaxForm }>(`/api/tax-forms/draft`, {
    method: 'POST',
    body: { formType, formData },
    requireAuth: true,
  });
  return res.taxForm;
}

export async function submitTaxForm(
  formType: TaxFormType,
  formData?: Record<string, any>,
): Promise<TaxForm> {
  const res = await apiRequest<{ taxForm: TaxForm }>(`/api/tax-forms/submit`, {
    method: 'POST',
    body: formData ? { formType, formData } : { formType },
    requireAuth: true,
  });
  return res.taxForm;
}

export interface ListAdminTaxFormsFilters {
  status?: TaxFormStatus;
  formType?: TaxFormType;
  userId?: string;
  expiringWithinDays?: number;
}

export async function listAdminTaxForms(
  filters: ListAdminTaxFormsFilters = {},
): Promise<TaxForm[]> {
  const params = new URLSearchParams();
  if (filters.status) params.set('status', filters.status);
  if (filters.formType) params.set('formType', filters.formType);
  if (filters.userId) params.set('userId', filters.userId);
  if (filters.expiringWithinDays != null)
    params.set('expiringWithinDays', String(filters.expiringWithinDays));
  const qs = params.toString();
  const res = await apiRequest<{ taxForms: TaxForm[] }>(
    `/api/admin/tax-forms${qs ? `?${qs}` : ''}`,
    { requireAuth: true },
  );
  return res.taxForms;
}

export async function getAdminTaxForm(id: string): Promise<TaxForm> {
  const res = await apiRequest<{ taxForm: TaxForm }>(`/api/admin/tax-forms/${id}`, {
    requireAuth: true,
  });
  return res.taxForm;
}

export async function verifyTaxForm(id: string): Promise<TaxForm> {
  const res = await apiRequest<{ taxForm: TaxForm }>(
    `/api/admin/tax-forms/${id}/verify`,
    { method: 'POST', requireAuth: true },
  );
  return res.taxForm;
}

export async function rejectTaxForm(id: string, reason: string): Promise<TaxForm> {
  const res = await apiRequest<{ taxForm: TaxForm }>(
    `/api/admin/tax-forms/${id}/reject`,
    { method: 'POST', body: { reason }, requireAuth: true },
  );
  return res.taxForm;
}

// ===========================================================================
// soppressata-50927 — GPP27 (Bitcoin Pizza Day 2027) admin/UB-gated flow.
// ===========================================================================

export interface Gpp27AgreementClause {
  id: string;
  version: string;
  sortOrder: number;
  body: string;
  requiresAck: boolean;
}

export interface Gpp27AgreementResponse {
  version: string | null;
  clauses: Gpp27AgreementClause[];
}

export async function fetchGpp27Agreement(): Promise<Gpp27AgreementResponse> {
  return apiRequest<Gpp27AgreementResponse>('/api/gpp27/agreement');
}

export interface Gpp27BudgetSuggestion {
  city: string;
  tier: 1 | 2 | 3;
  perHeadRate: number;
  lastYearEstimatedAttendance: number | null;
  currentRsvpCount: number;
  expectedAttendance: number;
  rawSuggestedCapUsd: number;
  suggestedCapUsd: number;
  ceilingUsd: number;
}

export async function fetchGpp27BudgetSuggestion(
  city: string,
  partyId?: string,
): Promise<Gpp27BudgetSuggestion> {
  const qs = new URLSearchParams({ city });
  if (partyId) qs.set('partyId', partyId);
  return apiRequest<Gpp27BudgetSuggestion>(`/api/gpp27/budget-suggestion?${qs.toString()}`);
}

export interface Gpp27CreateEventInput {
  city: string;
  hostName: string;
  email: string;
  telegram: string;
  country?: string;
  countryCode?: string;
  cityFormattedName?: string;
  cityLat?: number;
  cityLng?: number;
  timezone?: string;
}

export interface Gpp27CreateEventResponse {
  success: boolean;
  event: {
    id: string;
    name: string;
    inviteCode: string;
    customUrl: string | null;
    city: string | null;
    region: string | null;
    year: number;
  };
  eventPageUrl: string;
  hostPageUrl: string;
}

export async function createGpp27Event(input: Gpp27CreateEventInput): Promise<Gpp27CreateEventResponse> {
  return apiRequest<Gpp27CreateEventResponse>('/api/gpp27/events', {
    method: 'POST',
    body: input,
  });
}

export async function setGpp27Budget(
  partyId: string,
  reimbursementCapUsd: number,
): Promise<{ success: boolean; reimbursementCapUsd: number; ceilingUsd: number }> {
  return apiRequest(`/api/gpp27/parties/${partyId}/budget`, {
    method: 'PATCH',
    body: { reimbursementCapUsd },
  });
}

export async function acceptGpp27Agreement(
  partyId: string,
): Promise<{ success: boolean; agreementVersion: string; agreementAcceptedAt: string }> {
  return apiRequest(`/api/gpp27/parties/${partyId}/agreement/accept`, { method: 'POST' });
}

export interface Gpp27PublishStatus {
  partyId: string;
  agreementSigned: boolean;
  agreementVersionMatches: boolean;
  hasMerchAddress: boolean;
  currentAgreementVersion: string | null;
  signedAgreementVersion: string | null;
  canPublish: boolean;
}

export async function fetchGpp27PublishStatus(partyId: string): Promise<Gpp27PublishStatus> {
  return apiRequest<Gpp27PublishStatus>(`/api/gpp27/parties/${partyId}/publish-status`);
}

export async function publishGpp27Event(partyId: string): Promise<{ success: boolean; published: boolean }> {
  return apiRequest(`/api/gpp27/parties/${partyId}/publish`, { method: 'POST' });
}

// scarpetta-58472: site-wide suggestions list (admin / underboss view-only).
export interface Suggestion {
  id: string; createdAt: string; body: string;
  imageUrl: string | null; name: string | null; email: string | null;
  pageUrl: string | null; status: string;
  aiSummary: string | null; aiTags: string[] | null;
}
export async function fetchSuggestions() {
  return apiRequest<{ suggestions: Suggestion[] }>('/api/suggestions');
}

// =============================================================================
// Saved filter views (montanara-58497) — per-account, keyed by auth email.
// `params` is the page's serialized URL query string (page-agnostic).
// =============================================================================
export type SavedViewScope = 'payments' | 'underboss';

export interface SavedView {
  id: string;
  name: string;
  params: string;
  updatedAt: string;
}

export async function listSavedViews(scope: SavedViewScope): Promise<SavedView[]> {
  const { views } = await apiRequest<{ views: SavedView[] }>(
    `/api/saved-views?scope=${encodeURIComponent(scope)}`,
  );
  return views;
}

export async function saveFilterView(
  scope: SavedViewScope,
  name: string,
  params: string,
): Promise<SavedView> {
  return apiRequest<SavedView>('/api/saved-views', {
    method: 'POST',
    body: { scope, name, params },
  });
}

export async function deleteSavedView(id: string): Promise<void> {
  await apiRequest<{ ok: boolean }>(`/api/saved-views/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
