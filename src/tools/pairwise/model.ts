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

/** One combination under test: `strength` parameters each pinned to a value. */
export type Tuple = ReadonlyArray<{ name: string; value: string }>;

export interface Coverage {
  /** The strength the tuples were enumerated at, so a reader knows what was checked. */
  strength: number;
  /** Tuples reachable given the exclusions. */
  total: number;
  covered: number;
  /** Tuples excluded by constraints, so legitimately absent. */
  excluded: number;
  missing: Tuple[];
  /**
   * Set when the check was too large to run, so nothing here was verified. The
   * caller must say so rather than presenting zeroes as a clean result.
   */
  skipped?: string;
}

export interface GenerateResult {
  rows: Row[];
  coverage: Coverage;
  /** Largest product of any `strength` domains — no covering array can be smaller. */
  lowerBound: number;
  error?: string;
}

function violatesAny(row: Row, exclusions: Exclusion[]): boolean {
  return exclusions.some((e) => e.terms.every((t) => row[t.name] === t.value));
}

/**
 * Ceiling on backtracking steps per reachability question.
 *
 * Generous: the search below only ever revisits a parameter when an exclusion
 * actually bites, so realistic inputs finish in a handful of steps. The budget
 * exists so a pathological constraint set cannot hang the tab.
 */
const REACHABILITY_BUDGET = 100_000;

/**
 * Whether some complete assignment contains `tuple` and violates no exclusion.
 *
 * Checking the tuple against the exclusions alone is not enough. Exclusions
 * combine: with `A=1, C=1` and `A=1, C=2` forbidden and C having only those two
 * values, `A=1` cannot appear in any row at all, so every tuple containing it is
 * unreachable even though no single exclusion names it. Reporting those as gaps
 * blames the generator for constraints the user wrote.
 *
 * A depth-first search over the unpinned parameters settles it. On exhausting the
 * budget it answers "reachable", which costs a spurious gap in the report rather
 * than false confidence that nothing is missing.
 */
export function isReachable(
  parameters: Parameter[],
  tuple: Tuple,
  exclusions: Exclusion[],
): boolean {
  const pinned: Row = {};
  for (const { name, value } of tuple) pinned[name] = value;

  // A tuple that already breaks an exclusion outright needs no search.
  if (violatesAny(pinned, exclusions)) return false;

  const free = parameters.filter((p) => !(p.name in pinned));
  let steps = 0;

  const search = (index: number, assignment: Row): boolean => {
    if (index === free.length) return true;
    const parameter = free[index]!;
    for (const value of parameter.values) {
      if (++steps > REACHABILITY_BUDGET) return true;
      const next = { ...assignment, [parameter.name]: value };
      if (violatesAny(next, exclusions)) continue;
      if (search(index + 1, next)) return true;
    }
    return false;
  };

  return search(0, pinned);
}

/**
 * Ceiling on tuples enumerated for one coverage check.
 *
 * Coverage grows as C(params, strength) × values^strength, so it is the strength
 * control rather than the input size that makes this explode: four parameters of
 * a hundred values each is 100 million tuples at strength 4 against sixty
 * thousand at strength 2. Materialising the former exhausts memory, and this all
 * runs synchronously while rendering.
 *
 * A million tuples is a few hundred milliseconds and comfortably beyond any real
 * test matrix, so the cap only ever bites on input that could not have been
 * verified anyway.
 */
export const MAX_TUPLES = 1_000_000;

/** C(n, k), computed rather than enumerated — the enumeration is what we are sizing. */
function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let i = 1; i <= k; i++) result = (result * (n - k + i)) / i;
  return Math.round(result);
}

/**
 * Tuples a coverage check at this strength would enumerate, or `Infinity` when
 * that is past the budget.
 *
 * Counted exactly where counting is itself cheap. Summing the per-combination
 * products means walking the combinations, so the number of combinations is
 * checked first — otherwise sizing the job costs as much as the job.
 */
export function tupleCount(parameters: Parameter[], strength: number): number {
  const width = Math.min(strength, parameters.length);
  if (width < 1) return 0;

  if (binomial(parameters.length, width) > MAX_TUPLES) return Infinity;

  let total = 0;
  for (const indices of combinations(parameters.length, width)) {
    total += indices.reduce((product, i) => product * parameters[i]!.values.length, 1);
    if (total > MAX_TUPLES) return Infinity;
  }
  return total;
}

/** Every combination of `size` distinct parameters, as index lists. */
function combinations(count: number, size: number): number[][] {
  const out: number[][] = [];
  const build = (start: number, chosen: number[]) => {
    if (chosen.length === size) {
      out.push([...chosen]);
      return;
    }
    for (let i = start; i < count; i++) {
      chosen.push(i);
      build(i + 1, chosen);
      chosen.pop();
    }
  };
  build(0, []);
  return out;
}

