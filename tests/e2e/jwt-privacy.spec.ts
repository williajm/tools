import { test, expect } from '@playwright/test';
import { SignJWT } from 'jose';

// Deliberately synthetic credentials used only by these browser tests.
const KEY = 'jwt-privacy-test-secret-0123456789';
const makeToken = () =>
  new SignJWT({ sub: 'jwt-privacy-test' })
    .setProtectedHeader({ alg: 'HS256' })
    .sign(new TextEncoder().encode(KEY));

const fragment = (token: string) =>
  Buffer.from(encodeURIComponent(JSON.stringify({ token }))).toString('base64').replace(/=+$/, '');

test('JWT decoding and verification keep credentials out of URLs and storage', async ({ page }) => {
  const token = await makeToken();
  await page.goto('./jwt/');
  const cleanUrl = page.url();

  await page.getByLabel('Token', { exact: true }).fill(token);
  await expect(page.locator('pre.output').nth(1)).toContainText('jwt-privacy-test');
  await page.getByPlaceholder('The HMAC secret…').fill(KEY);
  await page.getByRole('button', { name: 'Verify', exact: true }).click();
  await expect(page.locator('.note--ok')).toContainText('Signature is valid for HS256.');

  // The old behaviour saved the token after a debounce. Let pending writes run
  // before checking, otherwise this regression could pass before the leak.
  await page.waitForTimeout(500);
  await expect(page).toHaveURL(cleanUrl);
  expect(await page.evaluate(() => ({
    local: { ...localStorage },
    session: { ...sessionStorage },
    history: history.state,
  }))).toEqual({ local: {}, session: {}, history: null });

  await page.reload();
  await expect(page.getByLabel('Token', { exact: true })).toHaveValue('');
  await expect(page.locator('pre.output')).toHaveCount(0);
  await page.getByLabel('Token', { exact: true }).fill(token);
  await expect(page.getByPlaceholder('The HMAC secret…')).toHaveValue('');
});

test('old JWT share links are stripped without restoring their tokens', async ({ page }) => {
  const token = await makeToken();
  await page.goto(`./jwt/?view=jwt#${fragment(token)}`);
  const cleanUrl = new URL(page.url());
  cleanUrl.hash = '';

  await expect(page).toHaveURL(cleanUrl.href);
  await expect(page.getByLabel('Token', { exact: true })).toHaveValue('');
  await expect(page.locator('pre.output')).toHaveCount(0);

  // A fragment can also arrive during same-document navigation. It must not
  // replace the user's current input or remain in the address bar.
  await page.getByLabel('Token', { exact: true }).fill(token);
  await page.evaluate((hash) => { window.location.hash = hash; }, fragment('another-old-token'));
  await expect(page).toHaveURL(cleanUrl.href);
  await expect(page.getByLabel('Token', { exact: true })).toHaveValue(token);

  await page.reload();
  await expect(page.getByLabel('Token', { exact: true })).toHaveValue('');
  await expect(page).toHaveURL(cleanUrl.href);
});
