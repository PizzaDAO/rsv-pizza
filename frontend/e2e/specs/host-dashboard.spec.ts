import { test, expect } from '@playwright/test';
import {
  blockExternalScripts,
  mockPhotoStats,
  mockNotableAttendees,
  mockUserPreferences,
} from '../mocks/api-handlers';
import { injectAuth, TEST_USER } from '../fixtures/auth.fixture';

const MOCK_PARTY = {
  id: 'party-id-001',
  name: 'Host Test Party',
  invite_code: 'host-test-123',
  custom_url: null,
  date: '2026-06-01T18:00:00.000Z',
  timezone: 'America/New_York',
  address: '789 Host St, Manhattan, NY 10001',
  max_guests: 50,
  hide_guests: false,
  require_approval: false,
  user_id: TEST_USER.id,
  co_hosts: [],
  event_type: null,
  pinned_apps: [],
  event_image_url: null,
  description: 'A test party for host dashboard',
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

function setupHostPageMocks(page: import('@playwright/test').Page, partyOverrides: any = {}) {
  const party = { ...MOCK_PARTY, ...partyOverrides };

  // Mock Supabase direct queries for parties table
  return Promise.all([
    blockExternalScripts(page),
    mockPhotoStats(page),
    mockNotableAttendees(page),
    mockUserPreferences(page),

    // Mock Supabase parties query (both custom_url and invite_code lookups)
    page.route('**/*.supabase.co/rest/v1/parties*', (route, request) => {
      const url = request.url();
      if (request.method() === 'GET') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(party),
          headers: {
            'content-range': '0-0/1',
          },
        });
      }
      if (request.method() === 'PATCH') {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([party]),
        });
      }
      return route.fallback();
    }),

    // Mock Supabase guests query
    page.route('**/*.supabase.co/rest/v1/guests*', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }),

    // Mock other Supabase tables
    page.route('**/*.supabase.co/rest/v1/social_posts*', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }),

    page.route('**/*.supabase.co/rest/v1/notable_attendees*', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }),

    page.route('**/*.supabase.co/rest/v1/user_preferences*', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }),

    // Mock backend API endpoints used by host page
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

test.describe('Host Dashboard', () => {
  test('tab navigation works', async ({ page }) => {
    await injectAuth(page);
    await setupHostPageMocks(page);

    await page.goto('/host/host-test-123');

    // Wait for the page to load
    await expect(page.locator('[data-testid="host-tab-details"]')).toBeVisible({ timeout: 15000 });

    // Click guests tab
    const guestsTab = page.locator('[data-testid="host-tab-guests"]');
    await expect(guestsTab).toBeVisible();
    await guestsTab.click();

    // URL should update
    await page.waitForURL('**/host/host-test-123/guests');

    // Click pizza tab
    const pizzaTab = page.locator('[data-testid="host-tab-pizza"]');
    await expect(pizzaTab).toBeVisible();
    await pizzaTab.click();

    await page.waitForURL('**/host/host-test-123/pizza');

    // Click photos tab
    const photosTab = page.locator('[data-testid="host-tab-photos"]');
    await expect(photosTab).toBeVisible();
    await photosTab.click();

    await page.waitForURL('**/host/host-test-123/photos');
  });

  test('non-owner is redirected', async ({ page }) => {
    await injectAuth(page);
    await setupHostPageMocks(page, { user_id: 'different-user-id' });

    await page.goto('/host/host-test-123');

    // Should redirect to the RSVP page since user is not the owner
    await page.waitForURL('**/rsvp/host-test-123', { timeout: 15000 });
  });
});
