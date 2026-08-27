import { useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { saveBlob } from '@shared/lib/download.ts';
import {
  DEFAULT_REQUEST,
  FILLS,
  FILL_NAMES,
  FILL_NOTES,
  MAX_BYTES,
  SIZE_UNITS,
  generateFile,
  maxFor,
  normalise,
  suggestedFilename,
  toBytes,
  type Generated,
  type Request,
  type SizeUnit,
} from './file.ts';

interface State extends Request {
  /** Empty means "use the suggested name". */
  filename: string;
  sha256: boolean;
}

const INITIAL: State = { ...DEFAULT_REQUEST, filename: '', sha256: false };

type Phase = 'idle' | 'working' | 'done' | 'failed';

/** What a run was asked for, frozen at the click so progress describes that job. */
interface Job {
  bytes: number;
  filename: string;
}

function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MiB`;
}

export function TestFile() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const [phase, setPhase] = useState<Phase>('idle');
  const [job, setJob] = useState<Job | null>(null);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<(Generated & { filename: string }) | null>(null);
  const [error, setError] = useState<string | null>(null);

  // The fragment is hand-editable, so never trust it to be one of our values.
  const { size, unit, fill } = normalise(state);
  const bytes = toBytes(size, unit);
  const max = maxFor(unit);
  const filename = state.filename.trim() || suggestedFilename(size, unit, fill);
  const busy = phase === 'working';
  const canGenerate = bytes >= 1 && bytes <= MAX_BYTES && !busy;

  const onSize = (raw: string) => {
    // A number field reports '' while a decimal is half-typed ("2."); writing
    // that back as 0 would garble the entry, so leave state alone until it parses.
    const n = Number(raw);
    if (raw === '' || !Number.isFinite(n) || n <= 0) return;
    set('size', Math.min(n, max));
  };

  const onUnit = (next: SizeUnit) => {
    // Each unit has its own ceiling; keep the size inside the new one.
    setState({ ...state, unit: next, size: Math.min(size, maxFor(next)) });
  };

  const run = async () => {
    const thisJob: Job = { bytes, filename };
    setJob(thisJob);
    setPhase('working');
    setProgress(0);
    setResult(null);
    setError(null);
    try {
      const generated = await generateFile(thisJob.bytes, fill, {
        sha256: state.sha256,
        onProgress: setProgress,
      });
      saveBlob(generated.blob, thisJob.filename);
      setResult({ ...generated, filename: thisJob.filename });
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
              value={size}
              disabled={busy}
              title={`Up to ${max.toLocaleString()} ${unit}`}
              onInput={(e) => onSize((e.target as HTMLInputElement).value)}
            />
          </label>
          <label class="row row--tight small">
            <span class="field__label">Unit</span>
            <select
              value={unit}
              disabled={busy}
              onChange={(e) => onUnit((e.target as HTMLSelectElement).value as SizeUnit)}
            >
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
          <Segmented
            label="Fill"
            options={FILLS}
            value={fill}
            names={FILL_NAMES}
            disabled={busy}
            onChange={(f) => set('fill', f)}
          />
        </div>

        <div class="note note--ok small">{FILL_NOTES[fill]}</div>

        <div class="row">
          <label class="row row--tight small">
            <span class="field__label">Filename</span>
            <input
              type="text"
              value={state.filename}
              disabled={busy}
              placeholder={suggestedFilename(size, unit, fill)}
              style="width:16rem"
              onInput={(e) => set('filename', (e.target as HTMLInputElement).value)}
            />
          </label>
          <label
            class="checkbox"
            title="Hashing runs in JavaScript and roughly doubles the build time at large sizes"
          >
            <input
              type="checkbox"
              checked={state.sha256}
              disabled={busy}
              onChange={(e) => set('sha256', (e.target as HTMLInputElement).checked)}
            />
            Compute SHA-256
          </label>
          <button type="button" class="primary" disabled={!canGenerate} onClick={run}>
            {busy ? 'Generating…' : 'Generate & download'}
          </button>
        </div>

        {busy && job && (
          <div class="stack stack--tight">
            <progress value={progress} max={job.bytes} style="width:100%" />
            <span class="small dim">
              {formatMiB(progress)} of {formatMiB(job.bytes)}
            </span>
          </div>
        )}

        {phase === 'failed' && <div class="note note--error small">{error}</div>}

        {result && (
          <div class="stack stack--tight">
            <div class="note note--ok small">
              Saved <span class="mono">{result.filename}</span> — {result.bytes.toLocaleString()} bytes.
              {result.sha256 && ' Upload it, hash what the server stored, and compare.'}
            </div>
            <div class="row">
              {result.sha256 && (
                <>
                  <span class="field__label">SHA-256</span>
                  <span class="mono small wrap-anywhere">{result.sha256}</span>
                  <CopyButton value={result.sha256} />
                </>
              )}
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
