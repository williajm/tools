import { describe, it, expect } from 'vitest';
import {
  analyse,
  checkSchema,
  diffJson,
  draftOf,
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

  it('reports a bad pattern in the schema as a schema error', async () => {
    const result = await validateSchema('x', '{"type":"string","pattern":"([unclosed"}');
    expect(result.valid).toBe(false);
    expect(result.error).toBeTruthy();
    expect(result.issues).toEqual([]);
  });

  // The validator reports both the container keyword and the specific failure
  // underneath it; showing both would list every violation twice.
  it('does not report a violation twice via its container keyword', async () => {
    const result = await validateSchema(
      { age: 'old' },
      JSON.stringify({ type: 'object', properties: { age: { type: 'integer' } } }),
    );
    expect(result.valid).toBe(false);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]!.path).toBe('/age');
  });

  it('names the root when the failure is the document itself', async () => {
    const result = await validateSchema([], '{"type":"object"}');
    expect(result.valid).toBe(false);
    expect(result.issues[0]!.path).toBe('(root)');
  });

  it('honours a declared draft', async () => {
    // `exclusiveMinimum` is a boolean modifier in draft-04 and a number from
    // draft-06 on, so the draft chosen changes the verdict for the same document.
    const schema = JSON.stringify({
      $schema: 'http://json-schema.org/draft-07/schema#',
      type: 'integer',
      exclusiveMinimum: 5,
    });
    expect((await validateSchema(5, schema)).valid).toBe(false);
    expect((await validateSchema(6, schema)).valid).toBe(true);
  });
});

describe('draftOf', () => {
  it('reads the declared $schema', () => {
    expect(draftOf({ $schema: 'http://json-schema.org/draft-04/schema#' })).toBe('4');
    expect(draftOf({ $schema: 'http://json-schema.org/draft-07/schema#' })).toBe('7');
    expect(draftOf({ $schema: 'https://json-schema.org/draft/2019-09/schema' })).toBe('2019-09');
    expect(draftOf({ $schema: 'https://json-schema.org/draft/2020-12/schema' })).toBe('2020-12');
  });

  it('maps draft-06 onto draft-07 rather than refusing it', () => {
    expect(draftOf({ $schema: 'http://json-schema.org/draft-06/schema#' })).toBe('7');
  });

  it('falls back to the current draft when none is declared', () => {
    expect(draftOf({ type: 'object' })).toBe('2020-12');
    expect(draftOf({ $schema: 42 })).toBe('2020-12');
    expect(draftOf(null)).toBe('2020-12');
  });
});

