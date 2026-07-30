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
  /**
   * Set when the diff was abandoned on the time limit. Nothing else here is
   * meaningful — an empty result is not "no differences".
   */
  tooLarge?: boolean;
}

const EMPTY_RESULT: DiffResult = {
  rows: [],
  inlineChanges: [],
  summary: { added: 0, removed: 0, unchanged: 0, identical: false },
};

/**
 * How long any one diff may run before it is abandoned.
 *
 * Myers is O(ND) in the edit distance, so two large dissimilar inputs cost time
 * proportional to how different they are — and this runs synchronously while
 * rendering, on every keystroke. jsdiff takes a `timeout` and returns undefined
 * rather than an answer when it expires, which is the honest outcome: a partial
 * diff would be indistinguishable from a real one.
 */
const DIFF_TIMEOUT_MS = 1500;

export function computeDiff(
  leftRaw: string,
  rightRaw: string,
  granularity: Granularity,
  options: Options,
): DiffResult {
  const left = normalise(leftRaw, options);
  const right = normalise(rightRaw, options);

  if (granularity !== 'lines') {
    // `diffChars` honours only ignoreCase; `diffWords` treats whitespace runs as
    // insignificant by construction, so neither takes ignoreWhitespace. Passing
    // it did nothing, which is why the UI now hides the option in these modes.
    const inlineOptions = { ignoreCase: options.ignoreCase, timeout: DIFF_TIMEOUT_MS };
    const changes =
      granularity === 'words'
        ? diffWords(left, right, inlineOptions)
        : diffChars(left, right, inlineOptions);

    if (!changes) return { ...EMPTY_RESULT, tooLarge: true };

    return {
      rows: [],
      inlineChanges: changes,
      summary: summariseInline(changes),
    };
  }

  const changes = diffArrays(splitLines(left), splitLines(right), {
    comparator: lineEquals(options),
    timeout: DIFF_TIMEOUT_MS,
  });

  if (!changes) return { ...EMPTY_RESULT, tooLarge: true };

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

export interface Segment {
  text: string;
  changed: boolean;
}

/**
 * Below this share of shared content, a pair of lines is treated as a rewrite
 * rather than an edit. Marking every word of an unrelated line is noise that
 * makes the genuinely small edits harder to spot.
 */
const SIMILARITY_FLOOR = 0.3;

/** Long lines make the word diff cost real time for no readability gain. */
const MAX_INLINE_LENGTH = 600;

/**
 * Splits a replaced pair of lines into the words that survived and the words
 * that changed, so a one-word edit reads as a one-word edit.
 *
 * Returns null when the two lines share too little to be an edit, or when they
 * are too long to be worth the work — the caller then shows the plain line.
 */
export function wordSegments(
  left: string,
  right: string,
  options: Options = DEFAULT_OPTIONS,
): { left: Segment[]; right: Segment[] } | null {
  if (left.length > MAX_INLINE_LENGTH || right.length > MAX_INLINE_LENGTH) return null;

  // Matches the options the line diff ran under, so the words marked agree with
  // the lines called changed — without it, `ignoreCase` produced a pair of lines
  // reported as equal whose every word was highlighted as different. There is no
  // `ignoreWhitespace` to pass on: `diffWords` treats runs of whitespace as
  // insignificant already, which is what separates it from `diffWordsWithSpace`.
  const changes = diffWords(left, right, { ignoreCase: options.ignoreCase });

  const shared = changes
    .filter((change) => !change.added && !change.removed)
    .reduce((total, change) => total + change.value.trim().length, 0);
  const longest = Math.max(left.trim().length, right.trim().length);
  if (longest === 0 || shared / longest < SIMILARITY_FLOOR) return null;

  return {
    left: changes
      .filter((change) => !change.added)
      .map((change) => ({ text: change.value, changed: Boolean(change.removed) })),
    right: changes
      .filter((change) => !change.removed)
      .map((change) => ({ text: change.value, changed: Boolean(change.added) })),
  };
}

/**
 * Splits text into the lines a patch is defined over: each keeps its terminator.
 *
 * Two things the display model deliberately throws away matter here. Empty text
 * has no lines at all rather than one blank one, so creating content in an empty
 * file is an insertion at line 0 rather than a replacement of a phantom line.
 * And a final line without a newline is a different token from the same line with
 * one, which is the only way a patch can represent adding or removing the
 * newline at end of file — under the display model the two texts compare equal
 * and produced no hunk whatsoever.
 */
export function patchTokens(text: string): string[] {
  if (text === '') return [];
  return text.match(/[^\n]*\n|[^\n]+/g) ?? [];
}

export interface UnifiedOptions {
  leftName?: string;
  rightName?: string;
  context?: number;
}

const NO_EOL = '\\ No newline at end of file';

/**
 * Unified diff text, for pasting into a patch or a review comment.
 *
 * Emitted as real hunks with `@@` headers and `context` lines either side. The
 * headers are what make this a patch rather than a listing: `git apply` and
 * `patch` both need them to locate the change and reject the input outright
 * without them. Runs of unchanged lines between hunks are dropped, which also
 * keeps the output a sane size on a large file.
 *
 * Computed from the texts rather than the display rows, and always compared
 * literally. A patch has to apply, so it cannot inherit `ignoreCase` or
 * `ignoreWhitespace` from the view — a diff that called two lines equal because
 * their case differed would produce a patch that does not apply.
 */
export function toUnified(leftText: string, rightText: string, options: UnifiedOptions = {}): string {
  const { leftName = 'left', rightName = 'right', context = 3 } = options;
  const header = [`--- ${leftName}`, `+++ ${rightName}`];

  const changes = diffArrays(patchTokens(leftText), patchTokens(rightText), {
    timeout: DIFF_TIMEOUT_MS,
  });
  if (!changes) return header.join('\n');

  interface Entry {
    kind: 'equal' | 'added' | 'removed';
    token: string;
    leftNo?: number;
    rightNo?: number;
  }

  const entries: Entry[] = [];
  let leftNo = 0;
  let rightNo = 0;
  for (const change of changes) {
    for (const token of change.value) {
      if (change.added) entries.push({ kind: 'added', token, rightNo: ++rightNo });
      else if (change.removed) entries.push({ kind: 'removed', token, leftNo: ++leftNo });
      else entries.push({ kind: 'equal', token, leftNo: ++leftNo, rightNo: ++rightNo });
    }
  }

  const changed = entries.reduce<number[]>((out, entry, i) => {
    if (entry.kind !== 'equal') out.push(i);
    return out;
  }, []);
  // No differences means no hunks. The file headers alone are a valid empty patch.
  if (changed.length === 0) return header.join('\n');

  // Group changes into hunks, merging any two whose context windows touch.
  const hunks: Array<{ start: number; end: number }> = [];
  for (const i of changed) {
    const start = Math.max(0, i - context);
    const end = Math.min(entries.length - 1, i + context);
    const last = hunks[hunks.length - 1];
    if (last && start <= last.end + 1) last.end = Math.max(last.end, end);
    else hunks.push({ start, end });
  }

  const lines = [...header];
  for (const hunk of hunks) {
    const slice = entries.slice(hunk.start, hunk.end + 1);
    const fromLeft = slice.filter((e) => e.kind !== 'added');
    const fromRight = slice.filter((e) => e.kind !== 'removed');

    // A hunk that adds to an empty side starts at line 0 with a count of 0,
    // which is how unified diff spells "there was nothing here".
    const leftStart = fromLeft[0]?.leftNo ?? 0;
    const rightStart = fromRight[0]?.rightNo ?? 0;

    lines.push(`@@ -${leftStart},${fromLeft.length} +${rightStart},${fromRight.length} @@`);
    for (const entry of slice) {
      const prefix = entry.kind === 'added' ? '+' : entry.kind === 'removed' ? '-' : ' ';
      const terminated = entry.token.endsWith('\n');
      lines.push(prefix + (terminated ? entry.token.slice(0, -1) : entry.token));
      if (!terminated) lines.push(NO_EOL);
    }
  }

  // Patches are newline-terminated; `git apply` warns about one that is not.
  return `${lines.join('\n')}\n`;
}
