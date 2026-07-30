import { test, expect, type Page } from '@playwright/test';
import { TOOLS } from '../../src/shared/registry.ts';

/**
 * The theme toggle, tested against the built site because the parts most likely
 * to break are invisible anywhere else: the pre-paint bootstrap is inline script,
 * which only the real CSP can reject, and only a real browser resolves
 * `prefers-color-scheme` and `color-scheme` at all.
 */

const LIGHT_BG = 'rgb(251, 251, 250)'; // --bg light  #fbfbfa
const DARK_BG = 'rgb(20, 22, 26)'; //    --bg dark   #14161a

const bg = (page: Page) =>
  page.evaluate(() => getComputedStyle(document.body).backgroundColor);
const attr = (page: Page) =>
  page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const stored = (page: Page) => page.evaluate(() => localStorage.getItem('tools:theme'));

test.describe('following the system', () => {
  test.use({ colorScheme: 'dark' });

  test('uses the dark palette with no stored preference', async ({ page }) => {
    await page.goto('./');
    expect(await attr(page)).toBeNull();
    expect(await bg(page)).toBe(DARK_BG);
    expect(await stored(page)).toBeNull();
  });
});

test.describe('overriding the system', () => {
  test.use({ colorScheme: 'dark' });

  test('forcing light beats a dark system setting', async ({ page }) => {
    await page.goto('./');
    await page.locator('.theme-toggle').click(); // system -> light
    expect(await attr(page)).toBe('light');
    expect(await bg(page)).toBe(LIGHT_BG);
  });

  /**
   * Scrollbars and form controls follow `color-scheme`, not our custom
   * properties, so without the per-theme override a forced-light page kept dark
   * scrollbars framing it.
   */
  test('color-scheme tracks the override, not the OS', async ({ page }) => {
    await page.goto('./');
    const scheme = () =>
      page.evaluate(() => getComputedStyle(document.documentElement).colorScheme);

    await page.locator('.theme-toggle').click(); // light
    expect(await scheme()).toBe('light');
    await page.locator('.theme-toggle').click(); // dark
    expect(await scheme()).toBe('dark');
  });
});

test('the toggle cycles system, light, dark and back', async ({ page }) => {
  await page.goto('./encoding/');
  const button = page.locator('.theme-toggle');
  await expect(button).toBeVisible();

  await expect(button).toHaveAttribute('aria-label', /Theme: System\. Switch to light\./);

  await button.click();
  expect(await attr(page)).toBe('light');
  expect(await stored(page)).toBe('light');

  await button.click();
  expect(await attr(page)).toBe('dark');
  expect(await stored(page)).toBe('dark');

  await button.click();
  expect(await attr(page)).toBeNull();
  // Back to the default leaves no trace, rather than storing the word "system".
  expect(await stored(page)).toBeNull();
});

/**
 * The reason the bootstrap is inline in the head rather than in the bundle: a
 * theme applied after the bundle loads shows a flash of the wrong palette on
 * every navigation.
 */
test('a stored theme is applied without the bundle running at all', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('tools:theme', 'dark'));

  // Block every module chunk. Vite emits the stylesheet as its own <link>, so the
  // page still has its CSS but no application code whatsoever — if the theme is
  // still applied, only the head script can have done it. Sampling early in a
  // normal load would race the very thing under test.
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('./encoding/');

  expect(await attr(page)).toBe('dark');
  expect(await bg(page)).toBe(DARK_BG);
  // Proof the bundle really did not run: the shell never rendered.
  await expect(page.locator('footer.foot')).toHaveCount(0);
});

test('the inline bootstrap is permitted by the page CSP', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });

  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('tools:theme', 'dark'));

  // Every page carries the same hash, so check them all rather than assuming the
  // generator wrote it consistently.
  for (const path of ['./', ...TOOLS.map((t) => `./${t.slug}/`)]) {
    await page.goto(path);
    expect(await attr(page), path).toBe('dark');
  }

  // A hash mismatch surfaces as a CSP console error, not a thrown exception.
  expect(problems.filter((p) => /Content Security Policy|unsafe-inline/i.test(p))).toEqual([]);
  expect(problems).toEqual([]);
});

test('the choice survives navigation between tools', async ({ page }) => {
  await page.goto('./encoding/');
  await page.locator('.theme-toggle').click();
  await page.locator('.theme-toggle').click(); // dark

  await page.goto('./cidr/');
  expect(await attr(page)).toBe('dark');
  await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-label', /Theme: Dark/);

  await page.goto('./');
  expect(await attr(page)).toBe('dark');
});

test('a junk stored value falls back to the system instead of breaking', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => localStorage.setItem('tools:theme', 'chartreuse'));
  await page.goto('./encoding/');

  expect(await attr(page)).toBeNull();
  await expect(page.locator('.theme-toggle')).toHaveAttribute('aria-label', /Theme: System/);
});
