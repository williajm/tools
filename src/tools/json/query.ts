/**
 * A small, self-contained JSONPath query engine.
 *
 * Deliberately hand-rolled with zero dependencies and no `eval`/`new Function`.
 * The pages ship `script-src 'self'` with no `'unsafe-eval'`, and the popular
 * JSONPath libraries evaluate filter predicates like `[?(@.price < 10)]` by
 * compiling them with `new Function` (jsonpath-plus) — which throws under this
 * CSP, the same way the compiling schema validator did before it was replaced.
 * Interpreting the filter expression instead makes the tool CSP-safe by
 * construction rather than by trusting a dependency not to regress.
 *
 * Supported subset (documented in the UI):
 *   $                 root
 *   .name  ['name']   child by name  (bracket form allows any characters)
 *   .*     [*]        wildcard: every child
 *   ..name  ..*  ..[] recursive descent
 *   [0]  [-1]         array index, negative counts from the end
 *   [start:end:step]  array slice (Python semantics, negatives allowed)
 *   [0,2]  ['a','b']  union of indices and/or names
 *   [?(<expr>)]       filter: keep children where <expr> is true
 *
 * Filter expressions:
 *   comparisons  == != < <= > >=
 *   existence    @.field            (true when the path resolves to a value)
 *   logical      &&  ||  !  ( )
 *   operands     @ / @.a / @['a'] / @[0] / $-rooted paths, and literals
 *                (numbers, 'strings', "strings", true, false, null)
 */

export interface Match {
  /** Readable normalized path, e.g. `$.store.book[0].title`. */
  path: string;
  value: unknown;
}

export type QueryResult = { matches: Match[] } | { error: string };

export function isQueryError(result: QueryResult): result is { error: string } {
  return 'error' in result;
}

// --- selectors and the parsed path -------------------------------------------

type Selector =
  | { kind: 'name'; name: string }
  | { kind: 'wildcard' }
  | { kind: 'index'; index: number }
  | { kind: 'slice'; start: number | null; end: number | null; step: number | null }
  | { kind: 'union'; items: Selector[] }
  | { kind: 'filter'; expr: Expr };

interface Step {
  descendant: boolean;
  selector: Selector;
}

// --- filter expression AST ---------------------------------------------------

type Expr =
  | { t: 'or'; l: Expr; r: Expr }
  | { t: 'and'; l: Expr; r: Expr }
  | { t: 'not'; e: Expr }
  | { t: 'cmp'; op: '==' | '!=' | '<' | '<=' | '>' | '>='; l: Operand; r: Operand }
  | { t: 'truthy'; o: Operand };

type Operand =
  | { t: 'path'; root: boolean; segs: PathSeg[] }
  | { t: 'lit'; value: unknown };

type PathSeg = { kind: 'name'; name: string } | { kind: 'index'; index: number };

class ParseError extends Error {}

// --- path parser -------------------------------------------------------------

