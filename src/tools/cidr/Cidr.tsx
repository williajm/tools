import { useMemo } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { compareSets, describe, formatCount, splitSubnets } from './cidr.ts';

type Mode = 'calculator' | 'sets';

interface State {
  input: string;
  mode: Mode;
  /** Prefix to divide the block into; null follows the block's own size. */
  splitPrefix: number | null;
  setA: string;
  setB: string;
}

const INITIAL: State = {
  input: '192.168.1.0/24',
  mode: 'calculator',
  splitPrefix: null,
  setA: '10.0.0.0/24\n10.0.1.0/24\n10.0.2.0/24',
  setB: '10.0.1.128/25',
};

/** Rows of a split table beyond which the page stops being useful. */
const SPLIT_LIMIT = 256;

export function Cidr() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const result = useMemo(() => describe(state.input), [state.input]);
  const info = result.ok ? result.info : null;

  const splitPrefix = useMemo(() => {
    if (!info) return null;
    if (state.splitPrefix !== null) return state.splitPrefix;
    // Two bits deeper than the block itself: four subnets, a useful default.
    return Math.min(info.prefix + 2, info.version === 4 ? 32 : 128);
  }, [info, state.splitPrefix]);

  const split = useMemo(
    () => (info && splitPrefix !== null ? splitSubnets(info, splitPrefix, SPLIT_LIMIT) : null),
    [info, splitPrefix],
  );

  const sets = useMemo(
    () => (state.mode === 'sets' ? compareSets(state.setA, state.setB) : null),
    [state.mode, state.setA, state.setB],
  );

  /** Drives both the table and the copyable summary, so they cannot drift. */
  const fields = useMemo((): Array<[string, string]> => {
    if (!info) return [];
    const rows: Array<[string, string]> = [
      ['CIDR', info.cidr],
      ['Version', `IPv${info.version}`],
    ];
    if (info.hostAddress) rows.push(['Address as typed', info.hostAddress]);
    if (info.netmask) rows.push(['Netmask', info.netmask]);
    if (info.wildcard) rows.push(['Wildcard mask', info.wildcard]);
    rows.push(
      ['Network address', info.network],
      [info.version === 4 ? 'Broadcast address' : 'Last address', info.lastAddress],
      ['Usable range', `${info.firstUsable} – ${info.lastUsable}`],
      ['Total addresses', formatCount(info.totalAddresses)],
      ['Usable addresses', formatCount(info.usableAddresses)],
      ['Host bits', String(info.hostBits)],
      ['Reverse DNS', info.reverse],
    );
    if (info.reverseZone) rows.push(['Reverse zone', info.reverseZone]);
    rows.push(['Scope', info.classification.join(', ')]);
    return rows;
  }, [info]);

  const summary = useMemo(
    () => fields.map(([label, value]) => `${label}: ${value}`).join('\n'),
    [fields],
  );

  return (
    <ToolShell slug="cidr" wide>
      <div class="stack">
        <div class="row">
          <Segmented
            label="Mode"
            options={['calculator', 'sets'] as const}
            value={state.mode}
            names={{ calculator: 'Calculator', sets: 'Compare sets' }}
            onChange={(next) => set('mode', next)}
          />
        </div>

        {state.mode === 'calculator' ? (
          <>
            <div class="row">
              <label class="field" style="flex:1;min-width:min(100%,22rem)">
                <span class="field__label">IP address or CIDR block</span>
                <input
                  type="text"
                  value={state.input}
                  spellcheck={false}
                  autocomplete="off"
                  placeholder="10.0.0.0/8 or 2001:db8::/32"
                  onInput={(e) => set('input', (e.target as HTMLInputElement).value)}
                />
              </label>
            </div>

            {!result.ok && <div class="note note--error">{result.error}</div>}

            {info && (
              <>
                <div class="row">
                  <span class="field__label">Details</span>
                  <span class="topbar__spacer" />
                  <CopyButton value={summary} label="Copy summary" />
                </div>

                <div class="grid-2">
                  <div class="table-scroll">
                    <table class="data">
                      <tbody>
                        {fields.map(([label, value]) => (
                          <tr key={label}>
                            <th scope="row" style="width:12rem">
                              {label}
                            </th>
                            <td class="mono wrap-anywhere">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div class="stack stack--tight">
                    <div class="row">
                      <label class="checkbox">
                        Split into
                        <input
                          type="number"
                          min={info.prefix}
                          max={info.version === 4 ? 32 : 128}
                          value={splitPrefix ?? info.prefix}
                          style="min-width:5.5rem"
                          onInput={(e) => {
                            const raw = (e.target as HTMLInputElement).value;
                            set('splitPrefix', raw === '' ? null : Number(raw));
                          }}
                        />
                        bit subnets
                      </label>
                      {state.splitPrefix !== null && (
                        <button type="button" class="ghost" onClick={() => set('splitPrefix', null)}>
                          Reset
                        </button>
                      )}
                      <span class="topbar__spacer" />
                      {split && !split.error && (
                        <CopyButton
                          value={split.subnets.map((s) => s.cidr).join('\n')}
                          label="Copy list"
                        />
                      )}
                    </div>

                    {split?.error && <div class="note note--error">{split.error}</div>}

                    {split && !split.error && (
                      <>
                        <p class="small dim" style="margin:0">
                          {formatCount(split.total)} subnet{split.total === 1n ? '' : 's'} of{' '}
                          {formatCount(2n ** BigInt((info.version === 4 ? 32 : 128) - (splitPrefix ?? 0)))}{' '}
                          addresses each
                          {split.truncated && `, showing the first ${split.subnets.length}`}.
                        </p>
                        <div class="table-scroll" style="max-height:420px;overflow-y:auto">
                          <table class="data">
                            <thead>
                              <tr>
                                <th>Subnet</th>
                                <th>Range</th>
                              </tr>
                            </thead>
                            <tbody>
                              {split.subnets.map((subnet) => (
                                <tr key={subnet.cidr}>
                                  <td class="mono wrap-anywhere">{subnet.cidr}</td>
                                  <td class="mono small wrap-anywhere">
                                    {subnet.network} – {subnet.lastAddress}
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
              </>
            )}
          </>
        ) : (
          <>
            <div class="grid-2">
              <label class="field">
                <span class="field__label">Set A — one network per line</span>
                <textarea
                  value={state.setA}
                  spellcheck={false}
                  style="min-height:150px"
                  onInput={(e) => set('setA', (e.target as HTMLTextAreaElement).value)}
                />
              </label>
              <label class="field">
                <span class="field__label">Set B</span>
                <textarea
                  value={state.setB}
                  spellcheck={false}
                  style="min-height:150px"
                  onInput={(e) => set('setB', (e.target as HTMLTextAreaElement).value)}
                />
              </label>
            </div>

            {sets?.error && <div class="note note--error">{sets.error}</div>}

            {sets && !sets.error && (
              <>
                <div class="row small">
                  <span class={sets.overlaps ? 'note note--warn' : 'note note--ok'}>
                    {sets.overlaps ? 'A and B overlap' : 'A and B are disjoint'}
                  </span>
                  {sets.aContainsB && <span class="note note--ok">A fully contains B</span>}
                  {sets.bContainsA && <span class="note note--ok">B fully contains A</span>}
                </div>

                <div class="grid-2">
                  <SetResultPane title="A merged" value={sets.mergedA} />
                  <SetResultPane title="B merged" value={sets.mergedB} />
                  <SetResultPane title="A minus B" value={sets.aMinusB} />
                  <SetResultPane title="B minus A" value={sets.bMinusA} />
                </div>
              </>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}

function SetResultPane({ title, value }: { title: string; value: string[] }) {
  return (
    <div class="stack stack--tight">
      <div class="row">
        <span class="field__label">
          {title} — {value.length} network{value.length === 1 ? '' : 's'}
        </span>
        <span class="topbar__spacer" />
        <CopyButton value={value.join('\n')} />
      </div>
      <pre class="output" style="min-height:90px">{value.join('\n')}</pre>
    </div>
  );
}
