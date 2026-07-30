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

export function findMatches(regex: RegExp, input: string): MatchInfo[] {
  const matches: MatchInfo[] = [];
  if (!input) return matches;

  // A global regex is stateful; work on a fresh copy so repeated renders agree.
  const global = regex.global || regex.sticky;
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`);

  let match: RegExpExecArray | null;
  while ((match = re.exec(input)) !== null) {
    const named = match.groups ?? {};
    const nameByIndex = new Map<number, string>();
    // Map named groups back to their positional index for display.
    for (const name of Object.keys(named)) {
      const idx = match.indexOf(named[name] as string, 1);
      if (idx > 0 && !nameByIndex.has(idx)) nameByIndex.set(idx, name);
    }

    matches.push({
      index: match.index,
      text: match[0],
      groups: match.slice(1).map((value, i) => ({
        name: nameByIndex.get(i + 1) ?? null,
        value,
      })),
    });

    if (matches.length >= MAX_MATCHES) break;
    // Zero-length match: advance manually or exec never terminates.
    if (match[0] === '') re.lastIndex++;
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
    const re = new RegExp(regex.source, regex.flags.replace(/[gy]/g, ''));
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

export const FLAGS: ReadonlyArray<{ flag: string; label: string; note: string }> = [
  { flag: 'g', label: 'global', note: 'Find all matches, not just the first' },
  { flag: 'i', label: 'ignore case', note: 'Case-insensitive matching' },
  { flag: 'm', label: 'multiline', note: '^ and $ match at line breaks' },
  { flag: 's', label: 'dotall', note: '. also matches newlines' },
  { flag: 'u', label: 'unicode', note: 'Treat the pattern as a sequence of code points' },
  { flag: 'y', label: 'sticky', note: 'Match only from lastIndex' },
];
