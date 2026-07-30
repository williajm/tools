import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  DEFAULT_OPTIONS,
  collapse,
  computeDiff,
  isSkip,
  normalise,
  toSideBySide,
  toUnified,
  wordSegments,
  type Options,
  type Row,
} from './diff.ts';

const opts = (overrides: Partial<Options> = {}): Options => ({ ...DEFAULT_OPTIONS, ...overrides });

describe('normalise', () => {
  it('converts CRLF and CR to LF when asked', () => {
    expect(normalise('a\r\nb\rc', opts())).toBe('a\nb\nc');
  });

  it('leaves line endings alone when not asked', () => {
    expect(normalise('a\r\nb', opts({ normaliseEol: false }))).toBe('a\r\nb');
  });

  it('trims trailing whitespace when asked', () => {
    expect(normalise('a   \nb\t\n', opts({ trimTrailing: true }))).toBe('a\nb\n');
  });

  it('does not touch leading whitespace', () => {
    expect(normalise('   a', opts({ trimTrailing: true }))).toBe('   a');
  });
});

describe('computeDiff — lines', () => {
  it('reports identical input as identical', () => {
    const result = computeDiff('a\nb\nc', 'a\nb\nc', 'lines', opts());
    expect(result.summary.identical).toBe(true);
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(0);
    expect(result.rows.every((r) => r.kind === 'equal')).toBe(true);
  });

  it('numbers lines independently per side', () => {
    const { rows } = computeDiff('a\nb\nc', 'a\nX\nc', 'lines', opts());
    const removed = rows.find((r) => r.kind === 'removed')!;
    const added = rows.find((r) => r.kind === 'added')!;
    expect(removed.leftNo).toBe(2);
    expect(removed.rightNo).toBeUndefined();
    expect(added.rightNo).toBe(2);
    expect(added.leftNo).toBeUndefined();
  });

  it('counts a pure addition', () => {
    const result = computeDiff('a\nb', 'a\nb\nc', 'lines', opts());
    expect(result.summary.added).toBe(1);
    expect(result.summary.removed).toBe(0);
  });

  it('counts a pure deletion', () => {
    const result = computeDiff('a\nb\nc', 'a\nb', 'lines', opts());
    expect(result.summary.added).toBe(0);
    expect(result.summary.removed).toBe(1);
  });

  it('does not emit a phantom final line for a trailing newline', () => {
    // Regression: splitting on \n leaves an empty tail element that is not a line.
    const result = computeDiff('a\nb\n', 'a\nb\n', 'lines', opts());
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map((r) => r.text)).toEqual(['a', 'b']);
  });

  it('treats a line-ending-only difference as identical once normalised', () => {
    const result = computeDiff('a\r\nb', 'a\nb', 'lines', opts({ normaliseEol: true }));
    expect(result.summary.identical).toBe(true);
  });

  it('sees a line-ending difference when normalisation is off', () => {
    const result = computeDiff('a\r\nb', 'a\nb', 'lines', opts({ normaliseEol: false }));
    expect(result.summary.identical).toBe(false);
  });

  it('honours ignoreCase', () => {
    expect(computeDiff('Hello', 'hello', 'lines', opts()).summary.added).toBe(1);
    expect(computeDiff('Hello', 'hello', 'lines', opts({ ignoreCase: true })).summary.added).toBe(0);
  });

  it('handles empty input on either side', () => {
    expect(computeDiff('', '', 'lines', opts()).summary.identical).toBe(true);
    expect(computeDiff('', 'a', 'lines', opts()).summary.added).toBeGreaterThan(0);
    expect(computeDiff('a', '', 'lines', opts()).summary.removed).toBeGreaterThan(0);
  });

  it('counts empty input as one empty line, not zero lines', () => {
    // Regression: jsdiff returns no changes at all for '' vs '', which lost the
    // row that the line accounting expects on both sides.
    const result = computeDiff('', '', 'lines', opts());
    expect(result.rows).toEqual([{ kind: 'equal', leftNo: 1, rightNo: 1, text: '' }]);
  });

  it('appends a line without rewriting the previous one', () => {
    // Regression: jsdiff's line tokens include the newline, so the unterminated
    // last line 'b' did not match 'b\n' and the diff read as -1/+2.
    const { rows } = computeDiff('a\nb', 'a\nb\nc', 'lines', opts());
    expect(rows.map((r) => [r.kind, r.text])).toEqual([
      ['equal', 'a'],
      ['equal', 'b'],
      ['added', 'c'],
    ]);
  });

  it('ignores leading and trailing whitespace when asked', () => {
    expect(computeDiff('  a', 'a  ', 'lines', opts()).summary.identical).toBe(false);
    expect(
      computeDiff('  a', 'a  ', 'lines', opts({ ignoreWhitespace: true })).summary.identical,
    ).toBe(true);
    // Interior whitespace is still a difference.
    expect(
      computeDiff('a b', 'a  b', 'lines', opts({ ignoreWhitespace: true })).summary.identical,
    ).toBe(false);
  });

  it('accounts for every line of both inputs', () => {
    // Property: each side's line count must be recoverable from the rows.
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 12 }),
        fc.array(fc.constantFrom('a', 'b', 'c', 'd'), { maxLength: 12 }),
        (leftLines, rightLines) => {
          const left = leftLines.join('\n');
          const right = rightLines.join('\n');
          const { rows } = computeDiff(left, right, 'lines', opts());

          const leftCount = rows.filter((r) => r.kind !== 'added').length;
          const rightCount = rows.filter((r) => r.kind !== 'removed').length;
          expect(leftCount).toBe(left.split('\n').length);
          expect(rightCount).toBe(right.split('\n').length);
        },
      ),
      { numRuns: 150 },
    );
  });
});

