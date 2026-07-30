import { test, expect, type Page } from '@playwright/test';

/** The information architecture: search, the Ctrl-K palette, and recents. */

/**
 * Opens the command palette.
 *
 * `goto` resolves as soon as the document loads, which on a client-rendered
 * page is before the effect that binds the Ctrl-K listener has run — a keypress
 * sent in that gap is simply lost. Waiting for the rendered shell covers the
 * usual case, and retrying covers the rest.
 */
async function openPalette(page: Page) {
  await expect(page.locator('footer.foot')).toBeVisible();
  const palette = page.getByRole('dialog', { name: 'Find a tool' });
  await expect(async () => {
    await page.keyboard.press('Control+k');
    await expect(palette).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  return palette;
}

test('search narrows the index', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Search tools').fill('b64');

  // Subsequence matching, so "b64" should still find Base64 encoding.
  await expect(page.locator('.card__name').first()).toHaveText('Encoding');
  await expect(page.locator('.card')).not.toHaveCount(13);
});

test('search says so when nothing matches', async ({ page }) => {
  await page.goto('./');
  await page.getByLabel('Search tools').fill('zzzzqqq');
  await expect(page.getByText('No tool matches')).toBeVisible();
});

test('a card navigates to its tool', async ({ page }) => {
  await page.goto('./');
  await page.getByRole('link', { name: /Pairwise matrix/ }).click();
  await expect(page).toHaveURL(/\/pairwise\/$/);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Pairwise matrix');
});

test('Ctrl-K reaches another tool from a tool page', async ({ page }) => {
  await page.goto('./encoding/');
  const palette = await openPalette(page);

  await palette.getByLabel('Find a tool').fill('cidr');
  await expect(palette.getByRole('option').first()).toContainText('CIDR');

  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cidr\/$/);
});

test('Escape closes the palette', async ({ page }) => {
  await page.goto('./encoding/');
  const palette = await openPalette(page);
  await page.keyboard.press('Escape');
  await expect(palette).toBeHidden();
});

test('a visited tool appears under Recent', async ({ page }) => {
  await page.goto('./hash/');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Hash & HMAC');

  await page.goto('./');
  const recent = page.locator('.cat-head', { hasText: 'Recent' });
  await expect(recent).toBeVisible();
  // The Recent grid is the one immediately after that heading.
  await expect(recent.locator('+ .card-grid .card__name')).toHaveText(['Hash & HMAC']);
});