describe('checkSchema', () => {
  it('passes a well-formed schema', () => {
    expect(checkSchema({ type: 'object', properties: { a: { type: ['string', 'null'] } } })).toBeNull();
  });

  it('catches a misspelled type, which the validator would otherwise swallow', () => {
    expect(checkSchema({ type: 'sting' })).toMatch(/not a JSON Schema type/);
  });

  it('catches a misspelled type nested in a subschema', () => {
    const problem = checkSchema({ properties: { a: { items: { type: 'boolen' } } } });
    expect(problem).toMatch(/#\/properties\/a\/items/);
  });

  it('catches a non-string type', () => {
    expect(checkSchema({ type: 7 })).toMatch(/must be a string/);
  });

  // `const` and `enum` hold instance data, so a "type" key inside them is a
  // value the user is matching on rather than a keyword to validate.
  it('does not mistake instance data for a keyword', () => {
    expect(checkSchema({ const: { type: 'whatever the user likes' } })).toBeNull();
    expect(checkSchema({ enum: [{ type: 'anything' }] })).toBeNull();
  });
});

/**
 * Regression: the keyword walk descended into every key except const and enum,
 * so instance data was read as schema. A schema describing an object with a
 * field called "type" was rejected outright.
 */
describe('checkSchema follows only subschema keywords', () => {
  it('accepts a property literally named "type"', () => {
    expect(checkSchema({ properties: { type: { type: 'string' } } })).toBeNull();
    expect(checkSchema({ properties: { type: { enum: ['a', 'b'] } } })).toBeNull();
  });

  it('accepts annotation keywords holding instance data', () => {
    expect(checkSchema({ default: { type: 'invoice' } })).toBeNull();
    expect(checkSchema({ examples: [{ type: 'cat' }] })).toBeNull();
    expect(checkSchema({ const: { type: 'anything' } })).toBeNull();
    expect(checkSchema({ enum: [{ type: 'anything' }] })).toBeNull();
    expect(checkSchema({ title: 'type', description: 'type' })).toBeNull();
  });

  it('still catches a misspelled type at the root', () => {
    expect(checkSchema({ type: 'sting' })).toMatch(/not a JSON Schema type/);
  });

  it('still catches one inside a real subschema', () => {
    expect(checkSchema({ properties: { a: { type: 'boolen' } } })).toMatch(/#\/properties\/a/);
    expect(checkSchema({ items: { type: 'nope' } })).toMatch(/#\/items/);
    expect(checkSchema({ allOf: [{ type: 'object' }, { type: 'nope' }] })).toMatch(/#\/allOf\/1/);
    expect(checkSchema({ not: { type: 'nope' } })).toMatch(/#\/not/);
    expect(checkSchema({ $defs: { X: { type: 'nope' } } })).toMatch(/#\/\$defs\/X/);
    expect(checkSchema({ if: { type: 'nope' } })).toMatch(/#\/if/);
  });

  it('accepts a realistic schema end to end', async () => {
    const schema = JSON.stringify({
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      type: 'object',
      required: ['type', 'amount'],
      properties: {
        type: { type: 'string', enum: ['invoice', 'credit'] },
        amount: { type: 'number', minimum: 0 },
        tags: { type: 'array', items: { type: 'string' } },
      },
      default: { type: 'invoice', amount: 0 },
      examples: [{ type: 'credit', amount: 5 }],
    });
    expect(checkSchema(JSON.parse(schema))).toBeNull();
    const ok = await validateSchema({ type: 'invoice', amount: 1 }, schema);
    expect(ok.valid).toBe(true);
    const bad = await validateSchema({ type: 'invoice' }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.error).toBeUndefined();
  });
});

/**
 * Regression: `key in object` consults the prototype chain, so a key named
 * toString, constructor or __proto__ compared against a document lacking it
 * reported a change against the inherited value instead of an addition.
 */
describe('diffJson uses own properties only', () => {
  it('reports an inherited-looking key as an addition', () => {
    for (const key of ['toString', 'constructor', '__proto__', 'valueOf', 'hasOwnProperty']) {
      const right = JSON.parse(`{"${key}":1}`) as Record<string, unknown>;
      const entries = diffJson({}, right);
      expect(entries, key).toHaveLength(1);
      expect(entries[0]!.kind, key).toBe('added');
      expect(entries[0]!.right, key).toBe('1');
      expect(entries[0]!.left, key).toBeUndefined();
    }
  });

  it('reports removal of such a key too', () => {
    const left = JSON.parse('{"toString":1}') as Record<string, unknown>;
    const entries = diffJson(left, {});
    expect(entries).toHaveLength(1);
    expect(entries[0]!.kind).toBe('removed');
  });

  it('never leaks a function into the diff', () => {
    const entries = diffJson({}, JSON.parse('{"toString":1}') as Record<string, unknown>);
    expect(JSON.stringify(entries)).not.toContain('native code');
  });

  it('still reports a real change on such a key', () => {
    const left = JSON.parse('{"toString":1}') as Record<string, unknown>;
    const right = JSON.parse('{"toString":2}') as Record<string, unknown>;
    expect(diffJson(left, right)).toEqual([
      { path: '$.toString', kind: 'changed', left: '1', right: '2' },
    ]);
  });
});
