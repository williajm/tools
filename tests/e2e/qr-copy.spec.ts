import { test, expect, type Page } from '@playwright/test';

/**
 * Copying the QR code as an image.
 *
 * Only a browser can tell you whether this works: `ClipboardItem` does not exist
 * in jsdom, the write needs a user gesture and a secure context, and the whole
 * point is what ends up on the system clipboard rather than what the code
 * intended to put there.
 */

/**
 * Matches the button in every state. Locating it by the label the assertion
 * expects it to change to would stop matching the moment it succeeds.
 */
const copyImageButton = (page: Page) =>
  page.getByRole('button', { name: /Copy image|Copied|Copy failed/ });

test.beforeEach(async ({ context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
});

test('copies the QR code to the clipboard as a PNG', async ({ page }) => {
  await page.goto('./qr/');

  const button = copyImageButton(page);
  await expect(button).toBeEnabled();
  await button.click();
  await expect(button).toHaveText('Copied');

  const clipboard = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    const blob = await items[0]!.getType('image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return { types: items.flatMap((i) => i.types), size: bytes.length, magic: [...bytes.slice(0, 4)] };
  });

  expect(clipboard.types).toContain('image/png');
  // The PNG magic number: this is a decoded image, not its source text.
  expect(clipboard.magic).toEqual([0x89, 0x50, 0x4e, 0x47]);
  expect(clipboard.size).toBeGreaterThan(100);
});

test('the clipboard image is the code that is on screen', async ({ page }) => {
  await page.goto('./qr/');
  await page.getByRole('textbox', { name: 'Text' }).fill('https://example.com/first');
  await copyImageButton(page).click();
  await expect(copyImageButton(page)).toHaveText('Copied');

  const first = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await (await items[0]!.getType('image/png')).arrayBuffer()).byteLength;
  });

  // A different payload must produce a different image, not a stale one.
  await page.getByRole('textbox', { name: 'Text' }).fill('https://example.com/a-much-longer-second-payload-here');
  await expect(copyImageButton(page)).toHaveText('Copy image');
  await copyImageButton(page).click();
  await expect(copyImageButton(page)).toHaveText('Copied');

  const second = await page.evaluate(async () => {
    const items = await navigator.clipboard.read();
    return (await (await items[0]!.getType('image/png')).arrayBuffer()).byteLength;
  });

  expect(second).not.toBe(first);
});

test('copying an image needs no network permission the CSP withholds', async ({ page }) => {
  // The obvious implementation fetches the data URL to get a Blob, which
  // `connect-src 'none'` refuses. Decoding it by hand avoids that, so this asserts
  // no request is attempted and nothing is logged.
  const problems: string[] = [];
  const requests: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(message.text());
  });
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('./qr/');
  const before = requests.length;
  await copyImageButton(page).click();
  await expect(copyImageButton(page)).toHaveText('Copied');

  expect(requests.slice(before)).toEqual([]);
  expect(problems).toEqual([]);
});

test('the payload is still copyable as text, and the PNG downloadable', async ({ page }) => {
  await page.goto('./qr/');
  await page.getByRole('textbox', { name: 'Text' }).fill('https://example.com/x');

  await page.getByRole('button', { name: /Copy payload|Copied/ }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('https://example.com/x');

  await expect(page.locator('a[download="qr.png"]')).toHaveAttribute('href', /^data:image\/png;base64,/);
});

test('the SVG source is no longer offered as a copy', async ({ page }) => {
  await page.goto('./qr/');
  await expect(page.getByRole('button', { name: 'Copy SVG' })).toHaveCount(0);
  // The code itself is still rendered as inline SVG.
  await expect(page.locator('svg').first()).toBeVisible();
});
