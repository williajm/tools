import { describe, it, expect } from 'vitest';
import {
  applyReplace,
  compile,
  evaluate,
  findMatches,
  groupNames,
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

describe('groupNames', () => {
  it('maps named groups to their capture index', () => {
    expect(groupNames('(?<a>x)(?<b>y)')).toEqual(new Map([[1, 'a'], [2, 'b']]));
  });

  it('counts unnamed groups towards the index', () => {
    expect(groupNames('(x)(?<b>y)(z)')).toEqual(new Map([[2, 'b']]));
  });

  it('ignores non-capturing groups and assertions', () => {
    expect(groupNames('(?:a)(?=b)(?!c)(?<=d)(?<!e)(?<f>g)')).toEqual(new Map([[1, 'f']]));
  });

  it('ignores parens inside a character class', () => {
    expect(groupNames('[()](?<a>x)')).toEqual(new Map([[1, 'a']]));
  });

  it('ignores escaped parens', () => {
    expect(groupNames('\\((?<a>x)\\)')).toEqual(new Map([[1, 'a']]));
  });

  it('ignores an escaped bracket that does not open a class', () => {
    expect(groupNames('\\[(?<a>x)')).toEqual(new Map([[1, 'a']]));
  });

  it('returns nothing for a pattern without named groups', () => {
    expect(groupNames('(a)(b)')).toEqual(new Map());
  });
});

/**
 * Regression: names were recovered per match by looking up each named group's
 * captured text in the match array. Two groups capturing the same string
 * collided, and a group that did not participate lost its name entirely.
 */
describe('named group labelling', () => {
  it('labels both groups when they capture identical text', () => {
    const [match] = findMatches(/(?<first>\w+)-(?<second>\w+)/, 'ab-ab');
    expect(match!.groups.map((g) => g.name)).toEqual(['first', 'second']);
    expect(match!.groups.map((g) => g.value)).toEqual(['ab', 'ab']);
  });

  it('keeps the name of an optional group that did not match', () => {
    const [match] = findMatches(/(?<maybe>x)?(?<always>y)/, 'y');
    expect(match!.groups.map((g) => g.name)).toEqual(['maybe', 'always']);
    expect(match!.groups[0]!.value).toBeUndefined();
  });

  it('leaves unnamed groups unnamed without shifting the named ones', () => {
    const [match] = findMatches(/(\d)(?<letter>[a-z])(\d)/, '1a2');
    expect(match!.groups.map((g) => g.name)).toEqual([null, 'letter', null]);
  });
});

describe('evaluate', () => {
  const base = { pattern: '\\d+', flags: 'g', input: 'a1b22', tests: '1\n!x', replacement: '#' };

  it('returns everything the tool displays in one call', () => {
    const result = evaluate(base);
    expect(result.error).toBeUndefined();
    expect(result.matches.map((m) => m.text)).toEqual(['1', '22']);
    expect(result.replaced).toBe('a#b#');
    expect(result.summary).toEqual({ total: 2, passed: 2, failed: 0 });
    expect(result.segments.some((s) => s.matched)).toBe(true);
  });

  it('reports a compile failure and nothing else', () => {
    const result = evaluate({ ...base, pattern: '([unclosed' });
    expect(result.error).toBeTruthy();
    expect(result.matches).toEqual([]);
    expect(result.outcomes).toEqual([]);
    expect(result.replaced).toBe('');
  });

  it('treats an empty pattern as nothing to do', () => {
    const result = evaluate({ ...base, pattern: '' });
    expect(result.error).toBeUndefined();
    expect(result.matches).toEqual([]);
  });

  it('produces only structured-cloneable data, so it can cross a worker boundary', () => {
    // Throws on a function, class instance or anything else non-transferable.
    expect(() => structuredClone(evaluate(base))).not.toThrow();
  });
});

/**
 * Regression: runTests stripped `y` along with `g`, which changed what the
 * pattern means. Sticky anchors the match at lastIndex, so /abc/y must not match
 * "xabc" — but the table tested it as /abc/ and reported a pass.
 */
describe('sticky semantics survive the test table', () => {
  it('does not match away from the anchor', () => {
    const [outcome] = runTests(/abc/y, parseTestCases('xabc'));
    expect(outcome!.matched).toBe(false);
    expect(outcome!.pass).toBe(false);
    // Which is what the real regex does.
    expect(/abc/y.test('xabc')).toBe(false);
  });

  it('still matches at the anchor', () => {
    expect(runTests(/abc/y, parseTestCases('abcdef'))[0]!.matched).toBe(true);
  });

  it('agrees with a fresh sticky regex on every case', () => {
    for (const input of ['abc', 'xabc', 'abcx', '', 'ab']) {
      const expected = new RegExp('abc', 'y').test(input);
      expect(runTests(/abc/y, parseTestCases(input || 'x'))[0]!.matched, input).toBe(
        input === '' ? new RegExp('abc', 'y').test('x') : expected,
      );
    }
  });

  it('still drops the global flag, so row order cannot matter', () => {
    const repeated = parseTestCases('aaa\naaa\naaa\naaa');
    expect(runTests(/a+/g, repeated).every((o) => o.matched)).toBe(true);
  });
});
