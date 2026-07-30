/**
 * Encoding primitives. Pure functions, no DOM, so they are directly unit-testable.
 *
 * All text conversions round-trip through UTF-8 rather than using btoa/atob
 * directly, since those only handle Latin-1 and silently mangle anything else.
 */

export type Scheme = 'base64' | 'base64url' | 'url' | 'html' | 'hex';

export const SCHEMES: readonly Scheme[] = ['base64', 'base64url', 'url', 'html', 'hex'] as const;

export const SCHEME_NAMES: Record<Scheme, string> = {
  base64: 'Base64',
  base64url: 'Base64url',
  url: 'URL',
  html: 'HTML',
  hex: 'Hex',
};

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

/**
 * Raised for input this tool can explain (wrong alphabet, odd hex length).
 * Anything else escaping a decode is a TextDecoder failure, whose message text
 * differs between engines — hence a type check rather than string matching.
 */
export class EncodingError extends Error {}

function bytesToBinary(bytes: Uint8Array): string {
  // Chunked to avoid blowing the argument limit on large inputs.
  let out = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    out += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return out;
}

function binaryToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// --- base64 ------------------------------------------------------------------

export function toBase64(text: string): string {
  return btoa(bytesToBinary(encoder.encode(text)));
}

export function fromBase64(b64: string): string {
  // Tolerate whitespace from wrapped/pasted input.
  const cleaned = b64.replace(/\s+/g, '');
  if (cleaned === '') return '';
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(cleaned)) {
    throw new EncodingError('Not valid base64: contains characters outside the base64 alphabet.');
  }
  return decoder.decode(binaryToBytes(atob(cleaned)));
}

export function toBase64Url(text: string): string {
  return toBase64(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64: string): string {
  const cleaned = b64.replace(/\s+/g, '');
  if (cleaned === '') return '';
  if (!/^[A-Za-z0-9_-]*={0,2}$/.test(cleaned)) {
    throw new EncodingError('Not valid base64url: expected the URL-safe alphabet (- and _ instead of + and /).');
  }
  const padded = cleaned.replace(/-/g, '+').replace(/_/g, '/');
  return fromBase64(padded + '='.repeat((4 - (padded.length % 4)) % 4));
}

// --- url ---------------------------------------------------------------------

export function toUrl(text: string): string {
  return encodeURIComponent(text);
}

export function fromUrl(text: string): string {
  try {
    // '+' means space in application/x-www-form-urlencoded, which is what most
    // pasted query strings are.
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    throw new EncodingError('Not valid percent-encoding: contains a malformed % sequence.');
  }
}

// --- html --------------------------------------------------------------------

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

export function toHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function fromHtml(text: string): string {
  // Deliberately hand-rolled rather than assigning to innerHTML, which would
  // execute or fetch things depending on the markup pasted in.
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (match, body: string) => {
    if (body.startsWith('#x') || body.startsWith('#X')) {
      const code = Number.parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (body.startsWith('#')) {
      const code = Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? match;
  });
}

// --- hex ---------------------------------------------------------------------

export function toHex(text: string): string {
  return [...encoder.encode(text)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function fromHex(text: string): string {
  const cleaned = text.replace(/(?:0x|\s|:|-)/gi, '');
  if (cleaned === '') return '';
  if (cleaned.length % 2 !== 0) {
    throw new EncodingError('Not valid hex: an odd number of digits (each byte needs two).');
  }
  if (!/^[0-9a-fA-F]*$/.test(cleaned)) {
    throw new EncodingError('Not valid hex: contains characters outside 0-9 and a-f.');
  }
  const bytes = new Uint8Array(cleaned.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(cleaned.slice(i * 2, i * 2 + 2), 16);
  }
  return decoder.decode(bytes);
}

// --- dispatch ----------------------------------------------------------------

const TABLE: Record<Scheme, { encode: (s: string) => string; decode: (s: string) => string }> = {
  base64: { encode: toBase64, decode: fromBase64 },
  base64url: { encode: toBase64Url, decode: fromBase64Url },
  url: { encode: toUrl, decode: fromUrl },
  html: { encode: toHtml, decode: fromHtml },
  hex: { encode: toHex, decode: fromHex },
};

export interface Result {
  output: string;
  error?: string;
}

export function convert(text: string, scheme: Scheme, direction: 'encode' | 'decode'): Result {
  if (text === '') return { output: '' };
  try {
    return { output: TABLE[scheme][direction](text) };
  } catch (err) {
    if (err instanceof EncodingError) return { output: '', error: err.message };
    // Anything else is the fatal TextDecoder rejecting bytes that are not text.
    return { output: '', error: 'Decoded to bytes that are not valid UTF-8 text.' };
  }
}
