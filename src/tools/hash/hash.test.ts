import { describe, it, expect } from 'vitest';
import { ALGORITHMS, compute, digest, hmac } from './hash.ts';

// Known-answer tests. These vectors are published, so a regression in the
// wiring (wrong encoding, wrong algorithm) shows up immediately.
describe('digest known answers', () => {
  it('matches published vectors for "abc"', async () => {
    expect(await digest('abc', 'MD5')).toBe('900150983cd24fb0d6963f7d28e17f72');
    expect(await digest('abc', 'SHA-1')).toBe('a9993e364706816aba3e25717850c26c9cd0d89d');
    expect(await digest('abc', 'SHA-256')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(await digest('abc', 'SHA-512')).toBe(
      'ddaf35a193617abacc417349ae20413112e6fa4e89a97ea20a9eeee64b55d39a' +
        '2192992a274fc1a836ba3c23a3feebbd454d4423643ce80e2a9ac94fa54ca49f',
    );
  });

  it('matches published vectors for the empty string', async () => {
    expect(await digest('', 'MD5')).toBe('d41d8cd98f00b204e9800998ecf8427e');
    expect(await digest('', 'SHA-256')).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
  });

  it('matches the published vector for SHA-384', async () => {
    expect(await digest('abc', 'SHA-384')).toBe(
      'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed' +
        '8086072ba1e7cc2358baeca134c825a7',
    );
  });

  it('hashes UTF-8 bytes rather than code units', async () => {
    // "é" is two bytes in UTF-8; hashing code units would give a different digest.
    expect(await digest('é', 'SHA-256')).toBe(
      '4a99557e4033c3539de2eb65472017cad5f9557f7a0625a09f1c3f6e2ba69c4c',
    );
    expect(await digest('日本語', 'SHA-256')).toBe(
      '77710aedc74ecfa33685e33a6c7df5cc83004da1bdcef7fb280f5c2b2e97e0a5',
    );
  });
});

describe('hmac known answers', () => {
  it('matches RFC 4231 test case 2', async () => {
    // key = "Jefe", data = "what do ya want for nothing?"
    expect(await hmac('what do ya want for nothing?', 'Jefe', 'SHA-256')).toBe(
      '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843',
    );
    expect(await hmac('what do ya want for nothing?', 'Jefe', 'SHA-1')).toBe(
      'effcdf6ae5eb2fa2d27416d5f184df9c259a7c79',
    );
  });

  it('refuses HMAC-MD5 rather than offering a broken MAC', async () => {
    await expect(hmac('x', 'k', 'MD5')).rejects.toThrow(/not available/i);
  });
});

describe('compute', () => {
  it('digests when no key is given and HMACs when one is', async () => {
    expect(await compute('abc', 'SHA-256', null)).toBe(await digest('abc', 'SHA-256'));
    expect(await compute('abc', 'SHA-256', 'k')).toBe(await hmac('abc', 'k', 'SHA-256'));
  });

  it('produces a hex digest of the documented length for every algorithm', async () => {
    const lengths: Record<string, number> = {
      MD5: 32,
      'SHA-1': 40,
      'SHA-256': 64,
      'SHA-384': 96,
      'SHA-512': 128,
    };
    for (const algo of ALGORITHMS) {
      const out = await digest('some input', algo);
      expect(out).toMatch(/^[0-9a-f]+$/);
      expect(out, algo).toHaveLength(lengths[algo]!);
    }
  });
});
