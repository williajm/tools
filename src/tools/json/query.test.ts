import { describe, it, expect } from 'vitest';
import { query, isQueryError, type Match } from './query.ts';

/** Convenience: run a query that is expected to succeed and return its values. */
function values(root: unknown, path: string): unknown[] {
  const result = query(root, path);
  if (isQueryError(result)) throw new Error(`unexpected error: ${result.error}`);
  return result.matches.map((m) => m.value);
}

function matches(root: unknown, path: string): Match[] {
  const result = query(root, path);
  if (isQueryError(result)) throw new Error(`unexpected error: ${result.error}`);
  return result.matches;
}

// The canonical Goessner bookstore, the example every JSONPath is tested against.
const store = {
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      { category: 'fiction', author: 'J. R. R. Tolkien', title: 'The Lord of the Rings', isbn: '0-395-19395-8', price: 22.99 },
    ],
    bicycle: { color: 'red', price: 19.95 },
  },
};

describe('root and child selection', () => {
  it('returns the whole document for $', () => {
    expect(values(store, '$')).toEqual([store]);
  });

  it('selects a nested child by dot notation', () => {
    expect(values(store, '$.store.bicycle.color')).toEqual(['red']);
  });

  it('selects a child by bracket notation', () => {
    expect(values(store, "$['store']['bicycle']['color']")).toEqual(['red']);
  });

  it('returns nothing for a missing key without erroring', () => {
    expect(values(store, '$.store.garage')).toEqual([]);
  });

  it('reports the normalized path of each match', () => {
    expect(matches(store, '$.store.book[0].title')[0]!.path).toBe('$.store.book[0].title');
  });
});

describe('wildcards', () => {
  it('selects every value of an object', () => {
    expect(values(store, '$.store.*')).toEqual([store.store.book, store.store.bicycle]);
  });

  it('selects every element of an array', () => {
    expect(values(store, '$.store.book[*].author')).toEqual([
      'Nigel Rees',
      'Evelyn Waugh',
      'Herman Melville',
      'J. R. R. Tolkien',
    ]);
  });
});

describe('recursive descent', () => {
  it('finds a key at any depth', () => {
    expect(values(store, '$..author')).toEqual([
      'Nigel Rees',
      'Evelyn Waugh',
      'Herman Melville',
      'J. R. R. Tolkien',
    ]);
  });

  it('finds every price including the bicycle', () => {
    expect(values(store, '$..price')).toEqual([8.95, 12.99, 8.99, 22.99, 19.95]);
  });

  it('combines descent with a wildcard', () => {
    expect(values(store, '$..book[*].isbn')).toEqual(['0-553-21311-3', '0-395-19395-8']);
  });
});

describe('array indices and slices', () => {
  const nums = { a: [10, 20, 30, 40, 50] };

  it('selects by index', () => {
    expect(values(nums, '$.a[0]')).toEqual([10]);
    expect(values(nums, '$.a[2]')).toEqual([30]);
  });

  it('counts negative indices from the end', () => {
    expect(values(nums, '$.a[-1]')).toEqual([50]);
    expect(values(nums, '$.a[-2]')).toEqual([40]);
  });

  it('returns nothing for an out-of-range index', () => {
    expect(values(nums, '$.a[99]')).toEqual([]);
  });

  it('slices a range', () => {
    expect(values(nums, '$.a[1:3]')).toEqual([20, 30]);
  });

  it('slices with an open start or end', () => {
    expect(values(nums, '$.a[:2]')).toEqual([10, 20]);
    expect(values(nums, '$.a[3:]')).toEqual([40, 50]);
  });

  it('slices with a step', () => {
    expect(values(nums, '$.a[::2]')).toEqual([10, 30, 50]);
  });

  it('slices with a negative step, reversing', () => {
    expect(values(nums, '$.a[::-1]')).toEqual([50, 40, 30, 20, 10]);
  });

  it('slices with negative bounds', () => {
    expect(values(nums, '$.a[-2:]')).toEqual([40, 50]);
  });

  it('gives sliced elements their real index in the path', () => {
    expect(matches(nums, '$.a[1:3]').map((m) => m.path)).toEqual(['$.a[1]', '$.a[2]']);
  });

  it('rejects a slice with more than three parts', () => {
    // Regression: $.a[0:2:1:999] silently behaved as $.a[0:2:1].
    const result = query(nums, '$.a[0:2:1:999]');
    expect(isQueryError(result) && result.error).toMatch(/slice/i);
  });
});

