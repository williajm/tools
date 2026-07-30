import { make, type Expression } from 'covertable';

/**
 * Pairwise / N-wise test matrix generation.
 *
 * The covering-array generation itself is covertable's job (Apache-2.0, see
 * THIRD-PARTY-NOTICES). What lives here is the parsing of a compact text format
 * into its model, and the exhaustive coverage verification — which is cheap for
 * this problem and worth doing, since a matrix that silently misses pairs is
 * worse than no matrix at all.
 */

export interface Parameter {
  name: string;
  values: string[];
}

export interface Exclusion {
  /** All of these must not hold simultaneously. */
  terms: Array<{ name: string; value: string }>;
  raw: string;
}

export interface ParseResult {
  parameters: Parameter[];
  exclusions: Exclusion[];
  errors: string[];
}

/**
 * Parameters, one per line:  `OS: Windows, macOS, Linux`
 * Values containing a comma can be quoted:  `Sep: ",", ";"`
 */
export function parseParameters(text: string): { parameters: Parameter[]; errors: string[] } {
  const parameters: Parameter[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();

  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const colon = trimmed.indexOf(':');
    if (colon === -1) {
      errors.push(`Line ${index + 1}: expected "Name: value, value, …".`);
      return;
    }

    const name = trimmed.slice(0, colon).trim();
    if (!name) {
      errors.push(`Line ${index + 1}: parameter name is empty.`);
      return;
    }
    if (seen.has(name)) {
      errors.push(`Line ${index + 1}: duplicate parameter "${name}".`);
      return;
    }

    const values = splitValues(trimmed.slice(colon + 1));
    if (values.length === 0) {
      errors.push(`Line ${index + 1}: "${name}" has no values.`);
      return;
    }
    if (new Set(values).size !== values.length) {
      errors.push(`Line ${index + 1}: "${name}" has duplicate values.`);
      return;
    }
    if (values.length === 1) {
      errors.push(
        `Line ${index + 1}: "${name}" has only one value, so it cannot vary. Remove it or add another.`,
      );
      return;
    }

    seen.add(name);
    parameters.push({ name, values });
  });

  return { parameters, errors };
}

function splitValues(text: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;

  for (const ch of text) {
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === ',') {
      out.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current.trim());
  return out.filter((v) => v !== '');
}

/**
 * Exclusions, one per line:  `Browser=Safari, OS=Windows`
 * meaning that combination must never appear together.
 */
export function parseExclusions(text: string, parameters: Parameter[]): { exclusions: Exclusion[]; errors: string[] } {
  const exclusions: Exclusion[] = [];
  const errors: string[] = [];
  const byName = new Map(parameters.map((p) => [p.name, p]));

  text.split('\n').forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const terms: Exclusion['terms'] = [];
    let bad = false;

    for (const part of splitValues(trimmed)) {
      const eq = part.indexOf('=');
      if (eq === -1) {
        errors.push(`Exclusion ${index + 1}: "${part}" is not of the form Name=Value.`);
        bad = true;
        continue;
      }
      const name = part.slice(0, eq).trim();
      const value = part.slice(eq + 1).trim();
      const param = byName.get(name);
      if (!param) {
        errors.push(`Exclusion ${index + 1}: unknown parameter "${name}".`);
        bad = true;
        continue;
      }
      if (!param.values.includes(value)) {
        errors.push(`Exclusion ${index + 1}: "${name}" has no value "${value}".`);
        bad = true;
        continue;
      }
      terms.push({ name, value });
    }

    if (bad) return;
    if (terms.length < 2) {
      errors.push(
        `Exclusion ${index + 1}: needs at least two terms — a single Name=Value would remove that value entirely.`,
      );
      return;
    }
    exclusions.push({ terms, raw: trimmed });
  });

  return { exclusions, errors };
}

export function parse(paramText: string, exclusionText: string): ParseResult {
  const { parameters, errors } = parseParameters(paramText);
  const { exclusions, errors: exclusionErrors } = parseExclusions(exclusionText, parameters);
  return { parameters, exclusions, errors: [...errors, ...exclusionErrors] };
}

/** Maps our exclusions onto covertable's declarative constraint trees. */
export function toConstraints(exclusions: Exclusion[]): Expression[] {
  return exclusions.map(
    (exclusion): Expression => ({
      operator: 'not',
      condition: {
        operator: 'and',
        conditions: exclusion.terms.map((term) => ({
          operator: 'eq' as const,
          left: term.name,
          value: term.value,
        })),
      },
    }),
  );
}

