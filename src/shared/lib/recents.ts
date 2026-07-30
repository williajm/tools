const KEY = 'tools:recents';
const MAX = 6;

/** Recently opened tool slugs, most recent first. Best-effort: storage may be unavailable. */
export function getRecents(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}

export function recordRecent(slug: string): void {
  try {
    const next = [slug, ...getRecents().filter((s) => s !== slug)].slice(0, MAX);
    localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    // Private browsing or storage disabled — recents are a nicety, not a requirement.
  }
}
