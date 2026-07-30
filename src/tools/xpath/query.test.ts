import { describe, it, expect } from 'vitest';
import { LOCATOR_NAMES, cssPathOf, parseDocument, query, toLocator, xpathOf } from './query.ts';

const HTML = `<!doctype html>
<html><body>
  <div id="main" class="container">
    <h1>Title</h1>
    <ul class="list">
      <li class="item" data-id="1">First</li>
      <li class="item" data-id="2">Second</li>
      <li class="item selected" data-id="3">Third</li>
    </ul>
    <a href="https://example.com">Link</a>
  </div>
</body></html>`;

describe('parseDocument', () => {
  it('parses HTML', () => {
    const { doc, error } = parseDocument(HTML, 'html');
    expect(error).toBeUndefined();
    expect(doc!.querySelector('#main')).not.toBeNull();
  });

  it('recovers from malformed HTML the way a browser does', () => {
    const { doc, error } = parseDocument('<div><p>unclosed', 'html');
    expect(error).toBeUndefined();
    expect(doc!.querySelector('p')).not.toBeNull();
  });

  it('reports malformed XML rather than recovering', () => {
    const { doc, error } = parseDocument('<a><b></a>', 'xml');
    expect(doc).toBeUndefined();
    expect(error).toBeTruthy();
  });

  it('parses well-formed XML', () => {
    const { doc, error } = parseDocument('<root><child>x</child></root>', 'xml');
    expect(error).toBeUndefined();
    expect(doc!.querySelector('child')?.textContent).toBe('x');
  });
});

describe('CSS selectors', () => {
  it('finds matching elements in order', () => {
    const result = query(HTML, 'li.item', 'css', 'html');
    expect(result.error).toBeUndefined();
    expect(result.hits).toHaveLength(3);
    expect(result.hits.map((h) => h.textContent)).toEqual(['First', 'Second', 'Third']);
    expect(result.hits.map((h) => h.position)).toEqual([1, 2, 3]);
  });

  it('supports attribute selectors', () => {
    const result = query(HTML, 'li[data-id="2"]', 'css', 'html');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.textContent).toBe('Second');
  });

  it('returns no hits for a valid selector that matches nothing', () => {
    const result = query(HTML, 'table', 'css', 'html');
    expect(result.error).toBeUndefined();
    expect(result.hits).toEqual([]);
  });

  it('reports an invalid selector', () => {
    const result = query(HTML, 'div >>> span', 'css', 'html');
    expect(result.error).toBeTruthy();
    expect(result.hits).toEqual([]);
  });
});

describe('XPath', () => {
  it('finds elements by path', () => {
    const result = query(HTML, '//li[@class="item"]', 'xpath', 'html');
    expect(result.error).toBeUndefined();
    expect(result.hits).toHaveLength(2); // "item selected" is a different class string
  });

  it('supports contains()', () => {
    const result = query(HTML, '//li[contains(@class,"item")]', 'xpath', 'html');
    expect(result.hits).toHaveLength(3);
  });

  it('supports positional predicates', () => {
    const result = query(HTML, '(//li)[2]', 'xpath', 'html');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.textContent).toBe('Second');
  });

  it('selects attribute nodes', () => {
    const result = query(HTML, '//a/@href', 'xpath', 'html');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.nodeType).toBe('attribute');
    expect(result.hits[0]!.markup).toBe('href="https://example.com"');
  });

  it('selects text nodes', () => {
    const result = query(HTML, '//h1/text()', 'xpath', 'html');
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]!.nodeType).toBe('text');
    expect(result.hits[0]!.markup).toBe('Title');
  });

  it('returns a number for count()', () => {
    const result = query(HTML, 'count(//li)', 'xpath', 'html');
    expect(result.scalar).toBe('3');
    expect(result.hits).toEqual([]);
  });

  it('returns a string for string-length()', () => {
    const result = query(HTML, 'string(//h1)', 'xpath', 'html');
    expect(result.scalar).toBe('Title');
  });

  it('returns a boolean for a boolean expression', () => {
    expect(query(HTML, 'count(//li) > 2', 'xpath', 'html').scalar).toBe('true');
    expect(query(HTML, 'count(//li) > 9', 'xpath', 'html').scalar).toBe('false');
  });

  it('explains that XPath 2.0 functions are unavailable', () => {
    // ends-with() is XPath 2.0; browsers, Selenium and Playwright all reject it.
    const result = query(HTML, '//li[ends-with(@data-id,"1")]', 'xpath', 'html');
    expect(result.error).toBeTruthy();
    expect(result.error).toMatch(/XPath 1\.0/);
  });

  it('does not throw on a malformed expression', () => {
    // Engines disagree here: browsers throw on an unterminated predicate, jsdom
    // returns an empty node set. Either is acceptable — the contract is that
    // query() never lets an exception escape.
    expect(() => query(HTML, '//li[', 'xpath', 'html')).not.toThrow();
    const result = query(HTML, '//li[', 'xpath', 'html');
    expect(result.hits).toEqual([]);
  });
});

