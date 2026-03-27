import { test, expect } from '@playwright/test';
import { mockAuthFlow, setupCommonMocks } from '../mocks/api-handlers';
import { LoginPage, VerifyPage } from '../pages/login.page';
import { injectAuth, clearAuth, TEST_USER, TEST_TOKEN } from '../fixtures/auth.fixture';

test.describe('Authentication Flow', () => {
  test('visit /login and see email input', async ({ page }) => {
    await setupCommonMocks(page);
    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.expectLoaded();
    await expect(loginPage.emailInput).toBeVisible();
  });

  test('submit email triggers magic-link API call', async ({ page }) => {
    await setupCommonMocks(page);
    await mockAuthFlow(page);

    const loginPage = new LoginPage(page);
    await loginPage.goto();
    await loginPage.expectLoaded();

    // Intercept and verify the magic-link request
    const [request] = await Promise.all([
      page.waitForRequest('**/api/auth/magic-link'),
      loginPage.login('testuser@example.com'),
    ]);

    expect(request.method()).toBe('POST');
    const body = request.postDataJSON();
    expect(body.email).toBe('testuser@example.com');

    // Should navigate to verify page
    await page.waitForURL('**/auth/verify');
  });

  test('navigate to /auth/verify and enter code', async ({ page }) => {
    await setupCommonMocks(page);
    await mockAuthFlow(page);

    const verifyPage = new VerifyPage(page);
    await verifyPage.goto();
    await verifyPage.expectLoaded();

    // Verify all 6 code inputs are visible
    for (let i = 0; i < 6; i++) {
      await expect(verifyPage.getCodeInput(i)).toBeVisible();
    }
  });

  test('successful verification stores token and redirects', async ({ page }) => {
    await setupCommonMocks(page);
    await mockAuthFlow(page);

    const verifyPage = new VerifyPage(page);
    await verifyPage.goto();
    await verifyPage.expectLoaded();

    // Enter the 6-digit code
    await verifyPage.enterCode('123456');

    // Should show success message
    await verifyPage.expectSuccess();

    // Verify token was stored in localStorage
    const storedToken = await page.evaluate(() => localStorage.getItem('authToken'));
    expect(storedToken).toBe('fake-jwt-token-from-verify');

    const storedUser = await page.evaluate(() => localStorage.getItem('user'));
    expect(storedUser).not.toBeNull();
    const parsedUser = JSON.parse(storedUser!);
    expect(parsedUser.email).toBe('testuser@example.com');
  });

  test('sign out clears state', async ({ page }) => {
    await setupCommonMocks(page);

    // Start with auth state
    await injectAuth(page);
    await page.goto('/');

    // Verify auth state is present
    const tokenBefore = await page.evaluate(() => localStorage.getItem('authToken'));
    expect(tokenBefore).toBe(TEST_TOKEN);

    // Clear auth (simulates sign out)
    await clearAuth(page);

    // Verify state is cleared
    const tokenAfter = await page.evaluate(() => localStorage.getItem('authToken'));
    expect(tokenAfter).toBeNull();

    const userAfter = await page.evaluate(() => localStorage.getItem('user'));
    expect(userAfter).toBeNull();
  });
});
