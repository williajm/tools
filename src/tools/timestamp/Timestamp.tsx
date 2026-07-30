import { useMemo, useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { formatAll, parseInput, zoneList } from './time.ts';

interface State {
  input: string;
  zone: string;
}

function defaultZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function Timestamp() {
  const [state, setState] = useHashState<State>({
    input: String(Math.floor(Date.now() / 1000)),
    zone: defaultZone(),
  });
  const { input, zone } = state;
  const [zones] = useState(zoneList);

  const parsed = useMemo(() => parseInput(input, zone), [input, zone]);
  const rows = useMemo(
    () => (parsed.dt ? formatAll(parsed.dt, zone) : []),
    [parsed, zone],
  );

  return (
    <ToolShell slug="timestamp">
      <div class="stack">
        <div class="row">
          <button
            type="button"
            class="primary"
            onClick={() => setState({ ...state, input: String(Math.floor(Date.now() / 1000)) })}
          >
            Now
          </button>
          <button
            type="button"
            onClick={() => setState({ ...state, input: String(Date.now()) })}
          >
            Now (ms)
          </button>
          <label class="row row--tight small">
            <span class="field__label">Zone</span>
            <select
              value={zone}
              onChange={(e) => setState({ ...state, zone: (e.target as HTMLSelectElement).value })}
            >
              {zones.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </div>

        <label class="field">
          <span class="field__label">Timestamp or date</span>
          <input
            type="text"
            value={input}
            spellcheck={false}
            placeholder="1700000000, 2023-11-14T22:13:20Z, or a SQL/HTTP date…"
            onInput={(e) => setState({ ...state, input: (e.target as HTMLInputElement).value })}
          />
        </label>

        {parsed.error ? (
          <div class="note note--error">{parsed.error}</div>
        ) : (
          <>
            <div class="note note--ok small">{parsed.interpretation}</div>
            <div class="table-scroll">
              <table class="data">
                <thead>
                  <tr>
                    <th style="width:11rem">Format</th>
                    <th>Value</th>
                    <th style="width:5rem" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.label}>
                      <td>{row.label}</td>
                      <td class="mono wrap-anywhere">{row.value}</td>
                      <td>
                        <CopyButton value={row.value} />
                      </td>
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
