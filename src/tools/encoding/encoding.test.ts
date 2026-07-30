import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  SCHEMES,
  convert,
  fromBase64,
  fromBase64Url,
  fromHex,
  fromHtml,
  toBase64,
  toBase64Url,
  toHex,
  toHtml,
} from './encoding.ts';

describe('round-trips', () => {
  // Property test: for every scheme, decode(encode(x)) === x for arbitrary text.
  // HTML is excluded because escaping is deliberately not exhaustive — it escapes
  // the five dangerous characters, so it is lossy in the other direction only for
  // entities the user typed themselves.
  for (const scheme of SCHEMES) {
    it(`${scheme} survives arbitrary unicode`, () => {
      fc.assert(
        fc.property(fc.string(), (text) => {
          const encoded = convert(text, scheme, 'encode');
          expect(encoded.error).toBeUndefined();
          const decoded = convert(encoded.output, scheme, 'decode');
          expect(decoded.error).toBeUndefined();
          expect(decoded.output).toBe(text);
        }),
        { numRuns: 200 },
      );
    });
  }
});

describe('base64', () => {
  it('handles ASCII', () => {
    expect(toBase64('hello')).toBe('aGVsbG8=');
    expect(fromBase64('aGVsbG8=')).toBe('hello');
  });

  it('handles multi-byte UTF-8 that btoa alone would break', () => {
    expect(toBase64('日本語')).toBe('5pel5pys6Kqe');
    expect(fromBase64('5pel5pys6Kqe')).toBe('日本語');
    expect(toBase64('🎉')).toBe('8J+OiQ==');
    expect(fromBase64('8J+OiQ==')).toBe('🎉');
  });

  it('tolerates whitespace in pasted input', () => {
    expect(fromBase64('aGVs\nbG8=')).toBe('hello');
    expect(fromBase64('  aGVsbG8=  ')).toBe('hello');
  });

  it('rejects the wrong alphabet rather than returning nonsense', () => {
    expect(convert('aGVs-bG8', 'base64', 'decode').error).toMatch(/base64/i);
  });
});

describe('base64url', () => {
  it('uses the URL-safe alphabet and strips padding', () => {
    // '>>>' and '???' are the shortest printable strings whose base64 contains
    // the two characters that differ between the alphabets.
    expect(toBase64('>>>')).toBe('Pj4+');
    expect(toBase64Url('>>>')).toBe('Pj4-');
    expect(fromBase64Url('Pj4-')).toBe('>>>');

    expect(toBase64('???')).toBe('Pz8/');
    expect(toBase64Url('???')).toBe('Pz8_');
    expect(fromBase64Url('Pz8_')).toBe('???');
  });

  it('reports base64 that decodes to non-UTF-8 bytes', () => {
    // "//4=" is valid base64 but the bytes 0xFF 0xFE are not text.
    expect(convert('//4=', 'base64', 'decode').error).toMatch(/not valid UTF-8/i);
  });

  it('restores missing padding when decoding', () => {
    expect(fromBase64Url(toBase64Url('hello'))).toBe('hello');
    expect(fromBase64Url(toBase64Url('a'))).toBe('a');
    expect(fromBase64Url(toBase64Url('ab'))).toBe('ab');
  });

  it('rejects standard-alphabet input', () => {
    expect(convert('aGVs+bG8', 'base64url', 'decode').error).toMatch(/base64url/i);
  });
});

describe('hex', () => {
  it('encodes bytes not code units', () => {
    expect(toHex('hi')).toBe('6869');
    expect(toHex('é')).toBe('c3a9'); // two UTF-8 bytes, not one
  });

  it('accepts common separators and 0x prefixes', () => {
    expect(fromHex('68 69')).toBe('hi');
    expect(fromHex('68:69')).toBe('hi');
    expect(fromHex('0x6869')).toBe('hi');
  });

  it('reports odd-length and non-hex input', () => {
    expect(convert('686', 'hex', 'decode').error).toMatch(/odd number/i);
    expect(convert('68zz', 'hex', 'decode').error).toMatch(/outside/i);
  });
});

describe('html', () => {
  it('escapes the characters that matter', () => {
    expect(toHtml('<script>alert("x") & \'y\'</script>')).toBe(
      '&lt;script&gt;alert(&quot;x&quot;) &amp; &#39;y&#39;&lt;/script&gt;',
    );
  });

  it('decodes named, decimal and hex entities', () => {
    expect(fromHtml('&lt;b&gt;')).toBe('<b>');
    expect(fromHtml('&#72;&#105;')).toBe('Hi');
    expect(fromHtml('&#x1F389;')).toBe('🎉');
  });

  it('leaves unknown entities untouched rather than guessing', () => {
    expect(fromHtml('&notarealentity;')).toBe('&notarealentity;');
  });

  /**
   * Regression: an out-of-range code point threw RangeError out of
   * String.fromCodePoint, which the dispatcher then misreported as bytes that
   * are not valid UTF-8 — an explanation about bytes, for input with none.
   */
  it('explains a character reference outside the Unicode range', () => {
    for (const entity of ['&#x110000;', '&#1114112;', '&#99999999999999999999;', '&#xFFFFFFF;']) {
      const result = convert(entity, 'html', 'decode');
      expect(result.error, entity).toMatch(/outside the Unicode range/);
      expect(result.error, entity).not.toMatch(/UTF-8/);
    }
  });

  it('still decodes the highest valid code point', () => {
    expect(fromHtml('&#x10FFFF;')).toBe(String.fromCodePoint(0x10ffff));
  });
});

describe('base64 length', () => {
  /**
   * Regression: `atob` throws on a length that leaves one character over, and
   * that throw was reported as invalid UTF-8 rather than as a wrong length.
   */
  it('explains a leftover character rather than blaming the bytes', () => {
    for (const bad of ['a', 'YWJjZ']) {
      const result = convert(bad, 'base64', 'decode');
      expect(result.error, bad).toMatch(/length is wrong/);
      expect(result.error, bad).not.toMatch(/UTF-8/);
    }
  });

  it('explains it for base64url too', () => {
    const result = convert('a', 'base64url', 'decode');
    expect(result.error).toMatch(/length is wrong/);
    expect(result.error).toMatch(/base64url/);
  });

  it('still accepts valid unpadded lengths', () => {
    expect(convert('YQ', 'base64', 'decode')).toEqual({ output: 'a' });
    expect(convert('YWI', 'base64', 'decode')).toEqual({ output: 'ab' });
    expect(convert('YWJj', 'base64', 'decode')).toEqual({ output: 'abc' });
  });

  it('still reports genuinely invalid UTF-8 as such', () => {
    // Correct length and alphabet, but the bytes are not text.
    const result = convert('abc', 'base64', 'decode');
    expect(result.error).toMatch(/UTF-8/);
  });
});

describe('empty input', () => {
  it('produces empty output with no error for every scheme', () => {
    for (const scheme of SCHEMES) {
      expect(convert('', scheme, 'encode')).toEqual({ output: '' });
      expect(convert('', scheme, 'decode')).toEqual({ output: '' });
    }
  });
});
