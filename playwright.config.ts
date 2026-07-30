import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the *built* site served by `vite preview`, not
 * the dev server. The build is what ships, and only the build carries the CSP
 * meta tag (dev strips it so HMR can connect) — testing dev would skip the one
 * guarantee most worth checking.
 */

const PORT = 4173;
const BASE = process.env.BASE_PATH ?? '/tools/';
const URL = `http://127.0.0.1:${PORT}${BASE}`;

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: URL,
    trace: 'on-first-retry',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run build && npx vite preview --port ${PORT} --strictPort`,
    url: URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