describe('computeDiff — words and chars', () => {
  it('produces inline changes rather than rows', () => {
    const result = computeDiff('the quick fox', 'the slow fox', 'words', opts());
    expect(result.rows).toEqual([]);
    expect(result.inlineChanges.length).toBeGreaterThan(1);
    expect(result.inlineChanges.some((c) => c.added)).toBe(true);
    expect(result.inlineChanges.some((c) => c.removed)).toBe(true);
  });

  it('reassembles to the right text from the non-removed parts', () => {
    const result = computeDiff('the quick fox', 'the slow fox', 'words', opts());
    const rebuilt = result.inlineChanges.filter((c) => !c.removed).map((c) => c.value).join('');
    expect(rebuilt).toBe('the slow fox');
  });

  it('reassembles to the left text from the non-added parts', () => {
    const result = computeDiff('the quick fox', 'the slow fox', 'words', opts());
    const rebuilt = result.inlineChanges.filter((c) => !c.added).map((c) => c.value).join('');
    expect(rebuilt).toBe('the quick fox');
  });

  it('diffs at character granularity', () => {
    const result = computeDiff('abc', 'abd', 'chars', opts());
    expect(result.inlineChanges.some((c) => c.added && c.value === 'd')).toBe(true);
    expect(result.inlineChanges.some((c) => c.removed && c.value === 'c')).toBe(true);
  });

  it('marks identical text as identical', () => {
    expect(computeDiff('same', 'same', 'words', opts()).summary.identical).toBe(true);
  });
});

describe('collapse', () => {
  const rows = Array.from({ length: 30 }, (_, i) => ({
    kind: 'equal' as const,
    leftNo: i + 1,
    rightNo: i + 1,
    text: `line ${i + 1}`,
  }));

  it('collapses a fully unchanged diff to a single skip', () => {
    const out = collapse(rows, 3);
    expect(out).toEqual([{ kind: 'skip', count: 30 }]);
  });

  it('keeps context either side of a change', () => {
    const withChange = [...rows];
    withChange[15] = { kind: 'added', rightNo: 16, text: 'new' } as never;
    const out = collapse(withChange, 3);

    const kept = out.filter((r) => r.kind !== 'skip');
    // The change plus three lines either side.
    expect(kept).toHaveLength(7);
    expect(out.filter((r) => r.kind === 'skip')).toHaveLength(2);
  });

  it('preserves total line accounting', () => {
    const withChange = [...rows];
    withChange[10] = { kind: 'removed', leftNo: 11, text: 'gone' } as never;
    const out = collapse(withChange, 2);
    const total = out.reduce((sum, r) => sum + (r.kind === 'skip' ? r.count : 1), 0);
    expect(total).toBe(withChange.length);
  });

  it('returns everything when the diff is short', () => {
    const short = rows.slice(0, 3).map((r, i) => (i === 1 ? { ...r, kind: 'added' as const } : r));
    expect(collapse(short, 3).every((r) => r.kind !== 'skip')).toBe(true);
  });
});

describe('toSideBySide', () => {
  it('aligns a replaced line opposite its replacement', () => {
    const { rows } = computeDiff('a\nb\nc', 'a\nX\nc', 'lines', opts());
    const pairs = toSideBySide(rows);
    expect(pairs).toHaveLength(3);
    const middle = pairs[1] as { left?: Row; right?: Row };
    expect(middle.left?.text).toBe('b');
    expect(middle.right?.text).toBe('X');
  });

  it('leaves a blank cell when the runs are unequal', () => {
    const { rows } = computeDiff('a', 'a\nb\nc', 'lines', opts());
    const pairs = toSideBySide(rows) as Array<{ left?: Row; right?: Row }>;
    expect(pairs.map((p) => [p.left?.text, p.right?.text])).toEqual([
      ['a', 'a'],
      [undefined, 'b'],
      [undefined, 'c'],
    ]);
  });

  it('passes collapsed runs through as skips', () => {
    const rows: Row[] = Array.from({ length: 20 }, (_, i) => ({
      kind: 'equal' as const,
      leftNo: i + 1,
      rightNo: i + 1,
      text: `line ${i + 1}`,
    }));
    rows[10] = { kind: 'added', rightNo: 11, text: 'new' };

    const pairs = toSideBySide(collapse(rows, 2));
    expect(pairs.filter(isSkip)).toHaveLength(2);
    // Every original row is still represented, skips counting for their run.
    const total = pairs.reduce((sum, p) => sum + (isSkip(p) ? p.skip : 1), 0);
    expect(total).toBe(rows.length);
  });

  it('never puts an addition on the left or a removal on the right', () => {
    const { rows } = computeDiff('a\nb\nc\nd', 'a\nX\nY\nd', 'lines', opts());
    for (const pair of toSideBySide(rows)) {
      if (isSkip(pair)) continue;
      expect(pair.left?.kind).not.toBe('added');
      expect(pair.right?.kind).not.toBe('removed');
    }
  });
});

