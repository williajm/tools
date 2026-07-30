import { useMemo } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import {
  DEFAULT_OPTIONS,
  GRANULARITIES,
  collapse,
  computeDiff,
  isSkip,
  toSideBySide,
  toUnified,
  wordSegments,
  type Granularity,
  type Options,
  type Row,
  type Segment,
} from './diff.ts';

type View = 'split' | 'unified';

interface State extends Options {
  left: string;
  right: string;
  granularity: Granularity;
  view: View;
  /** Hide long runs of unchanged lines. */
  collapsed: boolean;
}

const INITIAL: State = {
  ...DEFAULT_OPTIONS,
  left: 'The quick brown fox\njumps over the lazy dog.\nPack my box with five dozen jugs.\nHow razorback jumping frogs\ncan level six piqued gymnasts.',
  right:
    'The quick brown fox\nleaps over the lazy dog.\nPack my box with five dozen liquor jugs.\nHow razorback jumping frogs\ncan level six piqued gymnasts!',
  granularity: 'lines',
  view: 'split',
  collapsed: false,
};

/** Unchanged lines either side of a change when collapsing. */
const CONTEXT = 3;

/**
 * A replaced line, with the words that actually changed marked.
 *
 * Two lines sitting opposite each other in red and green tell you *that*
 * something changed; the point of a side-by-side view is seeing *what*, without
 * reading both lines word by word.
 */
type MarkedRow = Row & { segments?: Segment[] };
type MarkedPair = { skip: number } | { left?: MarkedRow; right?: MarkedRow };

function LineCell({ row, side }: { row?: MarkedRow; side: 'left' | 'right' }) {
  const marked = row?.segments;
  const tint = side === 'left' ? 'diff__del' : 'diff__ins';
  const kind = side === 'left' ? 'removed' : 'added';

  if (!row) return <td />;
  if (row.kind !== kind) return <td>{row.text}</td>;

  return (
    <td class={tint}>
      {marked
        ? marked.map((segment, i) =>
            segment.changed ? (
              // eslint-disable-next-line react/no-array-index-key
              <mark key={i} class="diff__word">
                {segment.text}
              </mark>
            ) : (
              // eslint-disable-next-line react/no-array-index-key
              <span key={i}>{segment.text}</span>
            ),
          )
        : row.text}
    </td>
  );
}

