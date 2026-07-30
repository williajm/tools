import { describe, it, expect } from 'vitest';
import {
  analyse,
  diffJson,
  format,
  isFailure,
  minify,
  parseJson,
  sortKeys,
  validateSchema,
} from './json.ts';

describe('parseJson', () => {
  it('parses valid JSON', () => {
    const result = parseJson('{"a":1,"b":[2,3]}');
    expect(isFailure(result)).toBe(false);
    if (!isFailure(result)) expect(result.value).toEqual({ a: 1, b: [2, 3] });
  });

  it('reports empty input plainly', () => {
    const result = parseJson('   ');
    expect(isFailure(result) && result.error.message).toMatch(/Nothing to parse/);
  });

  it('converts a character offset into a line and column', () => {
    // The whole point: "position 23" is useless, "line 3" is actionable.
    const text = '{\n  "a": 1,\n  "b": oops\n}';
    const result = parseJson(text);
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) {
      expect(result.error.line).toBe(3);
      expect(result.error.column).toBeGreaterThan(0);
      expect(result.error.excerpt).toContain('oops');
    }
  });

  it('locates a trailing comma', () => {
    const result = parseJson('{\n "a": 1,\n}');
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.line).toBeGreaterThanOrEqual(2);
  });

  it('handles a single-line document', () => {
    const result = parseJson('{"a": }');
    expect(isFailure(result)).toBe(true);
    if (isFailure(result)) expect(result.error.line).toBe(1);
  });
});

describe('format and minify', () => {
  it('round-trips through format', () => {
    const value = { b: 2, a: [1, { c: null }] };
    expect(JSON.parse(format(value, 2))).toEqual(value);
  });

  it('respects the indent', () => {
    expect(format({ a: 1 }, 2)).toBe('{\n  "a": 1\n}');
    expect(format({ a: 1 }, 4)).toBe('{\n    "a": 1\n}');
    expect(format({ a: 1 }, 0)).toBe('{"a":1}');
  });

  it('minifies', () => {
    expect(minify({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });
});

describe('sortKeys', () => {
  it('sorts nested object keys', () => {
    const sorted = sortKeys({ b: 1, a: { d: 2, c: 3 } });
    expect(JSON.stringify(sorted)).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it('preserves array order', () => {
    // Arrays are ordered data; sorting them would change meaning.
    expect(sortKeys([3, 1, 2])).toEqual([3, 1, 2]);
  });

  it('leaves primitives and null alone', () => {
    expect(sortKeys(null)).toBeNull();
    expect(sortKeys(42)).toBe(42);
    expect(sortKeys('x')).toBe('x');
  });

  it('makes key-order-only differences comparable', () => {
    const a = { x: 1, y: { p: 1, q: 2 } };
    const b = { y: { q: 2, p: 1 }, x: 1 };
    expect(JSON.stringify(sortKeys(a))).toBe(JSON.stringify(sortKeys(b)));
  });
});

describe('analyse', () => {
  it('counts keys, depth and containers', () => {
    const text = '{"a":{"b":{"c":[1,2,null]}}}';
    const stats = analyse(JSON.parse(text), text);
    expect(stats.keys).toBe(3);
    expect(stats.objects).toBe(3);
    expect(stats.arrays).toBe(1);
    expect(stats.nulls).toBe(1);
    expect(stats.maxDepth).toBe(4);
  });

  it('measures UTF-8 bytes not characters', () => {
    const text = '{"a":"日本"}';
    expect(analyse(JSON.parse(text), text).bytes).toBe(new TextEncoder().encode(text).length);
    expect(analyse(JSON.parse(text), text).bytes).toBeGreaterThan(text.length);
  });
});

describe('diffJson', () => {
  it('finds nothing for identical values', () => {
    expect(diffJson({ a: 1, b: [1, 2] }, { a: 1, b: [1, 2] })).toEqual([]);
  });

  it('reports a changed scalar with its path', () => {
    expect(diffJson({ a: 1 }, { a: 2 })).toEqual([
      { path: '$.a', kind: 'changed', left: '1', right: '2' },
    ]);
  });

  it('reports added and removed keys', () => {
    const entries = diffJson({ a: 1 }, { b: 2 });
    expect(entries).toEqual([
      { path: '$.a', kind: 'removed', left: '1' },
      { path: '$.b', kind: 'added', right: '2' },
    ]);
  });

  it('descends into nested objects', () => {
    const entries = diffJson({ a: { b: { c: 1 } } }, { a: { b: { c: 2 } } });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.path).toBe('$.a.b.c');
  });

  it('reports array element changes by index', () => {
    const entries = diffJson([1, 2, 3], [1, 9, 3]);
    expect(entries).toEqual([{ path: '$[1]', kind: 'changed', left: '2', right: '9' }]);
  });

  it('reports appended and truncated array elements', () => {
    expect(diffJson([1], [1, 2])).toEqual([{ path: '$[1]', kind: 'added', right: '2' }]);
    expect(diffJson([1, 2], [1])).toEqual([{ path: '$[1]', kind: 'removed', left: '2' }]);
  });

  it('treats a type change as a change, not a descent', () => {
    const entries = diffJson({ a: { b: 1 } }, { a: [1] });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('changed');
  });

  it('distinguishes null from missing', () => {
    expect(diffJson({ a: null }, {})).toEqual([{ path: '$.a', kind: 'removed', left: 'null' }]);
    expect(diffJson({ a: null }, { a: 0 })).toEqual([
      { path: '$.a', kind: 'changed', left: 'null', right: '0' },
    ]);
  });

  it('is insensitive to key order', () => {
    expect(diffJson({ a: 1, b: 2 }, { b: 2, a: 1 })).toEqual([]);
  });

  it('returns data rather than markup', () => {
    // Deliberate: the UI renders through the framework's escaping. Returning
    // HTML built from user JSON is how the jsondiffpatch XSS worked.
    const entries = diffJson({ a: '<script>alert(1)</script>' }, { a: 'x' });
    expect(entries[0]!.left).toBe('"<script>alert(1)</script>"');
    expect(typeof entries[0]!.left).toBe('string');
  });
});

describe('validateSchema', () => {
  const schema = JSON.stringify({
    type: 'object',
    required: ['name', 'age'],
    properties: {
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 0 },
      email: { type: 'string', format: 'email' },
    },
  });

  it('accepts a conforming document', async () => {
    const result = await validateSchema({ name: 'Ada', age: 36 }, schema);
    expect(result.valid).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('reports every violation, not just the first', async () => {
    const result = await validateSchema({ age: -1 }, schema);
    expect(result.valid).toBe(false);
    expect(result.issues.length).toBeGreaterThanOrEqual(2);
  });

  it('includes the failing path', async () => {
    const result = await validateSchema({ name: 'Ada', age: 'old' }, schema);
    expect(result.issues.some((i) => i.path === '/age')).toBe(true);
  });

  it('validates formats', async () => {
    const result = await validateSchema({ name: 'A', age: 1, email: 'not-an-email' }, schema);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.path === '/email')).toBe(true);
  });

  it('reports an unparseable schema distinctly', async () => {
    const result = await validateSchema({}, '{not json');
    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/Schema is not valid JSON/);
  });

  it('reports an invalid schema without throwing', async () => {
    const result = await validateSchema({}, '{"type": "notatype"}');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
