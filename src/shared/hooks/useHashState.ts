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

function decode(raw: string): unknown {
  try {
    return JSON.parse(decodeURIComponent(atob(raw)));
  } catch {
    return undefined;
  }
}

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * Reconciles a decoded fragment against the tool's own initial state.
 *
 * A fragment is untrusted: it survives truncation, hand-editing and links
 * shared from an older version of a tool. It used to be cast straight to `T`,
 * so a merely *valid* fragment carrying `{}` left every field undefined and ten
 * of the thirteen tools rendered a blank page on the first `.trim()` or
 * `.split()`. A share link is a headline feature, so a damaged one has to
 * degrade to defaults rather than break the page.
 *
 * Each key is taken only when it is present and its type matches the default's,
 * which also drops keys a newer version has since removed or repurposed. Nested
 * objects are reconciled recursively; arrays are accepted wholesale, since their
 * element types are the tool's business and are checked where they are used.
 */
export function reconcile<T>(decoded: unknown, initial: T): T {
  if (!isPlainObject(initial)) {
    // A non-object state is taken only if the decoded type agrees.
    return typeof decoded === typeof initial ? (decoded as T) : initial;
  }
  if (!isPlainObject(decoded)) return initial;

  const out: Record<string, unknown> = { ...initial };
  for (const [key, fallback] of Object.entries(initial)) {
    if (!Object.hasOwn(decoded, key)) continue;
    const candidate = decoded[key];

    if (isPlainObject(fallback)) {
      out[key] = reconcile(candidate, fallback);
      continue;
    }
    if (Array.isArray(fallback)) {
      if (Array.isArray(candidate)) out[key] = candidate;
      continue;
    }
    // typeof null is 'object', which would otherwise pass for a string default.
    if (candidate !== null && typeof candidate === typeof fallback) out[key] = candidate;
  }
  return out as T;
}

function readHash<T>(initial: T): T | undefined {
  const raw = window.location.hash.replace(/^#/, '');
  if (!raw) return undefined;
  const decoded = decode(raw);
  return decoded === undefined ? undefined : reconcile(decoded, initial);
}

export function useHashState<T>(initial: T): [T, (next: T) => void] {
  // Held in a ref so the hashchange listener can reconcile against it without
  // needing to be torn down and rebuilt whenever the caller re-renders.
  const defaults = useRef(initial);
  const [state, setState] = useState<T>(() => readHash(defaults.current) ?? initial);
  const timer = useRef<number | undefined>(undefined);

  // Follow back/forward navigation between shared links.
  useEffect(() => {
    const onHashChange = () => {
      // An empty or unreadable fragment means "no shared state", which is the
      // initial state — not "keep whatever is on screen". Leaving it alone made
      // navigating back past the first share link a no-op.
      setState(readHash(defaults.current) ?? defaults.current);
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

  // A debounced write outliving the component would rewrite the URL of whatever
  // replaced it.
  useEffect(() => () => window.clearTimeout(timer.current), []);

  return [state, update];
}
