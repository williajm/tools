import { describe, it, expect } from 'vitest';
import { CATEGORIES, TOOLS, toolBySlug } from './registry.ts';

describe('registry integrity', () => {
  it('has a unique slug per tool', () => {
    const slugs = TOOLS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('only uses declared categories', () => {
    for (const tool of TOOLS) {
      expect(CATEGORIES).toContain(tool.category);
    }
  });

  it('finds every tool by its slug', () => {
    for (const tool of TOOLS) {
      expect(toolBySlug(tool.slug)).toBe(tool);
    }
    expect(toolBySlug('nope')).toBeUndefined();
  });

  // Every tool must fall in a category the home page renders, or its card would
  // exist in the registry and appear nowhere — the grid is the only navigation.
  it('leaves no tool unreachable from the home page', () => {
    const rendered = CATEGORIES.flatMap((cat) => TOOLS.filter((t) => t.category === cat));
    expect(rendered).toHaveLength(TOOLS.length);
  });

  it('gives every tool the name and blurb the page generator needs', () => {
    for (const tool of TOOLS) {
      expect(tool.name.length, tool.slug).toBeGreaterThan(0);
      expect(tool.blurb.length, tool.slug).toBeGreaterThan(0);
      // gen-pages.mjs parses these out of the source with a single-quoted regex.
      expect(tool.name, tool.slug).not.toContain("'");
      expect(tool.blurb, tool.slug).not.toContain("'");
    }
  });
});
