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

test('visiting a tool records nothing in localStorage', async ({ page }) => {
  // Recents was the only thing that wrote there; the site should now store
  // nothing on the machine at all.
  await page.goto('./hash/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hash & HMAC');

  const stored = await page.evaluate(() =>
    Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, i) => {
        const key = localStorage.key(i)!;
        return [key, localStorage.getItem(key)];
      }),
    ),
  );
  expect(stored).toEqual({});
});
