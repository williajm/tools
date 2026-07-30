import { test, expect, type Page } from '@playwright/test';
import { TOOLS } from '../../src/shared/registry.ts';

/**
 * One pass over every tool page. The registry drives it, so a tool added
 * without a working page fails here rather than in production.
 */

/** Collects anything the browser complains about, including CSP violations. */
function watchForProblems(page: Page): string[] {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`uncaught: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') problems.push(`console: ${message.text()}`);
  });
  page.on('requestfailed', (request) => {
    problems.push(`failed request: ${request.url()} — ${request.failure()?.errorText}`);
  });
  return problems;
}

test('the home page lists every tool', async ({ page }) => {
  const problems = watchForProblems(page);
  await page.goto('./');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Developer & test tools');
  await expect(page.locator('.card')).toHaveCount(TOOLS.length);
  expect(problems).toEqual([]);
});

for (const tool of TOOLS) {
  test(`${tool.slug} loads cleanly`, async ({ page }) => {
    const problems = watchForProblems(page);
    await page.goto(`./${tool.slug}/`);

    await expect(page.getByRole('heading', { level: 1 })).toHaveText(tool.name);
    await expect(page).toHaveTitle(`${tool.name} · tools`);
    // The shell only renders once the bundle has hydrated the page.
    await expect(page.locator('footer.foot')).toBeVisible();
    expect(problems).toEqual([]);
  });
}

test('the footer reaches a licences page with the bundled packages', async ({ page }) => {
  await page.goto('./encoding/');
  await page.getByRole('link', { name: 'Licences' }).click();

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Licences');
  // covertable is Apache-2.0 and ships no licence file of its own, so §4(a)
  // compliance depends on the generator substituting the canonical text.
  await expect(page.locator('#covertable')).toContainText('TERMS AND CONDITIONS FOR USE');
  await expect(page.locator('.dep')).not.toHaveCount(0);
});

test('every page forbids network connections in its own CSP', async ({ page }) => {
  // The privacy claim on the home page is only true if this holds, so assert it
  // rather than trusting that the generator was run.
  for (const path of ['./', ...TOOLS.map((t) => `./${t.slug}/`)]) {
    await page.goto(path);
    const csp = await page
      .locator('meta[http-equiv="Content-Security-Policy"]')
      .getAttribute('content');
    expect(csp, path).toContain("connect-src 'none'");
    expect(csp, path).toContain("default-src 'self'");
  }
});