describe('unions', () => {
  it('unions indices', () => {
    expect(values({ a: [1, 2, 3, 4] }, '$.a[0,2]')).toEqual([1, 3]);
  });

  it('unions names', () => {
    expect(values({ x: 1, y: 2, z: 3 }, "$['x','z']")).toEqual([1, 3]);
  });
});

describe('filters', () => {
  it('keeps array elements matching a comparison', () => {
    expect(values(store, '$.store.book[?(@.price < 10)].title')).toEqual([
      'Sayings of the Century',
      'Moby Dick',
    ]);
  });

  it('supports >= and <=', () => {
    expect(values(store, '$.store.book[?(@.price >= 12.99)].title')).toEqual([
      'Sword of Honour',
      'The Lord of the Rings',
    ]);
  });

  it('tests for existence of a field', () => {
    expect(values(store, '$.store.book[?(@.isbn)].title')).toEqual([
      'Moby Dick',
      'The Lord of the Rings',
    ]);
  });

  it('negates an existence test', () => {
    expect(values(store, '$.store.book[?(!@.isbn)].title')).toEqual([
      'Sayings of the Century',
      'Sword of Honour',
    ]);
  });

  it('compares against a string literal', () => {
    expect(values(store, "$.store.book[?(@.category == 'reference')].author")).toEqual(['Nigel Rees']);
  });

  it('combines conditions with &&', () => {
    expect(values(store, "$.store.book[?(@.category == 'fiction' && @.price < 10)].title")).toEqual([
      'Moby Dick',
    ]);
  });

  it('combines conditions with ||', () => {
    expect(values(store, '$.store.book[?(@.price < 9 || @.price > 20)].title')).toEqual([
      'Sayings of the Century',
      'Moby Dick',
      'The Lord of the Rings',
    ]);
  });

  it('honours parentheses over precedence', () => {
    const data = { items: [{ a: 1, b: 0 }, { a: 0, b: 1 }, { a: 1, b: 1 }] };
    // Without parens && binds tighter; the parens force the or first.
    expect(values(data, '$.items[?((@.a == 1 || @.b == 1) && @.a == 1)]')).toEqual([
      { a: 1, b: 0 },
      { a: 1, b: 1 },
    ]);
  });

  it('accepts grouped conditions whose outer parens do not enclose the filter', () => {
    // Regression: the first '(' and last ')' were stripped as if they were one
    // enclosing pair, mangling this into `@.a == 1) || (@.b == 1`.
    const data = { items: [{ a: 1 }, { b: 1 }, { c: 1 }] };
    expect(values(data, '$.items[?(@.a == 1) || (@.b == 1)]')).toEqual([{ a: 1 }, { b: 1 }]);
  });

  it('can compare a field against another field', () => {
    const data = { rows: [{ lo: 1, hi: 2 }, { lo: 5, hi: 3 }] };
    expect(values(data, '$.rows[?(@.lo < @.hi)]')).toEqual([{ lo: 1, hi: 2 }]);
  });

  it('filters object values, not just array elements', () => {
    const data = { a: { v: 1 }, b: { v: 5 }, c: { v: 9 } };
    expect(values(data, '$[?(@.v > 3)].v')).toEqual([5, 9]);
  });

  it('treats a missing operand as not-equal to a present one', () => {
    expect(values(store, "$.store.book[?(@.isbn != '0-553-21311-3')].title")).toEqual([
      'Sayings of the Century',
      'Sword of Honour',
      'The Lord of the Rings',
    ]);
  });

  it('can reference the root inside a filter', () => {
    const data = { threshold: 10, items: [{ n: 5 }, { n: 15 }] };
    expect(values(data, '$.items[?(@.n > $.threshold)]')).toEqual([{ n: 15 }]);
  });
});

