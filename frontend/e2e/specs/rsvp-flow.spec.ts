import { test, expect } from '@playwright/test';
import {
  mockEventAPI,
  mockRSVPSubmission,
  setupCommonMocks,
  mockUserPreferences,
} from '../mocks/api-handlers';
import {
  makePublicEvent,
  makeRSVPSuccess,
  makeWaitlistedRSVP,
  makePendingApprovalRSVP,
} from '../fixtures/test-data';
import { EventPage } from '../pages/event.page';
import { RSVPPage } from '../pages/rsvp.page';

test.describe('RSVP Flow', () => {
  let event: ReturnType<typeof makePublicEvent>;

  test.beforeEach(async ({ page }) => {
    await setupCommonMocks(page);
    event = makePublicEvent({ name: 'RSVP Test Party' });
    await mockEventAPI(page, event);
  });

  test('open RSVP modal from event page', async ({ page }) => {
    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();

    await eventPage.clickRSVP();

    const rsvpPage = new RSVPPage(page);
    await rsvpPage.expectOpen();

    // Should show step 1 with name and email inputs
    await expect(rsvpPage.nameInput).toBeVisible();
    await expect(rsvpPage.emailInput).toBeVisible();
  });

  test('fill Step 1: name and email, then advance to Step 2', async ({ page }) => {
    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();
    await eventPage.clickRSVP();

    const rsvpPage = new RSVPPage(page);
    await rsvpPage.expectOpen();

    // Fill step 1
    await rsvpPage.fillStep1('John Pizza', 'john@pizza.com');

    // Click next to go to step 2
    await rsvpPage.goToStep2();

    // Step 2 should now be visible (pizza preferences)
    await expect(page.locator('text=Step 2 of 2')).toBeVisible();
  });

  test('submit RSVP and see success confirmation', async ({ page }) => {
    await mockRSVPSubmission(page, makeRSVPSuccess());

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();
    await eventPage.clickRSVP();

    const rsvpPage = new RSVPPage(page);
    await rsvpPage.expectOpen();

    // Step 1
    await rsvpPage.fillStep1('Jane Doe', 'jane@example.com');
    await rsvpPage.goToStep2();

    // Step 2 - just submit with defaults
    await expect(page.locator('text=Step 2 of 2')).toBeVisible();
    await rsvpPage.submit();

    // Should see success
    await rsvpPage.expectSuccess();
    await expect(page.locator(`text=See you at ${event.name}!`)).toBeVisible();
  });

  test('waitlisted response shows waitlist position', async ({ page }) => {
    await mockRSVPSubmission(page, makeWaitlistedRSVP(5));

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();
    await eventPage.clickRSVP();

    const rsvpPage = new RSVPPage(page);
    await rsvpPage.expectOpen();

    // Fill and submit
    await rsvpPage.fillStep1('Wait Lister', 'wait@list.com');
    await rsvpPage.goToStep2();
    await rsvpPage.submit();

    // Should see waitlist message
    await rsvpPage.expectWaitlisted();
    await expect(page.locator('text=#5 on the waitlist')).toBeVisible();
  });

  test('require-approval response shows pending message', async ({ page }) => {
    await mockRSVPSubmission(page, makePendingApprovalRSVP());

    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();
    await eventPage.clickRSVP();

    const rsvpPage = new RSVPPage(page);
    await rsvpPage.expectOpen();

    // Fill and submit
    await rsvpPage.fillStep1('Pending Person', 'pending@approval.com');
    await rsvpPage.goToStep2();
    await rsvpPage.submit();

    // Should see pending approval message
    await rsvpPage.expectPendingApproval();
  });

  test('name is required to advance to step 2', async ({ page }) => {
    const eventPage = new EventPage(page);
    await eventPage.goto('abc123');
    await eventPage.expectLoaded();
    await eventPage.clickRSVP();

    const rsvpPage = new RSVPPage(page);
    await rsvpPage.expectOpen();

    // Try to advance without filling name (name input has required attribute)
    // The browser's built-in validation will prevent form submission
    await rsvpPage.goToStep2();

    // Should still be on step 1
    await expect(page.locator('text=Step 1 of 2')).toBeVisible();
  });
});
