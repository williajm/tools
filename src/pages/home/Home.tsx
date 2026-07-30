import { useEffect, useMemo, useState } from 'preact/hooks';
import { CATEGORIES, TOOLS, searchTools, toolBySlug } from '@shared/registry.ts';
import { toolUrl } from '@shared/lib/paths.ts';
import { getRecents } from '@shared/lib/recents.ts';
import { CommandPalette } from '@shared/components/CommandPalette.tsx';

function ToolCard({ slug, name, blurb }: { slug: string; name: string; blurb: string }) {
  return (
    <a class="card" href={toolUrl(slug)}>
      <div class="card__name">{name}</div>
      <div class="card__blurb">{blurb}</div>
    </a>
  );
}

export function Home() {
  const [query, setQuery] = useState('');
  const [recents, setRecents] = useState<string[]>([]);

  // localStorage is only available client-side; read after mount.
  useEffect(() => setRecents(getRecents()), []);

  const results = useMemo(() => (query.trim() ? searchTools(query) : null), [query]);
  const recentTools = recents.map(toolBySlug).filter((t) => t !== undefined);

  return (
    <div class="shell">
      <header class="topbar">
        <span class="topbar__home">tools</span>
        <span class="topbar__spacer" />
        <span class="topbar__hint">
          <kbd>Ctrl</kbd> <kbd>K</kbd>
        </span>
      </header>

      <div class="hero">
        <h1>Developer &amp; test tools</h1>
        <p>
          {TOOLS.length} utilities that run entirely in your browser. No server, no upload, no
          account — the page is static and your data never leaves the machine.
        </p>
      </div>

      <input
        class="search-big"
        type="text"
        value={query}
        placeholder="Search tools…"
        aria-label="Search tools"
        autocomplete="off"
        spellcheck={false}
        onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />

      {results ? (
        results.length ? (
          <>
            <div class="cat-head">
              {results.length} result{results.length === 1 ? '' : 's'}
            </div>
            <div class="card-grid">
              {results.map((t) => (
                <ToolCard key={t.slug} {...t} />
              ))}
            </div>
          </>
        ) : (
          <p class="dim">No tool matches “{query}”.</p>
        )
      ) : (
        <>
          {recentTools.length > 0 && (
            <>
              <div class="cat-head">Recent</div>
              <div class="card-grid">
                {recentTools.map((t) => (
                  <ToolCard key={t.slug} {...t} />
                ))}
              </div>
            </>
          )}

          {CATEGORIES.map((cat) => {
            const inCat = TOOLS.filter((t) => t.category === cat);
            if (!inCat.length) return null;
            return (
              <div key={cat}>
                <div class="cat-head">{cat}</div>
                <div class="card-grid">
                  {inCat.map((t) => (
                    <ToolCard key={t.slug} {...t} />
                  ))}
                </div>
              </div>
            );
          })}
        </>
      )}

      <footer class="foot">
        <span>Everything runs client-side. Nothing is uploaded.</span>
        <a href="./licenses/">Licences</a>
        <a href="https://github.com/williajm/tools">Source</a>
      </footer>

      <CommandPalette />
    </div>
  );
}
