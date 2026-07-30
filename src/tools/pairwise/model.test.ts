import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  exportMatrix,
  generateMatrix,
  isReachable,
  lowerBoundRows,
  parse,
  parseExclusions,
  parseParameters,
  verifyCoverage,
  type Exclusion,
  type Parameter,
} from './model.ts';

describe('parseParameters', () => {
  it('parses the basic form', () => {
    const { parameters, errors } = parseParameters('OS: Windows, macOS, Linux\nBrowser: Chrome, Firefox');
    expect(errors).toEqual([]);
    expect(parameters).toEqual([
      { name: 'OS', values: ['Windows', 'macOS', 'Linux'] },
      { name: 'Browser', values: ['Chrome', 'Firefox'] },
    ]);
  });

  it('ignores blank lines and comments', () => {
    const { parameters } = parseParameters('# a comment\n\nA: 1, 2\n\n  \nB: 3, 4');
    expect(parameters).toHaveLength(2);
  });

  it('supports quoted values containing commas', () => {
    const { parameters, errors } = parseParameters('Sep: ",", ";", "|"');
    expect(errors).toEqual([]);
    expect(parameters[0]!.values).toEqual([',', ';', '|']);
  });

  it('reports a missing colon', () => {
    expect(parseParameters('OS Windows macOS').errors[0]).toMatch(/expected "Name: value/);
  });

  it('reports duplicate parameter names', () => {
    expect(parseParameters('A: 1, 2\nA: 3, 4').errors[0]).toMatch(/duplicate parameter "A"/);
  });

  it('reports duplicate values', () => {
    expect(parseParameters('A: 1, 2, 1').errors[0]).toMatch(/duplicate values/);
  });

  it('rejects a single-value parameter, which cannot vary', () => {
    expect(parseParameters('A: only').errors[0]).toMatch(/only one value/);
  });

  it('reports an empty value list', () => {
    expect(parseParameters('A:').errors[0]).toMatch(/no values/);
  });
});

describe('parseExclusions', () => {
  const params: Parameter[] = [
    { name: 'OS', values: ['Windows', 'macOS', 'Linux'] },
    { name: 'Browser', values: ['Chrome', 'Safari'] },
  ];

  it('parses a forbidden combination', () => {
    const { exclusions, errors } = parseExclusions('Browser=Safari, OS=Windows', params);
    expect(errors).toEqual([]);
    expect(exclusions[0]!.terms).toEqual([
      { name: 'Browser', value: 'Safari' },
      { name: 'OS', value: 'Windows' },
    ]);
  });

  it('rejects an unknown parameter', () => {
    expect(parseExclusions('Nope=1, OS=Windows', params).errors[0]).toMatch(/unknown parameter "Nope"/);
  });

  it('rejects a value that parameter does not have', () => {
    expect(parseExclusions('OS=Solaris, Browser=Chrome', params).errors[0]).toMatch(/no value "Solaris"/);
  });

  it('rejects a single-term exclusion', () => {
    // Excluding one value outright is a parameter edit, not a constraint.
    expect(parseExclusions('OS=Windows', params).errors[0]).toMatch(/at least two terms/);
  });

  it('rejects malformed terms', () => {
    expect(parseExclusions('OS Windows, Browser=Chrome', params).errors[0]).toMatch(/not of the form/);
  });
});

describe('generateMatrix', () => {
  const params: Parameter[] = [
    { name: 'OS', values: ['Windows', 'macOS', 'Linux', 'iOS'] },
    { name: 'Browser', values: ['Chrome', 'Firefox', 'Safari', 'Edge'] },
    { name: 'Auth', values: ['SSO', 'Password', 'Passkey'] },
    { name: 'Locale', values: ['en-GB', 'ja-JP', 'ar-EG'] },
  ];

  it('covers every pair', () => {
    const result = generateMatrix(params, []);
    expect(result.error).toBeUndefined();
    expect(result.coverage.covered).toBe(result.coverage.total);
    expect(result.coverage.missing).toEqual([]);
  });

  it('stays within a sane multiple of the theoretical lower bound', () => {
    const result = generateMatrix(params, []);
    expect(result.lowerBound).toBe(16);
    // A greedy covering array should not be wildly worse than optimal; this
    // catches a quality regression, not just a correctness one.
    expect(result.rows.length).toBeGreaterThanOrEqual(result.lowerBound);
    expect(result.rows.length).toBeLessThanOrEqual(result.lowerBound * 2);
  });

  it('never emits a row violating an exclusion', () => {
    const exclusions = [
      { terms: [{ name: 'Browser', value: 'Safari' }, { name: 'OS', value: 'Windows' }], raw: '' },
      { terms: [{ name: 'Browser', value: 'Safari' }, { name: 'OS', value: 'Linux' }], raw: '' },
      { terms: [{ name: 'Browser', value: 'Edge' }, { name: 'OS', value: 'Linux' }], raw: '' },
    ];
    const result = generateMatrix(params, exclusions);
    expect(result.error).toBeUndefined();
    for (const row of result.rows) {
      for (const e of exclusions) {
        const violated = e.terms.every((t) => row[t.name] === t.value);
        expect(violated, JSON.stringify(row)).toBe(false);
      }
    }
  });

  it('still covers every reachable pair under exclusions', () => {
    const exclusions = [
      { terms: [{ name: 'Browser', value: 'Safari' }, { name: 'OS', value: 'Windows' }], raw: '' },
    ];
    const result = generateMatrix(params, exclusions);
    expect(result.coverage.missing).toEqual([]);
    // The forbidden pair is accounted for as excluded, not silently dropped.
    expect(result.coverage.excluded).toBeGreaterThan(0);
  });

  it('supports 3-way strength', () => {
    const result = generateMatrix(params, [], 3);
    expect(result.error).toBeUndefined();
    // Higher strength needs more rows but must still cover all pairs.
    expect(result.coverage.missing).toEqual([]);
    expect(result.rows.length).toBeGreaterThan(generateMatrix(params, [], 2).rows.length);
  });

  it('reports rather than throws when parameters are insufficient', () => {
    expect(generateMatrix([], []).error).toMatch(/at least two parameters/);
    expect(generateMatrix([params[0]!], []).error).toMatch(/at least two parameters/);
    expect(generateMatrix(params, [], 9).error).toMatch(/needs at least 9 parameters/);
  });

  it('reports contradictory exclusions instead of crashing', () => {
    // Forbid every OS alongside Chrome, and every browser but Chrome outright,
    // leaving nothing satisfiable.
    const tiny: Parameter[] = [
      { name: 'A', values: ['1', '2'] },
      { name: 'B', values: ['x', 'y'] },
    ];
    const exclusions = [
      { terms: [{ name: 'A', value: '1' }, { name: 'B', value: 'x' }], raw: '' },
      { terms: [{ name: 'A', value: '1' }, { name: 'B', value: 'y' }], raw: '' },
      { terms: [{ name: 'A', value: '2' }, { name: 'B', value: 'x' }], raw: '' },
      { terms: [{ name: 'A', value: '2' }, { name: 'B', value: 'y' }], raw: '' },
    ];
    const result = generateMatrix(tiny, exclusions);
    // Either an explicit error or an empty matrix — never a silent wrong answer.
    if (!result.error) expect(result.rows).toEqual([]);
  });
});

describe('coverage verification is a real oracle', () => {
  it('detects a deliberately incomplete matrix', () => {
    const params: Parameter[] = [
      { name: 'A', values: ['1', '2'] },
      { name: 'B', values: ['x', 'y'] },
    ];
    // Only one of the four pairs present.
    const coverage = verifyCoverage(params, [{ A: '1', B: 'x' }], []);
    expect(coverage.total).toBe(4);
    expect(coverage.covered).toBe(1);
    expect(coverage.missing).toHaveLength(3);
  });

  it('covers all pairs for arbitrary parameter shapes', () => {
    // Property test: whatever the shape, the generated matrix must be complete.
    fc.assert(
      fc.property(
        fc.array(fc.integer({ min: 2, max: 4 }), { minLength: 2, maxLength: 5 }),
        (sizes) => {
          const params: Parameter[] = sizes.map((n, i) => ({
            name: `P${i}`,
            values: Array.from({ length: n }, (_, v) => `v${v}`),
          }));
          const result = generateMatrix(params, []);
          expect(result.error).toBeUndefined();
          expect(result.coverage.missing).toEqual([]);
          expect(result.coverage.covered).toBe(result.coverage.total);
          expect(result.rows.length).toBeGreaterThanOrEqual(lowerBoundRows(params));
        },
      ),
      { numRuns: 40 },
    );
  });

  /**
   * Regression: verifyCoverage enumerated pairs whatever the strength, so a
   * 3-way matrix was declared complete on the strength of its pairs alone, and
   * the UI labelled that count "3-tuples".
   */
  describe('verifies at the strength it was asked for', () => {
    const params: Parameter[] = [
      { name: 'A', values: ['1', '2'] },
      { name: 'B', values: ['1', '2'] },
      { name: 'C', values: ['1', '2'] },
      { name: 'D', values: ['1', '2'] },
    ];

    it('enumerates tuples of the requested width', () => {
      // C(4,2) × 2² = 24 pairs; C(4,3) × 2³ = 32 triples; C(4,4) × 2⁴ = 16 quads.
      expect(verifyCoverage(params, [], [], 2).total).toBe(24);
      expect(verifyCoverage(params, [], [], 3).total).toBe(32);
      expect(verifyCoverage(params, [], [], 4).total).toBe(16);
      expect(verifyCoverage(params, [], [], 3).missing[0]).toHaveLength(3);
    });

    it('reports the strength it actually checked', () => {
      expect(verifyCoverage(params, [], [], 3).strength).toBe(3);
      // Capped at the number of parameters rather than silently over-claiming.
      expect(verifyCoverage(params, [], [], 9).strength).toBe(4);
    });

    it('catches a pair-complete matrix that misses a triple', () => {
      const pairComplete = generateMatrix(params, [], 2);
      expect(pairComplete.coverage.missing).toEqual([]);
      // The same rows judged at strength 3 must not pass.
      const asTriples = verifyCoverage(params, pairComplete.rows, [], 3);
      expect(asTriples.missing.length).toBeGreaterThan(0);
      expect(asTriples.covered).toBeLessThan(asTriples.total);
    });

    it('is satisfied by a genuine 3-way matrix', () => {
      const result = generateMatrix(params, [], 3);
      expect(result.error).toBeUndefined();
      expect(result.coverage.strength).toBe(3);
      expect(result.coverage.missing).toEqual([]);
    });

    it('scales the lower bound with strength', () => {
      expect(lowerBoundRows(params, 2)).toBe(4);
      expect(lowerBoundRows(params, 3)).toBe(8);
      expect(lowerBoundRows(params, 4)).toBe(16);
    });
  });

  /**
   * Regression: reachability was decided by testing the tuple against each
   * exclusion in isolation, so a value that several exclusions jointly ruled out
   * was still counted as reachable and then reported as an uncovered gap —
   * blaming the generator for the user's own constraints.
   */
  describe('reachability accounts for exclusions combining', () => {
    const params: Parameter[] = [
      { name: 'A', values: ['1', '2'] },
      { name: 'B', values: ['1', '2'] },
      { name: 'C', values: ['1', '2'] },
    ];
    // Between them these forbid A=1 outright: C has no third value left.
    const exclusions: Exclusion[] = [
      { terms: [{ name: 'A', value: '1' }, { name: 'C', value: '1' }], raw: 'A=1, C=1' },
      { terms: [{ name: 'A', value: '1' }, { name: 'C', value: '2' }], raw: 'A=1, C=2' },
    ];

    it('knows a transitively impossible tuple is unreachable', () => {
      expect(isReachable(params, [{ name: 'A', value: '1' }, { name: 'B', value: '1' }], exclusions))
        .toBe(false);
      expect(isReachable(params, [{ name: 'A', value: '2' }, { name: 'B', value: '1' }], exclusions))
        .toBe(true);
    });

    it('reports it as excluded rather than missing', () => {
      const result = generateMatrix(params, exclusions);
      expect(result.error).toBeUndefined();
      expect(result.coverage.missing).toEqual([]);
      expect(result.coverage.covered).toBe(result.coverage.total);
      // The four A=1 pairs are accounted for, not counted as gaps.
      expect(result.coverage.excluded).toBeGreaterThanOrEqual(4);
    });

    it('still calls a directly forbidden pair unreachable', () => {
      const direct: Exclusion[] = [
        { terms: [{ name: 'A', value: '1' }, { name: 'B', value: '1' }], raw: 'A=1, B=1' },
      ];
      expect(isReachable(params, [{ name: 'A', value: '1' }, { name: 'B', value: '1' }], direct))
        .toBe(false);
      // But A=1 on its own is still fine, since B=2 is available.
      expect(isReachable(params, [{ name: 'A', value: '1' }], direct)).toBe(true);
    });

    it('terminates on a fully contradictory constraint set', () => {
      const all: Exclusion[] = [];
      for (const a of ['1', '2']) {
        for (const b of ['1', '2']) {
          for (const c of ['1', '2']) {
            all.push({
              terms: [
                { name: 'A', value: a },
                { name: 'B', value: b },
                { name: 'C', value: c },
              ],
              raw: '',
            });
          }
        }
      }
      expect(isReachable(params, [{ name: 'A', value: '1' }], all)).toBe(false);
    });
  });
});

describe('exportMatrix', () => {
  const params: Parameter[] = [
    { name: 'A', values: ['1', '2'] },
    { name: 'B', values: ['x', 'y'] },
  ];
  const rows = [
    { A: '1', B: 'x' },
    { A: '2', B: 'y' },
  ];

  it('emits CSV with a header', () => {
    expect(exportMatrix(params, rows, 'csv')).toBe('A,B\n1,x\n2,y');
  });

  it('quotes CSV cells needing it', () => {
    expect(exportMatrix([{ name: 'S', values: [] }], [{ S: 'a,b' }], 'csv')).toContain('"a,b"');
  });

  it('emits a markdown table with a numbered column', () => {
    const md = exportMatrix(params, rows, 'markdown');
    expect(md.split('\n')[0]).toBe('| # | A | B |');
    expect(md).toContain('| 1 | 1 | x |');
  });

  it('emits parseable JSON', () => {
    expect(JSON.parse(exportMatrix(params, rows, 'json'))).toEqual(rows);
  });

  it('returns empty for no rows', () => {
    expect(exportMatrix(params, [], 'csv')).toBe('');
  });
});

describe('parse', () => {
  it('combines parameter and exclusion parsing', () => {
    const result = parse('OS: Windows, Linux\nBrowser: Chrome, Safari', 'Browser=Safari, OS=Linux');
    expect(result.errors).toEqual([]);
    expect(result.parameters).toHaveLength(2);
    expect(result.exclusions).toHaveLength(1);
  });

  it('surfaces errors from both halves', () => {
    const result = parse('OS Windows', 'Nope=1, Bad=2');
    expect(result.errors.length).toBeGreaterThan(1);
  });
});
