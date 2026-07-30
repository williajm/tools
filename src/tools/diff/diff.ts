import { diffArrays, diffChars, diffWords, type Change } from 'diff';

/**
 * Text diffing. `diff` (jsdiff) does the Myers algorithm; this module shapes the
 * output into rows the UI can render, and adds the normalisation options that
 * turn "everything changed" into a readable diff.
 */

export type Granularity = 'lines' | 'words' | 'chars';

export const GRANULARITIES: readonly Granularity[] = ['lines', 'words', 'chars'];

export interface Options {
  ignoreCase: boolean;
  ignoreWhitespace: boolean;
  /** Normalise CRLF to LF, so a line-ending change does not mask real ones. */
  normaliseEol: boolean;
  trimTrailing: boolean;
}

export const DEFAULT_OPTIONS: Options = {
  ignoreCase: false,
  ignoreWhitespace: false,
  normaliseEol: true,
  trimTrailing: false,
};

export function normalise(text: string, options: Options): string {
  let out = text;
  if (options.normaliseEol) out = out.replace(/\r\n?/g, '\n');
  if (options.trimTrailing) out = out.replace(/[ \t]+$/gm, '');
  return out;
}

/**
 * Splits text into the lines a reader would count.
 *
 * A trailing newline terminates the last line rather than opening an empty one,
 * so `'a\nb\n'` is two lines. Empty text is a single empty line.
 *
 * Diffing these arrays rather than handing raw text to `diffLines` avoids
 * jsdiff's newline-token semantics, where the final line of text without a
 * trailing newline (`'b'`) is a different token from the same line with one
 * (`'b\n'`) — which made appending a line read as one removal plus two
 * additions.
 */
export function splitLines(text: string): string[] {
  const lines = text.split('\n');
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Line equality under the current options. Whitespace handling matches jsdiff's
 * own `ignoreWhitespace`: leading and trailing only, never interior.
 */
function lineEquals(options: Options): (a: string, b: string) => boolean {
  const canonical = (line: string) => {
    let out = options.ignoreWhitespace ? line.trim() : line;
    if (options.ignoreCase) out = out.toLowerCase();
    return out;
  };
  return (a, b) => canonical(a) === canonical(b);
}

export interface Row {
  kind: 'equal' | 'added' | 'removed';
  /** 1-based line numbers, absent on the side where the line does not exist. */
  leftNo?: number;
  rightNo?: number;
  text: string;
}

export interface Summary {
  added: number;
  removed: number;
  unchanged: number;
  /** No differences *under the current options* — `ignoreCase` can make it true. */
  identical: boolean;
}

export interface DiffResult {
  rows: Row[];
  inlineChanges: Change[];
  summary: Summary;
}

export function computeDiff(
  leftRaw: string,
  rightRaw: string,
  granularity: Granularity,
  options: Options,
): DiffResult {
  const left = normalise(leftRaw, options);
  const right = normalise(rightRaw, options);

  const jsdiffOptions = {
    ignoreCase: options.ignoreCase,
    ignoreWhitespace: options.ignoreWhitespace,
  };

  if (granularity !== 'lines') {
    const changes =
      granularity === 'words'
        ? diffWords(left, right, jsdiffOptions)
        : diffChars(left, right, jsdiffOptions);

    return {
      rows: [],
      inlineChanges: changes,
      summary: summariseInline(changes),
    };
  }

  const changes = diffArrays(splitLines(left), splitLines(right), {
    comparator: lineEquals(options),
  });
  const rows: Row[] = [];
  let leftNo = 0;
  let rightNo = 0;

  for (const change of changes) {
    for (const text of change.value) {
      if (change.added) {
        rows.push({ kind: 'added', rightNo: ++rightNo, text });
      } else if (change.removed) {
        rows.push({ kind: 'removed', leftNo: ++leftNo, text });
      } else {
        // Under ignoreCase or ignoreWhitespace the two sides of an equal row can
        // differ in the ignored respect; jsdiff hands back the right-hand text.
        rows.push({ kind: 'equal', leftNo: ++leftNo, rightNo: ++rightNo, text });
      }
    }
  }

  const added = rows.filter((r) => r.kind === 'added').length;
  const removed = rows.filter((r) => r.kind === 'removed').length;

  return {
    rows,
    inlineChanges: [],
    summary: {
      added,
      removed,
      unchanged: rows.filter((r) => r.kind === 'equal').length,
      identical: added === 0 && removed === 0,
    },
  };
}

function summariseInline(changes: Change[]): Summary {
  let added = 0;
  let removed = 0;
  let unchanged = 0;
  for (const change of changes) {
    const count = change.count ?? change.value.length;
    if (change.added) added += count;
    else if (change.removed) removed += count;
    else unchanged += count;
  }
  return { added, removed, unchanged, identical: added === 0 && removed === 0 };
}

export interface Skip {
  kind: 'skip';
  count: number;
}

export type CollapsedRow = Row | Skip;

/** Collapses long runs of unchanged lines, keeping `context` either side. */
export function collapse(rows: Row[], context = 3): CollapsedRow[] {
  const keep = new Set<number>();
  rows.forEach((row, i) => {
    if (row.kind === 'equal') return;
    for (let j = Math.max(0, i - context); j <= Math.min(rows.length - 1, i + context); j++) {
      keep.add(j);
    }
  });

  const out: CollapsedRow[] = [];
  let skipped = 0;

  rows.forEach((row, i) => {
    if (keep.has(i)) {
      if (skipped > 0) {
        out.push({ kind: 'skip', count: skipped });
        skipped = 0;
      }
      out.push(row);
    } else {
      skipped++;
    }
  });

  if (skipped > 0) out.push({ kind: 'skip', count: skipped });
  return out;
}

/** One line of a side-by-side view: either a pair of rows, or a collapsed run. */
export type SidePair = { skip: number } | { left?: Row; right?: Row };

export function isSkip(pair: SidePair): pair is { skip: number } {
  return 'skip' in pair;
}

/**
 * Turns the flat row list into side-by-side pairs.
 *
 * A run of removals is aligned against the run of additions that replaces it,
 * so an edited line sits opposite its replacement rather than below it. Runs of
 * unequal length leave a blank cell on the shorter side.
 */
export function toSideBySide(rows: readonly CollapsedRow[]): SidePair[] {
  const out: SidePair[] = [];
  let removed: Row[] = [];
  let added: Row[] = [];

  const flush = () => {
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      out.push({ left: removed[i], right: added[i] });
    }
    removed = [];
    added = [];
  };

  for (const row of rows) {
    if (row.kind === 'skip') {
      flush();
      out.push({ skip: row.count });
    } else if (row.kind === 'removed') {
      removed.push(row);
    } else if (row.kind === 'added') {
      added.push(row);
    } else {
      flush();
      out.push({ left: row, right: row });
    }
  }

  flush();
  return out;
}

/** Unified diff text, for pasting into a patch or a review comment. */
export function toUnified(rows: Row[], leftName = 'left', rightName = 'right'): string {
  const lines = [`--- ${leftName}`, `+++ ${rightName}`];
  for (const row of rows) {
    const prefix = row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' ';
    lines.push(prefix + row.text);
  }
  return lines.join('\n');
}
