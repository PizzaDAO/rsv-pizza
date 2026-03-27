import { Page } from '@playwright/test';
import { TestPublicEvent, TestRSVPResponse, TestGuest } from '../fixtures/test-data';

const API_URL = process.env.VITE_API_URL || 'http://localhost:3006';

/**
 * Mock the GET /api/events/:slug endpoint to return a specific event.
 */
export async function mockEventAPI(page: Page, event: TestPublicEvent) {
  await page.route(`**/api/events/*`, (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ event }),
      });
    }
    return route.fallback();
  });
}

/**
 * Mock the POST /api/rsvp/:inviteCode/guest endpoint.
 */
export async function mockRSVPSubmission(page: Page, response: TestRSVPResponse) {
  await page.route(`**/api/rsvp/*/guest`, (route, request) => {
    if (request.method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response),
      });
    }
    return route.fallback();
  });
}

/**
 * Mock the magic-link and verify-code auth endpoints.
 */
export async function mockAuthFlow(page: Page, options: {
  isNewUser?: boolean;
  verifyResponse?: any;
} = {}) {
  const { isNewUser = false } = options;

  // Mock POST /api/auth/magic-link
  await page.route(`**/api/auth/magic-link`, (route, request) => {
    if (request.method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Code sent', isNewUser }),
      });
    }
    return route.fallback();
  });

  // Mock POST /api/auth/verify-code
  const defaultVerifyResponse = options.verifyResponse || {
    accessToken: 'fake-jwt-token-from-verify',
    user: {
      id: 'verified-user-001',
      email: 'testuser@example.com',
      name: isNewUser ? null : 'Test User',
    },
  };

  await page.route(`**/api/auth/verify-code`, (route, request) => {
    if (request.method() === 'POST') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(defaultVerifyResponse),
      });
    }
    return route.fallback();
  });

  // Mock PATCH /api/user/me (name update for new users)
  await page.route(`**/api/user/me`, (route, request) => {
    if (request.method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          user: {
            id: 'verified-user-001',
            email: 'testuser@example.com',
            name: 'New User Name',
          },
        }),
      });
    }
    return route.fallback();
  });
}

/**
 * Mock Supabase direct queries (*.supabase.co/rest/v1/*).
 * Returns empty arrays by default for any table query.
 */
export async function mockSupabaseQueries(page: Page, responses: Record<string, any> = {}) {
  await page.route(`**/*.supabase.co/rest/v1/*`, (route, request) => {
    const url = request.url();

    // Check for specific table responses
    for (const [tableName, data] of Object.entries(responses)) {
      if (url.includes(`/rest/v1/${tableName}`)) {
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(data),
        });
      }
    }

    // Default: return empty array for GET, success for POST/PATCH
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    }

    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ id: 'mock-id' }),
    });
  });
}

/**
 * Mock the party API endpoints (GET/POST/PATCH /api/parties/*).
 */
export async function mockPartyAPI(page: Page, partyData: any) {
  // Mock GET party
  await page.route(`**/api/parties/*`, (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ party: partyData }),
      });
    }
    if (request.method() === 'PATCH') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ party: { ...partyData, ...JSON.parse(request.postData() || '{}') } }),
      });
    }
    return route.fallback();
  });

  // Mock POST /api/parties (create)
  await page.route(`**/api/parties`, (route, request) => {
    if (request.method() === 'POST') {
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ party: partyData }),
      });
    }
    return route.fallback();
  });
}

/**
 * Mock the guests list endpoint.
 */
export async function mockGuestsAPI(page: Page, guests: TestGuest[]) {
  await page.route(`**/api/rsvp/*/guests`, (route, request) => {
    if (request.method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ guests }),
      });
    }
    return route.fallback();
  });
}

/**
 * Mock the guest approval/decline endpoints.
 */
export async function mockGuestActions(page: Page) {
  // Approve
  await page.route(`**/api/rsvp/*/guest/*/approve`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  // Decline
  await page.route(`**/api/rsvp/*/guest/*/decline`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });

  // Delete
  await page.route(`**/api/rsvp/*/guest/*`, (route, request) => {
    if (request.method() === 'DELETE') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true }),
      });
    }
    return route.fallback();
  });
}

/**
 * Mock the check-in endpoint.
 */
export async function mockCheckInAPI(page: Page) {
  await page.route(`**/api/rsvp/*/checkin/*`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true }),
    });
  });
}

/**
 * Block external scripts that aren't needed in tests (Google Maps, Stripe, etc.)
 */
export async function blockExternalScripts(page: Page) {
  await page.route('**/*.googleapis.com/**', (route) => route.abort());
  await page.route('**/js.stripe.com/**', (route) => route.abort());
  await page.route('**/maps.google.com/**', (route) => route.abort());
}

/**
 * Mock user preferences endpoint (for RSVP auto-fill).
 */
export async function mockUserPreferences(page: Page, preferences: any = null) {
  await page.route(`**/api/user/preferences*`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(preferences || { preferences: null }),
    });
  });

  // Also mock the Supabase direct query for user_preferences
  await page.route(`**/*.supabase.co/rest/v1/user_preferences*`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(preferences ? [preferences] : []),
    });
  });
}

/**
 * Mock photo stats endpoint.
 */
export async function mockPhotoStats(page: Page) {
  await page.route(`**/api/events/*/photos/stats`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ photoCount: 0, uploaderCount: 0 }),
    });
  });
}

/**
 * Mock notable attendees endpoint.
 */
export async function mockNotableAttendees(page: Page) {
  await page.route(`**/api/events/*/notable-attendees`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });

  await page.route(`**/*.supabase.co/rest/v1/notable_attendees*`, (route) => {
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([]),
    });
  });
}

/**
 * Set up all common mocks needed for most test scenarios.
 */
export async function setupCommonMocks(page: Page) {
  await blockExternalScripts(page);
  await mockSupabaseQueries(page);
  await mockUserPreferences(page);
  await mockPhotoStats(page);
  await mockNotableAttendees(page);
}
