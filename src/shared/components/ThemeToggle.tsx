import { useEffect, useState } from 'preact/hooks';
import {
  THEME_NAMES,
  applyTheme,
  nextTheme,
  readTheme,
  storeTheme,
  type Theme,
} from '../lib/theme.ts';

/**
 * Icons for the three states. Drawn rather than typeset, for the same reason the
 * wordmark is: an emoji or a glyph falls back to a missing-character box wherever
 * the font lacks coverage, which is not something to leave to font luck in the
 * header of every page.
 */
function ThemeIcon({ theme }: { theme: Theme }) {
  const common = {
    viewBox: '0 0 24 24',
    width: '15',
    height: '15',
    'aria-hidden': 'true',
    focusable: 'false',
  } as const;

  if (theme === 'light') {
    return (
      <svg {...common}>
        <g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
          <circle cx="12" cy="12" r="4.2" />
          <path d="M12 2.6v2.2M12 19.2v2.2M2.6 12h2.2M19.2 12h2.2M5.4 5.4l1.6 1.6M17 17l1.6 1.6M18.6 5.4L17 7M7 17l-1.6 1.6" />
        </g>
      </svg>
    );
  }

  if (theme === 'dark') {
    return (
      <svg {...common}>
        <path
          d="M20 14.4A8.6 8.6 0 1 1 9.6 4a7 7 0 0 0 10.4 10.4Z"
          stroke="currentColor"
          stroke-width="2"
          stroke-linejoin="round"
          fill="none"
        />
      </svg>
    );
  }

  // System: a display, i.e. "whatever this machine says".
  return (
    <svg {...common}>
      <g stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none">
        <rect x="2.8" y="4.2" width="18.4" height="12.4" rx="1.8" />
        <path d="M9 20.2h6" />
      </g>
    </svg>
  );
}

/**
 * Cycles system → light → dark.
 *
 * A single control rather than three, because the topbar has room for one thing
 * and the current state is legible from the icon. The accessible name carries both
 * halves — where you are and what pressing it does — since an icon alone cannot
 * say "currently following your system".
 *
 * The initial read happens in an effect, not during render: the pre-paint
 * bootstrap in the document head has already applied the stored theme by the time
 * this mounts, so there is nothing to correct visually, only state to catch up on.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => setTheme(readTheme()), []);

  const change = (next: Theme) => {
    setTheme(next);
    applyTheme(next);
    storeTheme(next);
  };

  const upcoming = nextTheme(theme);

  return (
    <button
      type="button"
      class="theme-toggle"
      title={`Theme: ${THEME_NAMES[theme]}`}
      aria-label={`Theme: ${THEME_NAMES[theme]}. Switch to ${THEME_NAMES[upcoming].toLowerCase()}.`}
      onClick={() => change(upcoming)}
    >
      <ThemeIcon theme={theme} />
      <span class="theme-toggle__name">{THEME_NAMES[theme]}</span>
    </button>
  );
}
