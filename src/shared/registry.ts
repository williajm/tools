/**
 * Single source of truth for the tool index, search and command palette.
 *
 * `slug` must match the directory containing that tool's index.html, since the
 * Vite multi-page build derives its entry points from those directories.
 */

export type Category = 'Encode & decode' | 'Generate' | 'Inspect & validate' | 'Compare' | 'Test';

export interface Tool {
  slug: string;
  name: string;
  blurb: string;
  category: Category;
  /** Extra search terms that don't appear in name or blurb. */
  keywords: string[];
  /** True when the tool never makes a network request, so it can lock down CSP. */
  offline: boolean;
}

export const TOOLS: Tool[] = [
  {
    slug: 'encoding',
    name: 'Encoding',
    blurb: 'Base64, base64url, URL, HTML entities and hex, in both directions.',
    category: 'Encode & decode',
    keywords: ['base64', 'atob', 'btoa', 'percent', 'escape', 'unescape', 'hex', 'entity'],
    offline: true,
  },
  {
    slug: 'uuid',
    name: 'UUID & IDs',
    blurb: 'UUID v4 and v7, ULID and NanoID, singly or in bulk.',
    category: 'Generate',
    keywords: ['guid', 'ulid', 'nanoid', 'identifier', 'random', 'v4', 'v7'],
    offline: true,
  },
  {
    slug: 'hash',
    name: 'Hash & HMAC',
    blurb: 'SHA-1, SHA-256, SHA-384, SHA-512 and MD5, with optional HMAC key.',
    category: 'Generate',
    keywords: ['sha', 'md5', 'digest', 'checksum', 'hmac', 'signature'],
    offline: true,
  },
  {
    slug: 'timestamp',
    name: 'Timestamp & timezone',
    blurb: 'Unix epoch to ISO 8601 and back, across any timezone.',
    category: 'Inspect & validate',
    keywords: ['epoch', 'unix', 'date', 'time', 'iso8601', 'utc', 'tz', 'convert'],
    offline: true,
  },
  {
    slug: 'lorem',
    name: 'Lorem & test data',
    blurb: 'Placeholder text with locale, RTL, edge-case and fixture modes. Seeded and reproducible.',
    category: 'Generate',
    keywords: ['ipsum', 'placeholder', 'dummy', 'faker', 'fixture', 'mock', 'sample', 'unicode'],
    offline: true,
  },
  {
    slug: 'qr',
    name: 'QR code',
    blurb: 'Generate from text, WiFi, vCard, calendar or TOTP. Decode from an image or camera.',
    category: 'Generate',
    keywords: ['barcode', 'scan', 'wifi', 'vcard', 'otpauth', '2fa', 'totp'],
    offline: true,
  },
  {
    slug: 'jwt',
    name: 'JWT',
    blurb: 'Decode and verify JSON Web Tokens without sending them to anyone.',
    category: 'Inspect & validate',
    keywords: ['jsonwebtoken', 'token', 'bearer', 'claims', 'jwk', 'oidc', 'auth'],
    offline: true,
  },
  {
    slug: 'json',
    name: 'JSON toolkit',
    blurb: 'Format, minify, validate against a JSON Schema, and diff.',
    category: 'Inspect & validate',
    keywords: ['pretty', 'beautify', 'minify', 'schema', 'ajv', 'validate', 'parse'],
    offline: true,
  },
  {
    slug: 'diff',
    name: 'Diff',
    blurb: 'Compare two blocks of text, line by line or word by word.',
    category: 'Compare',
    keywords: ['compare', 'patch', 'changes', 'unified', 'delta'],
    offline: true,
  },
  {
    slug: 'cidr',
    name: 'CIDR & subnet',
    blurb: 'Network, broadcast, usable range and host count for IPv4 and IPv6.',
    category: 'Inspect & validate',
    keywords: ['ip', 'ipv4', 'ipv6', 'netmask', 'subnet', 'network', 'range'],
    offline: true,
  },
  {
    slug: 'regex',
    name: 'Regex tester',
    blurb: 'Live matching with capture groups, plus a test-case table for pass/fail per input.',
    category: 'Test',
    keywords: ['regexp', 'pattern', 'match', 'replace', 'capture', 'validate'],
    offline: true,
  },
  {
    slug: 'xpath',
    name: 'XPath & selectors',
    blurb: 'Run XPath or CSS selectors against pasted HTML, and copy as a test locator.',
    category: 'Test',
    keywords: ['css', 'selector', 'query', 'html', 'xml', 'scrape', 'playwright', 'selenium'],
    offline: true,
  },
  {
    slug: 'pairwise',
    name: 'Pairwise matrix',
    blurb: 'Minimal covering arrays with constraints, so you test every pair without every combination.',
    category: 'Test',
    keywords: ['allpairs', 'all-pairs', 'combinatorial', 'nwise', 'covering', 'matrix', 'cases'],
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

/**
 * Subsequence match, so "b64" finds "base64" and "pw" finds "pairwise".
 * Returns a score where lower is better, or null when there is no match.
 */
function fuzzyScore(needle: string, haystack: string): number | null {
  if (!needle) return 0;
  let score = 0;
  let hi = 0;
  let lastHit = -1;
  for (const ch of needle) {
    const found = haystack.indexOf(ch, hi);
    if (found === -1) return null;
    // Prefer matches that are contiguous and near the start.
    score += found - lastHit - 1 + (found === 0 ? 0 : 1);
    lastHit = found;
    hi = found + 1;
  }
  return score;
}

export function searchTools(query: string): Tool[] {
  const q = query.trim().toLowerCase();
  if (!q) return TOOLS;

  const scored: Array<{ tool: Tool; score: number }> = [];
  for (const tool of TOOLS) {
    const name = tool.name.toLowerCase();
    const candidates: Array<[string, number]> = [
      [name, 0],
      [tool.slug.toLowerCase(), 1],
      [tool.keywords.join(' ').toLowerCase(), 40],
      [tool.blurb.toLowerCase(), 80],
    ];

    let best: number | null = null;
    for (const [text, penalty] of candidates) {
      // A direct substring hit always beats a scattered subsequence hit.
      const score = text.includes(q) ? text.indexOf(q) + penalty : fuzzyScore(q, text);
      if (score === null) continue;
      const total = score + penalty;
      if (best === null || total < best) best = total;
    }
    if (best !== null) scored.push({ tool, score: best });
  }

  return scored.sort((a, b) => a.score - b.score || a.tool.name.localeCompare(b.tool.name))
    .map((s) => s.tool);
}
