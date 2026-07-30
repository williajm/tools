/**
 * JSON formatting, validation and diffing.
 *
 * The valuable part is error reporting: `JSON.parse` throws a message with a
 * character offset, which is useless in a 4000-line document. Everything here
 * converts that into a line and column with the offending text.
 */

export interface ParseFailure {
  message: string;
  line?: number;
  column?: number;
  /** The source line, for pointing at the problem. */
  excerpt?: string;
}

export interface ParseOk {
  value: unknown;
}

export type ParseResult = ParseOk | { error: ParseFailure };

export function isFailure(result: ParseResult): result is { error: ParseFailure } {
  return 'error' in result;
}

function offsetToLineCol(text: string, offset: number): { line: number; column: number; excerpt: string } {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  const lastNewline = before.lastIndexOf('\n');
  const column = offset - lastNewline;
  const excerpt = text.split('\n')[line - 1] ?? '';
  return { line, column, excerpt };
}

/** Strips the engine's positional suffix and context dump from the message. */
function cleanMessage(raw: string): string {
  return raw
    .replace(/\s*in JSON at position \d+.*/, '')
    .replace(/\s*at position \d+.*/, '')
    .replace(/,\s*\.{0,3}".*"\s*is not valid JSON$/s, '')
    .replace(/\s*is not valid JSON$/, '')
    .trim();
}

export function parseJson(text: string): ParseResult {
  if (!text.trim()) return { error: { message: 'Nothing to parse.' } };

  try {
    return { value: JSON.parse(text) as unknown };
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = cleanMessage(raw) || raw;
    const lines = text.split('\n');

    // V8 emits three different shapes depending on the failure, so try each:
    //   "… in JSON at position 11 (line 3 column 1)"   — best case
    //   "… at position 11"                             — needs converting
    //   "Unexpected token 'o', ...\"ctx\" is not valid" — no location at all
    const lineCol = /line (\d+) column (\d+)/.exec(raw);
    if (lineCol) {
      const line = Number(lineCol[1]);
      return { error: { message, line, column: Number(lineCol[2]), excerpt: lines[line - 1] ?? '' } };
    }

    const position = /at position (\d+)/.exec(raw);
    if (position) {
      const { line, column, excerpt } = offsetToLineCol(text, Number(position[1]));
      return { error: { message, line, column, excerpt } };
    }

    // No position, but V8 embeds a context snippet and the offending character:
    //   Unexpected token 'o', ..."1,\n  "b": oops\n}" is not valid JSON
    // Locating that snippet in the source recovers the line.
    const context = /(?:\.\.\.)?"(.*)" is not valid JSON$/s.exec(raw)?.[1];
    const token = /Unexpected token '(.)'/.exec(raw)?.[1];
    if (context) {
      const contextStart = text.indexOf(context);
      if (contextStart !== -1) {
        const withinContext = token ? context.indexOf(token) : 0;
        const offset = contextStart + (withinContext === -1 ? 0 : withinContext);
        const { line, column, excerpt } = offsetToLineCol(text, offset);
        return { error: { message, line, column, excerpt } };
      }
    }

    // On a single-line document there is only one answer regardless.
    if (lines.length === 1) {
      return { error: { message, line: 1, excerpt: lines[0] } };
    }
    return { error: { message } };
  }
}

export function format(value: unknown, indent: number): string {
  return JSON.stringify(value, null, indent);
}

export function minify(value: unknown): string {
  return JSON.stringify(value);
}

/** Sorts object keys recursively, which makes two documents comparable. */
export function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    entries.sort(([a], [b]) => a.localeCompare(b));
    return Object.fromEntries(entries.map(([k, v]) => [k, sortKeys(v)]));
  }
  return value;
}

// --- statistics --------------------------------------------------------------

export interface Stats {
  bytes: number;
  keys: number;
  maxDepth: number;
  arrays: number;
  objects: number;
  nulls: number;
}

