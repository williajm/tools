/**
 * Text designed to break things.
 *
 * Same generator as the placeholder text, different word bank — these are the
 * inputs that expose truncation, normalisation, bidi and grapheme-clustering
 * bugs. Anything that survives this list is unlikely to be surprised in production.
 */

export interface EdgeCase {
  id: string;
  name: string;
  value: string;
  why: string;
}

export const EDGE_CASES: readonly EdgeCase[] = [
  {
    id: 'zero-width',
    name: 'Zero-width characters',
    value: 'a​b‌c‍d﻿e',
    why: 'Renders as "abcde" but is 9 code points. Breaks length checks and equality.',
  },
  {
    id: 'combining',
    name: 'Combining diacritics',
    value: 'é̂̃̄ vs é',
    why: 'Visually similar to precomposed forms but different bytes. Needs NFC normalisation.',
  },
  {
    id: 'zalgo',
    name: 'Stacked marks (zalgo)',
    value: 'Z͑ͫ̓ͪ̂a̕̚͢l̴̙̤g̸ͅo̳͜',
    why: 'Unbounded combining marks overflow line boxes and can cover adjacent UI.',
  },
  {
    id: 'emoji-zwj',
    name: 'Emoji ZWJ sequences',
    value: '👨‍👩‍👧‍👦 🏳️‍🌈 👩🏽‍💻',
    why: 'One visible glyph, many code points. Naive truncation splits it into garbage.',
  },
  {
    id: 'rtl-override',
    name: 'Bidi override',
    value: 'file‮gnp.js‬',
    why: 'Reverses displayed order — the classic filename-spoofing trick. Strip these.',
  },
  {
    id: 'long-word',
    name: 'Unbroken long word',
    value: 'A'.repeat(240),
    why: 'No break opportunity. Overflows any container without overflow-wrap set.',
  },
  {
    id: 'quotes',
    name: 'Quotes and escapes',
    value: `He said "it's fine" -- \\n \\t <b>&amp;</b> '; DROP TABLE--`,
    why: 'Shakes out escaping bugs across HTML, JSON, CSV and SQL layers.',
  },
  {
    id: 'whitespace',
    name: 'Exotic whitespace',
    value: 'a b c　d e f',
    why: 'Non-breaking, em, ideographic spaces plus line/paragraph separators.',
  },
  {
    id: 'homoglyph',
    name: 'Homoglyphs',
    value: 'pаypаl.com аpple.com', // Cyrillic а
    why: 'Cyrillic а for Latin a. Identical on screen, different string.',
  },
  {
    id: 'surrogate',
    name: 'Astral plane',
    value: '𝕳𝖊𝖑𝖑𝖔 𝟙𝟚𝟛 𐍈 𠜎',
    why: 'Above U+FFFF, so each is a surrogate pair. Breaks code-unit indexing.',
  },
  {
    id: 'casing',
    name: 'Casing edge cases',
    value: 'İstanbul ﬁ ǆ ß STRASSE',
    why: 'Turkish dotted I, ligatures and ß do not round-trip through case conversion.',
  },
  {
    id: 'numeric',
    name: 'Numeric lookalikes',
    value: '٤٢ ４２ 42 ⅘ ½ 1e10 NaN -0 0x2A',
    why: 'Arabic-Indic and full-width digits parse differently, or not at all.',
  },
];

export function edgeCaseById(id: string): EdgeCase | undefined {
  return EDGE_CASES.find((e) => e.id === id);
}
