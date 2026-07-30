/**
 * Entity fixtures via faker, loaded on demand.
 *
 * faker is large, so it is dynamically imported only when the user switches to
 * this mode — the placeholder-text modes must not pay for it.
 */

export type FieldId =
  | 'id'
  | 'uuid'
  | 'firstName'
  | 'lastName'
  | 'fullName'
  | 'email'
  | 'username'
  | 'phone'
  | 'company'
  | 'jobTitle'
  | 'street'
  | 'city'
  | 'postcode'
  | 'country'
  | 'iban'
  | 'creditCard'
  | 'date'
  | 'bool'
  | 'price'
  | 'url';

export interface FieldDef {
  id: FieldId;
  label: string;
  note?: string;
  /**
   * How this column should be written in SQL. Declared per field rather than
   * guessed from the value: inferring "numeric" from a digits-only string turned
   * postcodes, phone numbers and card numbers into SQL numbers, dropping leading
   * zeroes and overflowing INT on a 16-digit card. Defaults to text, which is the
   * safe direction — a quoted number still inserts.
   */
  sql?: 'number' | 'boolean';
}

export const FIELDS: readonly FieldDef[] = [
  { id: 'id', label: 'id (sequential)', sql: 'number' },
  { id: 'uuid', label: 'uuid' },
  { id: 'firstName', label: 'first_name' },
  { id: 'lastName', label: 'last_name' },
  { id: 'fullName', label: 'full_name' },
  { id: 'email', label: 'email' },
  { id: 'username', label: 'username' },
  { id: 'phone', label: 'phone' },
  { id: 'company', label: 'company' },
  { id: 'jobTitle', label: 'job_title' },
  { id: 'street', label: 'street' },
  { id: 'city', label: 'city' },
  { id: 'postcode', label: 'postcode' },
  { id: 'country', label: 'country' },
  { id: 'iban', label: 'iban', note: 'Checksum-valid' },
  { id: 'creditCard', label: 'card_number', note: 'Luhn-valid test number' },
  { id: 'date', label: 'created_at' },
  { id: 'bool', label: 'is_active', sql: 'boolean' },
  { id: 'price', label: 'price', sql: 'number' },
  { id: 'url', label: 'url' },
];

export const LOCALES = [
  { id: 'en', label: 'English' },
  { id: 'en_GB', label: 'English (UK)' },
  { id: 'de', label: 'German' },
  { id: 'fr', label: 'French' },
  { id: 'es', label: 'Spanish' },
  { id: 'ja', label: 'Japanese' },
  { id: 'ar', label: 'Arabic' },
  { id: 'zh_CN', label: 'Chinese' },
] as const;

export type LocaleId = (typeof LOCALES)[number]['id'];

/**
 * Reference point the `date` field measures back from.
 *
 * Any constant would do; what matters is that it is not `Date.now()`. Seeding
 * controls faker's random offset but not its reference date, so without this the
 * same seed produced different timestamps on different days.
 */
const SEED_EPOCH = new Date('2025-01-01T00:00:00.000Z');

export type Row = Record<string, string>;

export async function generateRows(
  fields: FieldId[],
  count: number,
  seed: string,
  locale: LocaleId,
): Promise<Row[]> {
  const mod = await import('@faker-js/faker');
  const allLocales = mod.allLocales as Record<string, unknown>;
  const localeDef = allLocales[locale] ?? mod.en;

  const faker = new mod.Faker({
    // Fall back to `en` so a sparse locale never yields undefined values.
    locale: [localeDef as never, mod.en],
  });

  // Numeric seed keeps output reproducible for a given text seed.
  let h = 0x811c9dc5;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  faker.seed(h >>> 0);

  const safeCount = Math.max(1, Math.min(1000, Math.floor(count) || 1));
  const rows: Row[] = [];

  for (let i = 0; i < safeCount; i++) {
    const row: Row = {};
    for (const field of fields) {
      row[labelOf(field)] = value(faker, field, i);
    }
    rows.push(row);
  }
  return rows;
}

function labelOf(field: FieldId): string {
  return FIELDS.find((f) => f.id === field)?.label.replace(/ \(.*\)$/, '') ?? field;
}

function value(faker: import('@faker-js/faker').Faker, field: FieldId, index: number): string {
  switch (field) {
    case 'id': return String(index + 1);
    case 'uuid': return faker.string.uuid();
    case 'firstName': return faker.person.firstName();
    case 'lastName': return faker.person.lastName();
    case 'fullName': return faker.person.fullName();
    case 'email': return faker.internet.email();
    case 'username': return faker.internet.username();
    case 'phone': return faker.phone.number();
    case 'company': return faker.company.name();
    case 'jobTitle': return faker.person.jobTitle();
    case 'street': return faker.location.streetAddress();
    case 'city': return faker.location.city();
    case 'postcode': return faker.location.zipCode();
    case 'country': return faker.location.country();
    case 'iban': return faker.finance.iban();
    case 'creditCard': return faker.finance.creditCardNumber();
    // A fixed reference date, so the same seed gives the same dates. Without it
    // faker measures the offset back from "now", making the output depend on the
    // wall clock — which contradicts the tool's own promise of reproducibility.
    case 'date': return faker.date.past({ years: 3, refDate: SEED_EPOCH }).toISOString();
    case 'bool': return String(faker.datatype.boolean());
    case 'price': return faker.commerce.price();
    case 'url': return faker.internet.url();
  }
}

// --- serialisation -----------------------------------------------------------

export type Export = 'table' | 'json' | 'csv' | 'sql';

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * SQL kind per column name.
 *
 * Keyed by `labelOf`, not `label`: the row keys have the parenthetical stripped,
 * so "id (sequential)" becomes the column "id".
 */
const SQL_KIND = new Map(FIELDS.map((f) => [labelOf(f.id), f.sql]));

function sqlLiteral(value: string, kind: FieldDef['sql']): string {
  if (kind === 'boolean') return value === 'true' ? 'TRUE' : 'FALSE';
  // Still checked, so a column declared numeric cannot emit a bare non-number.
  if (kind === 'number' && /^-?\d+(\.\d+)?$/.test(value)) return value;
  return `'${value.replace(/'/g, "''")}'`;
}

export function serialise(rows: Row[], format: Export, table = 'fixtures'): string {
  if (rows.length === 0) return '';
  const columns = Object.keys(rows[0]!);

  switch (format) {
    case 'json':
      return JSON.stringify(rows, null, 2);
    case 'csv':
      return [
        columns.map(csvCell).join(','),
        ...rows.map((r) => columns.map((c) => csvCell(r[c] ?? '')).join(',')),
      ].join('\n');
    case 'sql':
      return rows
        .map(
          (r) =>
            `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
              .map((c) => sqlLiteral(r[c] ?? '', SQL_KIND.get(c)))
              .join(', ')});`,
        )
        .join('\n');
    case 'table':
    default:
      return [columns.join('\t'), ...rows.map((r) => columns.map((c) => r[c] ?? '').join('\t'))].join('\n');
  }
}
