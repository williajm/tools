import { useEffect, useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { ALGORITHMS, BROKEN, compute, type Algorithm } from './hash.ts';

interface State {
  text: string;
  algorithm: Algorithm;
  useHmac: boolean;
}

const INITIAL: State = { text: '', algorithm: 'SHA-256', useHmac: false };

export function Hash() {
  const [state, setState] = useHashState<State>(INITIAL);
  const { text, algorithm, useHmac } = state;

  // The key is deliberately kept out of the URL — a shared link should never
  // carry a secret, even in a fragment.
  const [key, setKey] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);

    compute(text, algorithm, useHmac ? key : null)
      .then((result) => {
        if (!cancelled) setOutput(result);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOutput('');
        setError(err instanceof Error ? err.message : String(err));
      });

    return () => {
      cancelled = true;
    };
  }, [text, algorithm, useHmac, key]);

  return (
    <ToolShell slug="hash">
      <div class="stack">
        <div class="row">
          <Segmented
            label="Algorithm"
            options={ALGORITHMS}
            value={algorithm}
            onChange={(next) => setState({ ...state, algorithm: next })}
          />
          <label class="checkbox">
            <input
              type="checkbox"
              checked={useHmac}
              onChange={(e) => setState({ ...state, useHmac: (e.target as HTMLInputElement).checked })}
            />
            HMAC
          </label>
        </div>

        {BROKEN.has(algorithm) && (
          <div class="note note--warn">
            {algorithm} is cryptographically broken — practical collisions exist. Fine for
            checksums and legacy interop, never for signatures, passwords or integrity.
          </div>
        )}

        {useHmac && (
          <label class="field">
            <span class="field__label">Key (never added to the URL)</span>
            <input
              type="password"
              value={key}
              placeholder="Secret key…"
              autocomplete="off"
              onInput={(e) => setKey((e.target as HTMLInputElement).value)}
            />
          </label>
        )}

        <label class="field">
          <span class="field__label">Input</span>
          <textarea
            value={text}
            spellcheck={false}
            placeholder="Text to hash…"
            onInput={(e) => setState({ ...state, text: (e.target as HTMLTextAreaElement).value })}
          />
        </label>

        {error ? (
          <div class="note note--error">{error}</div>
        ) : (
          <div class="stack stack--tight">
            <div class="row">
              <span class="field__label">
                {useHmac ? `HMAC-${algorithm}` : algorithm} · {output.length / 2} bytes
              </span>
              <span class="topbar__spacer" />
              <CopyButton value={output} />
            </div>
            <pre class="output">{output}</pre>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