function parsePath(input: string): Step[] {
  let i = 0;
  const n = input.length;
  const ws = () => {
    while (i < n && /\s/.test(input[i]!)) i++;
  };

  ws();
  if (input[i] !== '$') throw new ParseError("A JSONPath must start with '$'.");
  i++;

  const steps: Step[] = [];
  ws();
  while (i < n) {
    if (input[i] === '.') {
      if (input[i + 1] === '.') {
        // '..' recursive descent, followed by a name, '*', or a bracket.
        i += 2;
        if (input[i] === '[') {
          steps.push({ descendant: true, selector: parseBracket() });
        } else {
          steps.push({ descendant: true, selector: parseDotSelector() });
        }
      } else {
        i += 1;
        steps.push({ descendant: false, selector: parseDotSelector() });
      }
    } else if (input[i] === '[') {
      steps.push({ descendant: false, selector: parseBracket() });
    } else {
      throw new ParseError(`Unexpected "${input[i]}" at position ${i}.`);
    }
    ws();
  }
  return steps;

  function parseDotSelector(): Selector {
    if (input[i] === '*') {
      i++;
      return { kind: 'wildcard' };
    }
    const start = i;
    while (i < n && !'.[] \t\n\r'.includes(input[i]!)) i++;
    const name = input.slice(start, i);
    if (!name) throw new ParseError(`Expected a name after '.' at position ${start}.`);
    return { kind: 'name', name };
  }

  /** Called with input[i] === '['. Consumes through the matching ']'. */
  function parseBracket(): Selector {
    const inner = scanBracket();
    const trimmed = inner.trim();
    if (trimmed === '') throw new ParseError('Empty [] is not a valid selector.');
    if (trimmed === '*') return { kind: 'wildcard' };
    if (trimmed[0] === '?') {
      let e = trimmed.slice(1).trim();
      if (e[0] === '(' && e[e.length - 1] === ')') e = e.slice(1, -1);
      return { kind: 'filter', expr: parseFilter(e) };
    }

    const parts = splitTopLevel(inner);
    const items = parts.map(parseBracketItem);
    return items.length === 1 ? items[0]! : { kind: 'union', items };
  }

  /** Reads from input[i] === '[' to the matching ']', returning the interior. */
  function scanBracket(): string {
    // input[i] is '['
    const start = ++i;
    let depth = 1;
    let quote: string | null = null;
    while (i < n) {
      const c = input[i]!;
      if (quote) {
        if (c === '\\') i += 2;
        else {
          if (c === quote) quote = null;
          i++;
        }
        continue;
      }
      if (c === "'" || c === '"') quote = c;
      else if (c === '[') depth++;
      else if (c === ']') {
        depth--;
        if (depth === 0) {
          const inner = input.slice(start, i);
          i++; // past ']'
          return inner;
        }
      }
      i++;
    }
    throw new ParseError("Unbalanced '[' — no matching ']'.");
  }
}

/** Splits bracket interior on commas at the top level, honouring quotes. */
function splitTopLevel(s: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let j = 0; j < s.length; j++) {
    const c = s[j]!;
    if (quote) {
      if (c === '\\') j++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '[' || c === '(') depth++;
    else if (c === ']' || c === ')') depth--;
    else if (c === ',' && depth === 0) {
      parts.push(s.slice(start, j));
      start = j + 1;
    }
  }
  parts.push(s.slice(start));
  return parts;
}

function parseBracketItem(raw: string): Selector {
  const part = raw.trim();
  if (part === '') throw new ParseError('Empty selector between commas.');
  const q = part[0];
  if (q === "'" || q === '"') {
    if (part[part.length - 1] !== q) throw new ParseError(`Unterminated string ${part}.`);
    return { kind: 'name', name: unescapeString(part.slice(1, -1)) };
  }
  if (part.includes(':')) {
    const [s, e, st] = part.split(':');
    return {
      kind: 'slice',
      start: sliceNum(s),
      end: sliceNum(e),
      step: sliceNum(st),
    };
  }
  if (/^-?\d+$/.test(part)) return { kind: 'index', index: Number(part) };
  throw new ParseError(`"${part}" is not an index, slice or quoted name.`);
}

function sliceNum(s: string | undefined): number | null {
  if (s === undefined || s.trim() === '') return null;
  if (!/^-?\d+$/.test(s.trim())) throw new ParseError(`"${s}" is not a valid slice bound.`);
  return Number(s.trim());
}

function unescapeString(s: string): string {
  return s.replace(/\\(u[0-9a-fA-F]{4}|.)/g, (_, esc: string) => {
    if (esc[0] === 'u') return String.fromCharCode(parseInt(esc.slice(1), 16));
    const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '/': '/' };
    return map[esc] ?? esc;
  });
}

// --- filter expression parser (recursive descent, no eval) -------------------

type Tok =
  | { t: 'op'; v: '&&' | '||' | '!' | '==' | '!=' | '<' | '<=' | '>' | '>=' }
  | { t: 'lparen' }
  | { t: 'rparen' }
  | { t: 'at' }
  | { t: 'root' }
  | { t: 'dot' }
  | { t: 'lbracket' }
  | { t: 'rbracket' }
  | { t: 'string'; v: string }
  | { t: 'number'; v: number }
  | { t: 'name'; v: string };

