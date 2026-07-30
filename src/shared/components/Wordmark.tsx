/**
 * The site mark, drawn rather than typeset.
 *
 * It was previously the ⌗ character in a ::before rule, which falls back to a
 * missing-glyph box on any system without coverage for it — including plain
 * Linux desktops. A mark in the header is not something to leave to font luck.
 */
export function Wordmark() {
  return (
    <svg
      class="wordmark"
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      focusable="false"
    >
      <g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" fill="none">
        <path d="M9.5 3.5 L7 20.5" />
        <path d="M17.5 3.5 L15 20.5" />
        <path d="M4 9.5 H20.5" />
        <path d="M3.5 14.5 H20" />
      </g>
    </svg>
  );
}
