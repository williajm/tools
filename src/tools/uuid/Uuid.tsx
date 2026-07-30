import { useCallback, useEffect, useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import {
  CASE_INSENSITIVE,
  HYPHENATED,
  KINDS,
  KIND_NAMES,
  KIND_NOTES,
  generate,
  timestampOf,
  type IdKind,
} from './ids.ts';

export function Uuid() {
  const [kind, setKind] = useState<IdKind>('uuidv4');
  const [count, setCount] = useState(5);
  const [uppercase, setUppercase] = useState(false);
  const [hyphens, setHyphens] = useState(true);
  const [ids, setIds] = useState<string[]>([]);

  const regenerate = useCallback(() => {
    setIds(generate(kind, count, { uppercase, hyphens }));
  }, [kind, count, uppercase, hyphens]);

  // Generate on load and whenever the options change, so the page is never empty.
  useEffect(regenerate, [regenerate]);

  const canUppercase = CASE_INSENSITIVE.has(kind);
  const canDropHyphens = HYPHENATED.has(kind);
  const firstStamp = ids.length ? timestampOf(kind, ids[0]!) : null;

  return (
    <ToolShell slug="uuid">
      <div class="stack">
        <div class="row">
          <Segmented
            label="Kind"
            options={KINDS}
            value={kind}
            names={KIND_NAMES}
            onChange={setKind}
          />
        </div>

        <div class="note note--ok small">{KIND_NOTES[kind]}</div>

        <div class="row">
          <label class="row row--tight small">
            <span class="field__label">Count</span>
            <input
              type="number"
              min={1}
              max={1000}
              value={count}
              onInput={(e) => setCount(Number((e.target as HTMLInputElement).value))}
            />
          </label>

          <label
            class="checkbox"
            title={
              canUppercase
                ? undefined
                : 'NanoID is case-sensitive — changing case would produce a different ID'
            }
          >
            <input
              type="checkbox"
              checked={uppercase && canUppercase}
              disabled={!canUppercase}
              onChange={(e) => setUppercase((e.target as HTMLInputElement).checked)}
            />
            Uppercase
          </label>

          <label class="checkbox" title={canDropHyphens ? undefined : 'Only UUIDs contain hyphens'}>
            <input
              type="checkbox"
              checked={hyphens}
              disabled={!canDropHyphens}
              onChange={(e) => setHyphens((e.target as HTMLInputElement).checked)}
            />
            Hyphens
          </label>

          <button type="button" class="primary" onClick={regenerate}>
            Regenerate
          </button>
          <CopyButton value={ids.join('\n')} label={`Copy ${ids.length}`} />
        </div>

        {firstStamp && (
          <p class="small dim" style="margin:0">
            Embedded timestamp of the first ID: <span class="mono">{firstStamp.toISOString()}</span>
          </p>
        )}

        <pre class="output">{ids.join('\n')}</pre>
      </div>
    </ToolShell>
  );
}