function tokenizeFilter(s: string): Tok[] {
  const toks: Tok[] = [];
  let i = 0;
  const n = s.length;
  while (i < n) {
    const c = s[i]!;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    const two = s.slice(i, i + 2);
    if (two === '&&' || two === '||' || two === '==' || two === '!=' || two === '<=' || two === '>=') {
      toks.push({ t: 'op', v: two });
      i += 2;
      continue;
    }
    if (c === '<' || c === '>' || c === '!') {
      toks.push({ t: 'op', v: c });
      i++;
      continue;
    }
    if (c === '(') { toks.push({ t: 'lparen' }); i++; continue; }
    if (c === ')') { toks.push({ t: 'rparen' }); i++; continue; }
    if (c === '@') { toks.push({ t: 'at' }); i++; continue; }
    if (c === '$') { toks.push({ t: 'root' }); i++; continue; }
    if (c === '.') { toks.push({ t: 'dot' }); i++; continue; }
    if (c === '[') { toks.push({ t: 'lbracket' }); i++; continue; }
    if (c === ']') { toks.push({ t: 'rbracket' }); i++; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1;
      let out = '';
      while (j < n && s[j] !== c) {
        if (s[j] === '\\') { out += s[j]! + (s[j + 1] ?? ''); j += 2; }
        else { out += s[j]!; j++; }
      }
      if (j >= n) throw new ParseError('Unterminated string in filter.');
      toks.push({ t: 'string', v: unescapeString(out) });
      i = j + 1;
      continue;
    }
    const num = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(s.slice(i));
    if (num && (c === '-' || /\d/.test(c))) {
      toks.push({ t: 'number', v: Number(num[0]) });
      i += num[0].length;
      continue;
    }
    const name = /^[A-Za-z_][A-Za-z0-9_]*/.exec(s.slice(i));
    if (name) {
      toks.push({ t: 'name', v: name[0] });
      i += name[0].length;
      continue;
    }
    throw new ParseError(`Unexpected "${c}" in filter expression.`);
  }
  return toks;
}

function parseFilter(s: string): Expr {
  const toks = tokenizeFilter(s);
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];

  const expr = parseOr();
  if (p !== toks.length) throw new ParseError('Trailing tokens in filter expression.');
  return expr;

  function parseOr(): Expr {
    let left = parseAnd();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '||') {
      eat();
      left = { t: 'or', l: left, r: parseAnd() };
    }
    return left;
  }
  function parseAnd(): Expr {
    let left = parseNot();
    while (peek()?.t === 'op' && (peek() as { v: string }).v === '&&') {
      eat();
      left = { t: 'and', l: left, r: parseNot() };
    }
    return left;
  }
  function parseNot(): Expr {
    if (peek()?.t === 'op' && (peek() as { v: string }).v === '!') {
      eat();
      return { t: 'not', e: parseNot() };
    }
    return parseCmp();
  }
  function parseCmp(): Expr {
    // A parenthesised boolean sub-expression.
    if (peek()?.t === 'lparen') {
      const save = p;
      eat();
      const inner = parseOr();
      if (peek()?.t === 'rparen') {
        eat();
        // '(...)' may still be the left side of a comparison, though that is unusual.
        const cmp = tryCmpOp();
        if (cmp) return { t: 'cmp', op: cmp, l: exprToOperand(inner), r: parseOperand() };
        return inner;
      }
      p = save; // not a grouping; fall through to operand parsing
    }
    const left = parseOperand();
    const cmp = tryCmpOp();
    if (cmp) return { t: 'cmp', op: cmp, l: left, r: parseOperand() };
    return { t: 'truthy', o: left };
  }
  function tryCmpOp(): '==' | '!=' | '<' | '<=' | '>' | '>=' | null {
    const t = peek();
    if (t?.t === 'op' && ['==', '!=', '<', '<=', '>', '>='].includes(t.v)) {
      eat();
      return t.v as '==' | '!=' | '<' | '<=' | '>' | '>=';
    }
    return null;
  }
  function parseOperand(): Operand {
    const t = peek();
    if (!t) throw new ParseError('Expected an operand in the filter expression.');
    if (t.t === 'string') { eat(); return { t: 'lit', value: t.v }; }
    if (t.t === 'number') { eat(); return { t: 'lit', value: t.v }; }
    if (t.t === 'name') {
      eat();
      if (t.v === 'true') return { t: 'lit', value: true };
      if (t.v === 'false') return { t: 'lit', value: false };
      if (t.v === 'null') return { t: 'lit', value: null };
      throw new ParseError(`Unexpected identifier "${t.v}" — did you mean '${t.v}'?`);
    }
    if (t.t === 'at' || t.t === 'root') {
      eat();
      return { t: 'path', root: t.t === 'root', segs: parseOperandPath() };
    }
    throw new ParseError('Expected an operand in the filter expression.');
  }
  function parseOperandPath(): PathSeg[] {
    const segs: PathSeg[] = [];
    for (;;) {
      const t = peek();
      if (t?.t === 'dot') {
        eat();
        const name = eat();
        if (name?.t !== 'name') throw new ParseError("Expected a name after '.' in filter path.");
        segs.push({ kind: 'name', name: name.v });
      } else if (t?.t === 'lbracket') {
        eat();
        const inside = eat();
        if (inside?.t === 'string') segs.push({ kind: 'name', name: inside.v });
        else if (inside?.t === 'number') segs.push({ kind: 'index', index: inside.v });
        else throw new ParseError('Filter path [] takes a number or quoted name.');
        if (eat()?.t !== 'rbracket') throw new ParseError("Expected ']' in filter path.");
      } else {
        break;
      }
    }
    return segs;
  }
  // A parenthesised expression used as a comparison operand is not supported;
  // reject it clearly rather than silently mis-evaluating.
  function exprToOperand(_: Expr): Operand {
    throw new ParseError('A parenthesised group cannot be compared directly.');
  }
}

