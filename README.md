# tools

**Live site: [williajm.github.io/tools](https://williajm.github.io/tools/)**

Developer and test utilities that run entirely in your browser. No server, no
upload, no account — the site is static files on GitHub Pages, and your data
never leaves the machine.

That claim is enforced rather than promised: every page ships a
`connect-src 'none'` Content Security Policy, so the browser itself refuses to
let these tools make a network request. Tool state lives in the URL fragment,
which browsers never send to a server, so sharing a link and uploading nothing
are simultaneously true.

## The tools

Thirteen of them, grouped into one page per area: encoding, UUID and IDs, hash
and HMAC, timestamps and timezones, lorem and test data, QR codes, JWT, a JSON
toolkit, text diff, CIDR and subnets, a regex tester, XPath and CSS selectors,
and a pairwise test matrix generator.

The home page lists all of them, grouped by category. That grid is the whole
navigation — there is no search box, no command palette and no recents list.

Light and dark both work. The toggle in the header cycles system, light and dark;
"system" is the default and stores nothing, so the site only writes to your
machine if you actively pick a side.

## Development

```sh
npm install
npm run gen:pages   # writes index.html per tool from the registry
npm run dev
```

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server (the CSP meta tag is stripped in dev so HMR can connect) |
| `npm test` | Vitest unit tests |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Typecheck, generate pages, build to `dist/` |
| `npm run test:e2e` | Playwright, against the built site — needs `npx playwright install chromium` first |

`docs/PLAN.md` records the architecture, the GitHub Pages constraints that
produced it, and what has deliberately been left out.

## Adding a tool

1. Add an entry to `src/shared/registry.ts` — it is the single source of truth
   for slugs, names, blurbs, categories and search keywords.
2. Create `src/tools/<slug>/` with the logic, its tests, a component, and a
   `main.tsx` that calls `mount()`.
3. Run `npm run gen:pages` and commit the generated `<slug>/index.html`. CI
   fails if the generated pages have drifted from the registry.

The multi-page build derives its entry points from the directories containing an
`index.html`, so no build config changes when a tool is added.

## Licensing

This project is MIT. The built site bundles third-party packages under their own
licences, reproduced in full at `/licenses` — generated at build time from the
packages rollup actually bundled, so it cannot drift. The build fails if a
dependency ships no licence text and no canonical copy is available for it.
