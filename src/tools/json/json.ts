// Type-only, so the validator stays behind the dynamic import in validateSchema.
import type { Schema, SchemaDraft } from '@cfworker/json-schema';

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

/**
 * `$schema` values mapped onto the drafts the validator implements. draft-06 is
 * close enough to draft-07 for the keywords that differ to be ones almost nobody
 * writes, and answering with draft-07 beats refusing the document.
 */
const DRAFTS: ReadonlyArray<readonly [RegExp, SchemaDraft]> = [
  [/draft-0[34]\//, '4'],
  [/draft-0[67]\//, '7'],
  [/draft\/2019-09\//, '2019-09'],
  [/draft\/2020-12\//, '2020-12'],
];

const DEFAULT_DRAFT: SchemaDraft = '2020-12';

export function draftOf(schema: unknown): SchemaDraft {
  const declared =
    schema !== null && typeof schema === 'object'
      ? (schema as { $schema?: unknown }).$schema
      : undefined;
  if (typeof declared !== 'string') return DEFAULT_DRAFT;
  for (const [pattern, draft] of DRAFTS) {
    if (pattern.test(declared)) return draft;
  }
  return DEFAULT_DRAFT;
}

/**
 * Keywords whose failure only means "something inside me failed". The validator
 * reports them alongside the specific error underneath, which would show every
 * violation twice — once uselessly. `anyOf`, `oneOf` and `not` are kept: their
 * per-branch leaves are the confusing half, and the summary is the useful one.
 */
const AGGREGATE_KEYWORDS: ReadonlySet<string> = new Set([
  'properties',
  'patternProperties',
  'additionalProperties',
  'items',
  'prefixItems',
  'additionalItems',
  'contains',
  'dependentSchemas',
  'propertyNames',
  'allOf',
  'if',
  'then',
  'else',
  '$ref',
]);

const JSON_TYPES: ReadonlySet<string> = new Set([
  'null',
  'boolean',
  'object',
  'array',
  'number',
  'string',
  'integer',
]);

/**
 * Keywords whose value is itself a subschema.
 *
 * Recursion has to follow these and nothing else. Descending into every key
 * except `const` and `enum` treated instance data as schema, so a schema
 * describing an object with a field called "type" — `{"properties":{"type":
 * {"type":"string"}}}`, about as ordinary as schemas get — was rejected, as were
 * `default` and `examples` holding any object with a `type` member.
 */
const SUBSCHEMA_KEYWORDS: ReadonlySet<string> = new Set([
  'additionalItems',
  'unevaluatedItems',
  'items',
  'contains',
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'not',
  'if',
  'then',
  'else',
]);

/** Keywords holding an array of subschemas. */
const SUBSCHEMA_ARRAY_KEYWORDS: ReadonlySet<string> = new Set([
  'prefixItems',
  'items',
  'allOf',
  'anyOf',
  'oneOf',
]);

/** Keywords holding a map of name to subschema. */
const SUBSCHEMA_MAP_KEYWORDS: ReadonlySet<string> = new Set([
  '$defs',
  'definitions',
  'properties',
  'patternProperties',
  'dependentSchemas',
]);

/**
 * Catches the schema mistakes the validator would otherwise swallow.
 *
 * A misspelled `type` is accepted silently and then fails every instance, so the
 * document under test gets blamed for a typo in the schema. That is the same
 * failure mode the CIDR parser guards against: confidently answering a question
 * nobody asked. A bad `pattern` throws from the validator, so it needs no check.
 *
 * Only the keywords above are followed. Everything else is either an assertion
 * whose value is data, or annotation such as `default`, `examples` and `const` —
 * where a `type` member belongs to the user's instance, not to the schema.
 */
export function checkSchema(schema: unknown, path = '#'): string | null {
  if (schema === null || typeof schema !== 'object' || Array.isArray(schema)) return null;

  for (const [key, child] of Object.entries(schema as Record<string, unknown>)) {
    if (key === 'type') {
      const names = Array.isArray(child) ? child : [child];
      for (const name of names) {
        if (typeof name !== 'string') {
          return `Schema at ${path}: "type" must be a string or an array of strings.`;
        }
        if (!JSON_TYPES.has(name)) {
          return `Schema at ${path}: "${name}" is not a JSON Schema type. Expected one of ${[
            ...JSON_TYPES,
          ].join(', ')}.`;
        }
      }
      continue;
    }

    // `items` and `prefixItems` may be a single schema or an array of them.
    if (Array.isArray(child) && SUBSCHEMA_ARRAY_KEYWORDS.has(key)) {
      for (const [index, item] of child.entries()) {
        const problem = checkSchema(item, `${path}/${key}/${index}`);
        if (problem) return problem;
      }
      continue;
    }
    if (SUBSCHEMA_KEYWORDS.has(key)) {
      const problem = checkSchema(child, `${path}/${key}`);
      if (problem) return problem;
      continue;
    }
    if (SUBSCHEMA_MAP_KEYWORDS.has(key) && child !== null && typeof child === 'object') {
      for (const [name, sub] of Object.entries(child as Record<string, unknown>)) {
        const problem = checkSchema(sub, `${path}/${key}/${name}`);
        if (problem) return problem;
      }
      continue;
    }
  }

  return null;
}

/**
 * Validates against a JSON Schema.
 *
 * The validator interprets the schema rather than compiling it to JavaScript,
 * which is not a detail: the pages ship `script-src 'self'`, and every
 * compiling validator builds its checker with `new Function`. Under this CSP
 * that throws, so a compiling validator cannot validate anything here at all.
 * Loaded on demand since only this one mode needs it.
 */
export async function validateSchema(value: unknown, schemaText: string): Promise<ValidationResult> {
  const schemaParsed = parseJson(schemaText);
  if (isFailure(schemaParsed)) {
    return { valid: false, issues: [], error: `Schema is not valid JSON: ${schemaParsed.error.message}` };
  }

  const problem = checkSchema(schemaParsed.value);
  if (problem) return { valid: false, issues: [], error: problem };

  try {
    const { Validator } = await import('@cfworker/json-schema');

    // shortCircuit false, so every violation is reported rather than the first.
    const validator = new Validator(
      schemaParsed.value as Schema,
      draftOf(schemaParsed.value),
      false,
    );
    const result = validator.validate(value);

    return {
      valid: result.valid,
      issues: [...result.errors]
        .filter((e) => !AGGREGATE_KEYWORDS.has(e.keyword))
        .map((e) => ({
          // Locations arrive as JSON pointers prefixed with '#'.
          path: e.instanceLocation.replace(/^#/, '') || '(root)',
          message: e.error,
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
    // `in` consults the prototype chain, so a document with a key named
    // "toString", "constructor" or "__proto__" compared against one without it
    // reported a change against the inherited value — `{}` vs `{"toString":1}`
    // showed `function toString() { [native code] }` as the left-hand side —
    // rather than the addition it is. JSON.parse creates these as own
    // properties, so hasOwn is the question actually being asked.
    const inLeft = Object.hasOwn(leftObj, key);
    const inRight = Object.hasOwn(rightObj, key);
    if (!inLeft) entries.push({ path: childPath, kind: 'added', right: render(rightObj[key]) });
    else if (!inRight) entries.push({ path: childPath, kind: 'removed', left: render(leftObj[key]) });
    else entries.push(...diffJson(leftObj[key], rightObj[key], childPath));
  }
  return entries;
}
