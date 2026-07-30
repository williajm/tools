import { test, expect } from '@playwright/test';

/**
 * Wiring checks: the logic has unit tests, so these only prove that each page
 * is plumbed to it and renders a real answer in a real browser.
 */

test('encoding round-trips through base64', async ({ page }) => {
  await page.goto('./encoding/');
  await page.getByLabel('Input').fill('hello');
  await expect(page.getByText('aGVsbG8=')).toBeVisible();
});

test('the CIDR calculator derives a subnet', async ({ page }) => {
  await page.goto('./cidr/');
  await page.getByLabel('IP address or CIDR block').fill('10.20.30.40/22');

  await expect(page.getByRole('row', { name: /Netmask/ })).toContainText('255.255.252.0');
  await expect(page.getByRole('row', { name: /Network address/ })).toContainText('10.20.28.0');
  await expect(page.getByRole('row', { name: /Broadcast address/ })).toContainText('10.20.31.255');
  await expect(page.getByRole('row', { name: /Usable addresses/ })).toContainText('1 022');
  await expect(page.getByRole('row', { name: /Scope/ })).toContainText('Private (RFC 1918)');
});

test('the CIDR calculator rejects a malformed address', async ({ page }) => {
  await page.goto('./cidr/');
  await page.getByLabel('IP address or CIDR block').fill('300.1.1.1');
  await expect(page.getByText('is not a valid IPv4 or IPv6 address')).toBeVisible();
});

test('the diff shows added and removed lines side by side', async ({ page }) => {
  await page.goto('./diff/');
  await page.getByLabel('Left').fill('alpha\nbravo\ncharlie');
  await page.getByLabel('Right').fill('alpha\ndelta\ncharlie');

  await expect(page.locator('.diff__del')).toHaveText(['bravo']);
  await expect(page.locator('.diff__ins')).toHaveText(['delta']);
});

test('the diff reports identical input as identical', async ({ page }) => {
  await page.goto('./diff/');
  await page.getByLabel('Left').fill('same');
  await page.getByLabel('Right').fill('same');
  await expect(page.getByText('No differences')).toBeVisible();
});

test('the diff marks the words that changed, not just the lines', async ({ page }) => {
  await page.goto('./diff/');
  await page.getByLabel('Left').fill('jumps over the lazy dog');
  await page.getByLabel('Right').fill('leaps over the lazy dog');

  await expect(page.locator('.diff__del .diff__word')).toHaveText(['jumps']);
  await expect(page.locator('.diff__ins .diff__word')).toHaveText(['leaps']);
});

test('the CIDR ruler shows where the network stops', async ({ page }) => {
  await page.goto('./cidr/');
  await page.getByLabel('IP address or CIDR block').fill('172.16.0.0/12');

  await expect(page.locator('.ruler__mark')).toHaveText('/12');
  await expect(page.locator('.ruler__cell--network')).toHaveCount(12);
  await expect(page.locator('.ruler__cell--host')).toHaveCount(20);
});
