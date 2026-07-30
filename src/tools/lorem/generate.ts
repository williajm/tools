import { makeRng, type Rng } from './rng.ts';
import { scriptById, type ScriptId } from './scripts.ts';
import { EDGE_CASES } from './edge.ts';

export type Unit = 'paragraphs' | 'sentences' | 'words' | 'list-items' | 'characters' | 'bytes';
export type Format = 'text' | 'html' | 'markdown';

export const UNITS: readonly Unit[] = [
  'paragraphs',
  'sentences',
  'words',
  'list-items',
  'characters',
  'bytes',
];

export const FORMATS: readonly Format[] = ['text', 'html', 'markdown'];

export interface Options {
  script: ScriptId;
  unit: Unit;
  count: number;
  format: Format;
  seed: string;
  /** Start the first paragraph with the conventional "Lorem ipsum dolor sit amet". */
  classicOpening: boolean;
}

const CLASSIC_OPENING = 'Lorem ipsum dolor sit amet, consectetur adipiscing elit';

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function joinWords(words: string[], unspaced: boolean): string {
  return words.join(unspaced ? '' : ' ');
}

function sentence(rng: Rng, script: ScriptId): string {
  const def = scriptById(script);
  const length = 6 + rng.int(10);
  const words: string[] = [];
  for (let i = 0; i < length; i++) words.push(rng.pick(def.words));

  const body = joinWords(words, def.unspaced);
  // CJK and Thai use their own terminal punctuation.
  const stop = def.id === 'cjk-han' || def.id === 'japanese' ? '。' : '.';
  return (def.rtl || def.unspaced ? body : capitalise(body)) + stop;
}

function paragraph(rng: Rng, script: ScriptId, sentences = 3 + rng.int(3)): string {
  return Array.from({ length: sentences }, () => sentence(rng, script)).join(' ');
}

/** Truncates to an exact character or UTF-8 byte budget without splitting graphemes. */
function trimTo(text: string, limit: number, mode: 'characters' | 'bytes'): string {
  if (mode === 'characters') {
    // Iterate by code point so a surrogate pair is never cut in half.
    const points = [...text];
    return points.length <= limit ? text : points.slice(0, limit).join('');
  }

  const encoder = new TextEncoder();
  if (encoder.encode(text).length <= limit) return text;

  let out = '';
  let used = 0;
  for (const ch of text) {
    const size = encoder.encode(ch).length;
    if (used + size > limit) break;
    out += ch;
    used += size;
  }

  /**
   * Fill the remainder with single-byte characters so the budget is met exactly.
   *
   * A multi-byte script cannot always land on the target: a Japanese character is
   * three bytes, so a two-byte budget could not be filled at all and returned an
   * empty string, and a four-byte budget stopped at three. This mode exists to
   * produce a value of an exact byte length — for a column limit or a header
   * budget — so falling short is the one thing it must not do. ASCII letters are
   * the only characters that can close a gap of one or two bytes.
   */
  const FILLER = 'abcdefghijklmnopqrstuvwxyz';
  let index = 0;
  while (used < limit) {
    out += FILLER[index++ % FILLER.length];
    used += 1;
  }

  return out;
}

function padTo(rng: Rng, script: ScriptId, limit: number, mode: 'characters' | 'bytes'): string {
  // Build well past the target, then trim back — cheaper than measuring per word.
  let text = '';
  const measure = (s: string) =>
    mode === 'characters' ? [...s].length : new TextEncoder().encode(s).length;

  let guard = 0;
  while (measure(text) < limit && guard++ < 10000) {
    text += (text ? ' ' : '') + paragraph(rng, script, 4);
  }
  return trimTo(text, limit, mode);
}

function asHtml(blocks: string[], unit: Unit, rtl: boolean): string {
  const dir = rtl ? ' dir="rtl"' : '';
  if (unit === 'list-items') {
    return `<ul${dir}>\n${blocks.map((b) => `  <li>${b}</li>`).join('\n')}\n</ul>`;
  }
  if (unit === 'paragraphs') {
    // Include a heading and nested markup — flat <p> tags do not exercise a renderer.
    return blocks
      .map((b, i) =>
        i === 1
          ? `<h2${dir}>${b.split(' ').slice(0, 5).join(' ')}</h2>\n<p${dir}>${b}</p>`
          : `<p${dir}>${b}</p>`,
      )
      .join('\n');
  }
  return `<p${dir}>${blocks.join(' ')}</p>`;
}

