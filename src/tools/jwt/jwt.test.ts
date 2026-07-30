/**
 * @vitest-environment node
 *
 * jose checks `payload instanceof Uint8Array`, and jsdom's TextEncoder returns
 * one from a different realm, so the check fails there. A browser has a single
 * realm, so this is a jsdom artifact rather than a real defect — run these
 * against Node, which is also where jose's crypto path is exercised properly.
 */
import { describe, it, expect } from 'vitest';
import { SignJWT } from 'jose';
import { checkAlgorithm, decode, describeClaims, verify } from './jwt.ts';

const SECRET = new TextEncoder().encode('a-very-long-test-secret-value-0123456789');

async function makeToken(claims: Record<string, unknown>, expiresIn = '1h') {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .sign(SECRET);
}

describe('decode', () => {
  it('splits a valid token into header, payload and signature', async () => {
    const token = await makeToken({ sub: 'user-1', role: 'admin' });
    const out = decode(token);
    expect(out.header['alg']).toBe('HS256');
    expect(out.header['typ']).toBe('JWT');
    expect(out.payload['sub']).toBe('user-1');
    expect(out.payload['role']).toBe('admin');
    expect(out.signature).not.toBe('');
    expect(out.signingInput.split('.')).toHaveLength(2);
  });

  it('strips a Bearer prefix', async () => {
    const token = await makeToken({ sub: 'x' });
    expect(decode(`Bearer ${token}`).payload['sub']).toBe('x');
    expect(decode(`bearer  ${token}`).payload['sub']).toBe('x');
  });

  it('decodes unicode claims correctly', async () => {
    const token = await makeToken({ name: '日本語 🎉' });
    expect(decode(token).payload['name']).toBe('日本語 🎉');
  });

  it('reports the wrong number of segments', () => {
    expect(() => decode('a.b')).toThrow(/three dot-separated parts; this has 2/);
    expect(() => decode('a.b.c.d.e')).toThrow(/JWE/);
  });

  it('reports malformed segments distinctly', () => {
    expect(() => decode('!!!.eyJhIjoxfQ.sig')).toThrow(/header is not valid base64url/);
    // Valid base64url that is not JSON.
    expect(() => decode('eyJhbGciOiJIUzI1NiJ9.bm90anNvbg.sig')).toThrow(/payload is not valid JSON/);
  });

  it('rejects an empty token', () => {
    expect(() => decode('   ')).toThrow(/Paste a token/);
  });
});

describe('checkAlgorithm', () => {
  it('flags alg:none as an error', () => {
    const warning = checkAlgorithm({ alg: 'none' });
    expect(warning?.level).toBe('error');
    expect(warning?.message).toMatch(/unsigned/i);
  });

  it('is case-insensitive about none', () => {
    expect(checkAlgorithm({ alg: 'NONE' })?.level).toBe('error');
    expect(checkAlgorithm({ alg: 'None' })?.level).toBe('error');
  });

  it('warns that HMAC algorithms are symmetric', () => {
    for (const alg of ['HS256', 'HS384', 'HS512']) {
      const warning = checkAlgorithm({ alg });
      expect(warning?.level, alg).toBe('warn');
      expect(warning?.message).toMatch(/symmetric/);
    }
  });

  it('is quiet for asymmetric algorithms', () => {
    expect(checkAlgorithm({ alg: 'RS256' })).toBeNull();
    expect(checkAlgorithm({ alg: 'ES256' })).toBeNull();
  });

  it('errors when alg is missing or not a string', () => {
    expect(checkAlgorithm({})?.level).toBe('error');
    expect(checkAlgorithm({ alg: 42 })?.level).toBe('error');
  });
});

describe('describeClaims', () => {
  const now = 1_700_000_000_000; // fixed clock

  it('marks an expired token as an error', () => {
    const notes = describeClaims({ exp: 1_600_000_000 }, now);
    const exp = notes.find((n) => n.claim === 'exp')!;
    expect(exp.status).toBe('error');
    expect(exp.detail).toMatch(/expired/i);
  });

  it('marks a live token as ok', () => {
    const notes = describeClaims({ exp: 1_800_000_000 }, now);
    expect(notes.find((n) => n.claim === 'exp')!.status).toBe('ok');
  });

  it('warns when there is no exp at all', () => {
    const notes = describeClaims({ sub: 'x' }, now);
    const exp = notes.find((n) => n.claim === 'exp')!;
    expect(exp.status).toBe('warn');
    expect(exp.detail).toMatch(/never expires/);
  });

  it('catches milliseconds passed where seconds are required', () => {
    // The single most common JWT bug in the wild.
    const notes = describeClaims({ exp: 1_700_000_000_000 }, now);
    const exp = notes.find((n) => n.claim === 'exp')!;
    expect(exp.status).toBe('error');
    expect(exp.detail).toMatch(/milliseconds/);
  });

  it('rejects non-numeric time claims', () => {
    const notes = describeClaims({ exp: '1700000000' }, now);
    expect(notes.find((n) => n.claim === 'exp')!.status).toBe('error');
  });

  it('flags a not-yet-valid nbf', () => {
    const notes = describeClaims({ nbf: 1_800_000_000, exp: 1_900_000_000 }, now);
    const nbf = notes.find((n) => n.claim === 'nbf')!;
    expect(nbf.status).toBe('error');
    expect(nbf.detail).toMatch(/not valid yet/);
  });

  it('warns about clock skew on a future iat', () => {
    const notes = describeClaims({ iat: 1_700_000_500, exp: 1_800_000_000 }, now);
    expect(notes.find((n) => n.claim === 'iat')!.status).toBe('warn');
  });

  it('renders an array audience as a list', () => {
    const notes = describeClaims({ aud: ['a', 'b'], exp: 1_800_000_000 }, now);
    expect(notes.find((n) => n.claim === 'aud')!.value).toBe('a, b');
  });
});

describe('verify', () => {
  it('accepts a correct secret', async () => {
    const token = await makeToken({ sub: 'x' });
    const result = await verify(token, 'a-very-long-test-secret-value-0123456789', 'secret');
    expect(result.valid).toBe(true);
    expect(result.message).toMatch(/valid for HS256/);
  });

  it('rejects a wrong secret', async () => {
    const token = await makeToken({ sub: 'x' });
    const result = await verify(token, 'wrong-secret-wrong-secret-wrong-secret', 'secret');
    expect(result.valid).toBe(false);
  });

  it('rejects an expired token even with the right secret', async () => {
    const token = await new SignJWT({ sub: 'x' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuedAt(1_600_000_000)
      .setExpirationTime(1_600_000_060)
      .sign(SECRET);
    const result = await verify(token, 'a-very-long-test-secret-value-0123456789', 'secret');
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/exp/i);
  });

  it('refuses to verify alg:none rather than reporting success', async () => {
    // Hand-built unsigned token — the classic forgery attempt.
    const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const payload = btoa(JSON.stringify({ sub: 'admin' }))
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    const result = await verify(`${header}.${payload}.`, 'anything', 'secret');
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/alg "none"/);
  });

  it('reports a decode failure rather than throwing', async () => {
    const result = await verify('not-a-jwt', 'secret', 'secret');
    expect(result.valid).toBe(false);
    expect(result.message).toMatch(/three dot-separated parts/);
  });
});
