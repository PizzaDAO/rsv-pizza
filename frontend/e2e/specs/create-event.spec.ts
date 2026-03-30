import { test, expect } from '@playwright/test';
import { setupCommonMocks, mockPartyAPI, blockExternalScripts } from '../mocks/api-handlers';
import { injectAuth, TEST_USER } from '../fixtures/auth.fixture';

test.describe('Create Event', () => {
  test('authenticated user fills event form and submits', async ({ page }) => {
    await setupCommonMocks(page);
    await blockExternalScripts(page);
    await injectAuth(page);

    // Mock the party creation endpoint
    const mockParty = {
      id: 'new-party-id',
      name: 'My New Pizza Party',
      invite_code: 'new-invite-123',
      inviteCode: 'new-invite-123',
      custom_url: null,
    };

    await page.route('**/api/parties', (route, request) => {
      if (request.method() === 'POST') {
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ party: mockParty }),
        });
      }
      return route.fallback();
    });

    // Mock Supabase storage upload
    await page.route('**/*.supabase.co/storage/**', (route) => {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ Key: 'test-image.jpg' }),
      });
    });

    // Navigate to the create event page
    await page.goto('/');

    // Fill the party name
    const nameInput = page.locator('[data-testid="event-form-name"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('My New Pizza Party');

    // Verify the submit button is visible
    const submitButton = page.locator('[data-testid="event-form-submit"]');
    await expect(submitButton).toBeVisible();
    await expect(submitButton).toContainText('Create Party');

    // Submit the form
    await submitButton.click();

    // Should navigate to the host page after creation
    await page.waitForURL('**/host/**', { timeout: 10000 });
  });

  test('unauthenticated user sees login modal on submit', async ({ page }) => {
    await setupCommonMocks(page);
    await blockExternalScripts(page);

    // Do NOT inject auth — user is not logged in

    await page.goto('/');

    // Fill the party name
    const nameInput = page.locator('[data-testid="event-form-name"]');
    await expect(nameInput).toBeVisible({ timeout: 10000 });
    await nameInput.fill('Party Without Login');

    // Submit the form
    const submitButton = page.locator('[data-testid="event-form-submit"]');
    await submitButton.click();

    // Should show login modal since user is not authenticated
    await expect(page.locator('text=Log In or Sign Up')).toBeVisible({ timeout: 5000 });
  });
});
