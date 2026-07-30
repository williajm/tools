/**
 * XPath and CSS selector evaluation against pasted markup.
 *
 * Zero dependencies: DOMParser and document.evaluate are both native. The
 * parsing happens in a detached document, so nothing in the pasted markup can
 * load, execute or affect the host page.
 *
 * Note this is XPath 1.0 — what browsers implement, and what Selenium and
 * Playwright expose. XPath 2.0+ functions will not work here, and neither will
 * they work in those tools, so that limitation is the useful one to match.
 */

export type Language = 'xpath' | 'css';
export type DocumentKind = 'html' | 'xml';

export interface Hit {
  /** 1-based, matching XPath's own indexing convention. */
  position: number;
  nodeType: string;
  nodeName: string;
  /** Outer markup for elements, value for attributes and text. */
  markup: string;
  textContent: string;
  /** A unique CSS path back to this node, for use as a test locator. */
  cssPath?: string;
  /** An absolute XPath back to this node. */
  xpath?: string;
}

export interface QueryResult {
  hits: Hit[];
  /** XPath can return a number, string or boolean rather than a node set. */
  scalar?: string;
  error?: string;
  parseError?: string;
}

const NODE_TYPES: Record<number, string> = {
  1: 'element',
  2: 'attribute',
  3: 'text',
  4: 'cdata',
  7: 'processing-instruction',
  8: 'comment',
  9: 'document',
  10: 'doctype',
  11: 'fragment',
};

export function parseDocument(source: string, kind: DocumentKind): { doc?: Document; error?: string } {
  const parser = new DOMParser();

  if (kind === 'xml') {
    const doc = parser.parseFromString(source, 'application/xml');
    // XML parse failures surface as a <parsererror> element rather than throwing.
    const failure = doc.querySelector('parsererror');
    if (failure) {
      return { error: failure.textContent?.trim() || 'The XML could not be parsed.' };
    }
    return { doc };
  }

  // HTML parsing never fails; it recovers. That is what browsers do, so it is
  // also what a selector-testing tool should reflect.
  return { doc: parser.parseFromString(source, 'text/html') };
}

/**
 * CSS.escape is available in every current browser but absent from some
 * non-browser DOM implementations, so fall back rather than crash.
 */
function escapeIdent(value: string): string {
  if (typeof CSS !== 'undefined' && typeof CSS.escape === 'function') return CSS.escape(value);
  return value.replace(/[^\w-]/g, (c) => `\\${c}`);
}

/** Builds a stable CSS path, preferring an id when one is present. */
export function cssPathOf(element: Element): string {
  if (element.id) return `#${escapeIdent(element.id)}`;

  const parts: string[] = [];
  let current: Element | null = element;

  while (current && current.nodeType === 1) {
    if (current.id) {
      parts.unshift(`#${escapeIdent(current.id)}`);
      break;
    }

    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;
    if (!parent) {
      parts.unshift(tag);
      break;
    }

    const siblings = [...parent.children].filter((c) => c.tagName === current!.tagName);
    parts.unshift(
      siblings.length > 1 ? `${tag}:nth-of-type(${siblings.indexOf(current) + 1})` : tag,
    );
    current = parent;
  }

  return parts.join(' > ');
}

/** Builds an absolute XPath with positional predicates. */
export function xpathOf(node: Node): string {
  if (node.nodeType === 2) {
    const attr = node as Attr;
    const owner = attr.ownerElement;
    return owner ? `${xpathOf(owner)}/@${attr.name}` : `@${attr.name}`;
  }

  const parts: string[] = [];
  let current: Node | null = node;

  while (current && current.nodeType === 1) {
    const element = current as Element;
    const parent: Element | null = element.parentElement;
    if (!parent) {
      parts.unshift(`/${element.tagName.toLowerCase()}`);
      break;
    }
    const siblings = [...parent.children].filter((c) => c.tagName === element.tagName);
    const index = siblings.indexOf(element) + 1;
    parts.unshift(
      siblings.length > 1
        ? `/${element.tagName.toLowerCase()}[${index}]`
        : `/${element.tagName.toLowerCase()}`,
    );
    current = parent;
  }

  return parts.join('') || '/';
}

