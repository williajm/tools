import { describe, it, expect } from 'vitest';
import { CATEGORIES, TOOLS, searchTools, toolBySlug } from './registry.ts';

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
});

describe('searchTools', () => {
  it('returns everything for an empty query', () => {
    expect(searchTools('')).toEqual(TOOLS);
    expect(searchTools('   ')).toEqual(TOOLS);
  });

  it('returns nothing when no tool matches', () => {
    expect(searchTools('zzzzqqq')).toEqual([]);
  });

  it('matches on name', () => {
    expect(searchTools('regex')[0]!.slug).toBe('regex');
  });

  it('matches on keyword', () => {
    expect(searchTools('md5')[0]!.slug).toBe('hash');
    expect(searchTools('netmask')[0]!.slug).toBe('cidr');
    expect(searchTools('otpauth')[0]!.slug).toBe('qr');
  });

  it('matches a subsequence, so abbreviations work', () => {
    expect(searchTools('b64').map((t) => t.slug)).toContain('encoding');
    expect(searchTools('pw').map((t) => t.slug)).toContain('pairwise');
  });

  /**
   * Regression: the field penalty was added twice on the substring branch and
   * once on the subsequence branch, so a literal match was charged double and a
   * scattered match in a higher-priority field could outrank it.
   */
  describe('a literal match outranks a scattered one', () => {
    it('puts the tool that has "ip" as a keyword first', () => {
      const ranked = searchTools('ip').map((t) => t.slug);
      expect(ranked[0]).toBe('cidr');
      // t-i-mestam-p matched as a subsequence, and must not win.
      expect(ranked.indexOf('cidr')).toBeLessThan(ranked.indexOf('timestamp'));
    });

    it('puts the tool that has "guid" as a keyword first', () => {
      const ranked = searchTools('guid').map((t) => t.slug);
      expect(ranked[0]).toBe('uuid');
      expect(ranked.indexOf('uuid')).toBeLessThan(ranked.indexOf('diff'));
    });

    it('holds for every keyword in the registry', () => {
      for (const tool of TOOLS) {
        for (const keyword of tool.keywords) {
          const ranked = searchTools(keyword).map((t) => t.slug);
          const better = ranked.slice(0, ranked.indexOf(tool.slug));
          // Anything ahead of it must have matched the keyword literally too,
          // never as a scattered subsequence.
          for (const slug of better) {
            const other = toolBySlug(slug)!;
            const haystack = [
              other.name,
              other.slug,
              other.keywords.join(' '),
              other.blurb,
            ]
              .join(' ')
              .toLowerCase();
            expect(haystack).toContain(keyword.toLowerCase());
          }
        }
      }
    });
  });

  it('prefers a name match over a blurb match', () => {
    // "diff" is the Diff tool's name and appears in the JSON toolkit's blurb.
    const ranked = searchTools('diff').map((t) => t.slug);
    expect(ranked[0]).toBe('diff');
    expect(ranked.indexOf('diff')).toBeLessThan(ranked.indexOf('json'));
  });

  it('is case-insensitive', () => {
    expect(searchTools('JWT')[0]!.slug).toBe('jwt');
    expect(searchTools('jwt')[0]!.slug).toBe('jwt');
  });
});
