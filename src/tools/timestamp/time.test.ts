import { describe, it, expect } from 'vitest';
import { formatAll, guessUnit, parseInput } from './time.ts';

describe('guessUnit', () => {
  it('treats 10-digit values as seconds and 13-digit as milliseconds', () => {
    expect(guessUnit(10)).toBe('seconds');
    expect(guessUnit(13)).toBe('milliseconds');
  });

  it('puts the boundary at 12 digits', () => {
    // 11-digit seconds reaches year 5138; 12-digit ms is only 2001. Below 12
    // digits seconds is the safer read.
    expect(guessUnit(11)).toBe('seconds');
    expect(guessUnit(12)).toBe('milliseconds');
  });
});

describe('parseInput', () => {
  it('reads a 10-digit epoch as seconds', () => {
    const r = parseInput('1700000000', 'UTC');
    expect(r.error).toBeUndefined();
    expect(r.dt!.toUTC().toISO()).toBe('2023-11-14T22:13:20.000Z');
    expect(r.interpretation).toMatch(/seconds/);
  });

  it('reads a 13-digit epoch as milliseconds', () => {
    const r = parseInput('1700000000000', 'UTC');
    expect(r.dt!.toUTC().toISO()).toBe('2023-11-14T22:13:20.000Z');
    expect(r.interpretation).toMatch(/milliseconds/);
  });

  it('handles the epoch itself and negative timestamps', () => {
    expect(parseInput('0', 'UTC').dt!.toUTC().toISO()).toBe('1970-01-01T00:00:00.000Z');
    expect(parseInput('-86400', 'UTC').dt!.toUTC().toISO()).toBe('1969-12-31T00:00:00.000Z');
  });

  it('parses ISO 8601, SQL and HTTP dates', () => {
    expect(parseInput('2023-11-14T22:13:20Z', 'UTC').dt!.toMillis()).toBe(1700000000000);
    expect(parseInput('2023-11-14 22:13:20', 'UTC').dt!.toMillis()).toBe(1700000000000);
    expect(parseInput('Tue, 14 Nov 2023 22:13:20 GMT', 'UTC').dt!.toMillis()).toBe(1700000000000);
  });

  it('applies the requested zone to zoneless input', () => {
    // Same wall-clock string, different zones, so different instants.
    const utc = parseInput('2023-11-14T12:00:00', 'UTC').dt!;
    const tokyo = parseInput('2023-11-14T12:00:00', 'Asia/Tokyo').dt!;
    expect(utc.toMillis() - tokyo.toMillis()).toBe(9 * 60 * 60 * 1000);
  });

  it('reports unusable input rather than defaulting to now', () => {
    expect(parseInput('', 'UTC').error).toBeTruthy();
    expect(parseInput('not a date', 'UTC').error).toBeTruthy();
    expect(parseInput('99999999999999999999', 'UTC').error).toMatch(/too large/i);
  });
});

describe('formatAll', () => {
  it('renders every row without throwing', () => {
    const { dt } = parseInput('1700000000', 'UTC') as { dt: NonNullable<ReturnType<typeof parseInput>['dt']> };
    const rows = formatAll(dt, 'UTC');
    expect(rows.length).toBeGreaterThan(8);
    for (const row of rows) {
      expect(row.value, row.label).not.toBe('');
    }
  });

  it('round-trips seconds and milliseconds', () => {
    const { dt } = parseInput('1700000000', 'UTC') as { dt: NonNullable<ReturnType<typeof parseInput>['dt']> };
    const rows = formatAll(dt, 'UTC');
    expect(rows.find((r) => r.label === 'Unix seconds')!.value).toBe('1700000000');
    expect(rows.find((r) => r.label === 'Unix milliseconds')!.value).toBe('1700000000000');
  });
});
