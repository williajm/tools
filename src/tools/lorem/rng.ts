/**
 * Seeded PRNG. Determinism is the point: a fixture generator that produces
 * different data every run cannot be used in a test that asserts on the output.
 *
 * mulberry32 — small, fast, good enough distribution for placeholder text.
 */
export interface Rng {
  next(): number;
  int(maxExclusive: number): number;
  pick<T>(items: readonly T[]): T;
  shuffle<T>(items: readonly T[]): T[];
}

export function hashSeed(seed: string): number {
  // FNV-1a, so a text seed maps to a stable 32-bit integer.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function makeRng(seed: string): Rng {
  let a = hashSeed(seed) || 1;

  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const int = (maxExclusive: number) => Math.floor(next() * maxExclusive);

  return {
    next,
    int,
    pick: <T>(items: readonly T[]): T => {
      if (items.length === 0) throw new Error('pick from empty list');
      return items[int(items.length)]!;
    },
    shuffle: <T>(items: readonly T[]): T[] => {
      const out = [...items];
      for (let i = out.length - 1; i > 0; i--) {
        const j = int(i + 1);
        [out[i], out[j]] = [out[j]!, out[i]!];
      }
      return out;
    },
  };
}
