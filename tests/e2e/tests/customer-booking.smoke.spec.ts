import { test, expect, type Page } from '@playwright/test';

/**
 * Customer booking — smoke + the four 2026-10-18 checkout fixes.
 *
 * READ-ONLY and STOPS BEFORE PAYMENT: it never taps Pay, so no real booking or
 * customer record is created. Synthetic test data only.
 *
 * NOTE: these selectors are written against the live SPA as observed on
 * 2026-10-18. They may need tuning on the first CI run (there is no local Node
 * to dry-run them). Keep them text/role based so copy changes are easy to track.
 */

const TEST = { name: 'QA Test Booking', email: 'qa-test@eventanauae.com', phone: '0501234567' };

/** First visit shows an onboarding name gate — skip it if present. */
async function skipOnboarding(page: Page) {
  const skip = page.getByRole('button', { name: /skip for now/i });
  if (await skip.isVisible().catch(() => false)) await skip.click();
}

/** Dismiss the welcome-discount popup if it is up. */
async function dismissPromo(page: Page) {
  const later = page.getByText(/maybe later/i);
  if (await later.isVisible().catch(() => false)) await later.click();
}

test.describe('Customer website — booking journey', () => {
  test('home loads and the WELCOME10 welcome popup shows (fix #1)', async ({ page }) => {
    await page.goto('/');
    await skipOnboarding(page);
    // The per-session welcome popup advertises the WELCOME10 code.
    await expect(page.getByText('WELCOME10').first()).toBeVisible();
    await expect(page.getByText(/10% off/i).first()).toBeVisible();
  });

  test('package booking keeps its package + progress when adding a catalogue item (fixes #2, #3, #4)', async ({ page }) => {
    await page.goto('/');
    await skipOnboarding(page);
    await dismissPromo(page);

    // Pick a package → castle colour → theme → checkout.
    await page.getByText('Golden Birthday Package').first().click();
    // Some packages need a bouncy-castle colour before continuing.
    const snow = page.getByText('Snow', { exact: true });
    if (await snow.isVisible().catch(() => false)) await snow.click();
    await page.getByRole('button', { name: /continue — choose theme/i }).click();

    await page.getByText('Snow White').first().click();
    await page.getByRole('button', { name: /select this theme/i }).click();
    await page.getByRole('button', { name: /continue — review & pay/i }).click();

    // Step 1 → fill the wizard up to the add-ons step.
    await expect(page.getByText(/step 1 of 6/i)).toBeVisible();
    await page.getByRole('button', { name: /next/i }).click();

    // Step 2 — emirate + "pin later".
    await page.getByRole('button', { name: 'Dubai', exact: true }).click();
    await page.getByText(/pin the exact location later/i).click();
    await page.getByRole('button', { name: /next/i }).click();

    // Step 3 — date is prefilled; pick a start time.
    await page.getByRole('button', { name: '5:00 PM' }).click();
    await page.getByRole('button', { name: /next/i }).click();

    // Step 4 — guest contact details.
    await page.getByPlaceholder(/full name/i).fill(TEST.name);
    await page.getByPlaceholder(/^email/i).fill(TEST.email);
    await page.getByPlaceholder(/mobile number \*/i).fill(TEST.phone);
    await page.getByRole('button', { name: /next/i }).click();

    // Step 5 — the "Add more items" button must be present for a package booking.
    await expect(page.getByText(/step 5 of 6/i)).toBeVisible();
    const addMore = page.getByRole('button', { name: /add more items from the catalogue/i });
    await expect(addMore).toBeVisible();
    await addMore.click();

    // It must land on Build Your Own WITH the package intact (not the intake).
    await expect(page.getByText(/build your own/i)).toBeVisible();

    // Add a food station (needs a kiosk colour), then return to checkout.
    await page.getByText('Corn Station').first().scrollIntoViewIfNeeded();
    // The "+" add control sits in the Corn Station row; add it, pick a colour, confirm.
    await page.getByText('Corn Station').first().locator('xpath=ancestor::*[self::div][1]').getByRole('button').first().click();
    const pink = page.getByRole('button', { name: 'pink', exact: true });
    if (await pink.isVisible().catch(() => false)) await pink.click();
    const addToParty = page.getByRole('button', { name: /add to my party/i });
    if (await addToParty.isVisible().catch(() => false)) await addToParty.click();
    await page.getByRole('button', { name: /continue — review/i }).click();

    // FIX #3 — back on step 5, NOT thrown to step 1.
    await expect(page.getByText(/step 5 of 6/i)).toBeVisible();

    // Advance to the review step.
    await page.getByRole('button', { name: /next/i }).click();
    await expect(page.getByText(/step 6 of 6/i)).toBeVisible();

    // FIX #4 — the package survived and the added item is present.
    await expect(page.getByText('Golden Birthday Package')).toBeVisible();
    await expect(page.getByText('Corn Station')).toBeVisible();

    // FIX #2 — the available-code hint shows above the discount field.
    await expect(page.getByText(/you have code\s*WELCOME10/i)).toBeVisible();

    // FIX #3 — typed contact details survived the catalogue round-trip.
    await page.getByRole('button', { name: /back/i }).click(); // → step 5
    await page.getByRole('button', { name: /back/i }).click(); // → step 4
    await expect(page.getByPlaceholder(/full name/i)).toHaveValue(TEST.name);
    await expect(page.getByPlaceholder(/^email/i)).toHaveValue(TEST.email);

    // Hard stop: never proceed to payment.
  });
});
