import { describe, it, expect } from 'vitest';
import { generateRows, serialise, type FieldId } from './fixtures.ts';

const fields: FieldId[] = ['id', 'fullName', 'email', 'iban', 'creditCard'];

describe('generateRows', () => {
  it('is reproducible for a given seed', async () => {
    const a = await generateRows(fields, 10, 'seed-1', 'en');
    const b = await generateRows(fields, 10, 'seed-1', 'en');
    expect(a).toEqual(b);
  });

  it('differs across seeds', async () => {
    const a = await generateRows(fields, 10, 'seed-1', 'en');
    const b = await generateRows(fields, 10, 'seed-2', 'en');
    expect(a).not.toEqual(b);
  });

  it('produces sequential ids and the requested row count', async () => {
    const rows = await generateRows(fields, 5, 's', 'en');
    expect(rows).toHaveLength(5);
    expect(rows.map((r) => r['id'])).toEqual(['1', '2', '3', '4', '5']);
  });

  it('clamps the row count', async () => {
    expect(await generateRows(['id'], 0, 's', 'en')).toHaveLength(1);
    expect(await generateRows(['id'], 99999, 's', 'en')).toHaveLength(1000);
  });

  it('never leaves a field empty or undefined', async () => {
    const all = (
      ['id', 'uuid', 'firstName', 'lastName', 'fullName', 'email', 'username', 'phone',
       'company', 'jobTitle', 'street', 'city', 'postcode', 'country', 'iban',
       'creditCard', 'date', 'bool', 'price', 'url'] satisfies FieldId[]
    );
    const rows = await generateRows(all, 20, 's', 'en');
    for (const row of rows) {
      for (const [key, value] of Object.entries(row)) {
        expect(value, key).toBeTypeOf('string');
        expect(value.length, key).toBeGreaterThan(0);
      }
    }
  });

  it('generates Luhn-valid card numbers', async () => {
    // The reason to use faker rather than random digits: these must pass the
    // same validation as a real card or they are useless as test data.
    const rows = await generateRows(['creditCard'], 40, 's', 'en');
    for (const row of rows) {
      const digits = (row['card_number'] ?? '').replace(/\D/g, '');
      expect(digits.length).toBeGreaterThanOrEqual(12);
      expect(luhnValid(digits), digits).toBe(true);
    }
  });

  it('generates IBANs with a valid mod-97 checksum', async () => {
    const rows = await generateRows(['iban'], 25, 's', 'en');
    for (const row of rows) {
      expect(ibanValid(row['iban'] ?? ''), row['iban']).toBe(true);
    }
  });

  it('respects the locale', async () => {
    const ja = await generateRows(['fullName'], 10, 's', 'ja');
    // At least some Japanese names should contain non-Latin characters.
    expect(ja.some((r) => /[^\x00-\x7F]/.test(r['full_name'] ?? ''))).toBe(true);
  });
});

describe('serialise', () => {
  it('emits a header row and one line per record in CSV', async () => {
    const rows = await generateRows(['id', 'fullName'], 3, 's', 'en');
    const lines = serialise(rows, 'csv').split('\n');
    expect(lines[0]).toBe('id,full_name');
    expect(lines).toHaveLength(4);
  });

  it('quotes CSV cells containing commas or quotes', () => {
    const out = serialise([{ a: 'x,y', b: 'he said "hi"' }], 'csv');
    expect(out).toContain('"x,y"');
    expect(out).toContain('"he said ""hi"""');
  });

  it('escapes single quotes in SQL and leaves numbers unquoted', () => {
    const out = serialise([{ id: '1', name: "O'Brien", flag: 'true' }], 'sql');
    expect(out).toContain("'O''Brien'");
    expect(out).toMatch(/VALUES \(1, /);
    expect(out).toContain('TRUE');
  });

  it('produces parseable JSON', async () => {
    const rows = await generateRows(['id', 'email'], 4, 's', 'en');
    expect(JSON.parse(serialise(rows, 'json'))).toEqual(rows);
  });

  it('returns empty string for no rows', () => {
    expect(serialise([], 'csv')).toBe('');
    expect(serialise([], 'json')).toBe('');
  });
});

function luhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function ibanValid(iban: string): boolean {
  const cleaned = iban.replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]+$/.test(cleaned)) return false;
  // Move the first four characters to the end, map letters to numbers, mod 97.
  const rearranged = cleaned.slice(4) + cleaned.slice(0, 4);
  const numeric = [...rearranged]
    .map((c) => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c))
    .join('');
  let remainder = 0;
  for (const ch of numeric) remainder = (remainder * 10 + Number(ch)) % 97;
  return remainder === 1;
}
