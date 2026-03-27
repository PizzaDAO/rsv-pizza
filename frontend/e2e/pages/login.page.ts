import { Page, Locator, expect } from '@playwright/test';

/**
 * Page object for the LoginPage (/login) and AuthVerifyPage (/auth/verify).
 */
export class LoginPage {
  readonly page: Page;
  readonly emailInput: Locator;
  readonly submitButton: Locator;
  readonly errorMessage: Locator;

  constructor(page: Page) {
    this.page = page;
    this.emailInput = page.locator('[data-testid="login-email"]');
    this.submitButton = page.locator('[data-testid="login-submit"]');
    this.errorMessage = page.locator('.bg-\\[\\#ff393a\\]\\/10');
  }

  async goto() {
    await this.page.goto('/login');
  }

  async expectLoaded() {
    await expect(this.page.locator('text=Log In or Sign Up')).toBeVisible({ timeout: 10000 });
  }

  async fillEmail(email: string) {
    await this.emailInput.fill(email);
  }

  async submit() {
    await this.submitButton.click();
  }

  async login(email: string) {
    await this.fillEmail(email);
    await this.submit();
  }
}

export class VerifyPage {
  readonly page: Page;

  constructor(page: Page) {
    this.page = page;
  }

  async goto() {
    await this.page.goto('/auth/verify');
  }

  async expectLoaded() {
    await expect(this.page.locator('text=Enter Your Code')).toBeVisible({ timeout: 10000 });
  }

  getCodeInput(index: number) {
    return this.page.locator(`[data-testid="verify-code-${index}"]`);
  }

  async enterCode(code: string) {
    const digits = code.split('');
    for (let i = 0; i < digits.length; i++) {
      await this.getCodeInput(i).fill(digits[i]);
    }
  }

  async expectSuccess() {
    await expect(this.page.locator('text=Welcome back!')).toBeVisible({ timeout: 10000 });
  }

  async expectError() {
    await expect(this.page.locator('text=Verification Failed')).toBeVisible({ timeout: 10000 });
  }
}
