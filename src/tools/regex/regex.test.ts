import { describe, it, expect } from 'vitest';
import {
  applyReplace,
  compile,
  findMatches,
  parseTestCases,
  runTests,
  segment,
  summarise,
} from './regex.ts';

describe('compile', () => {
  it('compiles a valid pattern', () => {
    expect(compile('\\d+', 'g').regex).toBeInstanceOf(RegExp);
  });

  it('reports a syntax error rather than throwing', () => {
    const result = compile('(unclosed', 'g');
    expect(result.regex).toBeUndefined();
    expect(result.error).toBeTruthy();
  });

  it('reports an invalid flag', () => {
    expect(compile('a', 'gz').error).toBeTruthy();
  });

  it('returns nothing for an empty pattern', () => {
    expect(compile('', 'g')).toEqual({});
  });
});

describe('findMatches', () => {
  it('finds all matches with positions', () => {
    const matches = findMatches(/\d+/g, 'a1bb22ccc333');
    expect(matches.map((m) => m.text)).toEqual(['1', '22', '333']);
    expect(matches.map((m) => m.index)).toEqual([1, 4, 9]);
  });

  it('finds all matches even when the pattern lacks /g', () => {
    // The table and highlighter both want every match regardless of the flag.
    expect(findMatches(/\d/, 'a1b2c3').map((m) => m.text)).toEqual(['1']);
    expect(findMatches(/\d/g, 'a1b2c3').map((m) => m.text)).toEqual(['1', '2', '3']);
  });

  it('exposes numbered capture groups', () => {
    const [match] = findMatches(/(\w+)@(\w+)/g, 'ada@example');
    expect(match!.groups.map((g) => g.value)).toEqual(['ada', 'example']);
  });

  it('exposes named capture groups', () => {
    const [match] = findMatches(/(?<user>\w+)@(?<host>\w+)/g, 'ada@example');
    expect(match!.groups.map((g) => g.name)).toEqual(['user', 'host']);
  });

  it('reports undefined for groups that did not participate', () => {
    const [match] = findMatches(/(a)|(b)/g, 'b');
    expect(match!.groups[0]!.value).toBeUndefined();
    expect(match!.groups[1]!.value).toBe('b');
  });

  it('terminates on a zero-length match instead of looping forever', () => {
    // /a*/g on "bbb" matches empty at every position — the classic infinite loop.
    const matches = findMatches(/a*/g, 'bbb');
    expect(matches.length).toBeLessThanOrEqual(5);
    expect(matches.every((m) => m.text === '')).toBe(true);
  });

  it('caps runaway match counts', () => {
    const matches = findMatches(/x*/g, 'y'.repeat(5000));
    expect(matches.length).toBeLessThanOrEqual(1000);
  });

  it('returns nothing for empty input', () => {
    expect(findMatches(/a/g, '')).toEqual([]);
  });
});

describe('segment', () => {
  it('splits into matched and unmatched runs', () => {
    expect(segment(/\d+/g, 'a12b3')).toEqual([
      { text: 'a', matched: false },
      { text: '12', matched: true },
      { text: 'b', matched: false },
      { text: '3', matched: true },
    ]);
  });

  it('handles a match at the very start and end', () => {
    expect(segment(/\d/g, '1a2')).toEqual([
      { text: '1', matched: true },
      { text: 'a', matched: false },
      { text: '2', matched: true },
    ]);
  });

  it('returns the whole input unmatched when nothing matches', () => {
    expect(segment(/z/g, 'abc')).toEqual([{ text: 'abc', matched: false }]);
  });

  it('reassembles to the original input', () => {
    for (const input of ['a12b3', '1a2', 'abc', '', 'aaa']) {
      const rebuilt = segment(/\d+/g, input).map((s) => s.text).join('');
      expect(rebuilt).toBe(input);
    }
  });
});

describe('parseTestCases', () => {
  it('treats plain lines as expected matches', () => {
    expect(parseTestCases('a@b.com\nc@d.org')).toEqual([
      { input: 'a@b.com', expect: 'match' },
      { input: 'c@d.org', expect: 'match' },
    ]);
  });

  it('treats a leading ! as expected non-match', () => {
    expect(parseTestCases('!not-an-email')).toEqual([
      { input: 'not-an-email', expect: 'no-match' },
    ]);
  });

  it('allows an escaped leading bang for literal input', () => {
    expect(parseTestCases('\\!literal')).toEqual([{ input: '!literal', expect: 'match' }]);
  });

  it('skips blank lines', () => {
    expect(parseTestCases('a\n\n  \nb')).toHaveLength(2);
  });
});

describe('runTests', () => {
  const cases = parseTestCases(['a@b.com', 'ada@example.co.uk', '!no-at-sign', '!@nolocal'].join('\n'));

  it('scores each case against its expectation', () => {
    const outcomes = runTests(/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i, cases);
    expect(outcomes.map((o) => o.pass)).toEqual([true, true, true, true]);
    expect(summarise(outcomes)).toEqual({ total: 4, passed: 4, failed: 0 });
  });

  it('marks a failing expectation', () => {
    // This pattern wrongly accepts an empty local part.
    const outcomes = runTests(/^.*@.*$/, cases);
    const failing = outcomes.filter((o) => !o.pass);
    expect(failing.length).toBeGreaterThan(0);
    expect(summarise(outcomes).failed).toBe(failing.length);
  });

  it('is order-independent with a global pattern', () => {
    // Regression: a shared /g regex carries lastIndex between rows, making
    // results depend on the order the table happens to be in.
    const repeated = parseTestCases('aaa\naaa\naaa\naaa');
    const outcomes = runTests(/a+/g, repeated);
    expect(outcomes.every((o) => o.matched)).toBe(true);
    expect(summarise(outcomes).passed).toBe(4);
  });

  it('is order-independent with a sticky pattern', () => {
    const repeated = parseTestCases('abc\nabc\nabc');
    const outcomes = runTests(/abc/y, repeated);
    expect(outcomes.every((o) => o.matched)).toBe(true);
  });

  it('reports what was captured', () => {
    const outcomes = runTests(/\d+/, parseTestCases('order 123'));
    expect(outcomes[0]!.captured).toBe('123');
  });
});

describe('applyReplace', () => {
  it('replaces all occurrences', () => {
    expect(applyReplace(/\d/g, 'a1b2', '#')).toBe('a#b#');
  });

  it('adds /g when the pattern lacks it, so replace is not surprising', () => {
    expect(applyReplace(/\d/, 'a1b2', '#')).toBe('a#b#');
  });

  it('supports group references', () => {
    expect(applyReplace(/(\w+)@(\w+)/g, 'ada@example', '$2/$1')).toBe('example/ada');
  });

  it('supports named group references', () => {
    expect(applyReplace(/(?<a>\w)(?<b>\w)/g, 'xy', '$<b>$<a>')).toBe('yx');
  });
});