// --- evaluation --------------------------------------------------------------

const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;

function childPath(base: string, key: string | number): string {
  if (typeof key === 'number') return `${base}[${key}]`;
  if (IDENT.test(key)) return `${base}.${key}`;
  return `${base}['${key.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}']`;
}

/** Pre-order walk yielding a node and all its descendants. */
function* descendants(value: unknown, path: string): Generator<Match> {
  yield { value, path };
  if (Array.isArray(value)) {
    for (let k = 0; k < value.length; k++) yield* descendants(value[k], `${path}[${k}]`);
  } else if (isObject(value)) {
    for (const [k, v] of Object.entries(value)) yield* descendants(v, childPath(path, k));
  }
}

function normalizeIndex(index: number, len: number): number {
  return index < 0 ? len + index : index;
}

function applySlice(arr: unknown[], sel: { start: number | null; end: number | null; step: number | null }): Match[] {
  const len = arr.length;
  const step = sel.step ?? 1;
  const out: Match[] = [];
  if (step === 0) return out;

  if (step > 0) {
    const start = sel.start === null ? 0 : normalizeIndex(sel.start, len);
    const end = sel.end === null ? len : normalizeIndex(sel.end, len);
    const lower = Math.min(Math.max(start, 0), len);
    const upper = Math.min(Math.max(end, 0), len);
    for (let i = lower; i < upper; i += step) out.push({ value: arr[i], path: `$[${i}]` });
  } else {
    const start = sel.start === null ? len - 1 : normalizeIndex(sel.start, len);
    const end = sel.end === null ? -len - 1 : normalizeIndex(sel.end, len);
    const upper = Math.min(Math.max(start, -1), len - 1);
    const lower = Math.min(Math.max(end, -1), len - 1);
    for (let i = upper; i > lower; i += step) out.push({ value: arr[i], path: `$[${i}]` });
  }
  return out;
}

function applySelector(sel: Selector, node: unknown, path: string, root: unknown): Match[] {
  switch (sel.kind) {
    case 'name':
      return isObject(node) && Object.hasOwn(node, sel.name)
        ? [{ value: node[sel.name], path: childPath(path, sel.name) }]
        : [];
    case 'wildcard':
      if (Array.isArray(node)) return node.map((v, k) => ({ value: v, path: `${path}[${k}]` }));
      if (isObject(node)) return Object.entries(node).map(([k, v]) => ({ value: v, path: childPath(path, k) }));
      return [];
    case 'index': {
      if (!Array.isArray(node)) return [];
      const idx = normalizeIndex(sel.index, node.length);
      return idx >= 0 && idx < node.length ? [{ value: node[idx], path: `${path}[${idx}]` }] : [];
    }
    case 'slice':
      return Array.isArray(node)
        ? applySlice(node, sel).map((m) => ({ value: m.value, path: `${path}${m.path.slice(1)}` }))
        : [];
    case 'union': {
      const out: Match[] = [];
      for (const item of sel.items) out.push(...applySelector(item, node, path, root));
      return out;
    }
    case 'filter': {
      const children: Match[] = [];
      if (Array.isArray(node)) node.forEach((v, k) => children.push({ value: v, path: `${path}[${k}]` }));
      else if (isObject(node)) for (const [k, v] of Object.entries(node)) children.push({ value: v, path: childPath(path, k) });
      return children.filter((c) => evalExpr(sel.expr, c.value, root));
    }
  }
}