describe('cssPathOf', () => {
  it('prefers an id when present', () => {
    const { doc } = parseDocument(HTML, 'html');
    expect(cssPathOf(doc!.querySelector('#main')!)).toBe('#main');
  });

  it('uses nth-of-type to disambiguate siblings', () => {
    const { doc } = parseDocument(HTML, 'html');
    const third = doc!.querySelectorAll('li')[2]!;
    const path = cssPathOf(third);
    expect(path).toContain('nth-of-type(3)');
    // The generated path must actually resolve back to the same node.
    expect(doc!.querySelector(path)).toBe(third);
  });

  it('generates paths that round-trip for every element', () => {
    const { doc } = parseDocument(HTML, 'html');
    for (const el of doc!.querySelectorAll('*')) {
      const path = cssPathOf(el);
      expect(doc!.querySelector(path), path).toBe(el);
    }
  });

  /**
   * Regression: an id was used as a shortcut without checking it identified
   * anything. Duplicate ids are invalid HTML and common in pasted markup — which
   * is the markup being debugged — and `#dup` resolves to the first match, so the
   * locator handed back pointed at a different element than the one selected.
   */
  describe('duplicate ids', () => {
    const DUPES = `<!doctype html><html><body>
      <div id="wrap"><span id="dup">first</span></div>
      <div id="other"><span id="dup">second</span></div>
    </body></html>`;

    it('does not shortcut to a duplicated id', () => {
      const { doc } = parseDocument(DUPES, 'html');
      const second = doc!.querySelectorAll('#dup')[1]!;
      expect(second.textContent).toBe('second');
      const path = cssPathOf(second);
      expect(path).not.toBe('#dup');
      expect(doc!.querySelector(path)).toBe(second);
    });

    it('does not anchor on a duplicated ancestor id either', () => {
      const { doc } = parseDocument(
        `<!doctype html><html><body>
           <div id="dup"><p>one</p></div>
           <div id="dup"><p><b>two</b></p></div>
         </body></html>`,
        'html',
      );
      const target = doc!.querySelectorAll('b')[0]!;
      const path = cssPathOf(target);
      expect(doc!.querySelector(path)).toBe(target);
    });

    it('still uses an id that is genuinely unique in the same document', () => {
      const { doc } = parseDocument(DUPES, 'html');
      expect(cssPathOf(doc!.querySelector('#other')!)).toBe('#other');
    });

    it('round-trips every element even with duplicates present', () => {
      const { doc } = parseDocument(DUPES, 'html');
      for (const el of doc!.querySelectorAll('*')) {
        const path = cssPathOf(el);
        expect(doc!.querySelector(path), path).toBe(el);
      }
    });
  });
});

describe('xpathOf', () => {
  it('generates an absolute path that round-trips', () => {
    const { doc } = parseDocument(HTML, 'html');
    for (const el of doc!.querySelectorAll('li, h1, a')) {
      const path = xpathOf(el);
      const found = doc!.evaluate(path, doc!, null, 9 /* FIRST_ORDERED_NODE */, null).singleNodeValue;
      expect(found, path).toBe(el);
    }
  });

  it('handles attribute nodes', () => {
    const { doc } = parseDocument(HTML, 'html');
    const attr = doc!.querySelector('a')!.getAttributeNode('href')!;
    expect(xpathOf(attr)).toMatch(/\/@href$/);
  });
});

