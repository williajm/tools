import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import license from 'rollup-plugin-license';
import { licensesPage } from './scripts/licenses-page.ts';
import { readdirSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));

/**
 * Multi-page build. Every top-level directory containing an index.html becomes
 * its own entry point, so each tool ships only its own JS. Adding a tool means
 * adding a directory — no config change needed.
 */
function htmlEntries(): Record<string, string> {
  const entries: Record<string, string> = { home: resolve(root, 'index.html') };
  for (const name of readdirSync(root, { withFileTypes: true })) {
    if (!name.isDirectory() || name.name.startsWith('.')) continue;
    if (['src', 'node_modules', 'dist', 'docs', 'tests', 'scripts', 'public'].includes(name.name)) continue;
    const html = resolve(root, name.name, 'index.html');
    if (existsSync(html)) entries[name.name] = html;
  }
  return entries;
}

/**
 * The pages ship a strict CSP including `connect-src 'none'`, which is the point
 * — it makes "nothing is uploaded" enforceable rather than a claim. That same
 * rule blocks Vite's HMR websocket, so strip it in dev only. Production output
 * keeps the CSP intact.
 */
function stripCspInDev() {
  return {
    name: 'strip-csp-in-dev',
    apply: 'serve' as const,
    transformIndexHtml(html: string) {
      return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/g, '');
    },
  };
}

/**
 * Where the site is served from: https://<user>.github.io/tools/ by default.
 * CI passes the subpath that `actions/configure-pages` reports, which is bare
 * (`/tools`) for a project page and empty for a custom domain — Vite needs both
 * a leading and a trailing slash, so normalise rather than trusting the input.
 */
function basePath(): string {
  const trimmed = (process.env.BASE_PATH ?? '/tools/').trim().replace(/^\/*/, '/').replace(/\/+$/, '');
  return trimmed === '' ? '/' : `${trimmed}/`;
}

export default defineConfig({
  base: basePath(),
  plugins: [
    preact(),
    stripCspInDev(),
    // Apache-2.0 (covertable) and others require attribution when distributed.
    // Bundling into the deployed site counts as distribution, so this is not optional.
    license({
      thirdParty: {
        includePrivate: false,
        output: [
          { file: resolve(root, 'dist', 'THIRD-PARTY-NOTICES.txt') },
          // Same content as a readable page, linked from every footer.
          {
            file: resolve(root, 'dist', 'licenses', 'index.html'),
            template: (dependencies) => licensesPage(dependencies),
          },
        ],
      },
    }),
  ],
  resolve: {
    alias: { '@shared': resolve(root, 'src/shared') },
  },
  build: {
    rollupOptions: { input: htmlEntries() },
    target: 'es2022',
    // Tools are lazily reached via their own page; warn if any single one bloats.
    chunkSizeWarningLimit: 600,
  },
});