function asMarkdown(blocks: string[], unit: Unit): string {
  if (unit === 'list-items') return blocks.map((b) => `- ${b}`).join('\n');
  if (unit === 'paragraphs') {
    return blocks
      .map((b, i) => (i === 1 ? `## ${b.split(' ').slice(0, 5).join(' ')}\n\n${b}` : b))
      .join('\n\n');
  }
  return blocks.join(' ');
}

/**
 * Block counts and length budgets need different ceilings: 500 paragraphs is
 * already unreasonable, whereas 20000 characters is a legitimate request when
 * you are testing a TEXT column limit.
 */
const MAX_BLOCKS = 500;
const MAX_LENGTH = 100000;

export function generate(options: Options): string {
  const { script, unit, format, seed, classicOpening } = options;
  const requested = Math.floor(options.count) || 1;
  const rng = makeRng(seed);
  const def = scriptById(script);

  if (unit === 'characters' || unit === 'bytes') {
    // Exact-length modes ignore format: the point is a precise budget, for
    // testing column limits and meta-description truncation.
    const limit = Math.max(1, Math.min(MAX_LENGTH, requested));
    return padTo(rng, script, limit, unit);
  }

  const count = Math.max(1, Math.min(MAX_BLOCKS, requested));

  /**
   * The classic opening is content, so it counts towards what was asked for.
   *
   * Prepending it after generating the full amount meant "12 words" returned 20
   * and "3 sentences" returned 4 — the option quietly overrode the count. Only
   * words and sentences are affected: for paragraphs and list items the opening
   * goes inside the first block, which leaves the number of blocks alone.
   */
  const openingWords = CLASSIC_OPENING.split(' ');
  const usesOpening = classicOpening && script === 'latin';

  let blocks: string[];
  switch (unit) {
    case 'words': {
      // A count below the opening's own length takes as much of it as fits.
      const fromOpening = usesOpening ? Math.min(count, openingWords.length) : 0;
      const words = [
        ...openingWords.slice(0, fromOpening),
        ...Array.from({ length: count - fromOpening }, () => rng.pick(def.words)),
      ];
      blocks = [joinWords(words, def.unspaced)];
      break;
    }
    case 'sentences': {
      const fromOpening = usesOpening ? Math.min(count, 1) : 0;
      const sentences = [
        ...(fromOpening ? [`${CLASSIC_OPENING}.`] : []),
        ...Array.from({ length: count - fromOpening }, () => sentence(rng, script)),
      ];
      blocks = [sentences.join(' ')];
      break;
    }
    case 'list-items':
      blocks = Array.from({ length: count }, () => sentence(rng, script).replace(/[.。]$/, ''));
      break;
    case 'paragraphs':
    default:
      blocks = Array.from({ length: count }, () => paragraph(rng, script));
      break;
  }

  // Words and sentences already folded the opening into their count above; for
  // these units it prefixes the first block without changing how many there are.
  if (usesOpening && blocks.length > 0 && (unit === 'paragraphs' || unit === 'list-items')) {
    blocks[0] = `${CLASSIC_OPENING}. ${blocks[0]!}`;
  }

  if (format === 'html') return asHtml(blocks, unit, def.rtl);
  if (format === 'markdown') return asMarkdown(blocks, unit);
  return blocks.join('\n\n');
}

/** All edge-case strings, one per line, for pasting into a test fixture. */
export function generateEdgeCases(): string {
  return EDGE_CASES.map((e) => e.value).join('\n');
}

/**
 * A locally generated placeholder image as an SVG data URI.
 *
 * Deliberately not a link to placehold.co or picsum: those are network requests,
 * which would break both the offline story and the promise that nothing leaves
 * the browser.
 */
export function placeholderImage(width: number, height: number, label?: string): string {
  const text = label ?? `${width}×${height}`;
  const fontSize = Math.max(10, Math.min(width, height) / 8);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
<rect width="100%" height="100%" fill="#d8d8d2"/>
<path d="M0 0 L${width} ${height} M${width} 0 L0 ${height}" stroke="#b8b8b0" stroke-width="1"/>
<text x="50%" y="50%" font-family="monospace" font-size="${fontSize}" fill="#55554f" text-anchor="middle" dominant-baseline="middle">${text}</text>
</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
