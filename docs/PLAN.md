# tools — plan

A collection of developer and test utilities hosted entirely on GitHub Pages.

## Principles

1. **Everything runs in the browser.** No server, so no data ever leaves the machine.
   This is the main differentiator against the ad-funded online tool sites, and on
   Pages it can be *proven* per-tool with a `connect-src 'none'` CSP meta tag.
2. **Don't rebuild what's already good.** If regex101 or crontab.guru already nails
   it, the bar for building our own is a specific reason we'd be better — usually
   privacy, offline use, or a testing-oriented angle the incumbent doesn't cover.
3. **Works offline.** PWA with a precaching service worker. A toolbox that works on
   a plane is meaningfully better than one that doesn't.
4. **No exotic infrastructure in v1.** Pure JS only — no WASM, no cross-origin
   isolation hacks.

## Platform constraints

Everything below follows from what GitHub Pages can and cannot do.

| Capability | Available | Consequence |
|---|---|---|
| Static files over HTTPS | Yes | Any client-side JS/WASM tool works |
| Server-side code, proxy, secrets | No | No API keys; can't reach CORS-blocked hosts |
| Custom HTTP headers / redirects | No | **No COOP/COEP** → no `SharedArrayBuffer` without a service-worker hack |
| Inbound requests (webhooks) | No | No request bin, no callback receiver |
| Cross-device persistence | No | State lives in `localStorage` / IndexedDB / URL only |
| Scheduled work | Partial | Not at runtime, but Actions can regenerate static data on cron and commit it |
| Outbound `fetch` | Partial | Only to hosts sending CORS headers |
| WebSocket / SSE | Yes | Not subject to CORS — a WS tester would genuinely work |
| Limits | — | 1 GB repo (soft), 100 GB/mo bandwidth (soft), 10 builds/hr |

