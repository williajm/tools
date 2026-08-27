import { useEffect, useMemo, useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import { FORMATS, MAX_COUNT, UNITS, generate, placeholderImage, type Format, type Unit } from './generate.ts';
import { SCRIPTS, scriptById, type ScriptId } from './scripts.ts';
import { EDGE_CASES } from './edge.ts';
import {
  FIELDS,
  LOCALES,
  generateRows,
  serialise,
  type Export,
  type FieldId,
  type LocaleId,
  type Row,
} from './fixtures.ts';

type Mode = 'text' | 'edge' | 'fixtures' | 'images';

const MODE_NAMES: Record<Mode, string> = {
  text: 'Placeholder text',
  edge: 'Edge cases',
  fixtures: 'Entity fixtures',
  images: 'Placeholder images',
};

const UNIT_NAMES: Record<Unit, string> = {
  paragraphs: 'Paragraphs',
  sentences: 'Sentences',
  words: 'Words',
  'list-items': 'List items',
  characters: 'Characters',
  bytes: 'Bytes',
};

const FORMAT_NAMES: Record<Format, string> = {
  text: 'Plain',
  html: 'HTML',
  markdown: 'Markdown',
};

interface State {
  mode: Mode;
  script: ScriptId;
  unit: Unit;
  count: number;
  format: Format;
  seed: string;
  classicOpening: boolean;
  fields: FieldId[];
  locale: LocaleId;
  exportAs: Export;
  imgWidth: number;
  imgHeight: number;
}

const INITIAL: State = {
  mode: 'text',
  script: 'latin',
  unit: 'paragraphs',
  count: 3,
  format: 'text',
  seed: 'tools',
  classicOpening: true,
  fields: ['id', 'fullName', 'email', 'city'],
  locale: 'en',
  exportAs: 'table',
  imgWidth: 640,
  imgHeight: 360,
};

export function Lorem() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const scriptDef = scriptById(state.script);
  const isLengthUnit = state.unit === 'characters' || state.unit === 'bytes';
  const maxCount = MAX_COUNT[state.unit];

  const textOutput = useMemo(
    () =>
      state.mode === 'text'
        ? generate({
            script: state.script,
            unit: state.unit,
            count: state.count,
            format: state.format,
            seed: state.seed,
            classicOpening: state.classicOpening,
          })
        : '',
    [state.mode, state.script, state.unit, state.count, state.format, state.seed, state.classicOpening],
  );

  // Fixtures need faker, which is loaded on demand.
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [fixtureError, setFixtureError] = useState<string | null>(null);

  useEffect(() => {
    if (state.mode !== 'fixtures' || state.fields.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setFixtureError(null);

    generateRows(state.fields, state.count, state.seed, state.locale)
      .then((result) => {
        if (!cancelled) setRows(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setFixtureError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [state.mode, state.fields, state.count, state.seed, state.locale]);

  const fixtureOutput = useMemo(
    () => (rows.length ? serialise(rows, state.exportAs) : ''),
    [rows, state.exportAs],
  );

  const imgUri = useMemo(
    () => placeholderImage(state.imgWidth, state.imgHeight),
    [state.imgWidth, state.imgHeight],
  );

  return (
    <ToolShell slug="lorem" wide>
      <div class="stack">
        <Segmented
          label="Mode"
          options={['text', 'edge', 'fixtures', 'images'] as const}
          value={state.mode}
          names={MODE_NAMES}
          onChange={(next) => set('mode', next)}
        />

        {state.mode === 'text' && (
          <>
            <div class="row">
              <label class="row row--tight small">
                <span class="field__label">Script</span>
                <select
                  value={state.script}
                  onChange={(e) => set('script', (e.target as HTMLSelectElement).value as ScriptId)}
                >
                  {SCRIPTS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </label>

              <label class="row row--tight small">
                <span class="field__label">Unit</span>
                <select
                  value={state.unit}
                  onChange={(e) => {
                    // Each unit has its own ceiling; keep the count inside the new one.
                    const unit = (e.target as HTMLSelectElement).value as Unit;
                    setState({ ...state, unit, count: Math.min(state.count, MAX_COUNT[unit]) });
                  }}
                >
                  {UNITS.map((u) => (
                    <option key={u} value={u}>
                      {UNIT_NAMES[u]}
                    </option>
                  ))}
                </select>
              </label>

              <label class="row row--tight small">
                <span class="field__label">Count</span>
                <input
                  type="number"
                  min={1}
                  max={maxCount}
                  title={`Up to ${maxCount.toLocaleString()} ${UNIT_NAMES[state.unit].toLowerCase()}`}
                  value={state.count}
                  // Clamp on entry rather than at generation time: the field never
                  // shows a number the output will not honour.
                  onInput={(e) =>
                    set('count', Math.min(Number((e.target as HTMLInputElement).value), maxCount))
                  }
                />
              </label>

              {!isLengthUnit && (
                <Segmented
                  label="Format"
                  options={FORMATS}
                  value={state.format}
                  names={FORMAT_NAMES}
                  onChange={(next) => set('format', next)}
                />
              )}
            </div>

            <div class="row">
              <label class="row row--tight small">
                <span class="field__label">Seed</span>
                <input
                  type="text"
                  value={state.seed}
                  style="width:12rem"
                  onInput={(e) => set('seed', (e.target as HTMLInputElement).value)}
                />
              </label>
              {state.script === 'latin' && (
                <label class="checkbox">
                  <input
                    type="checkbox"
                    checked={state.classicOpening}
                    onChange={(e) =>
                      set('classicOpening', (e.target as HTMLInputElement).checked)
                    }
                  />
                  Classic “Lorem ipsum” opening
                </label>
              )}
            </div>

            <div class="note note--ok small">{scriptDef.note}</div>

            <div class="row">
              <span class="field__label">Output</span>
              <span class="topbar__spacer" />
              <span class="small faint">
                {[...textOutput].length} chars · {new TextEncoder().encode(textOutput).length} bytes
              </span>
              <CopyButton value={textOutput} />
            </div>
            <pre class="output" dir={scriptDef.rtl && state.format !== 'html' ? 'rtl' : 'ltr'}>
              {textOutput}
            </pre>
          </>
        )}

        {state.mode === 'edge' && (
          <>
            <div class="note note--warn small">
              Text designed to break renderers, validators and truncation logic. Each row explains
              what it catches.
            </div>
            <div class="row">
              <span class="topbar__spacer" />
              <CopyButton value={EDGE_CASES.map((e) => e.value).join('\n')} label="Copy all" />
            </div>
            <div class="table-scroll">
              <table class="data">
                <thead>
                  <tr>
                    <th style="width:11rem">Case</th>
                    <th style="width:16rem">Value</th>
                    <th>Why it matters</th>
                    <th style="width:5rem" />
                  </tr>
                </thead>
                <tbody>
                  {EDGE_CASES.map((e) => (
                    <tr key={e.id}>
                      <td>{e.name}</td>
                      <td class="mono wrap-anywhere">{e.value}</td>
                      <td class="dim">{e.why}</td>
                      <td>
                        <CopyButton value={e.value} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {state.mode === 'fixtures' && (
          <>
            <div class="row">
              <label class="row row--tight small">
                <span class="field__label">Rows</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={state.count}
                  onInput={(e) => set('count', Number((e.target as HTMLInputElement).value))}
                />
              </label>
              <label class="row row--tight small">
                <span class="field__label">Locale</span>
                <select
                  value={state.locale}
                  onChange={(e) => set('locale', (e.target as HTMLSelectElement).value as LocaleId)}
                >
                  {LOCALES.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.label}
                    </option>
                  ))}
                </select>
              </label>
              <label class="row row--tight small">
                <span class="field__label">Seed</span>
                <input
                  type="text"
                  value={state.seed}
                  style="width:10rem"
                  onInput={(e) => set('seed', (e.target as HTMLInputElement).value)}
                />
              </label>
              <Segmented
                label="Export as"
                options={['table', 'json', 'csv', 'sql'] as const}
                value={state.exportAs}
                names={{ table: 'Table', json: 'JSON', csv: 'CSV', sql: 'SQL' }}
                onChange={(next) => set('exportAs', next)}
              />
            </div>

            <fieldset class="panel" style="border-color:var(--border)">
              <legend class="field__label">Fields</legend>
              <div class="row row--tight">
                {FIELDS.map((f) => (
                  <label class="checkbox" key={f.id} title={f.note}>
                    <input
                      type="checkbox"
                      checked={state.fields.includes(f.id)}
                      onChange={(e) => {
                        const on = (e.target as HTMLInputElement).checked;
                        set(
                          'fields',
                          on
                            ? [...state.fields, f.id]
                            : state.fields.filter((x) => x !== f.id),
                        );
                      }}
                    />
                    {f.label}
                    {f.note && <span class="faint"> ✓</span>}
                  </label>
                ))}
              </div>
            </fieldset>

            {fixtureError ? (
              <div class="note note--error">{fixtureError}</div>
            ) : state.fields.length === 0 ? (
              <div class="note note--warn">Pick at least one field.</div>
            ) : (
              <>
                <div class="row">
                  <span class="field__label">
                    {loading ? 'Generating…' : `${rows.length} rows`}
                  </span>
                  <span class="topbar__spacer" />
                  <CopyButton value={fixtureOutput} />
                </div>
                <pre class="output">{fixtureOutput}</pre>
              </>
            )}
          </>
        )}

        {state.mode === 'images' && (
          <>
            <div class="note note--ok small">
              Generated locally as an inline SVG data URI — no request to a placeholder service, so
              it works offline and leaks nothing.
            </div>
            <div class="row">
              <label class="row row--tight small">
                <span class="field__label">Width</span>
                <input
                  type="number"
                  min={16}
                  max={4096}
                  value={state.imgWidth}
                  onInput={(e) => set('imgWidth', Number((e.target as HTMLInputElement).value))}
                />
              </label>
              <label class="row row--tight small">
                <span class="field__label">Height</span>
                <input
                  type="number"
                  min={16}
                  max={4096}
                  value={state.imgHeight}
                  onInput={(e) => set('imgHeight', Number((e.target as HTMLInputElement).value))}
                />
              </label>
              <CopyButton value={imgUri} label="Copy data URI" />
              <CopyButton
                value={`<img src="${imgUri}" width="${state.imgWidth}" height="${state.imgHeight}" alt="" />`}
                label="Copy <img>"
              />
            </div>
            <div class="panel">
              <img
                src={imgUri}
                width={state.imgWidth}
                height={state.imgHeight}
                alt="Generated placeholder"
                style="max-width:100%;height:auto;display:block"
              />
            </div>
          </>
        )}
      </div>
    </ToolShell>
  );
}