const MAX_HITS = 500;

function describe(node: Node, position: number): Hit {
  const nodeType = NODE_TYPES[node.nodeType] ?? String(node.nodeType);

  let markup: string;
  if (node.nodeType === 1) markup = (node as Element).outerHTML;
  else if (node.nodeType === 2) markup = `${(node as Attr).name}="${(node as Attr).value}"`;
  else markup = node.nodeValue ?? '';

  return {
    position,
    nodeType,
    nodeName: node.nodeName.toLowerCase(),
    markup,
    textContent: node.textContent ?? '',
    cssPath: node.nodeType === 1 ? cssPathOf(node as Element) : undefined,
    xpath: node.nodeType === 1 || node.nodeType === 2 ? xpathOf(node) : undefined,
  };
}

export function query(source: string, expression: string, language: Language, kind: DocumentKind): QueryResult {
  const { doc, error: parseError } = parseDocument(source, kind);
  if (!doc) return { hits: [], parseError };
  if (!expression.trim()) return { hits: [] };

  if (language === 'css') {
    try {
      const found = [...doc.querySelectorAll(expression)];
      return { hits: found.slice(0, MAX_HITS).map((el, i) => describe(el, i + 1)) };
    } catch (err) {
      return {
        hits: [],
        error: err instanceof Error ? err.message : 'Invalid CSS selector.',
      };
    }
  }

  try {
    const evaluated = doc.evaluate(expression, doc, null, 0 /* ANY_TYPE */, null);

    switch (evaluated.resultType) {
      case 1: // NUMBER
        return { hits: [], scalar: String(evaluated.numberValue) };
      case 2: // STRING
        return { hits: [], scalar: evaluated.stringValue };
      case 3: // BOOLEAN
        return { hits: [], scalar: String(evaluated.booleanValue) };
      default: {
        const hits: Hit[] = [];
        let node = evaluated.iterateNext();
        let i = 0;
        while (node && hits.length < MAX_HITS) {
          hits.push(describe(node, ++i));
          node = evaluated.iterateNext();
        }
        return { hits };
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Engines report XPath problems tersely ("Unknown function: ends-with"), and
    // the most common cause by far is reaching for a 2.0 function. Say so.
    const looksLikeVersionIssue = /invalid|syntax|expression|unknown|function/i.test(message);
    return {
      hits: [],
      error: looksLikeVersionIssue
        ? `${message} — this is XPath 1.0, so 2.0+ functions such as matches(), ends-with() and lower-case() are unavailable (the same limitation applies in browsers, Selenium and Playwright).`
        : message,
    };
  }
}

// --- locator export ----------------------------------------------------------

export type LocatorFlavour = 'playwright-css' | 'playwright-xpath' | 'selenium-css' | 'selenium-xpath' | 'cypress';

export const LOCATOR_NAMES: Record<LocatorFlavour, string> = {
  'playwright-css': 'Playwright (CSS)',
  'playwright-xpath': 'Playwright (XPath)',
  'selenium-css': 'Selenium (CSS)',
  'selenium-xpath': 'Selenium (XPath)',
  cypress: 'Cypress',
};

function quote(value: string): string {
  return `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

export function toLocator(hit: Hit, flavour: LocatorFlavour): string {
  const css = hit.cssPath ?? '';
  const xpath = hit.xpath ?? '';

  switch (flavour) {
    case 'playwright-css': return `page.locator(${quote(css)})`;
    case 'playwright-xpath': return `page.locator(${quote(`xpath=${xpath}`)})`;
    case 'selenium-css': return `driver.find_element(By.CSS_SELECTOR, ${quote(css)})`;
    case 'selenium-xpath': return `driver.find_element(By.XPATH, ${quote(xpath)})`;
    case 'cypress': return `cy.get(${quote(css)})`;
  }
}
