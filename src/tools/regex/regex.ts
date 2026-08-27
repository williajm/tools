/**
 * Regex evaluation.
 *
 * The distinguishing feature over an exploratory tester is the test-case table:
 * many inputs at once, each with an expectation, so a pattern can be regression
 * tested rather than eyeballed.
 */

export interface CompileResult {
  regex?: RegExp;
  error?: string;
}

export function compile(pattern: string, flags: string): CompileResult {
  if (!pattern) return {};
  try {
    return { regex: new RegExp(pattern, flags) };
  } catch (err) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

export interface MatchInfo {
  index: number;
  text: string;
  groups: Array<{ name: string | null; value: string | undefined }>;
}

/** Guard against a pattern that matches empty repeatedly, which would spin forever. */
const MAX_MATCHES = 1000;

/**
 * Maps each capture group's index to its name, by walking the pattern.
 *
 * A group's index is its position among the capturing parens, and that is the
 * only thing that defines it. This used to be recovered per match by looking up
 * each named group's captured text in the match array, which got it wrong
 * whenever two groups captured the same string — `/(?<a>\w+)-(?<b>\w+)/` on
 * "ab-ab" labelled only the first — and lost the name entirely for an optional
 * group that did not participate.
 */
export function groupNames(source: string): Map<number, string> {
  const names = new Map<number, string>();
  let index = 0;
  let inClass = false;

  for (let i = 0; i < source.length; i++) {
    const ch = source[i];
    // An escape consumes the next character, so neither can open anything.
    if (ch === '\\') {
      i++;
      continue;
    }
    if (inClass) {
      if (ch === ']') inClass = false;
      continue;
    }
    if (ch === '[') {
      inClass = true;
      continue;
    }
    if (ch !== '(') continue;

    if (source[i + 1] !== '?') {
      index++;
      continue;
    }
    // `(?<name>` captures. `(?:`, `(?=`, `(?!`, `(?<=` and `(?<!` do not.
    const named = /^\(\?<([^=!][^>]*)>/.exec(source.slice(i));
    if (named) {
      index++;
      names.set(index, named[1]!);
    }
  }

  return names;
}

export function findMatches(regex: RegExp, input: string): MatchInfo[] {
  const matches: MatchInfo[] = [];

  // A global regex is stateful; work on a fresh copy so repeated renders agree.
  const global = regex.global || regex.sticky;
  const unicode = regex.unicode || regex.flags.includes('v');
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);
  // Depends only on the pattern, so it is resolved once rather than per match.
  const nameByIndex = groupNames(regex.source);

  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    matches.push({
      index: match.index,
      text: match[0],
      groups: match.slice(1).map((value, i) => ({
        name: nameByIndex.get(i + 1) ?? null,
        value,
      })),
    });

    if (matches.length >= MAX_MATCHES) break;
    // Zero-length match: advance manually or exec never terminates. In unicode
    // mode step over the whole code point: landing inside a surrogate pair makes
    // exec snap back and report the same match again, up to the cap.
    if (match[0] === '') re.lastIndex += unicode && (input.codePointAt(re.lastIndex) ?? 0) > 0xffff ? 2 : 1;
    if (!global) break;
  }

  return matches;
}

export interface Segment {
  text: string;
  matched: boolean;
}

/** Splits input into matched and unmatched runs for highlighting. */
export function segment(regex: RegExp, input: string): Segment[] {
  const matches = findMatches(regex, input);
  if (matches.length === 0) return input ? [{ text: input, matched: false }] : [];

  const segments: Segment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.index > cursor) segments.push({ text: input.slice(cursor, m.index), matched: false });
    // A zero-length match has nothing to highlight.
    if (m.text.length > 0) segments.push({ text: m.text, matched: true });
    cursor = m.index + m.text.length;
  }
  if (cursor < input.length) segments.push({ text: input.slice(cursor), matched: false });
  return segments;
}

// --- test-case table ---------------------------------------------------------

export type Expectation = 'match' | 'no-match';

export interface TestCase {
  input: string;
  expect: Expectation;
}

export interface TestOutcome extends TestCase {
  matched: boolean;
  pass: boolean;
  /** First match, for showing what was captured. */
  captured?: string;
}