describe('string escapes', () => {
  it('decodes backspace and form-feed escapes', () => {
    // Regression: \b and \f were missing from the escape map, so $['a\b']
    // silently matched the key "ab" instead of "a<backspace>".
    expect(values({ 'a\b': 1, ab: 2 }, "$['a\\b']")).toEqual([1]);
    expect(values({ 'a\f': 1, af: 2 }, "$['a\\f']")).toEqual([1]);
  });

  it('decodes unicode escapes', () => {
    expect(values({ café: 1 }, "$['caf\\u00e9']")).toEqual([1]);
  });

  it('decodes escapes in filter string literals too', () => {
    const data = { rows: [{ k: 'a\b' }, { k: 'ab' }] };
    expect(values(data, "$.rows[?(@.k == 'a\\b')]")).toEqual([{ k: 'a\b' }]);
  });

  it('rejects an unknown escape instead of dropping the backslash', () => {
    // Regression: $['a\x'] silently matched the key "ax".
    const result = query({ ax: 1 }, "$['a\\x']");
    expect(isQueryError(result) && result.error).toMatch(/escape/);
  });
});

describe('error handling', () => {
  it('rejects a path that does not start with $', () => {
    const result = query(store, 'store.book');
    expect(isQueryError(result) && result.error).toMatch(/must start with '\$'/);
  });

  it('reports an empty expression', () => {
    const result = query(store, '   ');
    expect(isQueryError(result) && result.error).toMatch(/Enter a JSONPath/);
  });

  it('reports an unbalanced bracket', () => {
    const result = query(store, '$.a[0');
    expect(isQueryError(result)).toBe(true);
  });

  it('reports a malformed filter', () => {
    const result = query(store, '$.book[?(@.price <)]');
    expect(isQueryError(result)).toBe(true);
  });

  it('reports a bare word instead of a quoted string', () => {
    const result = query(store, '$.book[?(@.category == reference)]');
    expect(isQueryError(result) && result.error).toMatch(/did you mean/);
  });
});

describe('large inputs', () => {
  // The engine spread selector results into an accumulator with push(...arr),
  // which throws RangeError past ~130k arguments — so a wildcard, wide slice or
  // filter over a big array crashed the tool it exists to inspect.
  const wide = { items: Array.from({ length: 200_000 }, (_, i) => i) };

  it('handles a wildcard over a very large array', () => {
    expect(values(wide, '$.items[*]')).toHaveLength(200_000);
  });

  it('handles a filter matching most of a very large array', () => {
    const result = query(wide, '$.items[?(@ >= 10)]');
    expect(isQueryError(result)).toBe(false);
    if (!isQueryError(result)) expect(result.matches).toHaveLength(199_990);
  });

  it('handles a wide slice over a very large array', () => {
    expect(values(wide, '$.items[0:200000]')).toHaveLength(200_000);
  });
});

describe('safety', () => {
  it('treats an inherited-looking key as absent', () => {
    // `.constructor`/`.toString` must not leak prototype members.
    expect(values({ a: 1 }, '$.toString')).toEqual([]);
    expect(values({ a: 1 }, '$.constructor')).toEqual([]);
  });

  it('reads own properties named like prototype members', () => {
    const data = JSON.parse('{"toString": 42}') as unknown;
    expect(values(data, '$.toString')).toEqual([42]);
  });

  it('deduplicates matches that resolve to the same node', () => {
    // A union naming the same key twice must not report it twice.
    expect(values({ a: 1 }, "$['a','a']")).toEqual([1]);
  });
});
