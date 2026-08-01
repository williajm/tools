import { useEffect, useMemo, useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import {
  analyse,
  diffJson,
  format,
  isFailure,
  minify,
  parseJson,
  sortKeys,
  validateSchema,
  type ValidationResult,
} from './json.ts';
import { query, isQueryError } from './query.ts';

type Mode = 'format' | 'query' | 'validate' | 'diff';

interface State {
  input: string;
  right: string;
  schema: string;
  path: string;
  mode: Mode;
  indent: number;
  sort: boolean;
}

const INITIAL: State = {
  input: '{\n  "name": "Ada",\n  "age": 36,\n  "tags": ["maths", "computing"]\n}',
  right: '{\n  "name": "Ada",\n  "age": 37,\n  "tags": ["maths", "engines"]\n}',
  schema:
    '{\n  "type": "object",\n  "required": ["name", "age"],\n  "properties": {\n    "name": { "type": "string" },\n    "age": { "type": "integer", "minimum": 0 }\n  }\n}',
  path: '$.tags[*]',
  mode: 'format',
  indent: 2,
  sort: false,
};

export function Json() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const left = useMemo(() => parseJson(state.input), [state.input]);
  const right = useMemo(
    () => (state.mode === 'diff' ? parseJson(state.right) : null),
    [state.mode, state.right],
  );

  const formatted = useMemo(() => {
    if (isFailure(left)) return '';
    const value = state.sort ? sortKeys(left.value) : left.value;
    return state.indent === 0 ? minify(value) : format(value, state.indent);
  }, [left, state.indent, state.sort]);

  const stats = useMemo(
    () => (isFailure(left) ? null : analyse(left.value, state.input)),
    [left, state.input],
  );

  const entries = useMemo(
    () => (right && !isFailure(left) && !isFailure(right) ? diffJson(left.value, right.value) : []),
    [left, right],
  );

  const queryResult = useMemo(
    () => (state.mode === 'query' && !isFailure(left) ? query(left.value, state.path) : null),
    [state.mode, left, state.path],
  );
  const queryValues = useMemo(
    () =>
      queryResult && !isQueryError(queryResult)
        ? JSON.stringify(
            queryResult.matches.map((m) => m.value),
            null,
            2,
          )
        : '',
    [queryResult],
  );

  const [validation, setValidation] = useState<ValidationResult | null>(null);
  useEffect(() => {
    if (state.mode !== 'validate' || isFailure(left)) {
      setValidation(null);
      return;
    }
    let cancelled = false;
    void validateSchema(left.value, state.schema).then((result) => {
      if (!cancelled) setValidation(result);
    });
    return () => {
      cancelled = true;
    };
  }, [state.mode, left, state.schema]);

  const renderError = (result: ReturnType<typeof parseJson>, label: string) =>
    isFailure(result) ? (
      <div class="note note--error">
        <strong>{label}:</strong> {result.error.message}
        {result.error.line !== undefined && (
          <>
            {' '}
            at line {result.error.line}
            {result.error.column !== undefined && `, column ${result.error.column}`}
            {result.error.excerpt && (
              <pre class="mono small" style="margin:6px 0 0;overflow-x:auto">
                {result.error.excerpt}
              </pre>
            )}
          </>
        )}
      </div>
    ) : null;

  return (
    <ToolShell slug="json" wide>
      <div class="stack">
        <div class="row">
          <Segmented
            label="Mode"
            options={['format', 'query', 'validate', 'diff'] as const}
            value={state.mode}
            names={{ format: 'Format', query: 'Query', validate: 'Schema', diff: 'Diff' }}
            onChange={(next) => set('mode', next)}
          />
          {state.mode === 'format' && (
            <>
              <Segmented
                label="Indent"
                options={['0', '2', '4'] as const}
                value={String(state.indent) as '0' | '2' | '4'}
                names={{ '0': 'Minify', '2': '2 spaces', '4': '4 spaces' }}
                onChange={(next) => set('indent', Number(next))}
              />
              <label class="checkbox">
                <input
                  type="checkbox"
                  checked={state.sort}
                  onChange={(e) => set('sort', (e.target as HTMLInputElement).checked)}
                />
                Sort keys
              </label>
            </>
          )}
        </div>

        <div class="grid-2">
          <label class="field">
            <span class="field__label">{state.mode === 'diff' ? 'Left' : 'JSON'}</span>
            <textarea
              value={state.input}
              spellcheck={false}
              style="min-height:220px"
              onInput={(e) => set('input', (e.target as HTMLTextAreaElement).value)}
            />
          </label>

          {state.mode === 'diff' && (
            <label class="field">
              <span class="field__label">Right</span>
              <textarea
                value={state.right}
                spellcheck={false}
                style="min-height:220px"
                onInput={(e) => set('right', (e.target as HTMLTextAreaElement).value)}
              />
            </label>
          )}

          {state.mode === 'validate' && (
            <label class="field">
              <span class="field__label">JSON Schema</span>
              <textarea
                value={state.schema}
                spellcheck={false}
                style="min-height:220px"
                onInput={(e) => set('schema', (e.target as HTMLTextAreaElement).value)}
              />
            </label>
          )}

          {state.mode === 'query' && (
            <div class="stack stack--tight">
              <label class="field">
                <span class="field__label">JSONPath</span>
                <input
                  type="text"
                  class="mono"
                  value={state.path}
                  spellcheck={false}
                  placeholder="$.store.book[?(@.price < 10)].title"
                  onInput={(e) => set('path', (e.target as HTMLInputElement).value)}
                />
              </label>
              <p class="small dim" style="margin:0">
                <code>$</code> root · <code>.name</code>/<code>[*]</code> child · <code>..</code> recurse ·{' '}
                <code>[0]</code>/<code>[-1]</code>/<code>[1:3]</code> index · <code>[?(@.x &gt; 1)]</code> filter
              </p>
            </div>
          )}

          {state.mode === 'format' && (
            <div class="stack stack--tight">
              <div class="row">
                <span class="field__label">Output</span>
                <span class="topbar__spacer" />
                <CopyButton value={formatted} />
              </div>
              <pre class="output" style="min-height:220px">{formatted}</pre>
            </div>
          )}
        </div>

        {renderError(left, state.mode === 'diff' ? 'Left' : 'JSON')}
        {right && renderError(right, 'Right')}

        {stats && state.mode === 'format' && (
          <div class="row small dim">
            <span>{stats.bytes} bytes</span>
            <span>·</span>
            <span>{stats.keys} keys</span>
            <span>·</span>
            <span>{stats.objects} objects</span>
            <span>·</span>
            <span>{stats.arrays} arrays</span>
            <span>·</span>
            <span>depth {stats.maxDepth}</span>
            {stats.nulls > 0 && (
              <>
                <span>·</span>
                <span>{stats.nulls} nulls</span>
              </>
            )}
          </div>
        )}

        {state.mode === 'validate' && validation && (
          <>
            {validation.error ? (
              <div class="note note--error">{validation.error}</div>
            ) : (
              <div class={validation.valid ? 'note note--ok' : 'note note--error'}>
                {validation.valid
                  ? '✓ Valid against the schema.'
                  : `✗ ${validation.issues.length} violation${validation.issues.length === 1 ? '' : 's'}.`}
              </div>
            )}
            {validation.issues.length > 0 && (
              <div class="table-scroll">
                <table class="data">
                  <thead>
                    <tr>
                      <th style="width:14rem">Path</th>
                      <th>Problem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {validation.issues.map((issue, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i}>
                        <td class="mono">{issue.path}</td>
                        <td>{issue.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}

        {state.mode === 'query' && queryResult && (
          <>
            {isQueryError(queryResult) ? (
              <div class="note note--error">{queryResult.error}</div>
            ) : (
              <>
                <div class={queryResult.matches.length === 0 ? 'note note--warn' : 'note note--ok'}>
                  {queryResult.matches.length === 0
                    ? 'No matches.'
                    : `${queryResult.matches.length} match${queryResult.matches.length === 1 ? '' : 'es'}.`}
                </div>
                {queryResult.matches.length > 0 && (
                  <>
                    <div class="row">
                      <span class="field__label">Values</span>
                      <span class="topbar__spacer" />
                      <CopyButton value={queryValues} />
                    </div>
                    <div class="table-scroll">
                      <table class="data">
                        <thead>
                          <tr>
                            <th style="width:18rem">Path</th>
                            <th>Value</th>
                          </tr>
                        </thead>
                        <tbody>
                          {queryResult.matches.map((m) => (
                            <tr key={m.path}>
                              <td class="mono wrap-anywhere">{m.path}</td>
                              <td class="mono wrap-anywhere">{JSON.stringify(m.value)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </>
            )}
          </>
        )}

        {state.mode === 'diff' && right && !isFailure(left) && !isFailure(right) && (
          <>
            <div class={entries.length === 0 ? 'note note--ok' : 'note note--warn'}>
              {entries.length === 0
                ? '✓ Structurally identical (key order ignored).'
                : `${entries.length} difference${entries.length === 1 ? '' : 's'}.`}
            </div>
            {entries.length > 0 && (
              <div class="table-scroll">
                <table class="data">
                  <thead>
                    <tr>
                      <th style="width:16rem">Path</th>
                      <th style="width:6rem">Change</th>
                      <th>Left</th>
                      <th>Right</th>
                    </tr>
                  </thead>
                  <tbody>
                    {entries.map((entry) => (
                      <tr key={entry.path}>
                        <td class="mono wrap-anywhere">{entry.path}</td>
                        <td
                          style={
                            entry.kind === 'added'
                              ? 'color:var(--ok)'
                              : entry.kind === 'removed'
                                ? 'color:var(--danger)'
                                : 'color:var(--warn)'
                          }
                        >
                          {entry.kind}
                        </td>
                        <td class="mono wrap-anywhere">{entry.left ?? ''}</td>
                        <td class="mono wrap-anywhere">{entry.right ?? ''}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}
