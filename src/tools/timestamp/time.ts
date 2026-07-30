import { DateTime } from 'luxon';

/**
 * Timestamp parsing. The hard part is not conversion, it is guessing what the
 * user pasted: seconds and milliseconds are both "just a number", and getting
 * it wrong silently puts you in 1970 or the year 55000.
 */

export type Unit = 'seconds' | 'milliseconds';

export interface Parsed {
  dt: DateTime;
  /** How the input was interpreted, so the UI can say so rather than guess silently. */
  interpretation: string;
  error?: undefined;
}

export interface ParseError {
  dt?: undefined;
  interpretation?: undefined;
  error: string;
}

/**
 * Epoch values are ambiguous. A 10-digit number is almost certainly seconds
 * (year ~2001-2286) and a 13-digit one milliseconds; anything else we state
 * plainly rather than pretending to know.
 */
export function guessUnit(digits: number): Unit {
  return digits >= 12 ? 'milliseconds' : 'seconds';
}

export function parseInput(raw: string, zone: string): Parsed | ParseError {
  const text = raw.trim();
  if (!text) return { error: 'Enter a timestamp or date.' };

  // Pure integer (optionally negative) → epoch.
  if (/^-?\d+$/.test(text)) {
    const digits = text.replace('-', '').length;
    const unit = guessUnit(digits);
    const n = Number(text);
    if (!Number.isSafeInteger(n)) return { error: 'That number is too large to be a timestamp.' };

    const dt =
      unit === 'seconds'
        ? DateTime.fromSeconds(n, { zone })
        : DateTime.fromMillis(n, { zone });

    if (!dt.isValid) return { error: dt.invalidReason ?? 'Not a valid timestamp.' };
    return {
      dt,
      interpretation: `Read as Unix ${unit} (${digits} digits).`,
    };
  }

  // ISO 8601 first, then a couple of common non-ISO shapes.
  const iso = DateTime.fromISO(text, { zone });
  if (iso.isValid) return { dt: iso, interpretation: 'Read as ISO 8601.' };

  const http = DateTime.fromHTTP(text, { zone });
  if (http.isValid) return { dt: http, interpretation: 'Read as an HTTP date header.' };

  const sql = DateTime.fromSQL(text, { zone });
  if (sql.isValid) return { dt: sql, interpretation: 'Read as a SQL datetime.' };

  return { error: 'Not a recognised timestamp. Try Unix epoch, ISO 8601, SQL or an HTTP date.' };
}

export interface Row {
  label: string;
  value: string;
}

export function formatAll(dt: DateTime, zone: string): Row[] {
  const local = dt.setZone(zone);
  return [
    { label: 'Unix seconds', value: String(Math.floor(dt.toSeconds())) },
    { label: 'Unix milliseconds', value: String(dt.toMillis()) },
    { label: 'ISO 8601', value: local.toISO() ?? '—' },
    { label: 'ISO 8601 (UTC)', value: dt.toUTC().toISO() ?? '—' },
    { label: 'RFC 2822', value: local.toRFC2822() ?? '—' },
    { label: 'HTTP header', value: dt.toHTTP() ?? '—' },
    { label: 'SQL', value: local.toSQL() ?? '—' },
    { label: 'Human', value: local.toLocaleString(DateTime.DATETIME_FULL_WITH_SECONDS) },
    { label: 'Relative', value: local.toRelative() ?? '—' },
    { label: 'Day of year', value: String(local.ordinal) },
    { label: 'ISO week', value: `${local.weekYear}-W${String(local.weekNumber).padStart(2, '0')}` },
  ];
}

/** Common zones first, then everything the runtime knows about. */
export function zoneList(): string[] {
  const common = ['UTC', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo'];
  let all: string[] = [];
  try {
    all = Intl.supportedValuesOf('timeZone');
  } catch {
    // Older engines lack supportedValuesOf; the common list still works.
  }
  return [...common, ...all.filter((z) => !common.includes(z))];
}
