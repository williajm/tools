/** Vite injects the configured `base`, so links work under /tools/ and at a root domain. */
const BASE = import.meta.env.BASE_URL || '/';

export function toolUrl(slug: string): string {
  return `${BASE}${slug}/`;
}

export function homeUrl(): string {
  return BASE;
}
