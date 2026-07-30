import { md5 } from 'js-md5';

/**
 * Digests via WebCrypto, except MD5 — WebCrypto deliberately omits it because
 * it is broken for anything security-related. It stays here because checksums
 * and legacy interop still need it.
 */

export type Algorithm = 'MD5' | 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512';

export const ALGORITHMS: readonly Algorithm[] = ['MD5', 'SHA-1', 'SHA-256', 'SHA-384', 'SHA-512'];

/** Algorithms that must not be used to authenticate anything. */
export const BROKEN: ReadonlySet<Algorithm> = new Set<Algorithm>(['MD5', 'SHA-1']);

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function digest(text: string, algorithm: Algorithm): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (algorithm === 'MD5') return md5(bytes);
  return toHex(await crypto.subtle.digest(algorithm, bytes));
}

/**
 * HMAC. MD5 is unavailable here: WebCrypto cannot import an HMAC-MD5 key, and
 * hand-rolling the construction to offer a broken MAC would be a bad trade.
 */
export async function hmac(text: string, key: string, algorithm: Algorithm): Promise<string> {
  if (algorithm === 'MD5') {
    throw new Error('HMAC-MD5 is not available. Pick SHA-256 or stronger.');
  }
  if (key === '') {
    // WebCrypto rejects a zero-length key ("Zero-length key is not supported"),
    // so say what to do about it rather than surfacing that.
    throw new Error('Enter a key to compute an HMAC.');
  }
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(key),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  return toHex(await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(text)));
}

/**
 * Digest, or HMAC when a key is supplied.
 *
 * `null` means "no HMAC"; a string means HMAC, including the empty string, which
 * errors. The distinction has to be explicit rather than read off the key's
 * truthiness: doing the latter meant that turning HMAC on and leaving the key
 * blank fell through to a plain digest, which the UI then labelled `HMAC-*`.
 * Handing back an unkeyed digest labelled as a MAC is the worst answer available,
 * so the two cases are now impossible to confuse.
 */
export async function compute(
  text: string,
  algorithm: Algorithm,
  key: string | null,
): Promise<string> {
  return key === null ? digest(text, algorithm) : hmac(text, key, algorithm);
}
