import { describe, it, expect } from 'vitest';
import { KINDS, generate, timestampOf } from './ids.ts';

describe('generate', () => {
  it('produces the requested count for every kind', () => {
    for (const kind of KINDS) {
      expect(generate(kind, 5)).toHaveLength(5);
    }
  });

  it('produces unique values', () => {
    for (const kind of KINDS) {
      const ids = generate(kind, 200);
      expect(new Set(ids).size).toBe(200);
    }
  });

  it('clamps the count to a sane range', () => {
    expect(generate('uuidv4', 0)).toHaveLength(1);
    expect(generate('uuidv4', -5)).toHaveLength(1);
    expect(generate('uuidv4', 99999)).toHaveLength(1000);
    expect(generate('uuidv4', Number.NaN)).toHaveLength(1);
  });

  it('matches the canonical UUID shape and version nibble', () => {
    const v4 = generate('uuidv4', 1)[0]!;
    expect(v4).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    const v7 = generate('uuidv7', 1)[0]!;
    expect(v7).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('strips hyphens only from UUIDs', () => {
    expect(generate('uuidv4', 1, { hyphens: false })[0]).toMatch(/^[0-9a-f]{32}$/);
    // A ULID has no hyphens to begin with; the option must not alter it.
    const plain = generate('ulid', 1, { hyphens: true })[0]!;
    const stripped = generate('ulid', 1, { hyphens: false })[0]!;
    expect(plain).toHaveLength(26);
    expect(stripped).toHaveLength(26);
  });

  it('uppercases when asked', () => {
    expect(generate('uuidv4', 1, { uppercase: true })[0]).toMatch(/^[0-9A-F-]+$/);
  });
});

describe('timestampOf', () => {
  it('recovers roughly the current time from v7 and ULID', () => {
    const before = Date.now();
    const v7 = generate('uuidv7', 1)[0]!;
    const u = generate('ulid', 1)[0]!;
    const after = Date.now();

    for (const [kind, id] of [['uuidv7', v7], ['ulid', u]] as const) {
      const ts = timestampOf(kind, id);
      expect(ts).not.toBeNull();
      expect(ts!.getTime()).toBeGreaterThanOrEqual(before - 1000);
      expect(ts!.getTime()).toBeLessThanOrEqual(after + 1000);
    }
  });

  it('returns null for kinds with no embedded time', () => {
    expect(timestampOf('uuidv4', generate('uuidv4', 1)[0]!)).toBeNull();
    expect(timestampOf('nanoid', generate('nanoid', 1)[0]!)).toBeNull();
  });

  it('keeps time-ordered kinds lexicographically sorted within one millisecond', () => {
    // Regression: plain ulid() re-randomises its suffix each call, so a bulk
    // generate came out unsorted. Sortability is the whole reason to pick these
    // kinds over v4, so a bulk generate must preserve it.
    for (const kind of ['ulid', 'uuidv7'] as const) {
      const ids = generate(kind, 200);
      expect([...ids].sort(), `${kind} should already be sorted`).toEqual(ids);
    }
  });
});
