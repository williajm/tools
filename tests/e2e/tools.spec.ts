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

/**
 * These exercise a feature rather than a page load, because that is the gap the
 * load-only smoke pass leaves. Schema validation was completely broken in the
 * built site — the validator compiled its checker with `new Function`, which
 * `script-src 'self'` forbids — while the unit tests passed, because Node has no
 * CSP. Only driving the real page under the real CSP catches that class of bug.
 */
test('JSON Schema validation runs under the shipped CSP', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });

  await page.goto('./json/');
  await page.getByRole('button', { name: 'Schema' }).click();
  await page.getByLabel('JSON', { exact: true }).fill('{"name": "Ada", "age": 36}');
  await page.getByLabel('JSON Schema').fill('{"type":"object","required":["name","age"]}');

  await expect(page.getByText('Valid against the schema')).toBeVisible();
  // No 'unsafe-eval' complaint, and nothing else, on the way to that verdict.
  expect(problems).toEqual([]);
});

test('JSON Schema validation reports a real violation with its path', async ({ page }) => {
  await page.goto('./json/');
  await page.getByRole('button', { name: 'Schema' }).click();
  await page.getByLabel('JSON', { exact: true }).fill('{"age": "old"}');
  await page
    .getByLabel('JSON Schema')
    .fill('{"type":"object","required":["name"],"properties":{"age":{"type":"integer"}}}');

  await expect(page.getByText(/violation/)).toBeVisible();
  await expect(page.locator('body')).toContainText('/age');
});

/**
 * The same CSP hazard as schema validation: a JSONPath filter predicate is the
 * one piece that a compiling library would run through `new Function`, which
 * `script-src 'self'` forbids. This drives a real filter in a real browser to
 * prove the interpreter evaluates it without ever reaching for eval.
 */
test('a JSONPath filter runs under the shipped CSP', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });

  await page.goto('./json/');
  await page.getByRole('button', { name: 'Query' }).click();
  await page
    .getByLabel('JSON', { exact: true })
    .fill('{"book":[{"t":"a","price":5},{"t":"b","price":20}]}');
  await page.getByLabel('JSONPath').fill('$.book[?(@.price < 10)].t');

  await expect(page.getByText('1 match.', { exact: true })).toBeVisible();
  await expect(page.getByRole('cell', { name: '"a"', exact: true })).toBeVisible();
  expect(problems).toEqual([]);
});

/**
 * Regression: the results table rendered one row per match, so a broad query
 * over a large document built hundreds of thousands of DOM rows and hung the
 * tab. The table is capped; the count still reports every match.
 */
test('a JSONPath query with thousands of matches renders a capped table', async ({ page }) => {
  await page.goto('./json/');
  await page.getByRole('button', { name: 'Query' }).click();
  await page
    .getByLabel('JSON', { exact: true })
    .fill(JSON.stringify(Array.from({ length: 2000 }, (_, i) => i)));
  await page.getByLabel('JSONPath').fill('$[*]');

  await expect(page.getByText('2000 matches. Showing the first 500')).toBeVisible();
  await expect(page.locator('table.data tbody tr')).toHaveCount(500);
});

test('a result exactly at the render cap shows no truncation note', async ({ page }) => {
  await page.goto('./json/');
  await page.getByRole('button', { name: 'Query' }).click();
  await page
    .getByLabel('JSON', { exact: true })
    .fill(JSON.stringify(Array.from({ length: 500 }, (_, i) => i)));
  await page.getByLabel('JSONPath').fill('$[*]');

  await expect(page.getByText('500 matches.', { exact: true })).toBeVisible();
  await expect(page.locator('table.data tbody tr')).toHaveCount(500);
});

