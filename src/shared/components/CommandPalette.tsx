import { useEffect, useRef, useState } from 'preact/hooks';
import { searchTools } from '../registry.ts';
import { toolUrl } from '../lib/paths.ts';

/**
 * Ctrl-K / Cmd-K tool switcher. Mounted on every page so the whole site is
 * reachable from anywhere without going home first.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = searchTools(query).slice(0, 8);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
        setQuery('');
        setCursor(0);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  if (!open) return null;

  const go = (index: number) => {
    const tool = results[index];
    if (tool) window.location.href = toolUrl(tool.slug);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => (results.length ? (c + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => (results.length ? (c - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      go(cursor);
    }
  };

  return (
    <div
      class="palette-backdrop"
      onClick={(e) => {
        if (e.target === e.currentTarget) setOpen(false);
      }}
    >
      <div class="palette" role="dialog" aria-modal="true" aria-label="Find a tool">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Find a tool…"
          aria-label="Find a tool"
          autocomplete="off"
          spellcheck={false}
          onInput={(e) => {
            setQuery((e.target as HTMLInputElement).value);
            setCursor(0);
          }}
          onKeyDown={onKeyDown}
        />
        {results.length === 0 ? (
          <div class="palette__empty">No tool matches “{query}”.</div>
        ) : (
          <ul class="palette__list" role="listbox">
            {results.map((tool, i) => (
              <li key={tool.slug}>
                <a
                  class="palette__item"
                  href={toolUrl(tool.slug)}
                  role="option"
                  aria-selected={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                >
                  <div class="palette__name">{tool.name}</div>
                  <div class="palette__blurb">{tool.blurb}</div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
