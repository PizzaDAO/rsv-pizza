import { Page, Locator, expect } from '@playwright/test';

/**
 * Page object for the public EventPage (/:slug).
 */
export class EventPage {
  readonly page: Page;
  readonly eventName: Locator;
  readonly eventDate: Locator;
  readonly eventAddress: Locator;
  readonly rsvpButton: Locator;
  readonly passwordInput: Locator;
  readonly passwordSubmit: Locator;
  readonly rsvpClosedText: Locator;
  readonly guestCount: Locator;
  readonly editRsvpButton: Locator;

  constructor(page: Page) {
    this.page = page;
    this.eventName = page.locator('[data-testid="event-name"]');
    this.eventDate = page.locator('[data-testid="event-date"]');
    this.eventAddress = page.locator('[data-testid="event-address"]');
    this.rsvpButton = page.locator('[data-testid="rsvp-button"]');
    this.passwordInput = page.locator('[data-testid="password-input"]');
    this.passwordSubmit = page.locator('[data-testid="password-submit"]');
    this.rsvpClosedText = page.locator('text=RSVPs are closed for this event');
    this.guestCount = page.locator('[data-testid="guest-count"]');
    this.editRsvpButton = page.locator('button:has-text("Edit RSVP")');
  }

  async goto(slug: string) {
    await this.page.goto(`/${slug}`);
  }

  async expectLoaded() {
    await expect(this.eventName).toBeVisible({ timeout: 10000 });
  }

  async clickRSVP() {
    await this.rsvpButton.click();
  }

  async enterPassword(password: string) {
    await this.passwordInput.fill(password);
    await this.passwordSubmit.click();
  }

  async expectPasswordPrompt() {
    await expect(this.page.locator('text=Password Required')).toBeVisible({ timeout: 10000 });
  }

  async expectRSVPsClosed() {
    await expect(this.rsvpClosedText).toBeVisible();
  }
}