const MISSING = Symbol('missing');

function resolveOperandPath(segs: PathSeg[], at: unknown, root: unknown, useRoot: boolean): unknown | typeof MISSING {
  let cur: unknown = useRoot ? root : at;
  for (const seg of segs) {
    if (seg.kind === 'name') {
      if (!isObject(cur) || !Object.hasOwn(cur, seg.name)) return MISSING;
      cur = cur[seg.name];
    } else {
      if (!Array.isArray(cur)) return MISSING;
      const idx = normalizeIndex(seg.index, cur.length);
      if (idx < 0 || idx >= cur.length) return MISSING;
      cur = cur[idx];
    }
  }
  return cur;
}

function resolveOperand(op: Operand, at: unknown, root: unknown): unknown | typeof MISSING {
  if (op.t === 'lit') return op.value;
  return resolveOperandPath(op.segs, at, root, op.root);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((x, i) => deepEqual(x, b[i]));
  }
  if (isObject(a) && isObject(b)) {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
}

function evalExpr(expr: Expr, at: unknown, root: unknown): boolean {
  switch (expr.t) {
    case 'or':
      return evalExpr(expr.l, at, root) || evalExpr(expr.r, at, root);
    case 'and':
      return evalExpr(expr.l, at, root) && evalExpr(expr.r, at, root);
    case 'not':
      return !evalExpr(expr.e, at, root);
    case 'truthy': {
      const v = resolveOperand(expr.o, at, root);
      if (v === MISSING) return false;
      // A resolved path is an existence test; a literal uses its own truthiness.
      return expr.o.t === 'path' ? true : Boolean(v);
    }
    case 'cmp': {
      const l = resolveOperand(expr.l, at, root);
      const r = resolveOperand(expr.r, at, root);
      const lm = l === MISSING;
      const rm = r === MISSING;
      if (expr.op === '==') return lm || rm ? lm && rm : deepEqual(l, r);
      if (expr.op === '!=') return lm || rm ? !(lm && rm) : !deepEqual(l, r);
      if (lm || rm) return false;
      const bothNum = typeof l === 'number' && typeof r === 'number';
      const bothStr = typeof l === 'string' && typeof r === 'string';
      if (!bothNum && !bothStr) return false;
      const a = l as number | string;
      const b = r as number | string;
      switch (expr.op) {
        case '<': return a < b;
        case '<=': return a <= b;
        case '>': return a > b;
        case '>=': return a >= b;
      }
    }
  }
}

/** Removes matches that resolve to the same normalized path, keeping the first. */
function dedupe(matches: Match[]): Match[] {
  const seen = new Set<string>();
  const out: Match[] = [];
  for (const m of matches) {
    if (!seen.has(m.path)) {
      seen.add(m.path);
      out.push(m);
    }
  }
  return out;
}

/**
 * Runs a JSONPath expression against a parsed value.
 *
 * Returns each match with its normalized path, so the UI can show where every
 * result came from. Parse errors are returned rather than thrown, so a
 * half-typed expression reports a message instead of blanking the tool.
 */
export function query(root: unknown, path: string): QueryResult {
  if (!path.trim()) return { error: 'Enter a JSONPath expression.' };
  let steps: Step[];
  try {
    steps = parsePath(path);
  } catch (err) {
    return { error: err instanceof ParseError ? err.message : String(err) };
  }

  let nodes: Match[] = [{ value: root, path: '$' }];
  for (const step of steps) {
    const next: Match[] = [];
    for (const node of nodes) {
      if (step.descendant) {
        for (const d of descendants(node.value, node.path)) {
          next.push(...applySelector(step.selector, d.value, d.path, root));
        }
      } else {
        next.push(...applySelector(step.selector, node.value, node.path, root));
      }
    }
    nodes = dedupe(next);
  }
  return { matches: nodes };
}
