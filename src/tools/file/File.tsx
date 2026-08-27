import { useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { saveBlob } from '@shared/lib/download.ts';
import {
  FILLS,
  FILL_NAMES,
  FILL_NOTES,
  MAX_BYTES,
  SIZE_UNITS,
  generateFile,
  maxFor,
  suggestedFilename,
  toBytes,
  type Fill,
  type Generated,
  type SizeUnit,
} from './file.ts';

interface State {
  size: number;
  unit: SizeUnit;
  fill: Fill;
  /** Empty means "use the suggested name". */
  filename: string;
}

const INITIAL: State = { size: 10, unit: 'MiB', fill: 'random', filename: '' };

type Phase = 'idle' | 'working' | 'done' | 'failed';

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

export function TestFile() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const [phase, setPhase] = useState<Phase>('idle');
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(Generated & { filename: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bytes = toBytes(state.size, state.unit);
  const max = maxFor(state.unit);
  const filename = state.filename.trim() || suggestedFilename(state.size, state.unit, state.fill);
  const canGenerate = bytes >= 1 && bytes <= MAX_BYTES && phase !== 'working';

  const onSize = (raw: string) => {
    // A number field reports '' while a decimal is half-typed ("2."); writing
    // that back as 0 would garble the entry, so leave state alone until it parses.
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n <= 0) return;
    set('size', Math.min(n, max));
  };

  const onUnit = (unit: SizeUnit) => {
    // Each unit has its own ceiling; keep the size inside the new one.
    setState({ ...state, unit, size: Math.min(state.size, maxFor(unit)) });
  };

  const run = async () => {
    setPhase('working');
    setProgress(0);
    setResult(null);
    setError(null);
    try {
      const generated = await generateFile(bytes, state.fill, setProgress);
      saveBlob(generated.blob, filename);
      setResult({ ...generated, filename });
      setPhase('done');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('failed');
    }
  };

  return (
    <ToolShell slug="file">
      <div class="stack">
        <div class="row">
          <label class="row row--tight small">
            <span class="field__label">Size</span>
            <input
              type="number"
              min={1}
              max={max}
              step="any"
              value={state.size}
              title={`Up to ${max.toLocaleString()} ${state.unit}`}
              onInput={(e) => onSize((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="row row--tight small">
            <span class="field__label">Unit</span>
            <select value={state.unit} onChange={(e) => onUnit((e.target as HTMLSelectElement).value as SizeUnit)}>
              {SIZE_UNITS.map((u) => (
                <option key={u} value={u}>
                  {u}
                </option>
              ))}
            </select>
          </label>
          <span class="small faint">
            = {bytes.toLocaleString()} bytes · up to 1 GiB
          </span>
        </div>

        <div class="row">
          <Segmented label="Fill" options={FILLS} value={state.fill} names={FILL_NAMES} onChange={(f) => set('fill', f)} />
        </div>

        <div class="note note--ok small">{FILL_NOTES[state.fill]}</div>

        <div class="row">
          <label class="row row--tight small">
            <span class="field__label">Filename</span>
            <input
              type="text"
              value={state.filename}
              placeholder={suggestedFilename(state.size, state.unit, state.fill)}
              style="width:16rem"
              onInput={(e) => set('filename', (e.target as HTMLInputElement).value)}
            />
          </label>
          <button type="button" class="primary" disabled={!canGenerate} onClick={run}>
            {phase === 'working' ? 'Generating…' : 'Generate & download'}
          </button>
        </div>

        {phase === 'working' && (
          <div class="stack stack--tight">
            <progress value={progress} max={bytes} style="width:100%" />
            <span class="small dim">
              {formatMiB(progress)} of {formatMiB(bytes)}
            </span>
          </div>
        )}

        {phase === 'failed' && <div class="note note--error small">{error}</div>}

        {result && (
          <div class="stack stack--tight">
            <div class="note note--ok small">
              Saved <span class="mono">{result.filename}</span> — {result.bytes.toLocaleString()} bytes.
              Upload it, hash what the server stored, and compare.
            </div>
            <div class="row">
              <span class="field__label">SHA-256</span>
              <span class="mono small wrap-anywhere">{result.sha256}</span>
              <CopyButton value={result.sha256} />
              <button type="button" onClick={() => saveBlob(result.blob, result.filename)} title="If the browser blocked the automatic download">
                Save again
              </button>
            </div>
          </div>
        )}
      </div>
    </ToolShell>
  );
}
