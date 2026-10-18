import { defineConfig, devices } from '@playwright/test';

/**
 * Eventana end-to-end config.
 *
 * Target is chosen by BASE_URL (defaults to the live customer site). There is no
 * staging environment, so the customer suite is written to be READ-ONLY and to
 * STOP before payment — it never creates a real booking. Point BASE_URL at a PR
 * preview or a local `vite preview` when one is available.
 */
const BASE_URL = process.env.BASE_URL || 'https://eventanauae.com';

export default defineConfig({
  testDir: './tests',
  // Prod is shared and occasionally slow (maps, cold API) — be patient, not flaky.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    actionTimeout: 15_000,
  },
  projects: [
    // Customers book on phones — the mobile viewport is the primary surface.
    { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
  ],
});
