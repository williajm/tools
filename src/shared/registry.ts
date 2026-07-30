/**
 * Single source of truth for the tool index.
 *
 * `slug` must match the directory containing that tool's index.html, since the
 * Vite multi-page build derives its entry points from those directories, and
 * `scripts/gen-pages.mjs` parses this file to write them.
 */

export type Category = 'Encode & decode' | 'Generate' | 'Inspect & validate' | 'Compare' | 'Test';

export interface Tool {
  slug: string;
  name: string;
  blurb: string;
  category: Category;
  /** True when the tool never makes a network request, so it can lock down CSP. */
  offline: boolean;
}

export const TOOLS: Tool[] = [
  {
    slug: 'encoding',
    name: 'Encoding',
    blurb: 'Base64, base64url, URL, HTML entities and hex, in both directions.',
    category: 'Encode & decode',
    offline: true,
  },
  {
    slug: 'uuid',
    name: 'UUID & IDs',
    blurb: 'UUID v4 and v7, ULID and NanoID, singly or in bulk.',
    category: 'Generate',
    offline: true,
  },
  {
    slug: 'hash',
    name: 'Hash & HMAC',
    blurb: 'SHA-1, SHA-256, SHA-384, SHA-512 and MD5, with optional HMAC key.',
    category: 'Generate',
    offline: true,
  },
  {
    slug: 'timestamp',
    name: 'Timestamp & timezone',
    blurb: 'Unix epoch to ISO 8601 and back, across any timezone.',
    category: 'Inspect & validate',
    offline: true,
  },
  {
    slug: 'lorem',
    name: 'Lorem & test data',
    blurb: 'Placeholder text with locale, RTL, edge-case and fixture modes. Seeded and reproducible.',
    category: 'Generate',
    offline: true,
  },
  {
    slug: 'qr',
    name: 'QR code',
    blurb: 'Generate from text, WiFi, vCard, calendar or TOTP. Decode from an image or camera.',
    category: 'Generate',
    offline: true,
  },
  {
    slug: 'jwt',
    name: 'JWT',
    blurb: 'Decode and verify JSON Web Tokens without sending them to anyone.',
    category: 'Inspect & validate',
    offline: true,
  },
  {
    slug: 'json',
    name: 'JSON toolkit',
    blurb: 'Format, minify, validate against a JSON Schema, and diff.',
    category: 'Inspect & validate',
    offline: true,
  },
  {
    slug: 'diff',
    name: 'Diff',
    blurb: 'Compare two blocks of text, line by line or word by word.',
    category: 'Compare',
    offline: true,
  },
  {
    slug: 'cidr',
    name: 'CIDR & subnet',
    blurb: 'Network, broadcast, usable range and host count for IPv4 and IPv6.',
    category: 'Inspect & validate',
    offline: true,
  },
  {
    slug: 'regex',
    name: 'Regex tester',
    blurb: 'Live matching with capture groups, plus a test-case table for pass/fail per input.',
    category: 'Test',
    offline: true,
  },
  {
    slug: 'xpath',
    name: 'XPath & selectors',
    blurb: 'Run XPath or CSS selectors against pasted HTML, and copy as a test locator.',
    category: 'Test',
    offline: true,
  },
  {
    slug: 'pairwise',
    name: 'Pairwise matrix',
    blurb: 'Minimal covering arrays with constraints, so you test every pair without every combination.',
    category: 'Test',
    offline: true,
  },
];

export const CATEGORIES: Category[] = [
  'Encode & decode',
  'Generate',
  'Inspect & validate',
  'Compare',
  'Test',
];

export function toolBySlug(slug: string): Tool | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
