import { describe, it, expect, vi } from 'vitest';
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
    // Column names are the real ones, since the SQL kind now comes from the
    // field metadata rather than from what the value happens to look like.
    const out = serialise([{ id: '1', full_name: "O'Brien", is_active: 'true' }], 'sql');
    expect(out).toContain("'O''Brien'");
    expect(out).toMatch(/VALUES \(1, /);
    expect(out).toContain('TRUE');
  });

  /**
   * Regression: numeric-looking strings were emitted unquoted, so a postcode with
   * a leading zero lost it and a 16-digit card number overflowed INT.
   */
  describe('SQL types come from the field, not the value', () => {
    it('quotes identifiers that merely look numeric', () => {
      const out = serialise(
        [{ postcode: '01234', phone: '07700900123', card_number: '4111111111111111' }],
        'sql',
      );
      expect(out).toContain("'01234'");
      expect(out).toContain("'07700900123'");
      expect(out).toContain("'4111111111111111'");
      expect(out).not.toMatch(/\(01234|, 07700900123|, 4111111111111111/);
    });

    it('leaves genuinely numeric columns bare', () => {
      const out = serialise([{ id: '7', price: '12.50' }], 'sql');
      expect(out).toMatch(/VALUES \(7, 12\.50\)/);
    });

    it('writes booleans as SQL keywords', () => {
      expect(serialise([{ is_active: 'true' }], 'sql')).toContain('TRUE');
      expect(serialise([{ is_active: 'false' }], 'sql')).toContain('FALSE');
    });

    it('quotes a date, which is not a number', () => {
      const out = serialise([{ created_at: '2025-01-01T00:00:00.000Z' }], 'sql');
      expect(out).toContain("'2025-01-01T00:00:00.000Z'");
    });

    it('quotes an unknown column rather than guessing', () => {
      expect(serialise([{ mystery: '123' }], 'sql')).toContain("'123'");
    });

    it('never emits a bare non-number for a numeric column', () => {
      // Defensive: a numeric column carrying junk must still produce valid SQL.
      expect(serialise([{ id: 'not-a-number' }], 'sql')).toContain("'not-a-number'");
    });

    it('round-trips real generated rows into quoted-or-bare correctly', async () => {
      const rows = await generateRows(['id', 'postcode', 'price', 'bool', 'creditCard'], 1, 's', 'en');
      const out = serialise(rows, 'sql');
      expect(out).toMatch(/VALUES \(1, '/);
      expect(out).toMatch(/(TRUE|FALSE)/);
    });
  });

  /**
   * Regression: faker.date.past measured its offset back from the current time,
   * so seeding controlled the offset but not the result — the same seed produced
   * different dates on different days, contradicting "seeded and reproducible".
   */
  describe('seeded dates are reproducible', () => {
    it('does not depend on the wall clock', async () => {
      vi.useFakeTimers();
      try {
        vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
        const january = await generateRows(['date'], 3, 'fixed', 'en');
        vi.setSystemTime(new Date('2026-06-01T00:00:00Z'));
        const june = await generateRows(['date'], 3, 'fixed', 'en');
        expect(january).toEqual(june);
      } finally {
        vi.useRealTimers();
      }
    });

    it('still differs between seeds', async () => {
      const a = await generateRows(['date'], 3, 'seed-a', 'en');
      const b = await generateRows(['date'], 3, 'seed-b', 'en');
      expect(a).not.toEqual(b);
    });

    it('produces valid ISO timestamps', async () => {
      for (const row of await generateRows(['date'], 5, 's', 'en')) {
        expect(Number.isNaN(Date.parse(row['created_at']!))).toBe(false);
      }
    });
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
