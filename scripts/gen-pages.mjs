/**
 * Generates one index.html per tool from the registry, plus the home page.
 *
 * The Vite multi-page build derives its entry points from directories containing
 * an index.html, so these files must exist on disk. Generating them keeps the
 * registry as the single source of truth for slugs, titles and descriptions.
 *
 * Run with: npm run gen:pages   (also runs as part of prebuild)
 */
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Parsed rather than imported so this script stays dependency-free and needs no
// TypeScript loader. The shape is stable and a mismatch fails loudly below.
const source = readFileSync(resolve(root, 'src/shared/registry.ts'), 'utf8');
const tools = [...source.matchAll(/\{\s*slug:\s*'([^']+)',\s*name:\s*'([^']+)',\s*blurb:\s*'([^']+)',/g)].map(
  ([, slug, name, blurb]) => ({ slug, name, blurb }),
);

if (tools.length === 0) {
  throw new Error('gen-pages: parsed zero tools from registry.ts — the format must have changed');
}

const escape = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * Applies the saved theme before the first paint.
 *
 * It has to run here, in the document head, rather than in the bundle: anything
 * that waits for JavaScript to load shows a flash of the system theme first, which
 * on a light-mode machine means a white flash on every navigation for anyone who
 * chose dark. There is no CSS-only way to read a stored preference.
 *
 * Kept to one statement and no error handling beyond the try, because it blocks
 * rendering. The key must match THEME_KEY in src/shared/lib/theme.ts.
 */
const THEME_BOOTSTRAP =
  "try{var t=localStorage.getItem('tools:theme');" +
  "if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t)}catch(e){}";

/**
 * CSP hash for the bootstrap above.
 *
 * `script-src 'self'` blocks inline script, and adding 'unsafe-inline' to let one
 * line through would forfeit the protection the whole site is built on. A sha256
 * hash allows exactly this script and nothing else. Computed from the string that
 * is actually embedded, so the two cannot drift apart.
 */
const BOOTSTRAP_HASH = `'sha256-${createHash('sha256').update(THEME_BOOTSTRAP).digest('base64')}'`;

function page({ title, description, script, csp }) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light dark" />
${csp ? `    <meta http-equiv="Content-Security-Policy" content="${csp}" />\n` : ''}    <title>${escape(title)}</title>
    <meta name="description" content="${escape(description)}" />
    <link rel="icon" href="/icon.svg" type="image/svg+xml" />
    <script>${THEME_BOOTSTRAP}</script>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="${script}"></script>
  </body>
</html>
`;
}

/**
 * Tool pages never call out to the network, so lock that down in the document
 * itself. GitHub Pages cannot set headers, but a meta CSP is enforced the same
 * way and makes the "nothing is uploaded" claim verifiable rather than a promise.
 *
 * `img-src` allows blob: and data: for locally generated QR codes and placeholder
 * images; `media-src` allows blob: for the camera stream in the QR decoder.
 */
const TOOL_CSP = [
  "default-src 'self'",
  `script-src 'self' ${BOOTSTRAP_HASH}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'none'",
  "form-action 'none'",
  "base-uri 'self'",
  // No `frame-ancestors`: browsers ignore it when it arrives in a meta element
  // and log an error for it, and GitHub Pages cannot send the header that would
  // work. Anti-framing is simply not available here.
].join('; ');

writeFileSync(
  resolve(root, 'index.html'),
  page({
    title: 'Developer & test tools',
    description:
      'Developer and test utilities that run entirely in your browser. No server, no upload, no account.',
    script: '/src/pages/home/main.tsx',
    csp: TOOL_CSP,
  }),
);

for (const tool of tools) {
  const dir = resolve(root, tool.slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    resolve(dir, 'index.html'),
    page({
      title: `${tool.name} · tools`,
      description: tool.blurb,
      script: `/src/tools/${tool.slug}/main.tsx`,
      csp: TOOL_CSP,
    }),
  );
}

console.log(`gen-pages: wrote index.html + ${tools.length} tool pages`);
