import { Page, Locator, expect } from '@playwright/test';

/**
 * Page object for the RSVPModal component.
 */
export class RSVPPage {
  readonly page: Page;
  readonly nameInput: Locator;
  readonly emailInput: Locator;
  readonly nextButton: Locator;
  readonly submitButton: Locator;
  readonly successMessage: Locator;
  readonly modal: Locator;

  constructor(page: Page) {
    this.page = page;
    this.nameInput = page.locator('[data-testid="rsvp-name"]');
    this.emailInput = page.locator('[data-testid="rsvp-email"]');
    this.nextButton = page.locator('[data-testid="rsvp-next"]');
    this.submitButton = page.locator('[data-testid="rsvp-submit"]');
    this.successMessage = page.locator('[data-testid="rsvp-success"]');
    this.modal = page.locator('[data-testid="rsvp-modal"]');
  }

  async expectOpen() {
    await expect(this.modal).toBeVisible({ timeout: 5000 });
  }

  async fillStep1(name: string, email?: string) {
    await this.nameInput.fill(name);
    if (email) {
      await this.emailInput.fill(email);
    }
  }

  async goToStep2() {
    await this.nextButton.click();
  }

  async submit() {
    await this.submitButton.click();
  }

  async expectSuccess() {
    await expect(this.successMessage).toBeVisible({ timeout: 10000 });
  }

  async expectWaitlisted() {
    await expect(this.page.getByRole('heading', { name: /on the Waitlist/i })).toBeVisible({ timeout: 10000 });
  }

  async expectPendingApproval() {
    await expect(this.page.locator('text=pending approval')).toBeVisible({ timeout: 10000 });
  }

  async expectUpdated() {
    await expect(this.page.locator('text=RSVP Updated')).toBeVisible({ timeout: 10000 });
  }

  async toggleDietaryRestriction(label: string) {
    await this.page.locator(`text=${label}`).first().click();
  }
}