test('Copy after a capped table still yields every matched value', async ({ context, page }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./json/');
  await page.getByRole('button', { name: 'Query' }).click();
  await page
    .getByLabel('JSON', { exact: true })
    .fill(JSON.stringify(Array.from({ length: 600 }, (_, i) => i)));
  await page.getByLabel('JSONPath').fill('$[*]');
  await expect(page.getByText('600 matches. Showing the first 500')).toBeVisible();

  const copy = page.getByRole('button', { name: /^Copy$|Copied/ });
  await copy.click();
  await expect(copy).toHaveText('Copied');

  const copied = JSON.parse(await page.evaluate(() => navigator.clipboard.readText())) as number[];
  expect(copied).toHaveLength(600);
  expect(copied[599]).toBe(599);
});

test('query errors and empty results surface as notes, not blank panels', async ({ page }) => {
  await page.goto('./json/');
  await page.getByRole('button', { name: 'Query' }).click();

  await page.getByLabel('JSONPath').fill('store.book');
  await expect(page.getByText(/must start with '\$'/)).toBeVisible();

  await page.getByLabel('JSONPath').fill('$.nope');
  await expect(page.getByText('No matches.', { exact: true })).toBeVisible();

  await page.getByLabel('JSON', { exact: true }).fill('{oops');
  await expect(page.locator('.note.note--error')).toContainText('JSON');
});

/**
 * Regression: a NumericDate outside the range Date can represent threw
 * RangeError out of the claims table while rendering, which blanked the entire
 * tool — no output, no error, just the token box.
 */
test('the JWT tool survives a token with an absurd exp', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));

  const b64u = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  const token = `${b64u({ alg: 'HS256', typ: 'JWT' })}.${b64u({ sub: 'x', exp: -1e13 })}.sig`;

  await page.goto('./jwt/');
  await page.getByLabel('Token').fill(token);

  // The payload still renders, and the bad claim is explained rather than fatal.
  await expect(page.getByText('"sub": "x"')).toBeVisible();
  await expect(page.getByRole('row', { name: /exp/ })).toContainText('range of dates');
  expect(problems).toEqual([]);
});

test('a catastrophic regex is abandoned instead of freezing the page', async ({ page }) => {
  await page.goto('./regex/');
  await page.getByLabel('Pattern').fill('(a+)+$');
  await page.getByLabel('Test string').fill(`${'a'.repeat(40)}b`);

  // Evaluated on a worker, so it can be terminated. Allow for the 2s budget.
  await expect(page.getByText(/Gave up after/)).toBeVisible({ timeout: 15_000 });
  // The page is still alive and responsive afterwards.
  await page.getByLabel('Pattern').fill('\\d+');
  await page.getByLabel('Test string').fill('a1b22');
  await expect(page.getByText('2 matches')).toBeVisible();
});

test('the pairwise matrix verifies at the strength selected', async ({ page }) => {
  await page.goto('./pairwise/');
  await page.getByRole('button', { name: '3-way' }).click();
  // The readout must name what was actually checked, not just echo the control.
  await expect(page.getByText(/reachable 3-tuples/)).toBeVisible();
  await expect(page.getByText(/Uncovered/)).toBeHidden();
});

/**
 * These two only fail in a browser. jsdom's XPath is case-insensitive and accepts
 * a null namespace resolver, so the unit tests cannot see either defect — the
 * generated XML locators matched nothing, and a prefixed expression threw
 * NamespaceError.
 */
test('XML locators keep element case, so they select what was found', async ({ page }) => {
  await page.goto('./xpath/');
  await page.getByRole('button', { name: 'XML' }).click();
  await page.getByRole('textbox', { name: 'Document' }).fill('<Root><Item/><Item/></Root>');
  await page.getByLabel('XPath expression').fill('//Item');
  await expect(page.locator('table.data tbody tr')).toHaveCount(2);

  // The CSS path keeps the document's case; the lower-cased form matched nothing.
  await expect(page.locator('table.data')).toContainText('Root > Item');
  await expect(page.locator('table.data')).not.toContainText('root > item');

  await page.getByLabel('Copy as').selectOption('playwright-xpath');
  await expect(page.locator('table.data')).toContainText('/Root/Item');
  await expect(page.locator('table.data')).not.toContainText('/root/item');

  // The generated path, fed back in, finds exactly the node it came from.
  await page.getByLabel('XPath expression').fill('/Root/Item[2]');
  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
});

