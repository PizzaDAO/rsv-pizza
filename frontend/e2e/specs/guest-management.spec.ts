import { test, expect, Page } from '@playwright/test';
import {
  blockExternalScripts,
  mockPhotoStats,
  mockNotableAttendees,
  mockUserPreferences,
} from '../mocks/api-handlers';
import { injectAuth, TEST_USER } from '../fixtures/auth.fixture';

const MOCK_PARTY = {
  id: 'party-id-002',
  name: 'Guest Management Party',
  invite_code: 'guest-mgmt-123',
  custom_url: null,
  date: '2026-06-01T18:00:00.000Z',
  timezone: 'America/New_York',
  address: '100 Guest Blvd, Manhattan, NY 10001',
  max_guests: 100,
  hide_guests: false,
  require_approval: true,
  user_id: TEST_USER.id,
  co_hosts: [],
  event_type: null,
  pinned_apps: [],
  event_image_url: null,
  description: null,
  donation_enabled: false,
  pizza_style: 'new-york',
  available_beverages: [],
  available_toppings: [],
  selected_pizzerias: [],
  host_name: 'Test Host',
  rsvp_closed_at: null,
  venue_name: null,
  duration: 3,
  donation_recipient: null,
  donation_recipient_url: null,
  donation_goal: null,
  donation_message: null,
  suggested_amounts: [],
  donation_eth_address: null,
  share_to_unlock: false,
  share_tweet_text: null,
  photo_moderation: false,
  nft_enabled: false,
  nft_chain: null,
  event_tags: [],
  created_at: '2026-01-01T00:00:00.000Z',
};

const MOCK_DB_GUESTS = [
  {
    id: 'g1',
    party_id: 'party-id-002',
    name: 'Alice Margherita',
    email: 'alice@pizza.com',
    ethereum_address: null,
    roles: [],
    dietary_restrictions: [],
    liked_toppings: ['pepperoni'],
    disliked_toppings: ['anchovies'],
    liked_beverages: [],
    disliked_beverages: [],
    mailing_list_opt_in: false,
    status: 'CONFIRMED',
    waitlist_position: null,
    submitted_at: '2026-05-01T12:00:00.000Z',
    checked_in_at: null,
    checked_in_by: null,
    pizzeria_rankings: [],
    suggested_pizzerias: [],
    nft_token_id: null,
    nft_transaction_hash: null,
  },
  {
    id: 'g2',
    party_id: 'party-id-002',
    name: 'Bob Pepperoni',
    email: 'bob@pizza.com',
    ethereum_address: null,
    roles: [],
    dietary_restrictions: [],
    liked_toppings: [],
    disliked_toppings: [],
    liked_beverages: [],
    disliked_beverages: [],
    mailing_list_opt_in: false,
    status: 'CONFIRMED',
    waitlist_position: null,
    submitted_at: '2026-05-01T13:00:00.000Z',
    checked_in_at: null,
    checked_in_by: null,
    pizzeria_rankings: [],
    suggested_pizzerias: [],
    nft_token_id: null,
    nft_transaction_hash: null,
  },
  {
    id: 'g3',
    party_id: 'party-id-002',
    name: 'Carol Calzone',
    email: 'carol@pizza.com',
    ethereum_address: null,
    roles: [],
    dietary_restrictions: [],
    liked_toppings: [],
    disliked_toppings: [],
    liked_beverages: [],
    disliked_beverages: [],
    mailing_list_opt_in: false,
    status: 'PENDING',
    waitlist_position: null,
    submitted_at: '2026-05-01T14:00:00.000Z',
    checked_in_at: null,
    checked_in_by: null,
    pizzeria_rankings: [],
    suggested_pizzerias: [],
    nft_token_id: null,
    nft_transaction_hash: null,
  },
  {
    id: 'g4',
    party_id: 'party-id-002',
    name: 'Dave Diavola',
    email: 'dave@pizza.com',
    ethereum_address: null,
    roles: [],
    dietary_restrictions: [],
    liked_toppings: [],
    disliked_toppings: [],
    liked_beverages: [],
    disliked_beverages: [],
    mailing_list_opt_in: false,
    status: 'CONFIRMED',
    waitlist_position: null,
    submitted_at: '2026-05-01T15:00:00.000Z',
    checked_in_at: null,
    checked_in_by: null,
    pizzeria_rankings: [],
    suggested_pizzerias: [],
    nft_token_id: null,
    nft_transaction_hash: null,
  },
];