export function analyse(value: unknown, text: string): Stats {
  const stats: Stats = {
    bytes: new TextEncoder().encode(text).length,
    keys: 0,
    maxDepth: 0,
    arrays: 0,
    objects: 0,
    nulls: 0,
  };

  const walk = (node: unknown, depth: number) => {
    stats.maxDepth = Math.max(stats.maxDepth, depth);
    if (node === null) {
      stats.nulls++;
    } else if (Array.isArray(node)) {
      stats.arrays++;
      for (const item of node) walk(item, depth + 1);
    } else if (typeof node === 'object') {
      stats.objects++;
      for (const [, v] of Object.entries(node as Record<string, unknown>)) {
        stats.keys++;
        walk(v, depth + 1);
      }
    }
  };

  walk(value, 0);
  return stats;
}

// --- schema validation -------------------------------------------------------

export interface ValidationIssue {
  path: string;
  message: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
  error?: string;
}

/** ajv is loaded on demand — it is the largest dependency on this page. */
export async function validateSchema(value: unknown, schemaText: string): Promise<ValidationResult> {
  const schemaParsed = parseJson(schemaText);
  if (isFailure(schemaParsed)) {
    return { valid: false, issues: [], error: `Schema is not valid JSON: ${schemaParsed.error.message}` };
  }

  try {
    const [{ default: Ajv }, { default: addFormats }] = await Promise.all([
      import('ajv'),
      import('ajv-formats'),
    ]);

    const ajv = new Ajv({ allErrors: true, strict: false });
    addFormats(ajv);

    const validate = ajv.compile(schemaParsed.value as object);
    const valid = validate(value);

    return {
      valid: Boolean(valid),
      issues: (validate.errors ?? []).map((e) => ({
        path: e.instancePath || '(root)',
        message: `${e.message ?? 'is invalid'}${
          e.params && Object.keys(e.params).length ? ` — ${JSON.stringify(e.params)}` : ''
        }`,
      })),
    };
  } catch (err) {
    return {
      valid: false,
      issues: [],
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

// --- diff --------------------------------------------------------------------

export interface DiffEntry {
  path: string;
  kind: 'added' | 'removed' | 'changed';
  left?: string;
  right?: string;
}

/**
 * Always JSON-encoded, so the string "1" and the number 1 are visibly different
 * in a diff. Rendering strings bare made those two indistinguishable.
 */
function render(value: unknown): string {
  return JSON.stringify(value) ?? String(value);
}

/**
 * Structural diff.
 *
 * Hand-rolled rather than using jsondiffpatch's HTML formatter: this returns
 * data, so the UI renders it through the framework's escaping. Building HTML
 * from user JSON is exactly the shape of the XSS that formatter had.
 */
export function diffJson(left: unknown, right: unknown, path = '$'): DiffEntry[] {
  if (Object.is(left, right)) return [];

  const leftIsObject = left !== null && typeof left === 'object';
  const rightIsObject = right !== null && typeof right === 'object';

  if (!leftIsObject || !rightIsObject || Array.isArray(left) !== Array.isArray(right)) {
    return [{ path, kind: 'changed', left: render(left), right: render(right) }];
  }

  if (Array.isArray(left) && Array.isArray(right)) {
    const entries: DiffEntry[] = [];
    const max = Math.max(left.length, right.length);
    for (let i = 0; i < max; i++) {
      const childPath = `${path}[${i}]`;
      if (i >= left.length) entries.push({ path: childPath, kind: 'added', right: render(right[i]) });
      else if (i >= right.length) entries.push({ path: childPath, kind: 'removed', left: render(left[i]) });
      else entries.push(...diffJson(left[i], right[i], childPath));
    }
    return entries;
  }

  const leftObj = left as Record<string, unknown>;
  const rightObj = right as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(leftObj), ...Object.keys(rightObj)])].sort();

  const entries: DiffEntry[] = [];
  for (const key of keys) {
    const childPath = `${path}.${key}`;
    const inLeft = key in leftObj;
    const inRight = key in rightObj;
    if (!inLeft) entries.push({ path: childPath, kind: 'added', right: render(rightObj[key]) });
    else if (!inRight) entries.push({ path: childPath, kind: 'removed', left: render(leftObj[key]) });
    else entries.push(...diffJson(leftObj[key], rightObj[key], childPath));
  }
  return entries;
}
