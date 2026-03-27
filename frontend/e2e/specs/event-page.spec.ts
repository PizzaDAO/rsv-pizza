import { test, expect } from '@playwright/test';
import { mockEventAPI, setupCommonMocks, mockRSVPSubmission } from '../mocks/api-handlers';
import { makePublicEvent, makeRSVPSuccess } from '../fixtures/test-data';
import { EventPage } from '../pages/event.page';

test.describe('Public Event Page', () => {
  test('visit /:slug loads event data and displays event info', async ({ page }) => {
    await setupCommonMocks(page);

    const event = makePublicEvent({
      name: 'Pepperoni Party',
      date: '2026-05-01T18:00:00.000Z',
      address: '456 Cheese Ave, Brooklyn, NY 11201',
    });
    await mockEventAPI(page, event);

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();

    // Event name should be displayed
    await expect(eventPage.eventName).toHaveText('Pepperoni Party');

    // Date should be displayed
    await expect(eventPage.eventDate).toBeVisible();

    // Address should be displayed
    await expect(eventPage.eventAddress).toBeVisible();
    await expect(eventPage.eventAddress).toContainText('456 Cheese Ave');
  });

  test('RSVP button is visible and clickable', async ({ page }) => {
    await setupCommonMocks(page);

    const event = makePublicEvent({ name: 'Click Test Party' });
    await mockEventAPI(page, event);
    await mockRSVPSubmission(page, makeRSVPSuccess());

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();

    // RSVP button should be visible
    await expect(eventPage.rsvpButton).toBeVisible();
    await expect(eventPage.rsvpButton).toContainText('RSVP');

    // Click should open the modal
    await eventPage.clickRSVP();
    await expect(page.locator('[data-testid="rsvp-modal"]')).toBeVisible();
  });

  test('password-protected event shows password prompt', async ({ page }) => {
    await setupCommonMocks(page);

    const event = makePublicEvent({
      name: 'Secret Pizza Party',
      hasPassword: true,
    });
    await mockEventAPI(page, event);

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');

    // Should show password prompt
    await eventPage.expectPasswordPrompt();

    // Password input should be visible
    await expect(eventPage.passwordInput).toBeVisible();
  });

  test('RSVPs closed shows closed state', async ({ page }) => {
    await setupCommonMocks(page);

    const event = makePublicEvent({
      name: 'Closed Event',
      rsvpClosedAt: '2026-04-01T00:00:00.000Z',
    });
    await mockEventAPI(page, event);

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();

    // RSVPs closed text should be visible
    await eventPage.expectRSVPsClosed();
  });

  test('event with no date does not show date section', async ({ page }) => {
    await setupCommonMocks(page);

    const event = makePublicEvent({
      name: 'TBD Party',
      date: null,
    });
    await mockEventAPI(page, event);

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();

    // Date section should not be visible
    await expect(eventPage.eventDate).not.toBeVisible();
  });
});