export type Row = Record<string, string>;

export interface Coverage {
  /** Tuples reachable given the exclusions. */
  total: number;
  covered: number;
  /** Tuples excluded by constraints, so legitimately absent. */
  excluded: number;
  missing: Array<[string, string, string, string]>;
}

export interface GenerateResult {
  rows: Row[];
  coverage: Coverage;
  /** Largest |Vi| × |Vj| — no covering array can have fewer rows than this. */
  lowerBound: number;
  error?: string;
}

function violatesAny(row: Row, exclusions: Exclusion[]): boolean {
  return exclusions.some((e) => e.terms.every((t) => row[t.name] === t.value));
}

/**
 * Exhaustively verifies pair coverage.
 *
 * Cheap for realistic inputs (O(rows × params²)) and a total oracle, so there is
 * no reason to trust the generator's output blindly. Any pair that a constraint
 * makes unreachable is reported as excluded rather than missing.
 */
export function verifyCoverage(
  parameters: Parameter[],
  rows: Row[],
  exclusions: Exclusion[],
): Coverage {
  let total = 0;
  let covered = 0;
  let excluded = 0;
  const missing: Coverage['missing'] = [];

  for (let i = 0; i < parameters.length; i++) {
    for (let j = i + 1; j < parameters.length; j++) {
      const a = parameters[i]!;
      const b = parameters[j]!;
      for (const va of a.values) {
        for (const vb of b.values) {
          // A pair forbidden by an exclusion can never appear, so it is not a gap.
          if (violatesAny({ [a.name]: va, [b.name]: vb }, exclusions)) {
            excluded++;
            continue;
          }
          total++;
          const found = rows.some((r) => r[a.name] === va && r[b.name] === vb);
          if (found) covered++;
          else missing.push([a.name, va, b.name, vb]);
        }
      }
    }
  }

  return { total, covered, excluded, missing };
}

export function lowerBoundRows(parameters: Parameter[]): number {
  let bound = 0;
  for (let i = 0; i < parameters.length; i++) {
    for (let j = i + 1; j < parameters.length; j++) {
      bound = Math.max(bound, parameters[i]!.values.length * parameters[j]!.values.length);
    }
  }
  return bound;
}

export function generateMatrix(
  parameters: Parameter[],
  exclusions: Exclusion[],
  strength = 2,
): GenerateResult {
  const empty: GenerateResult = {
    rows: [],
    coverage: { total: 0, covered: 0, excluded: 0, missing: [] },
    lowerBound: 0,
  };

  if (parameters.length < 2) {
    return { ...empty, error: 'Add at least two parameters.' };
  }
  if (strength > parameters.length) {
    return { ...empty, error: `Strength ${strength} needs at least ${strength} parameters.` };
  }

  const factors: Record<string, string[]> = {};
  for (const p of parameters) factors[p.name] = p.values;

  try {
    const rows = make(factors, {
      strength,
      constraints: toConstraints(exclusions),
    }) as Row[];

    return {
      rows,
      coverage: verifyCoverage(parameters, rows, exclusions),
      lowerBound: lowerBoundRows(parameters),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...empty,
      lowerBound: lowerBoundRows(parameters),
      error: `Could not build a matrix: ${message}. Contradictory exclusions are the usual cause.`,
    };
  }
}

// --- export ------------------------------------------------------------------

export type ExportFormat = 'csv' | 'json' | 'markdown';

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function exportMatrix(parameters: Parameter[], rows: Row[], format: ExportFormat): string {
  if (rows.length === 0) return '';
  const columns = parameters.map((p) => p.name);

  if (format === 'json') return JSON.stringify(rows, null, 2);

  if (format === 'markdown') {
    return [
      `| # | ${columns.join(' | ')} |`,
      `| --- | ${columns.map(() => '---').join(' | ')} |`,
      ...rows.map((r, i) => `| ${i + 1} | ${columns.map((c) => r[c] ?? '').join(' | ')} |`),
    ].join('\n');
  }

  return [
    columns.map(csvCell).join(','),
    ...rows.map((r) => columns.map((c) => csvCell(r[c] ?? '')).join(',')),
  ].join('\n');
}