export function runTests(regex: RegExp, cases: TestCase[]): TestOutcome[] {
  return cases.map((testCase) => {
    // Fresh regex per case: a stale lastIndex from a /g pattern would make
    // results depend on row order, which would be a maddening bug to chase.
    //
    // Only `g` is dropped. `y` was going too, which silently changed what the
    // pattern means — sticky anchors the match at lastIndex, so `/abc/y` must not
    // match "xabc", yet the table tested it as `/abc/` and reported a pass. A
    // fresh regex already starts at lastIndex 0, so sticky needs no help here.
    const re = new RegExp(regex.source, regex.flags.replace(/g/g, ''));
    const match = re.exec(testCase.input);
    const matched = match !== null;
    return {
      ...testCase,
      matched,
      pass: matched === (testCase.expect === 'match'),
      captured: match?.[0],
    };
  });
}

/**
 * Parses the test-case textarea. A leading `!` marks a line that must NOT match,
 * so both expectations can be expressed in one plain-text box.
 */
export function parseTestCases(text: string): TestCase[] {
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      if (line.startsWith('!')) return { input: line.slice(1), expect: 'no-match' as const };
      // Allow an escaped leading bang for inputs that genuinely start with one.
      if (line.startsWith('\\!')) return { input: line.slice(1), expect: 'match' as const };
      return { input: line, expect: 'match' as const };
    });
}

export interface Summary {
  total: number;
  passed: number;
  failed: number;
}

export function summarise(outcomes: TestOutcome[]): Summary {
  const passed = outcomes.filter((o) => o.pass).length;
  return { total: outcomes.length, passed, failed: outcomes.length - passed };
}

// --- replace -----------------------------------------------------------------

export function applyReplace(regex: RegExp, input: string, replacement: string): string {
  try {
    const re = regex.global ? regex : new RegExp(regex.source, `${regex.flags}g`);
    return input.replace(re, replacement);
  } catch (err) {
    return err instanceof Error ? `Error: ${err.message}` : String(err);
  }
}

// --- one-shot evaluation -----------------------------------------------------

export interface EvaluateRequest {
  pattern: string;
  flags: string;
  input: string;
  tests: string;
  replacement: string;
}

export interface Evaluation {
  /** Set when the pattern does not compile; the rest is then empty. */
  error?: string;
  matches: MatchInfo[];
  segments: Segment[];
  outcomes: TestOutcome[];
  summary: Summary;
  replaced: string;
}

export const EMPTY_EVALUATION: Evaluation = {
  matches: [],
  segments: [],
  outcomes: [],
  summary: { total: 0, passed: 0, failed: 0 },
  replaced: '',
};

/**
 * Everything the tool displays for one pattern, in a single call.
 *
 * Gathered into one function of plain data in and plain data out so it can run
 * on a worker thread: a pattern like `(a+)+$` against a non-matching string
 * backtracks for longer than anyone will wait, and a regex cannot be interrupted
 * once started. Off the main thread the worker can simply be terminated, which
 * is the only way to put a time limit on this.
 */
export function evaluate(request: EvaluateRequest): Evaluation {
  const { regex, error } = compile(request.pattern, request.flags);
  if (!regex) return error ? { ...EMPTY_EVALUATION, error } : EMPTY_EVALUATION;

  const outcomes = runTests(regex, parseTestCases(request.tests));
  return {
    matches: findMatches(regex, request.input),
    segments: segment(regex, request.input),
    outcomes,
    summary: summarise(outcomes),
    replaced: applyReplace(regex, request.input, request.replacement),
  };
}

export const FLAGS: ReadonlyArray<{ flag: string; label: string; note: string }> = [
  { flag: 'g', label: 'global', note: 'Find all matches, not just the first' },
  { flag: 'i', label: 'ignore case', note: 'Case-insensitive matching' },
  { flag: 'm', label: 'multiline', note: '^ and $ match at line breaks' },
  { flag: 's', label: 'dotall', note: '. also matches newlines' },
  { flag: 'u', label: 'unicode', note: 'Treat the pattern as a sequence of code points' },
  { flag: 'y', label: 'sticky', note: 'Match only from lastIndex' },
];
