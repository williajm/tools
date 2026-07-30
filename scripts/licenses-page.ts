import { readFileSync } from 'node:fs';
import type { Dependency } from 'rollup-plugin-license';

/**
 * Builds the /licenses page from the dependencies rollup actually bundled.
 *
 * Bundling third-party code into a deployed site is distribution, so the
 * attribution clauses apply — Apache-2.0 §4 for covertable in particular, whose
 * npm tarball ships no LICENSE file of its own. Generating this from the real
 * bundle rather than a hand-kept list means it cannot fall out of date.
 *
 * The page is emitted straight to dist and never passes through Vite, so it
 * carries its own styles and uses only relative links.
 */

/**
 * Canonical texts for licences that a package may declare without shipping.
 * covertable is exactly that case: its package.json says Apache-2.0 but the npm
 * tarball carries no LICENSE file, and §4(a) requires recipients to be given a
 * copy of the licence. This text is the unmodified upstream one.
 */
const CANONICAL_TEXTS: Record<string, string> = {
  'Apache-2.0': readFileSync(new URL('./license-texts/Apache-2.0.txt', import.meta.url), 'utf8'),
};

const escape = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

function repositoryUrl(dependency: Dependency): string | null {
  const { repository, homepage } = dependency;
  if (typeof repository === 'string') return repository;
  if (repository && typeof repository === 'object' && repository.url) {
    // npm records these as git+https://…git; strip that back to a browsable URL.
    return repository.url.replace(/^git\+/, '').replace(/\.git$/, '');
  }
  return homepage;
}

const STYLES = `
  :root {
    color-scheme: light dark;
    --bg: #fbfbfa; --surface: #fff; --border: #e0e0da;
    --text: #1a1a17; --dim: #6b6b63; --accent: #1b6b4f;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #14161a; --surface: #1b1e23; --border: #2b3038;
      --text: #e6e8ea; --dim: #9aa1ab; --accent: #57c99a;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0 auto; max-width: 900px; padding: 0 20px 80px;
    background: var(--bg); color: var(--text);
    font: 15px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  a { color: var(--accent); text-underline-offset: 2px; }
  header { padding: 22px 0; margin-bottom: 24px; border-bottom: 1px solid var(--border); }
  h1 { font-size: 26px; letter-spacing: -0.02em; margin: 0 0 6px; }
  .lede { color: var(--dim); max-width: 68ch; }
  .toc { columns: 2 220px; gap: 18px; padding: 0; margin: 0 0 32px; list-style: none; font-size: 13px; }
  .dep {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: 6px; padding: 14px 16px; margin-bottom: 12px;
  }
  .dep h2 { font-size: 15px; margin: 0 0 2px; }
  .dep .meta { font-size: 12.5px; color: var(--dim); margin-bottom: 10px; }
  .dep pre {
    font: 12px/1.5 ui-monospace, "SF Mono", Menlo, Consolas, monospace;
    white-space: pre-wrap; overflow-wrap: anywhere;
    max-height: 260px; overflow-y: auto; margin: 0;
    padding: 10px 12px; border: 1px solid var(--border); border-radius: 4px;
  }
  .missing { font-size: 12.5px; color: var(--dim); font-style: italic; }
  footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid var(--border); font-size: 12px; color: var(--dim); }
`;

/** The site's own licence, stated alongside the bundled ones. */
const SELF = `MIT License

Copyright (c) 2026 williajm

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.`;

export function licensesPage(dependencies: readonly Dependency[]): string {
  const sorted = [...dependencies].sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

  const entries = sorted
    .map((dependency) => {
      const name = dependency.name ?? 'unknown package';
      const id = encodeURIComponent(name);
      const url = repositoryUrl(dependency);
      const heading = url
        ? `<a href="${escape(url)}" rel="noopener noreferrer">${escape(name)}</a>`
        : escape(name);

      const notice = dependency.noticeText
        ? `<p class="meta">NOTICE</p><pre>${escape(dependency.noticeText)}</pre>`
        : '';

      const canonical = dependency.license ? CANONICAL_TEXTS[dependency.license] : undefined;
      const substituted = !dependency.licenseText && canonical !== undefined;
      const licenceText = dependency.licenseText ?? canonical;

      if (licenceText === undefined) {
        // Shipping code whose licence text we cannot produce is exactly the
        // thing this page exists to prevent, so stop the build rather than
        // publish an attribution with a hole in it.
        throw new Error(
          `licenses-page: ${name} declares ${dependency.license ?? 'no licence'} but ships no licence ` +
            'text, and there is no canonical copy for it in scripts/license-texts. Add the text ' +
            'from the project, or drop the dependency.',
        );
      }

      const text =
        (substituted
          ? `<p class="missing">The package ships no licence file; this is the canonical ${escape(
              dependency.license ?? '',
            )} text.</p>`
          : '') + `<pre>${escape(licenceText)}</pre>`;

      return `      <section class="dep" id="${id}">
        <h2>${heading}</h2>
        <p class="meta">${escape(dependency.version ?? '')} · ${escape(dependency.license ?? 'licence not declared')}</p>
        ${text}
        ${notice}
      </section>`;
    })
    .join('\n');

  const toc = sorted
    .map(
      (dependency) =>
        `        <li><a href="#${encodeURIComponent(dependency.name ?? '')}">${escape(
          dependency.name ?? 'unknown package',
        )}</a></li>`,
    )
    .join('\n');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
    <meta name="robots" content="noindex" />
    <title>Licences · tools</title>
    <style>${STYLES}</style>
  </head>
  <body>
    <header>
      <h1>Licences</h1>
      <p class="lede">
        This site is MIT licensed. It bundles the ${sorted.length} package${sorted.length === 1 ? '' : 's'}
        listed below, each under its own licence, reproduced here in full because
        shipping them in the built site counts as distribution.
      </p>
      <p><a href="../">← Back to the tools</a> · <a href="../THIRD-PARTY-NOTICES.txt">Plain text version</a></p>
    </header>

    <main>
      <ul class="toc">
${toc}
      </ul>

      <section class="dep">
        <h2>tools</h2>
        <p class="meta">This site · MIT</p>
        <pre>${escape(SELF)}</pre>
      </section>

${entries}
    </main>

    <footer>Generated at build time from the packages rollup actually bundled.</footer>
  </body>
</html>
`;
}
