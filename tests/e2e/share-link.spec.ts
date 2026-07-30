import { test, expect } from '@playwright/test';
import { TOOLS } from '../../src/shared/registry.ts';

/**
 * State lives in the URL fragment, which browsers never send to a server. These
 * tests hold that promise to account: the link must restore the work, and the
 * input must never appear in anything sent over the wire.
 */

test('the fragment restores the input after a reload', async ({ page }) => {
  await page.goto('./encoding/');

  const input = page.getByLabel('Input');
  await input.fill('smuggled through the fragment');

  // useHashState debounces the history write.
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toBe('');
  const shared = page.url();

  await page.goto(shared);
  await expect(page.getByLabel('Input')).toHaveValue('smuggled through the fragment');
});

test('a shared link carries state to a fresh session', async ({ browser }) => {
  const author = await browser.newPage();
  await author.goto('./encoding/');
  await author.getByLabel('Input').fill('hello from another tab');
  await expect.poll(() => author.evaluate(() => window.location.hash)).not.toBe('');
  const shared = author.url();
  await author.close();

  // A different context: no localStorage, no history, only the link.
  const recipient = await browser.newPage();
  await recipient.goto(shared);
  await expect(recipient.getByLabel('Input')).toHaveValue('hello from another tab');
  await recipient.close();
});

test('the input never leaves the browser', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', (request) => requests.push(request.url()));

  await page.goto('./encoding/');
  const secret = 'do-not-send-this-anywhere';
  await page.getByLabel('Input').fill(secret);
  await expect.poll(() => page.evaluate(() => window.location.hash)).not.toBe('');

  // Requests carry the path but never the fragment, and nothing new is fetched.
  for (const url of requests) expect(url).not.toContain(secret);
});

/**
 * A fragment is untrusted input. It survives truncation by chat clients, hand
 * editing, and being shared from an older version of a tool. It used to be cast
 * straight to the state type, so a valid-but-empty `{}` left required fields
 * undefined and ten of the thirteen tools rendered a blank page.
 */
test('a damaged share link degrades to defaults instead of blanking the tool', async ({ page }) => {
  const frag = (value: unknown) =>
    Buffer.from(encodeURIComponent(JSON.stringify(value))).toString('base64').replace(/=+$/, '');

  const hostile: Array<[string, string]> = [
    ['an empty object', frag({})],
    ['null', frag(null)],
    ['an array', frag([1, 2])],
    ['every field the wrong type', frag({ text: 1, left: [], input: null, parameters: 7, pattern: {} })],
    ['not base64 at all', 'not!valid!base64'],
    ['a truncated fragment', frag({ text: 'hello' }).slice(0, 4)],
  ];

  for (const tool of TOOLS) {
    for (const [label, value] of hostile) {
      const problems: string[] = [];
      const onError = (error: Error) => problems.push(error.message);
      page.on('pageerror', onError);

      await page.goto(`./${tool.slug}/#${value}`);
      // The footer only renders once the tool has mounted without throwing.
      await expect(page.locator('footer.foot'), `${tool.slug} given ${label}`).toBeVisible();
      expect(problems, `${tool.slug} given ${label}`).toEqual([]);

      page.off('pageerror', onError);
    }
  }
});
