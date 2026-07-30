import { useMemo } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { SCHEMES, SCHEME_NAMES, convert, type Scheme } from './encoding.ts';

interface State {
  text: string;
  scheme: Scheme;
  direction: 'encode' | 'decode';
}

const INITIAL: State = { text: '', scheme: 'base64', direction: 'encode' };

export function Encoding() {
  const [state, setState] = useHashState<State>(INITIAL);
  const { text, scheme, direction } = state;

  const result = useMemo(() => convert(text, scheme, direction), [text, scheme, direction]);

  const bytes = useMemo(() => new TextEncoder().encode(text).length, [text]);

  return (
    <ToolShell slug="encoding">
      <div class="stack">
        <div class="row">
          <Segmented
            label="Scheme"
            options={SCHEMES}
            value={scheme}
            names={SCHEME_NAMES}
            onChange={(next) => setState({ ...state, scheme: next })}
          />
          <Segmented
            label="Direction"
            options={['encode', 'decode'] as const}
            value={direction}
            names={{ encode: 'Encode', decode: 'Decode' }}
            onChange={(next) => setState({ ...state, direction: next })}
          />
          <button
            type="button"
            class="ghost"
            title="Use the output as the new input"
            disabled={!result.output}
            onClick={() =>
              setState({
                ...state,
                text: result.output,
                direction: direction === 'encode' ? 'decode' : 'encode',
              })
            }
          >
            ⇅ Swap
          </button>
        </div>

        <label class="field">
          <span class="field__label">Input</span>
          <textarea
            value={text}
            spellcheck={false}
            placeholder={direction === 'encode' ? 'Text to encode…' : 'Encoded text to decode…'}
            onInput={(e) => setState({ ...state, text: (e.target as HTMLTextAreaElement).value })}
          />
        </label>

        <div class="row small dim">
          <span>
            {text.length} char{text.length === 1 ? '' : 's'}
          </span>
          <span>·</span>
          <span>
            {bytes} byte{bytes === 1 ? '' : 's'} UTF-8
          </span>
        </div>

        {result.error ? (
          <div class="note note--error">{result.error}</div>
        ) : (
          <div class="stack stack--tight">
            <div class="row">
              <span class="field__label">Output</span>
              <span class="topbar__spacer" />
              <CopyButton value={result.output} />
            </div>
            <pre class="output">{result.output}</pre>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