describe('wordSegments', () => {
  it('marks only the words that changed', () => {
    const result = wordSegments('jumps over the lazy dog', 'leaps over the lazy dog')!;
    expect(result.left.filter((s) => s.changed).map((s) => s.text)).toEqual(['jumps']);
    expect(result.right.filter((s) => s.changed).map((s) => s.text)).toEqual(['leaps']);
  });

  it('reassembles each side exactly', () => {
    const left = 'Pack my box with five dozen jugs.';
    const right = 'Pack my box with five dozen liquor jugs.';
    const result = wordSegments(left, right)!;
    expect(result.left.map((s) => s.text).join('')).toBe(left);
    expect(result.right.map((s) => s.text).join('')).toBe(right);
  });

  it('declines when the lines share too little to be an edit', () => {
    expect(wordSegments('the quick brown fox', 'entirely unrelated content here')).toBeNull();
  });

  it('declines on lines long enough to cost real time', () => {
    const long = 'word '.repeat(200);
    expect(wordSegments(long, `${long}extra`)).toBeNull();
  });

  it('handles an empty side without dividing by zero', () => {
    expect(wordSegments('', '')).toBeNull();
    expect(wordSegments('', 'added text')).toBeNull();
  });

  it('marks a trailing punctuation change', () => {
    const result = wordSegments('can level six piqued gymnasts.', 'can level six piqued gymnasts!')!;
    expect(result.left.some((s) => s.changed)).toBe(true);
    expect(result.right.some((s) => s.changed)).toBe(true);
  });
});

describe('toUnified', () => {
  it('emits standard unified-diff prefixes', () => {
    const { rows } = computeDiff('a\nb', 'a\nc', 'lines', opts());
    const unified = toUnified(rows, 'old.txt', 'new.txt');
    const lines = unified.split('\n');
    expect(lines[0]).toBe('--- old.txt');
    expect(lines[1]).toBe('+++ new.txt');
    expect(lines).toContain(' a');
    expect(lines).toContain('-b');
    expect(lines).toContain('+c');
  });

  /**
   * Regression: the output had no `@@` headers at all, so despite being offered
   * as a patch it was rejected by `git apply` and `patch` as corrupt.
   */
  it('emits a hunk header locating the change', () => {
    const { rows } = computeDiff('a\nb', 'a\nc', 'lines', opts());
    const lines = toUnified(rows).split('\n');
    expect(lines[2]).toBe('@@ -1,2 +1,2 @@');
  });

  it('counts each side of the hunk correctly', () => {
    // One line appended: left has 2 lines, right has 3.
    const { rows } = computeDiff('a\nb\n', 'a\nb\nc\n', 'lines', opts());
    expect(toUnified(rows)).toContain('@@ -1,2 +1,3 @@');
  });

  it('spells an addition to an empty side as starting at zero', () => {
    const { rows } = computeDiff('', 'new line\n', 'lines', opts());
    expect(toUnified(rows)).toMatch(/@@ -\d+,\d+ \+1,1 @@/);
  });

  it('splits distant changes into separate hunks and drops the middle', () => {
    const left = Array.from({ length: 40 }, (_, i) => `line ${i}`).join('\n');
    const right = left.replace('line 0', 'CHANGED 0').replace('line 39', 'CHANGED 39');
    const unified = toUnified(computeDiff(left, right, 'lines', opts()).rows);
    expect(unified.match(/^@@ /gm)).toHaveLength(2);
    // The untouched middle is not carried along.
    expect(unified).not.toContain('line 20');
  });

  it('merges changes whose context windows touch into one hunk', () => {
    const left = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const right = left.replace('line 4', 'CHANGED 4').replace('line 6', 'CHANGED 6');
    const unified = toUnified(computeDiff(left, right, 'lines', opts()).rows);
    expect(unified.match(/^@@ /gm)).toHaveLength(1);
  });

  it('emits headers but no hunks for identical input', () => {
    const { rows } = computeDiff('same\n', 'same\n', 'lines', opts());
    expect(toUnified(rows)).toBe('--- left\n+++ right');
  });

  it('is newline-terminated', () => {
    const { rows } = computeDiff('a\n', 'b\n', 'lines', opts());
    expect(toUnified(rows).endsWith('\n')).toBe(true);
  });
});
