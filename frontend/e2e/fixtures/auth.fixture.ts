import { test as base, Page } from '@playwright/test';

/**
 * Fake user and JWT for authenticated test scenarios.
 * Sets localStorage values to bypass the magic link flow entirely.
 */
export const TEST_USER = {
  id: 'test-user-cuid-001',
  email: 'testuser@example.com',
  name: 'Test User',
};

export const TEST_TOKEN = 'fake-jwt-token-for-testing';

/**
 * Injects auth state into the browser before navigating.
 * Must be called BEFORE page.goto() because React reads localStorage on mount.
 */
export async function injectAuth(page: Page, user = TEST_USER, token = TEST_TOKEN) {
  await page.addInitScript(
    ({ user, token }) => {
      localStorage.setItem('authToken', token);
      localStorage.setItem('user', JSON.stringify(user));
    },
    { user, token },
  );
}

/**
 * Clears auth state from the browser.
 */
export async function clearAuth(page: Page) {
  await page.evaluate(() => {
    localStorage.removeItem('authToken');
    localStorage.removeItem('user');
  });
}

/**
 * Extended test fixture that provides an `authenticatedPage` already
 * configured with auth state injected into localStorage.
 */
export const test = base.extend<{ authenticatedPage: Page }>({
  authenticatedPage: async ({ page }, use) => {
    await injectAuth(page);
    await use(page);
  },
});

export { expect } from '@playwright/test';