The COOP/COEP gap is the main landmine for anything added later: multi-threaded
WASM (ffmpeg.wasm MT, DuckDB threads, SQLite's default OPFS VFS) wants cross-origin
isolation, which Pages cannot grant. Workarounds exist — `coi-serviceworker`,
single-threaded builds, SQLite's `opfs-sahpool` VFS — but each carries a real
trade-off. v1 sidesteps this entirely by staying pure JS.

### The CSP rules out any dependency that generates code

`script-src 'self'` carries no `'unsafe-eval'`, so `eval` and `new Function` both
throw at runtime. That is deliberate — it is a large part of what makes the
privacy claim enforceable — but it disqualifies a whole category of library.

This is not theoretical: the JSON toolkit originally used `ajv`, which compiles
each schema into JavaScript with `new Function`. Schema validation was therefore
broken on the deployed site for every schema, while every unit test passed,
because Node has no CSP. It now uses `@cfworker/json-schema`, which walks the
schema instead of compiling it.

Two rules follow. Prefer an interpreting library over a compiling one — and where
only a compiling one exists, precompile at build time rather than weakening the
CSP. And any feature whose dependency might generate code needs an end-to-end
test that exercises it against the built site, since that is the only place the
CSP is in force. `tests/e2e/tools.spec.ts` has one for schema validation.

Web Workers are unaffected: `new Worker(new URL('./worker.ts', import.meta.url))`
loads a real bundled file from the site's own origin, which `'self'` permits. A
`blob:` worker would not be. The regex tester relies on this to put a time limit
on a pattern that backtracks catastrophically, which is otherwise impossible —
a running regex cannot be interrupted, only a thread can be terminated.

## Architecture

| Decision | Choice | Rationale |
|---|---|---|
| Framework | **Preact** | React mental model and ecosystem access via `preact/compat`, at ~4 KB vs React's ~45 KB. In a multi-page build the baseline is paid on *every* entry point, for tools that are mostly a textarea and a button. |
| Build | **Vite + TypeScript, multi-page** | Real `/encoding/index.html` per tool. Proper deep links and SEO, no 404.html SPA-fallback hack. Each tool is its own lazily-loaded entry. |
| Granularity | **Grouped multi-mode pages** | One `/encoding` page with tabs, not five separate pages. 13 pages rather than ~25; less navigation, fewer entry points to maintain. |
| State | **URL fragment** | Fragments are never sent to a server, so "share this link" and "nothing is uploaded" stay simultaneously true. |
| Offline | `vite-plugin-pwa` | Precache service worker. |
| Deploy | Actions → `actions/deploy-pages` | On push to `main`. |
| Testing | Vitest (unit) + Playwright (e2e) | Public repo, so CI runs them. |

Note that roughly half the tools need no framework at all. Standardising on Preact
anyway — consistency across a shared design system beats micro-optimising each page.

**Information architecture is a Phase 0 concern, not a polish item.** Thirteen-plus
tools with a flat list is unusable. Categories, fuzzy search, a `Ctrl-K` command
palette, and recents in `localStorage` are what separate a daily-use site from a
bookmark folder with extra steps.

## Tools

| # | Tool | Scope | Key dependency |
|---|---|---|---|
| 1 | **Lorem / test data** | Locale-aware (CJK, RTL, Thai), seeded/deterministic, exact char/byte length, HTML + Markdown output, edge-case mode, entity lorem | `lorem-ipsum`, `@faker-js/faker` (lazy) |
| 2 | **QR code** | Generate + WiFi/vCard/VEVENT/`otpauth:` builders, SVG/PNG export, camera decode | `qrcode`, `jsQR` |
| 3 | **JWT decoder & verifier** | Decode + signature verification | `jose` |
| 4 | **Encoding toolkit** | base64 / base64url / URL / HTML entities / hex | native |
| 5 | **JSON toolkit** | Format, schema validate, query, diff | `@cfworker/json-schema`, `jsondiffpatch` |
| 6 | **Timestamp & timezone** | Unix ↔ ISO8601, timezone conversion | `luxon` |
| 7 | **UUID / ULID / NanoID** | v4/v7 generation, bulk output | `uuid`, `ulid`, `nanoid` |
| 8 | **Hash & HMAC** | SHA family via WebCrypto, MD5 via lib | WebCrypto, `js-md5` |
| 9 | **Text & JSON diff** | Side-by-side and inline | `diff`, `diff2html` |
| 10 | **CIDR / subnet calculator** | IPv4 + IPv6 | `cidr-tools` |
| 11 | **Regex tester** | JS flavour, live highlighting, capture groups, **test-case table** (many strings, pass/fail per row) | native `RegExp` |
| 12 | **XPath / CSS selector tester** | Against pasted HTML/XML, "copy as Playwright/Selenium locator" | **none** — native `document.evaluate` + `DOMParser` |
| 13 | **Pairwise test matrix** | N-wise covering arrays with constraints, CSV/JSON export | `covertable` |

### Notes on specific tools

**#1 Lorem / test data** is the engine behind several things. Edge-case mode
(zero-width chars, combining diacritics, emoji ZWJ sequences, RTL override chars,
200-char unbroken words) and the fixture generator are the same core with different
presets — near-zero marginal cost, so they ship as modes rather than separate tools.
Placeholder images are generated locally as SVG data URIs rather than linking
`placehold.co`, to keep the no-network guarantee intact.

**#11 Regex tester** duplicates regex101 unless the test-case table is the headline
feature. Paste many test strings, get pass/fail per row plus expected-match
assertions — regex-as-testing rather than regex-as-exploration. v1 is JS flavour
only; PCRE/RE2 need WASM and are deferred.

**#13 Pairwise** was originally scoped as "implement IPOG plus a constraint engine",
roughly two days. `covertable` obsoletes that. Verified 2026-07-29:

- Pure ESM, **zero dependencies**, zero Node builtins (no `fs`/`path`/`process`/
  `__dirname`/`require`) — confirmed browser-safe by inspection.
- 4×4×3×3 matrix → 16 rows, 73/73 pairs covered, hitting the theoretical lower
  bound exactly.
- Constraints verified working ("Safari only on macOS/iOS, Edge never on
  Linux/iOS" → 15 rows, zero violations).
- Also covers N-wise strength, sub-models for mixed strength, weights, presets for
  seeded rows, and `UncoveredPair`/`NeverMatch` exceptions when a constraint makes a
  pair unreachable. Constraints use Kleene three-valued logic, so a missing field
  defers to `null` rather than `false`.

The rejected alternative was `pict-node`, which ships `scripts/pict-install.js` to
download a **native PICT binary** at install time — Node-only, unusable on Pages.

## Non-goals

Recorded so they don't get relitigated. Each needs a server; adding one means this
is no longer "just GitHub Pages".

- Webhook receiver / request bin
- TLS or port scanning of remote hosts
- Arbitrary-URL fetching (CORS)
- Anything requiring an API key
- User accounts, cross-device sync
- Lighthouse runs, headless browser automation
- Native compiler toolchains (rustc, gcc)

Deliberately **not built** because a better free tool already exists: regex
exploration (regex101), cron expressions (crontab.guru), code formatting (your
editor already has Prettier).

## Licensing

Repo is MIT (`Copyright (c) 2026 williajm`).

`covertable` is **Apache-2.0**. Compatible — it bundles into an MIT project fine —
but note:

- Nothing is relicensed. Our code stays MIT, covertable's stays Apache-2.0; the
  built site is distributed under both.
- Bundling into a Pages site **is** distribution, so Apache-2.0 §4 attribution
  applies: ship a copy of the licence.
- The npm tarball does **not** include a LICENSE file despite declaring Apache-2.0
  in `package.json`. Pull the text from the GitHub repo. No `NOTICE` file exists,
  so §4(d) doesn't apply.
- Apache-2.0 carries an express patent grant that MIT lacks — marginally better
  protection than an MIT dependency.

TODO: add `rollup-plugin-license` to generate `THIRD-PARTY-NOTICES.txt` and a
`/licenses` page at build time. Covers every dependency, not just this one. Must be
in place before the first public deploy.

## Phasing

**Phase 0 — skeleton.** Vite + TS + Preact, design system, Actions deploy pipeline,
IA (categories, search, `Ctrl-K` palette), licence attribution generation, and 2–3
trivial tools end-to-end to prove the loop.

**Phase 1 — the easy wins.** #4 Encoding, #7 UUID, #8 Hash, #6 Timestamp. Small,
high-use, no interesting dependencies.

**Phase 2 — the headline tools.** #1 Lorem/test data, #2 QR, #3 JWT. The ones with
the strongest privacy story and the reason to visit.

**Phase 3 — the rest.** #5 JSON toolkit, #9 Diff, #10 CIDR, #11 Regex, #12 XPath,
#13 Pairwise.

**Phase 4 — polish.** PWA offline, per-tool CSP lockdown, share-links, recents.

Per-tool CSP, share-links and recents are done. PWA offline is blocked — see below.

## Deferred

TODO: PWA offline (`vite-plugin-pwa`). Blocked on a supply-chain problem, not a
technical one. Every version of the plugin pulls `workbox-build`, which reaches
`brace-expansion` — vulnerable at `<=5.0.7` under GHSA-mh99-v99m-4gvg (high, DoS
by unbounded expansion, build-time only). The fix is `brace-expansion@5.0.8`, and
an `overrides` pin would resolve it cleanly, but that release is newer than the
7-day minimum-release-age policy this environment installs under, so the lockfile
cannot be generated for it. Revisit once 5.0.8 ages in: add `vite-plugin-pwa`
plus `"overrides": { "brace-expansion": "^5.0.8" }` and confirm `npm audit` stays
clean. Note when doing so that the faker chunk is 2.8 MB — precache the rest and
cache that one at runtime rather than forcing it on every first visit.

TODO: multi-flavour regex (PCRE/RE2) — needs WASM, revisit once the COI question
is settled.

TODO: WASM tier if ever wanted — DuckDB-WASM (query local CSV/Parquet), SQLite, jq
playground, Pyodide. All viable on Pages but need the cross-origin isolation
question resolved first.

TODO: test-result tooling (JUnit/TAP viewer, coverage merger, HAR viewer) — cut
from v1 as not matching current workflow. Revisit if that changes.
