import { useMemo, useState } from 'preact/hooks';
import { ToolShell } from '@shared/components/ToolShell.tsx';
import { CopyButton } from '@shared/components/CopyButton.tsx';
import { Segmented } from '@shared/components/Segmented.tsx';
import { useHashState } from '@shared/hooks/useHashState.ts';
import {
  LOCATOR_NAMES,
  query,
  toLocator,
  type DocumentKind,
  type Language,
  type LocatorFlavour,
} from './query.ts';

interface State {
  source: string;
  expression: string;
  language: Language;
  kind: DocumentKind;
}

const EXAMPLE = `<div id="checkout" class="panel">
  <h1>Your basket</h1>
  <ul class="items">
    <li class="item" data-sku="A-1">Widget <span class="price">£9.99</span></li>
    <li class="item" data-sku="B-2">Gizmo <span class="price">£24.50</span></li>
    <li class="item out-of-stock" data-sku="C-3">Doohickey <span class="price">£4.00</span></li>
  </ul>
  <button type="submit" name="pay">Pay now</button>
</div>`;

const INITIAL: State = {
  source: EXAMPLE,
  expression: '//li[contains(@class,"item")]//span[@class="price"]',
  language: 'xpath',
  kind: 'html',
};

export function Xpath() {
  const [state, setState] = useHashState<State>(INITIAL);
  const set = <K extends keyof State>(key: K, value: State[K]) => setState({ ...state, [key]: value });

  const [flavour, setFlavour] = useState<LocatorFlavour>('playwright-css');

  const result = useMemo(
    () => query(state.source, state.expression, state.language, state.kind),
    [state.source, state.expression, state.language, state.kind],
  );

  return (
    <ToolShell slug="xpath" wide>
      <div class="stack">
        <div class="row">
          <Segmented
            label="Language"
            options={['xpath', 'css'] as const}
            value={state.language}
            names={{ xpath: 'XPath', css: 'CSS selector' }}
            onChange={(next) => set('language', next)}
          />
          <Segmented
            label="Document"
            options={['html', 'xml'] as const}
            value={state.kind}
            names={{ html: 'HTML', xml: 'XML' }}
            onChange={(next) => set('kind', next)}
          />
        </div>

        <label class="field">
          <span class="field__label">
            {state.language === 'xpath' ? 'XPath expression' : 'CSS selector'}
          </span>
          <input
            type="text"
            value={state.expression}
            spellcheck={false}
            placeholder={state.language === 'xpath' ? '//div[@id="main"]//a' : '#main a.link'}
            onInput={(e) => set('expression', (e.target as HTMLInputElement).value)}
          />
        </label>

        <label class="field">
          <span class="field__label">Document</span>
          <textarea
            value={state.source}
            spellcheck={false}
            style="min-height:170px"
            onInput={(e) => set('source', (e.target as HTMLTextAreaElement).value)}
          />
        </label>

        <div class="note note--ok small">
          Parsed into a detached document — nothing in the markup can load, run or reach the
          network.
        </div>

        {result.parseError && <div class="note note--error mono small">{result.parseError}</div>}
        {result.error && <div class="note note--error small">{result.error}</div>}

        {result.scalar !== undefined && (
          <div class="stack stack--tight">
            <span class="field__label">Result</span>
            <pre class="output">{result.scalar}</pre>
          </div>
        )}

        {!result.error && !result.parseError && result.scalar === undefined && (
          <>
            <div class="row">
              <span class={result.hits.length ? 'note note--ok' : 'note note--warn'}>
                {result.hits.length} node{result.hits.length === 1 ? '' : 's'} matched
              </span>
              <span class="topbar__spacer" />
              <label class="row row--tight small">
                <span class="field__label">Copy as</span>
                <select
                  value={flavour}
                  onChange={(e) => setFlavour((e.target as HTMLSelectElement).value as LocatorFlavour)}
                >
                  {Object.entries(LOCATOR_NAMES).map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
              <CopyButton
                value={result.hits
                  .map((h) => toLocator(h, flavour))
                  .filter((locator): locator is string => locator !== null)
                  .join('\n')}
                label="Copy locators"
              />
            </div>

            {result.hits.length > 0 && (
              <div class="table-scroll">
                <table class="data">
                  <thead>
                    <tr>
                      <th style="width:3rem">#</th>
                      <th style="width:6rem">Type</th>
                      <th>Markup</th>
                      <th style="width:22rem">Locator</th>
                      <th style="width:5rem" />
                    </tr>
                  </thead>
                  <tbody>
                    {result.hits.map((hit) => {
                      const locator = toLocator(hit, flavour);
                      return (
                        <tr key={`${hit.position}-${hit.nodeName}`}>
                          <td class="num faint">{hit.position}</td>
                          <td class="small">
                            <span class="mono">{hit.nodeName}</span>
                            <br />
                            <span class="faint">{hit.nodeType}</span>
                          </td>
                          <td class="mono wrap-anywhere small">{hit.markup}</td>
                          {/*
                            A CSS flavour cannot address an attribute or text
                            node, so say so rather than offering an empty
                            selector that looks copy-pasteable.
                          */}
                          <td class="mono wrap-anywhere small">
                            {locator ?? (
                              <span class="faint">
                                no {flavour.includes('xpath') ? 'XPath' : 'CSS'} locator for a{' '}
                                {hit.nodeType} node
                              </span>
                            )}
                          </td>
                          <td>
                            <CopyButton value={locator ?? ''} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>
    </ToolShell>
  );
}