describe('toLocator', () => {
  const hit = {
    position: 1,
    nodeType: 'element',
    nodeName: 'li',
    markup: '<li></li>',
    textContent: '',
    cssPath: '#main > ul > li:nth-of-type(2)',
    xpath: '/html/body/div/ul/li[2]',
  };

  it('emits Playwright locators', () => {
    expect(toLocator(hit, 'playwright-css')).toBe(
      "page.locator('#main > ul > li:nth-of-type(2)')",
    );
    expect(toLocator(hit, 'playwright-xpath')).toBe(
      "page.locator('xpath=/html/body/div/ul/li[2]')",
    );
  });

  it('emits Selenium locators', () => {
    expect(toLocator(hit, 'selenium-css')).toContain('By.CSS_SELECTOR');
    expect(toLocator(hit, 'selenium-xpath')).toContain('By.XPATH');
  });

  it('emits a Cypress locator', () => {
    expect(toLocator(hit, 'cypress')).toBe("cy.get('#main > ul > li:nth-of-type(2)')");
  });

  it('escapes quotes so the locator stays a valid single-quoted literal', () => {
    const tricky = { ...hit, cssPath: "div[title='it\\'s']" };
    const out = toLocator(tricky, 'cypress')!;

    // Nothing inside the literal may terminate it early.
    const inner = out.slice("cy.get('".length, -"')".length);
    expect(inner.replace(/\\./g, '')).not.toContain("'");

    // And the original selector must be recoverable.
    expect(inner.replace(/\\(['\\])/g, '$1')).toBe(tricky.cssPath);
  });
});

describe('safety', () => {
  it('does not execute scripts in pasted markup', () => {
    // DOMParser builds an inert document — scripts never run. If this ever
    // regressed, pasting a page from the internet would be dangerous.
    const before = (globalThis as Record<string, unknown>)['__xss'];
    query('<img src=x onerror="globalThis.__xss=1"><script>globalThis.__xss=1</script>', '//img', 'xpath', 'html');
    expect((globalThis as Record<string, unknown>)['__xss']).toBe(before);
  });
});

/**
 * Regression: element names were lower-cased regardless of document type. XML
 * preserves case and matches exactly, so `/root/item` selects nothing in a
 * document of `<Root><Item/></Root>` — the locators handed back matched nothing.
 * jsdom's XPath is case-insensitive, so the browser check lives in the e2e suite.
 */
describe('XML is case-sensitive', () => {
  const XML = '<Root><Item id="a"/><Item/></Root>';

  it('preserves element case in an XPath', () => {
    const { doc } = parseDocument(XML, 'xml');
    const second = doc!.getElementsByTagName('Item')[1]!;
    expect(xpathOf(second)).toBe('/Root/Item[2]');
  });

  it('preserves element case in a CSS path', () => {
    const { doc } = parseDocument(XML, 'xml');
    const second = doc!.getElementsByTagName('Item')[1]!;
    expect(cssPathOf(second)).toBe('Root > Item:nth-of-type(2)');
  });

  it('preserves case in the reported node name', () => {
    const result = query(XML, '//Item', 'xpath', 'xml');
    expect(result.hits[0]!.nodeName).toBe('Item');
  });

  it('still lower-cases for HTML, where selectors are case-insensitive', () => {
    const { doc } = parseDocument('<html><body><DIV><P>x</P></DIV></body></html>', 'html');
    const p = doc!.getElementsByTagName('p')[0]!;
    expect(xpathOf(p)).toBe('/html/body/div/p');
    expect(cssPathOf(p)).toBe('html > body > div > p');
  });
});

/**
 * Regression: an attribute or text hit has no CSS path, and the empty string was
 * substituted — producing `page.locator('')`, which is not merely useless but
 * wrong, and looks copy-pasteable.
 */
describe('toLocator declines what it cannot express', () => {
  const attrHit = {
    position: 1,
    nodeType: 'attribute',
    nodeName: 'href',
    markup: 'href="/x"',
    textContent: '/x',
    xpath: '/html/body/a/@href',
  };

  it('returns null for CSS flavours on an attribute', () => {
    expect(toLocator(attrHit, 'playwright-css')).toBeNull();
    expect(toLocator(attrHit, 'selenium-css')).toBeNull();
    expect(toLocator(attrHit, 'cypress')).toBeNull();
  });

  it('still returns an XPath locator for an attribute', () => {
    expect(toLocator(attrHit, 'playwright-xpath')).toContain('/html/body/a/@href');
    expect(toLocator(attrHit, 'selenium-xpath')).toContain('/html/body/a/@href');
  });

  it('returns null for every flavour on a text node, which has neither path', () => {
    const textHit = { ...attrHit, nodeType: 'text', nodeName: '#text', xpath: undefined };
    for (const flavour of Object.keys(LOCATOR_NAMES) as Array<keyof typeof LOCATOR_NAMES>) {
      expect(toLocator(textHit, flavour), flavour).toBeNull();
    }
  });

  it('never emits an empty selector', () => {
    const hits = [attrHit, { ...attrHit, nodeType: 'text', xpath: undefined }];
    for (const hit of hits) {
      for (const flavour of Object.keys(LOCATOR_NAMES) as Array<keyof typeof LOCATOR_NAMES>) {
        const out = toLocator(hit, flavour);
        if (out !== null) expect(out, flavour).not.toMatch(/\(''\)|=''/);
      }
    }
  });
});