async function setupGuestManagementMocks(page: Page) {
  await Promise.all([
    blockExternalScripts(page),
    mockPhotoStats(page),
    mockNotableAttendees(page),
    mockUserPreferences(page),

    // Mock Supabase parties query
    page.route('**/*.supabase.co/rest/v1/parties*', (route, request) => {
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(MOCK_PARTY),
          headers: { 'content-range': '0-0/1' },
        });
      }
      return route.fallback();
    }),

    // Mock Supabase guests query — return all mock guests
    page.route('**/*.supabase.co/rest/v1/guests*', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(MOCK_DB_GUESTS),
      });
    }),

    // Mock other tables
    page.route('**/*.supabase.co/rest/v1/social_posts*', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route('**/*.supabase.co/rest/v1/notable_attendees*', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),
    page.route('**/*.supabase.co/rest/v1/user_preferences*', (route) => {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }),

    // Mock backend API endpoints
    page.route('**/api/parties/*/co-hosts/enrich', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ coHosts: [] }),
      });
    }),
    page.route('**/api/events/*/photos/stats', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ photoCount: 0, uploaderCount: 0 }),
      });
    }),
  ]);
}

test.describe('Guest Management', () => {
  test.beforeEach(async ({ page }) => {
    await injectAuth(page);
    await setupGuestManagementMocks(page);
  });

  test('guest list renders all guests', async ({ page }) => {
    await page.goto('/host/guest-mgmt-123/guests');

    // Wait for guest list to load
    await expect(page.locator('text=Alice Margherita')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('text=Bob Pepperoni')).toBeVisible();
    await expect(page.locator('text=Dave Diavola')).toBeVisible();
  });

  test('search filters guests by name', async ({ page }) => {
    await page.goto('/host/guest-mgmt-123/guests');

    // Wait for guest list to load
    await expect(page.locator('text=Alice Margherita')).toBeVisible({ timeout: 15000 });

    // Use search input
    const searchInput = page.locator('[data-testid="guest-search"]');
    await expect(searchInput).toBeVisible();

    await searchInput.fill('alice');

    // Alice should still be visible
    await expect(page.locator('text=Alice Margherita')).toBeVisible();

    // Bob and Dave should be filtered out
    await expect(page.locator('text=Bob Pepperoni')).not.toBeVisible();
    await expect(page.locator('text=Dave Diavola')).not.toBeVisible();
  });

  test('search filters guests by email', async ({ page }) => {
    await page.goto('/host/guest-mgmt-123/guests');

    await expect(page.locator('text=Alice Margherita')).toBeVisible({ timeout: 15000 });

    const searchInput = page.locator('[data-testid="guest-search"]');
    await searchInput.fill('bob@pizza');

    // Bob should be visible
    await expect(page.locator('text=Bob Pepperoni')).toBeVisible();

    // Others should be filtered
    await expect(page.locator('text=Alice Margherita')).not.toBeVisible();
  });

  test('search with no results shows no-match message', async ({ page }) => {
    await page.goto('/host/guest-mgmt-123/guests');

    await expect(page.locator('text=Alice Margherita')).toBeVisible({ timeout: 15000 });

    const searchInput = page.locator('[data-testid="guest-search"]');
    await searchInput.fill('nonexistent');

    // Should show "No guests match" message
    await expect(page.locator('text=No guests match')).toBeVisible();
  });
});
