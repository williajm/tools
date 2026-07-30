import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  THEMES,
  THEME_KEY,
  applyTheme,
  nextTheme,
  readTheme,
  storeTheme,
  type Theme,
} from './theme.ts';

beforeEach(() => {
  localStorage.clear();
  document.documentElement.removeAttribute('data-theme');
});

describe('readTheme', () => {
  it('defaults to following the system', () => {
    expect(readTheme()).toBe('system');
  });

  it('reads a stored choice', () => {
    localStorage.setItem(THEME_KEY, 'dark');
    expect(readTheme()).toBe('dark');
    localStorage.setItem(THEME_KEY, 'light');
    expect(readTheme()).toBe('light');
  });

  // Storage is untrusted: another tab, an older version, or a user with devtools
  // open can put anything there.
  it('falls back to system for a value that is not a theme', () => {
    for (const junk of ['', 'DARK', 'blue', '{}', 'null', 'system ']) {
      localStorage.setItem(THEME_KEY, junk);
      expect(readTheme(), junk).toBe('system');
    }
  });

  it('survives storage being unavailable', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('private browsing');
    });
    try {
      expect(readTheme()).toBe('system');
    } finally {
      getItem.mockRestore();
    }
  });
});

describe('applyTheme', () => {
  it('sets the attribute the stylesheet keys off', () => {
    applyTheme('dark');
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    applyTheme('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
  });

  /**
   * There is no third palette. 'system' has to remove the attribute so the
   * `prefers-color-scheme` media query takes over again — setting it to the string
   * "system" would match neither selector and silently strand the page on light.
   */
  it('removes the attribute for system rather than setting a value', () => {
    applyTheme('dark');
    applyTheme('system');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});

describe('storeTheme', () => {
  it('persists an explicit choice', () => {
    storeTheme('dark');
    expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  });

  /**
   * Returning to the default must leave no trace. Recents was removed so the site
   * wrote nothing to the machine; a theme key reading "system" would reintroduce
   * exactly that for someone who tried the toggle and changed their mind.
   */
  it('clears the key for system instead of storing the word', () => {
    storeTheme('dark');
    storeTheme('system');
    expect(localStorage.getItem(THEME_KEY)).toBeNull();
    expect(localStorage.length).toBe(0);
  });

  it('does not throw when storage is unavailable', () => {
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    try {
      expect(() => storeTheme('dark')).not.toThrow();
    } finally {
      setItem.mockRestore();
    }
  });

  it('round-trips through readTheme for every theme', () => {
    for (const theme of THEMES) {
      storeTheme(theme);
      expect(readTheme(), theme).toBe(theme);
    }
  });
});

describe('nextTheme', () => {
  it('cycles through all three and returns to the start', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });

  it('reaches every theme from any starting point', () => {
    for (const start of THEMES) {
      const seen = new Set<Theme>();
      let current = start;
      for (let i = 0; i < THEMES.length; i++) {
        seen.add(current);
        current = nextTheme(current);
      }
      expect(seen.size, start).toBe(THEMES.length);
      // A full cycle returns to where it began.
      expect(current, start).toBe(start);
    }
  });
});

/**
 * The pre-paint bootstrap in scripts/gen-pages.mjs is a hand-written copy of this
 * logic — it has to be, since it runs in the document head before any bundle
 * loads. These pin the two ends together so they cannot drift apart silently.
 */
describe('agreement with the inline bootstrap', () => {
  it('uses the key the bootstrap reads', () => {
    expect(THEME_KEY).toBe('tools:theme');
  });

  it('only ever stores values the bootstrap acts on', () => {
    // The bootstrap applies the attribute for exactly 'light' and 'dark'.
    for (const theme of THEMES) {
      storeTheme(theme);
      const stored = localStorage.getItem(THEME_KEY);
      if (stored !== null) expect(['light', 'dark']).toContain(stored);
    }
  });
});
