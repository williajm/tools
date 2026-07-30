import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';
import { CommandPalette } from './CommandPalette.tsx';
import { homeUrl } from '../lib/paths.ts';
import { recordRecent } from '../lib/recents.ts';
import { toolBySlug } from '../registry.ts';

interface Props {
  slug: string;
  /** Widen for tools with tables or side-by-side panes. */
  wide?: boolean;
  children: ComponentChildren;
}

/** Common chrome for every tool page: topbar, heading from the registry, footer, palette. */
export function ToolShell({ slug, wide, children }: Props) {
  const tool = toolBySlug(slug);

  useEffect(() => {
    if (tool) {
      document.title = `${tool.name} · tools`;
      recordRecent(slug);
    }
  }, [slug, tool]);

  return (
    <div class={wide ? 'shell shell--wide' : 'shell'}>
      <header class="topbar">
        <a class="topbar__home" href={homeUrl()}>
          tools
        </a>
        <span class="topbar__spacer" />
        <span class="topbar__hint">
          <kbd>Ctrl</kbd> <kbd>K</kbd>
        </span>
      </header>

      {tool && (
        <div class="tool-head">
          <h1>{tool.name}</h1>
          <p>{tool.blurb}</p>
        </div>
      )}

      <main>{children}</main>

      <footer class="foot">
        <span>Runs entirely in your browser. Nothing is uploaded.</span>
        <a href={`${homeUrl()}licenses/`}>Licences</a>
        <a href="https://github.com/williajm/tools">Source</a>
      </footer>

      <CommandPalette />
    </div>
  );
}
