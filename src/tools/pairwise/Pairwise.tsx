import { useMemo } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { exportMatrix, generateMatrix, parse, type ExportFormat } from './model.ts';

interface State {
  params: string;
  exclusions: string;
  strength: number;
  exportAs: ExportFormat;
}

const EXAMPLE = `OS: Windows, macOS, Linux, iOS
Browser: Chrome, Firefox, Safari, Edge
Auth: SSO, Password, Passkey
Locale: en-GB, ja-JP, ar-EG`;

const EXAMPLE_EXCLUSIONS = `Browser=Safari, OS=Windows
Browser=Safari, OS=Linux
Browser=Edge, OS=Linux
Browser=Edge, OS=iOS`;

const INITIAL: State = {
  params: EXAMPLE,
  exclusions: EXAMPLE_EXCLUSIONS,
  strength: 2,
  exportAs: 'csv',
};

export function Pairwise() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const parsed = useMemo(() => parse(state.params, state.exclusions), [state.params, state.exclusions]);

  const result = useMemo(
    () =>
      parsed.errors.length === 0
        ? generateMatrix(parsed.parameters, parsed.exclusions, state.strength)
        : null,
    [parsed, state.strength],
  );

  const exhaustive = useMemo(
    () => parsed.parameters.reduce((acc, p) => acc * p.values.length, 1),
    [parsed.parameters],
  );

  const output = useMemo(
    () => (result?.rows.length ? exportMatrix(parsed.parameters, result.rows, state.exportAs) : ''),
    [result, parsed.parameters, state.exportAs],
  );

  // A skipped check has no missing tuples because nothing was examined, so
  // completeness has to require that the check actually ran.
  const complete =
    result &&
    !result.coverage.skipped &&
    result.coverage.missing.length === 0 &&
    result.rows.length > 0;

  return (
    <ToolShell slug="pairwise" wide>
      <div class="stack">
        <div class="grid-2">
          <label class="field">
            <span class="field__label">Parameters — one per line, “Name: value, value, …”</span>
            <textarea
              value={state.params}
              spellcheck={false}
              style="min-height:150px"
              onInput={(e) => set('params', (e.target as HTMLTextAreaElement).value)}
            />
          </label>

          <label class="field">
            <span class="field__label">
              Exclusions — combinations that must never appear together
            </span>
            <textarea
              value={state.exclusions}
              spellcheck={false}
              placeholder="Browser=Safari, OS=Windows"
              style="min-height:150px"
              onInput={(e) => set('exclusions', (e.target as HTMLTextAreaElement).value)}
            />
          </label>
        </div>

        <div class="row">
          <Segmented
            label="Strength"
            options={['2', '3', '4'] as const}
            value={String(state.strength) as '2' | '3' | '4'}
            names={{ '2': 'Pairwise (2)', '3': '3-way', '4': '4-way' }}
            onChange={(next) => set('strength', Number(next))}
          />
          <Segmented
            label="Export as"
            options={['csv', 'json', 'markdown'] as const}
            value={state.exportAs}
            names={{ csv: 'CSV', json: 'JSON', markdown: 'Markdown' }}
            onChange={(next) => set('exportAs', next)}
          />
          <CopyButton value={output} label="Copy matrix" />
        </div>

        {parsed.errors.length > 0 && (
          <div class="note note--error">
            <ul style="margin:0;padding-left:18px">
              {parsed.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {result?.error && <div class="note note--error">{result.error}</div>}

        {result && !result.error && result.rows.length > 0 && (
          <>
            {result.coverage.skipped ? (
              <div class="note note--warn">
                <strong>{result.rows.length} test cases</strong> generated, but coverage was not
                verified. {result.coverage.skipped}
              </div>
            ) : (
              <div class={complete ? 'note note--ok' : 'note note--error'}>
                {complete ? '✓ ' : '✗ '}
                <strong>
                  {result.rows.length} test cases
                </strong>{' '}
                cover {result.coverage.covered} of {result.coverage.total} reachable{' '}
                {result.coverage.strength === 2 ? 'pairs' : `${result.coverage.strength}-tuples`}
                {result.coverage.excluded > 0 && ` (${result.coverage.excluded} excluded by constraints)`}.
                {' '}Exhaustive testing would need <strong>{exhaustive.toLocaleString()}</strong> —
                a {(exhaustive / result.rows.length).toFixed(1)}× reduction. Theoretical minimum is{' '}
                {result.lowerBound}.
              </div>
            )}

            {result.coverage.missing.length > 0 && (
              <div class="note note--error small">
                <strong>Uncovered:</strong>{' '}
                {result.coverage.missing
                  .slice(0, 12)
                  .map((tuple) => tuple.map((t) => `${t.name}=${t.value}`).join(' & '))
                  .join('; ')}
                {result.coverage.missing.length > 12 && ` … and ${result.coverage.missing.length - 12} more`}
              </div>
            )}

            <div class="table-scroll">
              <table class="data">
                <thead>
                  <tr>
                    <th style="width:3rem">#</th>
                    {parsed.parameters.map((p) => (
                      <th key={p.name}>{p.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {result.rows.map((row, i) => (
                    // eslint-disable-next-line react/no-array-index-key
                    <tr key={i}>
                      <td class="num faint">{i + 1}</td>
                      {parsed.parameters.map((p) => (
                        <td key={p.name} class="mono">
                          {row[p.name] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </ToolShell>
  );
}
