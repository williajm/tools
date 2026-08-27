import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { generate, MAX_COUNT, PREVIEW_CHARS, placeholderImage, preview, type Options } from './generate.ts';
import { SCRIPTS } from './scripts.ts';
import { EDGE_CASES } from './edge.ts';
import { makeRng } from './rng.ts';

const base: Options = {
  script: 'latin',
  unit: 'paragraphs',
  count: 2,
  format: 'text',
  seed: 'test',
  classicOpening: false,
};

describe('determinism', () => {
  it('produces identical output for the same seed', () => {
    // The whole reason for a seed: reproducible fixtures.
    for (const script of SCRIPTS) {
      const opts = { ...base, script: script.id };
      expect(generate(opts)).toBe(generate(opts));
    }
  });

  it('produces different output for different seeds', () => {
    const a = generate({ ...base, seed: 'aaa' });
    const b = generate({ ...base, seed: 'bbb' });
    expect(a).not.toBe(b);
  });

  it('is deterministic across arbitrary seeds', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), (seed) => {
        expect(generate({ ...base, seed })).toBe(generate({ ...base, seed }));
      }),
      { numRuns: 100 },
    );
  });
});

describe('exact length modes', () => {
  it('hits the requested character count exactly', () => {
    for (const count of [1, 10, 100, 255, 1000]) {
      const out = generate({ ...base, unit: 'characters', count });
      expect([...out], `count=${count}`).toHaveLength(count);
    }
  });

  it('hits the requested byte count exactly', () => {
    for (const count of [1, 16, 64, 255, 2000]) {
      const out = generate({ ...base, unit: 'bytes', count });
      expect(new TextEncoder().encode(out).length, `count=${count}`).toBe(count);
    }
  });

  it('never splits a multi-byte character when trimming to bytes', () => {
    // A CJK glyph is 3 UTF-8 bytes, so most budgets cannot be filled exactly
    // with whole characters — the result must still decode cleanly.
    const decoder = new TextDecoder('utf-8', { fatal: true });
    for (let count = 1; count <= 40; count++) {
      const out = generate({ ...base, script: 'japanese', unit: 'bytes', count });
      const bytes = new TextEncoder().encode(out);
      expect(bytes.length).toBeLessThanOrEqual(count);
      expect(() => decoder.decode(bytes), `count=${count}`).not.toThrow();
    }
  });

  it('never splits a surrogate pair when trimming to characters', () => {
    const out = generate({ ...base, unit: 'characters', count: 50 });
    // No lone surrogates.
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(out).not.toMatch(/(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/);
  });
});

describe('units', () => {
  it('produces the requested number of words', () => {
    const out = generate({ ...base, unit: 'words', count: 12 });
    expect(out.split(/\s+/).filter(Boolean)).toHaveLength(12);
  });

  it('produces the requested number of list items', () => {
    const out = generate({ ...base, unit: 'list-items', count: 5, format: 'markdown' });
    expect(out.split('\n').filter((l) => l.startsWith('- '))).toHaveLength(5);
  });

  it('produces the requested number of paragraphs', () => {
    const out = generate({ ...base, unit: 'paragraphs', count: 4 });
    expect(out.split('\n\n')).toHaveLength(4);
  });

  it('produces the requested number of words well past the paragraph ceiling', () => {
    // Regression: one 500-block ceiling covered every unit, so 10,000 words
    // silently came back as 500.
    const out = generate({ ...base, unit: 'words', count: 10000 });
    expect(out.split(' ')).toHaveLength(10000);
  });

  it('clamps absurd counts to the ceiling for that unit', () => {
    expect(generate({ ...base, unit: 'words', count: 0 }).length).toBeGreaterThan(0);
    expect(generate({ ...base, unit: 'words', count: 999999 }).split(' ')).toHaveLength(MAX_COUNT.words);
    expect(generate({ ...base, unit: 'paragraphs', count: 999999 }).split('\n\n')).toHaveLength(
      MAX_COUNT.paragraphs,
    );
  });
});

describe('formats', () => {
  it('emits balanced HTML with a heading and list markup', () => {
    const html = generate({ ...base, unit: 'paragraphs', count: 3, format: 'html' });
    expect(html).toContain('<p>');
    expect(html).toContain('<h2>');
    expect((html.match(/<p>/g) ?? []).length).toBe((html.match(/<\/p>/g) ?? []).length);

    const list = generate({ ...base, unit: 'list-items', count: 3, format: 'html' });
    expect(list).toContain('<ul>');
    expect((list.match(/<li>/g) ?? []).length).toBe(3);
  });

  it('marks RTL scripts with dir="rtl" in HTML', () => {
    const html = generate({ ...base, script: 'arabic', format: 'html' });
    expect(html).toContain('dir="rtl"');
  });

  it('does not mark LTR scripts as RTL', () => {
    expect(generate({ ...base, script: 'latin', format: 'html' })).not.toContain('dir="rtl"');
  });
});

describe('scripts', () => {
  it('emits characters from the requested script only', () => {
    // Spot-check that each script is actually producing its own alphabet rather
    // than silently falling back to Latin.
    const ranges: Partial<Record<string, RegExp>> = {
      cyrillic: /[Ѐ-ӿ]/,
      greek: /[Ͱ-Ͽ]/,
      arabic: /[؀-ۿ]/,
      hebrew: /[֐-׿]/,
      'cjk-han': /[一-鿿]/,
      japanese: /[぀-ヿ一-鿿]/,
      korean: /[가-힯]/,
      devanagari: /[ऀ-ॿ]/,
      thai: /[฀-๿]/,
    };
    for (const [script, pattern] of Object.entries(ranges)) {
      const out = generate({ ...base, script: script as Options['script'] });
      expect(pattern!.test(out), `${script} should emit its own script`).toBe(true);
    }
  });

  it('omits spaces between words for unspaced scripts', () => {
    const out = generate({ ...base, script: 'thai', unit: 'words', count: 8 });
    expect(out).not.toMatch(/\s/);
  });

  it('applies the classic opening only to Latin', () => {
    expect(generate({ ...base, classicOpening: true })).toMatch(/^Lorem ipsum dolor sit amet/);
    expect(generate({ ...base, script: 'arabic', classicOpening: true })).not.toMatch(/^Lorem/);
  });
});

describe('edge cases', () => {
  it('every entry has a value and an explanation', () => {
    expect(EDGE_CASES.length).toBeGreaterThan(8);
    for (const e of EDGE_CASES) {
      expect(e.value.length, e.id).toBeGreaterThan(0);
      expect(e.why.length, e.id).toBeGreaterThan(10);
    }
  });

  it('ids are unique', () => {
    expect(new Set(EDGE_CASES.map((e) => e.id)).size).toBe(EDGE_CASES.length);
  });

  it('the zero-width case really contains zero-width characters', () => {
    const zw = EDGE_CASES.find((e) => e.id === 'zero-width')!;
    expect(zw.value).toMatch(/[​‌‍﻿]/);
    // Renders as fewer glyphs than it has code points — the actual hazard.
    expect([...zw.value].length).toBeGreaterThan(5);
  });
});

describe('placeholderImage', () => {
  it('returns a self-contained SVG data URI with no network reference', () => {
    const uri = placeholderImage(320, 240);
    expect(uri.startsWith('data:image/svg+xml,')).toBe(true);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml,'.length));
    expect(svg).toContain('320');
    expect(svg).toContain('240');
    // The whole point: no external fetch.
    expect(svg).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});

describe('rng', () => {
  it('stays within range and covers the space', () => {
    const rng = makeRng('seed');
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      seen.add(v);
    }
    expect(seen.size).toBe(10);
  });

  it('shuffle is a permutation', () => {
    const input = [1, 2, 3, 4, 5, 6, 7, 8];
    const out = makeRng('s').shuffle(input);
    expect([...out].sort()).toEqual(input);
  });
});

/**
 * Regression: the classic opening was prepended after the requested amount had
 * been generated, so it silently overrode the count — "12 words" returned 20 and
 * "3 sentences" returned 4.
 */
describe('the classic opening counts towards the total', () => {
  const base = { script: 'latin', format: 'text', seed: 's' } as const;
  const words = (s: string) => s.trim().split(/\s+/).length;
  const sentences = (s: string) => (s.match(/\./g) ?? []).length;

  it('returns exactly the requested number of words', () => {
    for (const count of [1, 3, 8, 12, 40]) {
      const out = generate({ ...base, unit: 'words', count, classicOpening: true });
      expect(words(out), `${count} words`).toBe(count);
    }
  });

  it('returns exactly the requested number of sentences', () => {
    for (const count of [1, 3, 10]) {
      const out = generate({ ...base, unit: 'sentences', count, classicOpening: true });
      expect(sentences(out), `${count} sentences`).toBe(count);
    }
  });

  it('still opens with the conventional phrase', () => {
    const out = generate({ ...base, unit: 'words', count: 12, classicOpening: true });
    expect(out.startsWith('Lorem ipsum dolor sit amet')).toBe(true);
  });

  it('truncates the opening when fewer words are asked for than it contains', () => {
    const out = generate({ ...base, unit: 'words', count: 2, classicOpening: true });
    expect(out).toBe('Lorem ipsum');
  });

  it('leaves block counts alone, where the opening goes inside the first block', () => {
    // Text format joins every unit's blocks with a blank line.
    for (const unit of ['paragraphs', 'list-items'] as const) {
      const out = generate({ ...base, unit, count: 3, classicOpening: true });
      expect(out.split('\n\n'), unit).toHaveLength(3);
      expect(out.startsWith('Lorem ipsum'), unit).toBe(true);
    }
  });

  it('is unaffected when the opening is off', () => {
    expect(words(generate({ ...base, unit: 'words', count: 12, classicOpening: false }))).toBe(12);
  });

  it('does not apply to non-Latin scripts', () => {
    const out = generate({
      script: 'japanese', unit: 'sentences', count: 2, format: 'text', seed: 's', classicOpening: true,
    });
    expect(out).not.toContain('Lorem');
  });
});

/**
 * Regression: byte mode stopped as soon as the next code point would not fit, so
 * a 2-byte budget for a 3-byte-per-character script returned an empty string and
 * a 4-byte budget returned 3 — in a mode whose whole purpose is an exact length.
 */
describe('byte mode hits the budget exactly', () => {
  const bytes = (s: string) => new TextEncoder().encode(s).length;

  it('is exact for a multi-byte script at awkward budgets', () => {
    for (const script of ['japanese', 'cjk-han', 'arabic'] as const) {
      for (const count of [1, 2, 3, 4, 5, 7, 10, 100]) {
        const out = generate({ script, unit: 'bytes', count, format: 'text', seed: 's', classicOpening: false });
        expect(bytes(out), `${script} ${count}`).toBe(count);
      }
    }
  });

  it('is exact for Latin too', () => {
    for (const count of [1, 2, 10, 500]) {
      const out = generate({ script: 'latin', unit: 'bytes', count, format: 'text', seed: 's', classicOpening: false });
      expect(bytes(out)).toBe(count);
    }
  });

  it('never returns empty for a positive budget', () => {
    for (const script of ['japanese', 'cjk-han', 'latin'] as const) {
      const out = generate({ script, unit: 'bytes', count: 2, format: 'text', seed: 's', classicOpening: false });
      expect(out.length, script).toBeGreaterThan(0);
    }
  });

  it('leaves character mode exact as before', () => {
    for (const count of [1, 5, 50]) {
      const out = generate({ script: 'japanese', unit: 'characters', count, format: 'text', seed: 's', classicOpening: false });
      expect([...out]).toHaveLength(count);
    }
  });
});

describe('preview', () => {
  it('returns short text unchanged', () => {
    expect(preview('abc')).toBe('abc');
  });

  it('cuts at the limit without splitting a surrogate pair', () => {
    const exact = 'x'.repeat(PREVIEW_CHARS);
    expect(preview(exact + 'tail')).toBe(exact);
    // An astral character straddling the cut is dropped whole, not halved.
    const straddling = 'x'.repeat(PREVIEW_CHARS - 1) + '😀' + 'tail';
    expect(preview(straddling)).toBe('x'.repeat(PREVIEW_CHARS - 1));
  });
});
