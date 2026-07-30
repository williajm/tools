/**
 * JWT decoding and verification.
 *
 * Decoding is deliberately independent of verification: you almost always want
 * to see the claims of a token you cannot verify. But a decoded token proves
 * nothing, so the UI must never present "decoded" as "valid" — hence the
 * separate `verify` step and the explicit alg:none check below.
 */

// Type-only, so it is erased at build time and `jose` stays lazily imported.
import type { JWK, KeyLike } from 'jose';

export interface DecodedJwt {
  header: Record<string, unknown>;
  payload: Record<string, unknown>;
  signature: string;
  /** The `header.payload` string that the signature covers. */
  signingInput: string;
}

export class JwtError extends Error {}

function decodeSegment(segment: string, what: string): Record<string, unknown> {
  let json: string;
  try {
    const padded = segment.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    json = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new JwtError(`The ${what} is not valid base64url.`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new JwtError(`The ${what} is not valid JSON.`);
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new JwtError(`The ${what} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

export function decode(token: string): DecodedJwt {
  const trimmed = token.trim().replace(/^Bearer\s+/i, '');
  if (!trimmed) throw new JwtError('Paste a token.');

  const parts = trimmed.split('.');
  if (parts.length !== 3) {
    throw new JwtError(
      parts.length < 3
        ? `A JWT has three dot-separated parts; this has ${parts.length}.`
        : `A JWT has three dot-separated parts; this has ${parts.length}. JWE tokens have five and are not supported.`,
    );
  }

  const [headerPart, payloadPart, signature] = parts as [string, string, string];
  return {
    header: decodeSegment(headerPart, 'header'),
    payload: decodeSegment(payloadPart, 'payload'),
    signature,
    signingInput: `${headerPart}.${payloadPart}`,
  };
}

// --- claim interpretation ----------------------------------------------------

export interface ClaimNote {
  claim: string;
  label: string;
  value: string;
  status: 'ok' | 'warn' | 'error' | 'info';
  detail?: string;
}

const REGISTERED: Record<string, string> = {
  iss: 'Issuer',
  sub: 'Subject',
  aud: 'Audience',
  exp: 'Expires',
  nbf: 'Not before',
  iat: 'Issued at',
  jti: 'JWT ID',
};

function formatEpoch(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

function relative(seconds: number, now: number): string {
  const delta = seconds - now;
  const abs = Math.abs(delta);
  const unit =
    abs < 60 ? [abs, 'second'] : abs < 3600 ? [abs / 60, 'minute'] : abs < 86400 ? [abs / 3600, 'hour'] : [abs / 86400, 'day'];
  const rounded = Math.round(unit[0] as number);
  const plural = rounded === 1 ? '' : 's';
  return delta >= 0 ? `in ${rounded} ${unit[1]}${plural}` : `${rounded} ${unit[1]}${plural} ago`;
}

/** Interprets the time-based and identity claims, since those are what go wrong. */
export function describeClaims(payload: Record<string, unknown>, nowMs = Date.now()): ClaimNote[] {
  const now = Math.floor(nowMs / 1000);
  const notes: ClaimNote[] = [];

  const timeClaim = (claim: 'exp' | 'nbf' | 'iat') => {
    const raw = payload[claim];
    if (raw === undefined) return;
    if (typeof raw !== 'number') {
      notes.push({
        claim,
        label: REGISTERED[claim]!,
        value: String(raw),
        status: 'error',
        detail: 'Must be a NumericDate (seconds since epoch) — this is not a number.',
      });
      return;
    }

    // A very common bug: milliseconds where seconds are required.
    const looksLikeMillis = raw > 1e11;
    if (looksLikeMillis) {
      notes.push({
        claim,
        label: REGISTERED[claim]!,
        value: String(raw),
        status: 'error',
        detail: 'Looks like milliseconds. NumericDate is in seconds — this is ~1000x too large.',
      });
      return;
    }

    if (claim === 'exp') {
      const expired = raw <= now;
      notes.push({
        claim,
        label: 'Expires',
        value: `${formatEpoch(raw)} (${relative(raw, now)})`,
        status: expired ? 'error' : 'ok',
        detail: expired ? 'This token has expired.' : undefined,
      });
    } else if (claim === 'nbf') {
      const notYet = raw > now;
      notes.push({
        claim,
        label: 'Not before',
        value: `${formatEpoch(raw)} (${relative(raw, now)})`,
        status: notYet ? 'error' : 'ok',
        detail: notYet ? 'This token is not valid yet.' : undefined,
      });
    } else {
      notes.push({
        claim,
        label: 'Issued at',
        value: `${formatEpoch(raw)} (${relative(raw, now)})`,
        status: raw > now + 60 ? 'warn' : 'info',
        detail: raw > now + 60 ? 'Issued in the future — check for clock skew.' : undefined,
      });
    }
  };

  timeClaim('iat');
  timeClaim('nbf');
  timeClaim('exp');

  if (payload['exp'] === undefined) {
    notes.push({
      claim: 'exp',
      label: 'Expires',
      value: '—',
      status: 'warn',
      detail: 'No exp claim, so this token never expires on its own.',
    });
  }

  for (const claim of ['iss', 'sub', 'aud', 'jti']) {
    const raw = payload[claim];
    if (raw === undefined) continue;
    notes.push({
      claim,
      label: REGISTERED[claim]!,
      value: Array.isArray(raw) ? raw.join(', ') : String(raw),
      status: 'info',
    });
  }

  return notes;
}

// --- algorithm warnings ------------------------------------------------------

export interface AlgWarning {
  level: 'error' | 'warn';
  message: string;
}

export function checkAlgorithm(header: Record<string, unknown>): AlgWarning | null {
  const alg = header['alg'];

  if (typeof alg !== 'string') {
    return { level: 'error', message: 'Header has no string "alg" — this is not a well-formed JWT.' };
  }

  if (alg.toLowerCase() === 'none') {
    return {
      level: 'error',
      message:
        'alg is "none" — this token is unsigned and carries no integrity guarantee at all. A verifier that accepts it can be trivially forged.',
    };
  }

  if (alg === 'HS256' || alg === 'HS384' || alg === 'HS512') {
    return {
      level: 'warn',
      message:
        `${alg} is symmetric: the same secret signs and verifies, so anyone who can verify can also mint tokens. ` +
        'If this token came from a third party, they can forge yours too.',
    };
  }

  return null;
}

// --- verification ------------------------------------------------------------

export type KeyFormat = 'secret' | 'jwk' | 'pem';

export interface VerifyResult {
  valid: boolean;
  message: string;
}

/**
 * Verifies the signature. `jose` handles the key import and the algorithm
 * matching; critically it refuses to verify an alg:none token, which is the
 * whole point of using a real library rather than comparing strings.
 */
export async function verify(
  token: string,
  keyInput: string,
  format: KeyFormat,
): Promise<VerifyResult> {
  const jose = await import('jose');
  const trimmed = token.trim().replace(/^Bearer\s+/i, '');

  let decoded: DecodedJwt;
  try {
    decoded = decode(trimmed);
  } catch (err) {
    return { valid: false, message: err instanceof Error ? err.message : String(err) };
  }

  const alg = decoded.header['alg'];
  if (typeof alg !== 'string' || alg.toLowerCase() === 'none') {
    return { valid: false, message: 'Cannot verify a token with alg "none" — there is no signature.' };
  }

  try {
    // Spelled out rather than derived from jwtVerify's parameters: that
    // signature is overloaded, and `Parameters<>` picks the key-resolver
    // overload, which no imported key satisfies.
    let key: KeyLike | Uint8Array | JWK;

    if (format === 'secret') {
      key = new TextEncoder().encode(keyInput);
    } else if (format === 'jwk') {
      const parsed: unknown = JSON.parse(keyInput);
      // A JWKS document has a "keys" array; pick the one matching kid, else the first.
      if (typeof parsed === 'object' && parsed !== null && 'keys' in parsed) {
        const keys = (parsed as { keys: unknown[] }).keys;
        const kid = decoded.header['kid'];
        const match =
          keys.find((k) => typeof k === 'object' && k !== null && (k as { kid?: unknown }).kid === kid) ??
          keys[0];
        if (!match) return { valid: false, message: 'The JWKS contains no keys.' };
        key = await jose.importJWK(match as JWK, alg);
      } else {
        key = await jose.importJWK(parsed as JWK, alg);
      }
    } else {
      key = await jose.importSPKI(keyInput, alg);
    }

    await jose.jwtVerify(trimmed, key, { algorithms: [alg] });
    return { valid: true, message: `Signature is valid for ${alg}.` };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { valid: false, message };
  }
}