/** Cartesian product of the given parameters' value lists. */
function valueTuples(chosen: Parameter[]): Tuple[] {
  let out: Tuple[] = [[]];
  for (const parameter of chosen) {
    const next: Tuple[] = [];
    for (const partial of out) {
      for (const value of parameter.values) {
        next.push([...partial, { name: parameter.name, value }]);
      }
    }
    out = next;
  }
  return out;
}

/**
 * Exhaustively verifies coverage at the requested strength.
 *
 * A total oracle, so there is no reason to trust the generator's output blindly —
 * and it verifies what the caller actually asked for. It used to enumerate pairs
 * regardless of strength, which meant a 3-way matrix was reported as fully
 * covered on the strength of its pairs alone.
 *
 * Any tuple that the constraints make unreachable is reported as excluded rather
 * than missing.
 */
export function verifyCoverage(
  parameters: Parameter[],
  rows: Row[],
  exclusions: Exclusion[],
  strength = 2,
): Coverage {
  let total = 0;
  let covered = 0;
  let excluded = 0;
  const missing: Tuple[] = [];

  const width = Math.min(strength, parameters.length);

  if (tupleCount(parameters, width) > MAX_TUPLES) {
    return {
      strength: width,
      total: 0,
      covered: 0,
      excluded: 0,
      missing: [],
      skipped:
        `Verifying ${width}-way coverage here would mean enumerating more than ` +
        `${MAX_TUPLES.toLocaleString('en-GB')} combinations, which would exhaust memory. ` +
        'Reduce the strength, or the number of values per parameter.',
    };
  }

  for (const indices of combinations(parameters.length, width)) {
    const chosen = indices.map((i) => parameters[i]!);
    for (const tuple of valueTuples(chosen)) {
      if (!isReachable(parameters, tuple, exclusions)) {
        excluded++;
        continue;
      }
      total++;
      const found = rows.some((row) => tuple.every((t) => row[t.name] === t.value));
      if (found) covered++;
      else missing.push(tuple);
    }
  }

  return { strength: width, total, covered, excluded, missing };
}

/**
 * No covering array can have fewer rows than the largest number of combinations
 * one parameter group forces it to cover.
 *
 * The product of the `strength` largest domains is only that number when every
 * combination is reachable. With exclusions it overstates: two binary factors
 * with one pair forbidden have three reachable pairs and can be covered in three
 * rows, but the unconstrained product says four — so the UI reported a minimum
 * the matrix had already beaten. Count reachable combinations per group instead
 * and take the largest.
 */
export function lowerBoundRows(
  parameters: Parameter[],
  strength = 2,
  exclusions: Exclusion[] = [],
): number {
  const width = Math.min(strength, parameters.length);
  if (width < 2) return 0;

  const sizes = parameters.map((p) => p.values.length).sort((a, b) => b - a);
  const unconstrained = sizes.slice(0, width).reduce((product, size) => product * size, 1);
  // Without exclusions every combination is reachable, so skip the work. The
  // budget check also keeps this from becoming the expensive path.
  if (exclusions.length === 0 || tupleCount(parameters, width) > MAX_TUPLES) return unconstrained;

  let bound = 0;
  for (const indices of combinations(parameters.length, width)) {
    const chosen = indices.map((i) => parameters[i]!);
    let reachable = 0;
    for (const tuple of valueTuples(chosen)) {
      if (isReachable(parameters, tuple, exclusions)) reachable++;
    }
    bound = Math.max(bound, reachable);
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
    coverage: { strength, total: 0, covered: 0, excluded: 0, missing: [] },
    lowerBound: 0,
  };

  if (parameters.length < 2) {
    return { ...empty, error: 'Add at least two parameters.' };
  }
  if (strength > parameters.length) {
    return { ...empty, error: `Strength ${strength} needs at least ${strength} parameters.` };
  }

  // Checked before generating, not just before verifying: the generator has to
  // cover every one of these combinations, so a job too large to check is also
  // too large to build, and both run synchronously during render.
  const tuples = tupleCount(parameters, strength);
  if (tuples > MAX_TUPLES) {
    return {
      ...empty,
      error:
        `This needs more than ${MAX_TUPLES.toLocaleString('en-GB')} ${strength}-way combinations, ` +
        'which would exhaust memory before producing anything. Reduce the strength, the number of ' +
        'parameters, or the values per parameter.',
    };
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
      coverage: verifyCoverage(parameters, rows, exclusions, strength),
      lowerBound: lowerBoundRows(parameters, strength, exclusions),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      ...empty,
      lowerBound: lowerBoundRows(parameters, strength, exclusions),
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