test('a namespaced XML document can be queried by prefix', async ({ page }) => {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(error.message));

  await page.goto('./xpath/');
  await page.getByRole('button', { name: 'XML' }).click();
  await page.getByRole('textbox', { name: 'Document' }).fill('<r xmlns:x="urn:z"><x:Item>found</x:Item></r>');
  await page.getByLabel('XPath expression').fill('//x:Item');

  await expect(page.locator('table.data tbody tr')).toHaveCount(1);
  await expect(page.locator('table.data')).toContainText('found');
  expect(problems).toEqual([]);
});

test('lorem generates a large word count and clamps the field to each unit ceiling', async ({ page }) => {
  await page.goto('./lorem/');
  await page.getByLabel('Unit').selectOption('words');
  const count = page.getByLabel('Count');

  // Regression: one 500-block ceiling covered every unit, so 10,000 words came back as 500.
  await count.fill('10000');
  await expect(page.locator('.output')).toHaveText(/^(\S+ ){9999}\S+$/);

  // A number the generator would not honour cannot be entered: it clamps as you type.
  await count.fill('999999');
  await expect(count).toHaveValue('200000');

  // Switching to a unit with a lower ceiling pulls the count down with it.
  await page.getByLabel('Unit').selectOption('paragraphs');
  await expect(count).toHaveValue('2000');
});

test('lorem downloads the output as a file named for its format', async ({ page }) => {
  await page.goto('./lorem/');
  await page.getByLabel('Unit').selectOption('words');
  await page.getByLabel('Count').fill('12');
  await page.getByRole('button', { name: 'Markdown' }).click();

  // A real browser check: the page ships a strict CSP and a blob: download has
  // to work under it.
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('lorem.md');

  const path = await download.path();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync(path, 'utf8').split(' ')).toHaveLength(12);
});

test('lorem previews a heavy-layout script but downloads all of it', async ({ page }) => {
  await page.goto('./lorem/');
  await page.getByLabel('Script').selectOption('devanagari');
  await page.getByLabel('Unit').selectOption('words');
  await page.getByLabel('Count').fill('200000');

  // Regression: rendering 200,000 words of Devanagari took Chromium ~3 minutes.
  await expect(page.getByText(/Showing the first 20,000 characters/)).toBeVisible();
  expect((await page.locator('.output').textContent())!.length).toBeLessThanOrEqual(20000);

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download' }).click();
  const { readFileSync } = await import('node:fs');
  expect(readFileSync((await (await downloadPromise).path())!, 'utf8').split(' ')).toHaveLength(200000);
});

test('the test-file tool downloads a file of the exact size and shows its SHA-256', async ({ page }) => {
  const { createHash } = await import('node:crypto');
  const { readFileSync } = await import('node:fs');
  await page.goto('./file/');

  // Three zero bytes: a size small enough to check byte for byte.
  await page.getByLabel('Unit').selectOption('B');
  await page.getByLabel('Size').fill('3');
  await page.getByRole('button', { name: 'Zero bytes' }).click();
  let downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate & download' }).click();
  let download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('zeros-3B.bin');
  let data = readFileSync((await download.path())!);
  expect([...data]).toEqual([0, 0, 0]);
  await expect(page.getByText(createHash('sha256').update(data).digest('hex'))).toBeVisible();

  // Random bytes spanning several internal chunks, with a chosen name.
  await page.getByLabel('Unit').selectOption('MiB');
  await page.getByLabel('Size').fill('2.5');
  await page.getByRole('button', { name: 'Random bytes' }).click();
  await page.getByLabel('Filename').fill('upload-probe.dat');
  downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Generate & download' }).click();
  download = await downloadPromise;
  expect(download.suggestedFilename()).toBe('upload-probe.dat');
  data = readFileSync((await download.path())!);
  expect(data.length).toBe(2.5 * 1024 * 1024);
  expect(data.some((b) => b !== 0)).toBe(true);
  await expect(page.getByText(createHash('sha256').update(data).digest('hex'))).toBeVisible();
});
