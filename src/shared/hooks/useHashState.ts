import { useCallback, useEffect, useRef, useState } from 'preact/hooks';

/**
 * Persists tool state in the URL fragment.
 *
 * The fragment is deliberate: browsers never send it to the server, so a shared
 * link carries the input without it ever reaching GitHub's access logs. That is
 * what lets "share this link" and "nothing is uploaded" both be true.
 */

function encode(value: unknown): string {
  // encodeURIComponent then base64 so UTF-8 (CJK, emoji) survives btoa.
  return btoa(encodeURIComponent(JSON.stringify(value))).replace(/=+$/, '');
}

function decode<T>(raw: string): T | undefined {
  try {
    return JSON.parse(decodeURIComponent(atob(raw))) as T;
  } catch {
    return undefined;
  }
}

function readHash<T>(): T | undefined {
  const raw = window.location.hash.replace(/^#/, '');
  return raw ? decode<T>(raw) : undefined;
}

export function useHashState<T>(initial: T): [T, (next: T) => void] {
  const [state, setState] = useState<T>(() => readHash<T>() ?? initial);
  const timer = useRef<number | undefined>(undefined);

  // Follow back/forward navigation between shared links.
  useEffect(() => {
    const onHashChange = () => {
      const next = readHash<T>();
      if (next !== undefined) setState(next);
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  const update = useCallback((next: T) => {
    setState(next);
    // Debounced: typing in a textarea should not write a history entry per keystroke.
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      history.replaceState(null, '', `#${encode(next)}`);
    }, 250);
  }, []);

  return [state, update];
}
