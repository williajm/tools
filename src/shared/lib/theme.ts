/**
 * Theme preference: follow the system, or override it in one direction.
 *
 * The stylesheet already carries both palettes and keys the override off
 * `data-theme` on `<html>` — the dark block is `:root:not([data-theme='light'])`
 * and there is a matching `:root[data-theme='dark']`, so absence of the attribute
 * means "whatever the OS says". All this module does is decide what the attribute
 * should be and remember the choice.
 *
 * Kept free of Preact so the same constants can be used by the pre-paint
 * bootstrap in `scripts/gen-pages.mjs`, which has to run before any bundle loads.
 */

export type Theme = 'system' | 'light' | 'dark';

export const THEMES: readonly Theme[] = ['system', 'light', 'dark'];

/** Shared with the bootstrap script; changing it orphans everyone's saved choice. */
export const THEME_KEY = 'tools:theme';

export const THEME_NAMES: Record<Theme, string> = {
  system: 'System',
  light: 'Light',
  dark: 'Dark',
};

const isTheme = (value: unknown): value is Theme =>
  value === 'system' || value === 'light' || value === 'dark';

/**
 * The stored preference, or 'system' when there is none.
 *
 * Storage is untrusted and may be unavailable: private browsing throws on access,
 * and the value could be anything a previous version or another tab wrote.
 */
export function readTheme(): Theme {
  try {
    const stored: unknown = localStorage.getItem(THEME_KEY);
    return isTheme(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

/**
 * Applies a theme to the document.
 *
 * 'system' removes the attribute rather than setting a value, so the media query
 * takes over again — there is no third palette to select.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', theme);
}

/**
 * Persists a choice, or clears it when the choice is to stop choosing.
 *
 * Recents was removed precisely so the site wrote nothing to the machine, so
 * 'system' deletes the key instead of storing the word "system": returning to the
 * default should leave no trace behind.
 */
export function storeTheme(theme: Theme): void {
  try {
    if (theme === 'system') localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Storage unavailable. The choice still applies for this page.
  }
}

/** Next theme in the cycle, for a single control that steps through all three. */
export function nextTheme(current: Theme): Theme {
  const index = THEMES.indexOf(current);
  return THEMES[(index + 1) % THEMES.length]!;
}
