import { CATEGORIES, TOOLS } from '@shared/registry.ts';
import { toolUrl } from '@shared/lib/paths.ts';
import { ThemeToggle } from '@shared/components/ThemeToggle.tsx';
import { Wordmark } from '@shared/components/Wordmark.tsx';

function ToolCard({ slug, name, blurb }: { slug: string; name: string; blurb: string }) {
  return (
    <a class="card" href={toolUrl(slug)}>
      <div class="card__name">{name}</div>
      <div class="card__blurb">{blurb}</div>
    </a>
  );
}

/**
 * The index: every tool, grouped by category.
 *
 * Thirteen tools fit on one screen, so the grid is the whole navigation — there
 * is no search box, no command palette and no recents list.
 */
export function Home() {
  return (
    <div class="shell">
      <header class="topbar">
        <span class="topbar__home">
          <Wordmark />
          tools
        </span>
        <ThemeToggle />
      </header>

      <div class="hero">
        <h1>Developer &amp; test tools</h1>
        <p>
          {TOOLS.length} utilities that run entirely in your browser. No server, no upload, no
          account — the page is static and your data never leaves the machine.
        </p>
      </div>

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

      <footer class="foot">
        <span>Everything runs client-side. Nothing is uploaded.</span>
        <a href="./licenses/">Licences</a>
        <a href="https://github.com/williajm/tools">Source</a>
      </footer>
    </div>
  );
}
