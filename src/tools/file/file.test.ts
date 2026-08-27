// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { DEFAULT_REQUEST, MAX_BYTES, generateFile, maxFor, normalise, suggestedFilename, toBytes } from './file.ts';

const nodeSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

describe('sizes', () => {
  it('converts decimal and binary units', () => {
    expect(toBytes(1, 'KB')).toBe(1000);
    expect(toBytes(1, 'KiB')).toBe(1024);
    expect(toBytes(2.5, 'MB')).toBe(2_500_000);
    expect(toBytes(10, 'MiB')).toBe(10_485_760);
  });

  it('rounds fractional bytes', () => {
    expect(toBytes(1.0004, 'KB')).toBe(1000);
  });

  it('caps every unit at exactly 1 GiB, fractions included', () => {
    expect(maxFor('B')).toBe(MAX_BYTES);
    expect(maxFor('MiB')).toBe(1024);
    // Regression: flooring to 1073 MB made 1073.5 MB unreachable although it is under the limit.
    expect(maxFor('MB')).toBeCloseTo(1073.741824, 6);
    expect(toBytes(maxFor('MB'), 'MB')).toBe(MAX_BYTES);
  });

  it('normalises state a hand-edited URL could carry', () => {
    const good = { size: 2.5, unit: 'MB', fill: 'zeros' } as const;
    expect(normalise(good)).toEqual(good);
    // Each bad field falls back on its own; the others survive.
    expect(normalise({ size: 3, unit: 'GB' as never, fill: 'zeros' })).toEqual({ size: 3, unit: DEFAULT_REQUEST.unit, fill: 'zeros' });
    expect(normalise({ size: 3, unit: 'B', fill: 'ones' as never })).toEqual({ size: 3, unit: 'B', fill: DEFAULT_REQUEST.fill });
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(normalise({ size, unit: 'B', fill: 'zeros' }).size).toBe(DEFAULT_REQUEST.size);
    }
    expect(normalise({ size: 5000, unit: 'MiB', fill: 'random' }).size).toBe(1024);
  });

  it('names the file after what it contains', () => {
    expect(suggestedFilename(10, 'MiB', 'random')).toBe('random-10MiB.bin');
    expect(suggestedFilename(2.5, 'MB', 'zeros')).toBe('zeros-2.5MB.bin');
  });
});

describe('generateFile', () => {
  it('produces zero bytes of exactly the requested length with the right digest', async () => {
    const { blob, bytes, sha256 } = await generateFile(3, 'zeros');
    const data = new Uint8Array(await blob.arrayBuffer());
    expect(bytes).toBe(3);
    expect(data).toEqual(new Uint8Array([0, 0, 0]));
    expect(sha256).toBe(nodeSha256(data));
  });

  it('produces random bytes across chunk and getRandomValues boundaries', async () => {
    // 2 MiB + 3: spans two full 1 MiB chunks plus a remainder, and each chunk
    // needs several 64 KiB getRandomValues calls.
    const size = 2 * 1024 * 1024 + 3;
    const { blob, sha256 } = await generateFile(size, 'random');
    const data = new Uint8Array(await blob.arrayBuffer());
    expect(data).toHaveLength(size);
    expect(sha256).toBe(nodeSha256(data));
    // Not all zeros, and the tail beyond the last 64 KiB boundary is filled too.
    expect(data.some((b) => b !== 0)).toBe(true);
    expect(data.subarray(size - 3).some((b) => b !== 0) || data.subarray(size - 4096).some((b) => b !== 0)).toBe(true);
  });

  it('hashes multi-chunk zero files correctly', async () => {
    const size = 3 * 1024 * 1024 + 1;
    const { blob, sha256 } = await generateFile(size, 'zeros');
    expect(blob.size).toBe(size);
    expect(sha256).toBe(nodeSha256(new Uint8Array(size)));
  });

  it('reports progress up to the full size', async () => {
    const seen: number[] = [];
    await generateFile(2 * 1024 * 1024 + 1, 'zeros', (done) => seen.push(done));
    expect(seen).toEqual([1024 * 1024, 2 * 1024 * 1024, 2 * 1024 * 1024 + 1]);
  });

  it('refuses sizes outside 1 byte to 1 GiB', async () => {
    await expect(generateFile(0, 'zeros')).rejects.toThrow(/1 to/);
    await expect(generateFile(MAX_BYTES + 1, 'zeros')).rejects.toThrow(/1 to/);
    await expect(generateFile(1.5, 'zeros')).rejects.toThrow(/whole number/);
  });
});
