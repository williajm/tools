import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests run against the *built* site served by `vite preview`, not
 * the dev server. The build is what ships, and only the build carries the CSP
 * meta tag (dev strips it so HMR can connect) — testing dev would skip the one
 * guarantee most worth checking.
 */

const PORT = 4173;
const BASE = process.env.BASE_PATH ?? '/tools/';
// Bind and poll the same literal address. `vite preview` otherwise listens on
// `localhost`, which resolves to ::1 first on the GitHub runners while this
// check polls 127.0.0.1 — the server comes up and is never found.
const HOST = '127.0.0.1';
const URL = `http://${HOST}:${PORT}${BASE}`;

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
    // CI has already run `npm run build`, so rebuilding here would do the same
    // work twice. Locally the build is included, since `npm run test:e2e` on its
    // own has to have something to serve.
    command: [
      process.env.PLAYWRIGHT_SKIP_BUILD ? null : 'npm run build',
      `npx vite preview --host ${HOST} --port ${PORT} --strictPort`,
    ]
      .filter(Boolean)
      .join(' && '),
    url: URL,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
