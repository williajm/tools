import { useMemo } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { FLAGS } from './regex.ts';
import { useEvaluation } from './useEvaluation.ts';

interface State {
  pattern: string;
  flags: string;
  input: string;
  tests: string;
  replacement: string;
}

const INITIAL: State = {
  pattern: '(?<user>[^@\\s]+)@(?<host>[^@\\s]+\\.[a-z]{2,})',
  flags: 'gi',
  input: 'Contact ada@example.com or grace@navy.mil.uk — not "bad@@example".',
  tests: [
    'ada@example.com',
    'grace@navy.mil.uk',
    '!bad@@example',
    '!no-at-sign.com',
    '!trailing@dot.',
  ].join('\n'),
  replacement: '$<host>',
};

export function Regex() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  // Evaluated on a worker so a pattern that backtracks forever can be abandoned
  // rather than freezing the tab. Memoised so an unchanged request is not re-sent
  // on every render.
  const request = useMemo(
    () => ({
      pattern: state.pattern,
      flags: state.flags,
      input: state.input,
      tests: state.tests,
      replacement: state.replacement,
    }),
    [state.pattern, state.flags, state.input, state.tests, state.replacement],
  );

  const { evaluation, status } = useEvaluation(request);
  const { matches, segments, outcomes, summary, replaced } = evaluation;
  const timedOut = status === 'timeout';

  const toggleFlag = (flag: string) => {
    set('flags', state.flags.includes(flag) ? state.flags.replace(flag, '') : state.flags + flag);
  };

  return (
    <ToolShell slug="regex" wide>
      <div class="stack">
        <label class="field">
          <span class="field__label">Pattern</span>
          <div class="row row--tight" style="align-items:stretch">
            <span class="mono dim" style="display:flex;align-items:center">/</span>
            <input
              type="text"
              value={state.pattern}
              spellcheck={false}
              onInput={(e) => set('pattern', (e.target as HTMLInputElement).value)}
            />
            <span class="mono dim" style="display:flex;align-items:center">/{state.flags}</span>
          </div>
        </label>

        <div class="row row--tight">
          {FLAGS.map((f) => (
            <label class="checkbox" key={f.flag} title={f.note}>
              <input
                type="checkbox"
                checked={state.flags.includes(f.flag)}
                onChange={() => toggleFlag(f.flag)}
              />
              <span class="mono">{f.flag}</span> <span class="faint small">{f.label}</span>
            </label>
          ))}
        </div>

        {evaluation.error && <div class="note note--error mono small">{evaluation.error}</div>}

        {timedOut && (
          <div class="note note--error">
            <strong>Gave up after 2 seconds.</strong> This pattern backtracks
            catastrophically on this input — a construct like <span class="mono">(a+)+</span> can
            take exponential time on a string that nearly matches. It was run on a worker thread and
            stopped, so the page stayed responsive. Simplify the pattern or shorten the input.
          </div>
        )}

        <div class="grid-2">
          <div class="stack">
            <label class="field">
              <span class="field__label">Test string</span>
              <textarea
                value={state.input}
                spellcheck={false}
                onInput={(e) => set('input', (e.target as HTMLTextAreaElement).value)}
              />
            </label>

            <div class="stack stack--tight">
              <span class="field__label">
                {matches.length} match{matches.length === 1 ? '' : 'es'}
              </span>
              <pre class="output">
                {segments.map((seg, i) =>
                  seg.matched ? (
                    // eslint-disable-next-line react/no-array-index-key
                    <mark key={i} style="background:var(--accent-bg);color:var(--accent);font-weight:600">
                      {seg.text}
                    </mark>
                  ) : (
                    // eslint-disable-next-line react/no-array-index-key
                    <span key={i}>{seg.text}</span>
                  ),
                )}
              </pre>
            </div>

            {matches.length > 0 && matches[0]!.groups.length > 0 && (
              <div class="table-scroll">
                <table class="data">
                  <thead>
                    <tr>
                      <th style="width:4rem">Match</th>
                      <th>Text</th>
                      {matches[0]!.groups.map((g, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <th key={i}>{g.name ? `$<${g.name}>` : `$${i + 1}`}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matches.slice(0, 50).map((m, i) => (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i}>
                        <td class="num faint">{m.index}</td>
                        <td class="mono">{m.text}</td>
                        {m.groups.map((g, gi) => (
                          // eslint-disable-next-line react/no-array-index-key
                          <td key={gi} class="mono">
                            {g.value ?? <span class="faint">undefined</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <label class="field">
              <span class="field__label">Replace with</span>
              <input
                type="text"
                value={state.replacement}
                spellcheck={false}
                placeholder="$1, $<name>, $&…"
                onInput={(e) => set('replacement', (e.target as HTMLInputElement).value)}
              />
            </label>
            <div class="stack stack--tight">
              <div class="row">
                <span class="field__label">Result</span>
                <span class="topbar__spacer" />
                <CopyButton value={replaced} />
              </div>
              <pre class="output">{replaced}</pre>
            </div>
          </div>

          <div class="stack">
            <label class="field">
              <span class="field__label">
                Test cases — one per line, prefix with <span class="mono">!</span> for must-not-match
              </span>
              <textarea
                value={state.tests}
                spellcheck={false}
                style="min-height:200px"
                onInput={(e) => set('tests', (e.target as HTMLTextAreaElement).value)}
              />
            </label>

            {outcomes.length > 0 && (
              <>
                <div class={summary.failed === 0 ? 'note note--ok' : 'note note--error'}>
                  {summary.failed === 0 ? '✓ ' : '✗ '}
                  {summary.passed} of {summary.total} passed
                  {summary.failed > 0 && ` — ${summary.failed} failing`}
                </div>

                <div class="table-scroll">
                  <table class="data">
                    <thead>
                      <tr>
                        <th style="width:3.5rem" />
                        <th>Input</th>
                        <th style="width:6rem">Expected</th>
                        <th style="width:9rem">Matched</th>
                      </tr>
                    </thead>
                    <tbody>
                      {outcomes.map((o, i) => (
                        // eslint-disable-next-line react/no-array-index-key
                        <tr key={i}>
                          <td style={o.pass ? 'color:var(--ok)' : 'color:var(--danger)'}>
                            {o.pass ? '✓ pass' : '✗ fail'}
                          </td>
                          <td class="mono wrap-anywhere">{o.input}</td>
                          <td class="faint small">{o.expect === 'match' ? 'match' : 'no match'}</td>
                          <td class="mono small">
                            {o.matched ? o.captured : <span class="faint">no match</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </ToolShell>
  );
}