export function Diff() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const result = useMemo(
    () => computeDiff(state.left, state.right, state.granularity, state),
    [
      state.left,
      state.right,
      state.granularity,
      state.ignoreCase,
      state.ignoreWhitespace,
      state.normaliseEol,
      state.trimTrailing,
    ],
  );

  const visible = useMemo(
    () => (state.collapsed ? collapse(result.rows, CONTEXT) : result.rows),
    [result.rows, state.collapsed],
  );

  const pairs = useMemo((): MarkedPair[] => {
    return toSideBySide(visible).map((pair) => {
      if (isSkip(pair)) return pair;
      // Only a removal sitting opposite an addition is an edit worth marking.
      if (pair.left?.kind !== 'removed' || pair.right?.kind !== 'added') return pair;

      const marked = wordSegments(pair.left.text, pair.right.text);
      if (!marked) return pair;

      return {
        left: { ...pair.left, segments: marked.left },
        right: { ...pair.right, segments: marked.right },
      };
    });
  }, [visible]);

  const unified = useMemo(() => toUnified(result.rows), [result.rows]);

  const lineMode = state.granularity === 'lines';

  return (
    <ToolShell slug="diff" wide>
      <div class="stack">
        <div class="grid-2">
          <label class="field">
            <span class="field__label">Left</span>
            <textarea
              value={state.left}
              spellcheck={false}
              style="min-height:200px"
              onInput={(e) => set('left', (e.target as HTMLTextAreaElement).value)}
            />
          </label>

          <label class="field">
            <span class="field__label">Right</span>
            <textarea
              value={state.right}
              spellcheck={false}
              style="min-height:200px"
              onInput={(e) => set('right', (e.target as HTMLTextAreaElement).value)}
            />
          </label>
        </div>

        <div class="row">
          <Segmented
            label="Granularity"
            options={GRANULARITIES}
            value={state.granularity}
            names={{ lines: 'Lines', words: 'Words', chars: 'Characters' }}
            onChange={(next) => set('granularity', next)}
          />

          {lineMode && (
            <Segmented
              label="View"
              options={['split', 'unified'] as const}
              value={state.view}
              names={{ split: 'Side by side', unified: 'Unified' }}
              onChange={(next) => set('view', next)}
            />
          )}

          <span class="topbar__spacer" />

          <button type="button" onClick={() => setState({ ...state, left: state.right, right: state.left })}>
            Swap
          </button>
          {lineMode && <CopyButton value={unified} label="Copy as patch" />}
        </div>

        <div class="row small">
          <label class="checkbox">
            <input
              type="checkbox"
              checked={state.ignoreCase}
              onChange={(e) => set('ignoreCase', (e.target as HTMLInputElement).checked)}
            />
            Ignore case
          </label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={state.ignoreWhitespace}
              onChange={(e) => set('ignoreWhitespace', (e.target as HTMLInputElement).checked)}
            />
            Ignore surrounding whitespace
          </label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={state.normaliseEol}
              onChange={(e) => set('normaliseEol', (e.target as HTMLInputElement).checked)}
            />
            Normalise CRLF
          </label>
          <label class="checkbox">
            <input
              type="checkbox"
              checked={state.trimTrailing}
              onChange={(e) => set('trimTrailing', (e.target as HTMLInputElement).checked)}
            />
            Trim trailing whitespace
          </label>
          {lineMode && (
            <label class="checkbox">
              <input
                type="checkbox"
                checked={state.collapsed}
                onChange={(e) => set('collapsed', (e.target as HTMLInputElement).checked)}
              />
              Hide unchanged
            </label>
          )}
        </div>

        {result.summary.identical ? (
          <div class="note note--ok">
            ✓ No differences{state.ignoreCase || state.ignoreWhitespace ? ' under these options' : ''}.
          </div>
        ) : (
          // A diff that found changes is the expected outcome, not a warning, so
          // it reads as a tally rather than a coloured slab.
          <div class="tally">
            <span class="tally__add">+{result.summary.added}</span>
            <span class="tally__del">−{result.summary.removed}</span>
            <span class="tally__unit">
              {lineMode ? 'lines' : state.granularity === 'words' ? 'words' : 'characters'} changed
            </span>
            <span class="tally__rest">{result.summary.unchanged} unchanged</span>
          </div>
        )}

        {lineMode ? (
          <div class="table-scroll">
            {state.view === 'split' ? (
              <table class="diff">
                <colgroup>
                  <col style="width:1%" />
                  <col style="width:49%" />
                  <col style="width:1%" />
                  <col style="width:49%" />
                </colgroup>
                <tbody>
                  {pairs.map((pair, i) =>
                    isSkip(pair) ? (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i} class="diff__skip">
                        <td colSpan={4}>⋯ {pair.skip} unchanged lines</td>
                      </tr>
                    ) : (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i}>
                        <td class="diff__gutter">{pair.left?.leftNo ?? ''}</td>
                        <LineCell row={pair.left} side="left" />
                        <td class="diff__gutter">{pair.right?.rightNo ?? ''}</td>
                        <LineCell row={pair.right} side="right" />
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            ) : (
              <table class="diff">
                <colgroup>
                  <col style="width:1%" />
                  <col style="width:1%" />
                  <col />
                </colgroup>
                <tbody>
                  {visible.map((row, i) =>
                    row.kind === 'skip' ? (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i} class="diff__skip">
                        <td colSpan={3}>⋯ {row.count} unchanged lines</td>
                      </tr>
                    ) : (
                      // eslint-disable-next-line react/no-array-index-key
                      <tr key={i}>
                        <td class="diff__gutter">{row.leftNo ?? ''}</td>
                        <td class="diff__gutter">{row.rightNo ?? ''}</td>
                        <td
                          class={
                            row.kind === 'added'
                              ? 'diff__ins'
                              : row.kind === 'removed'
                                ? 'diff__del'
                                : undefined
                          }
                        >
                          {row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}
                          {row.text}
                        </td>
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            )}
          </div>
        ) : (
          <pre class="output inline-diff">
            {result.inlineChanges.map((change, i) =>
              change.added ? (
                // eslint-disable-next-line react/no-array-index-key
                <ins key={i}>{change.value}</ins>
              ) : change.removed ? (
                // eslint-disable-next-line react/no-array-index-key
                <del key={i}>{change.value}</del>
              ) : (
                // eslint-disable-next-line react/no-array-index-key
                <span key={i}>{change.value}</span>
              ),
            )}
          </pre>
        )}
      </div>
    </ToolShell>
  );
}
