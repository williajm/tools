import { test, expect } from '@playwright/test';
import { CATEGORIES, TOOLS } from '../../src/shared/registry.ts';

/**
 * The information architecture, which is now just the card grid: no search box,
 * no command palette, no recents. That makes the grid the only route to a tool,
 * so these check every tool is actually reachable from it.
 */

test('a card navigates to its tool', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: /Pairwise matrix/ }).click();
  await expect(page).toHaveURL(/\/pairwise\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pairwise matrix');
});

test('every tool has a card on the home page', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.card')).toHaveCount(TOOLS.length);
  for (const tool of TOOLS) {
    await expect(page.locator('.card__name').filter({ hasText: tool.name }).first()).toBeVisible();
  }
});

test('the cards are grouped under every category in registry order', async ({ page }) => {
  await page.goto('./');
  await expect(page.locator('.cat-head')).toHaveText([...CATEGORIES]);
});

test('the removed navigation is gone', async ({ page }) => {
  // Asserted rather than assumed: a stale bundle would still carry these.
  for (const path of ['./', './encoding/']) {
    await page.goto(path);
    await expect(page.locator('footer.foot')).toBeVisible();
    await expect(page.getByLabel('Search tools')).toHaveCount(0);
    await expect(page.locator('.topbar__hint')).toHaveCount(0);

    // Ctrl-K must do nothing at all now.
    await page.keyboard.press('Control+k');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
});

/**
 * Removing recents left the site writing nothing to the machine. The theme
 * toggle is the one thing that can write since, and only on an explicit choice —
 * 'system' clears its key rather than storing the word — so simply using a tool
 * must still leave storage untouched.
 */
test('using a tool records nothing in localStorage', async ({ page }) => {
  const contents = () =>
    page.evaluate(() =>
      Object.fromEntries(
        Array.from({ length: localStorage.length }, (_, i) => {
          const key = localStorage.key(i)!;
          return [key, localStorage.getItem(key)];
        }),
      ),
    );

  await page.goto('./hash/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hash & HMAC');
  await page.getByLabel('Input').fill('something to hash');
  await expect(page.locator('pre.output')).not.toBeEmpty();
  expect(await contents()).toEqual({});

  await page.goto('./');
  expect(await contents()).toEqual({});

  // Choosing a theme is the only thing that may write, and returning to the
  // default must clear it again.
  const toggle = page.locator('.theme-toggle');
  await toggle.click();
  expect(await contents()).toEqual({ 'tools:theme': 'light' });
  await toggle.click();
  await toggle.click();
  expect(await contents()).toEqual({});
});
