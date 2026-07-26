# [UI-001] App scaffold + design system

## Domain

ui

## Status

in_progress

## Priority

P0

## Model

opus — porting an existing authoritative design; the token system, shell markup, and theming rules are all pinned by `design/index.html`, so this is faithful transcription plus standard Vite/Router/Query wiring, not novel design work.

## Dependencies

- Depends on: INFRA-007
- Blocks: UI-002, INFRA-004

## Spec References

- SPEC.md §3 — "Tech stack (fixed)" (Vite, React 18, TS strict, TanStack Query v5, React Router v6, vanilla CSS tokens, dev server on `:5173` proxying `/api` and `/events`)
- SPEC.md §11 — "UI — the board" (Shell: top bar · board · console drawer; no sidebar; vanilla CSS tokens, light/dark)
- CLAUDE.md — Architecture Decisions 1–3 (tool/workspace split, server is the sole writer, contract-first)
- `design/index.html` — **authoritative look & feel** (living interactive mockup; SPEC.md §11 defines the structural contract, the mockup defines the visual one)

## Summary

Turn `apps/ui` from a placeholder workspace into a running Vite + React 18 application with the project's design system in place: the token layer ported verbatim from the design prototype into `packages/kit/src/tokens.css` (the kit owns tokens so plugins inherit them), the three-part app shell (top bar · board scroller · console strip placeholder), routing and a TanStack Query provider, and a working light/dark theme toggle — the one piece the prototype is missing. No data wiring beyond a server health check; every real query arrives with UI-002.

## Acceptance Criteria

- [x] `npm run dev -w apps/ui` starts Vite on `:5173` and proxies `/api` and `/events` to `http://127.0.0.1:8765` (SSE proxying works — no response buffering).
- [x] `apps/ui` builds (`npm run build -w apps/ui`) and typechecks under TS strict with no `any` in app code.
- [x] `packages/kit/src/tokens.css` defines every token from `design/index.html` `:root` — colors (`--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-strong`, `--accent`/`--accent-ink`/`--accent-wash`, `--signal`/`--signal-wash`, `--sepia`/`--sepia-ink`/`--sepia-wash`/`--sepia-wash-2`, `--good`/`--good-wash`), shadows (`--shadow`, `--shadow-soft`), and type families (`--serif`, `--sans`, `--mono`) — with identical values.
- [x] Theming works three ways, in this precedence: `prefers-color-scheme: dark` as the default signal, overridden by `:root[data-theme="light"]` and `:root[data-theme="dark"]`.
- [x] `packages/kit` exports the stylesheet (`@corpus/kit/tokens.css`) and `apps/ui` imports it once at the app root; no hard-coded hex color exists anywhere in `apps/ui/src` (lint-visible convention, checked by review).
- [x] A theme toggle in the top bar cycles `system → light → dark`, writes `data-theme` on `<html>` (removing the attribute for `system`), and persists the choice in `localStorage` across reloads.
- [x] Global base styles match the prototype: `body` uses `--sans` at `13.5px`/`1.45` on `--bg`/`--ink`, `overflow: hidden`, `box-sizing: border-box` reset, `button { font: inherit; … }` reset.
- [x] `:focus-visible` renders a `2px solid var(--accent)` outline with `2px` offset and `4px` radius on buttons, inputs, and `[tabindex]` elements.
- [x] A `@media (prefers-reduced-motion: reduce)` block disables the pulse animation and column/row transitions (same rules as the prototype).
- [x] Shell renders: `.topbar` with a serif wordmark ("Corpus") plus a mono uppercase eyebrow ("workbench"), a centered `.searchbar` **button** showing the placeholder copy and a `⌘K` `<kbd>` hint, and an accent `＋ Ask / Capture` button with a `c` `<kbd>` hint (both are non-functional affordances in this issue — search overlay and composer are later issues; they must not appear disabled).
- [x] `.board` is a horizontal scroller with `scroll-snap-type: x proximity`, `overflow-y: hidden`, the prototype's padding/gap, and the custom `10px` scrollbar thumb; it renders placeholder/empty content in this issue.
- [x] `.console` renders as a collapsed one-line strip pinned below the board (static placeholder text — the real console is UI-011); it is part of the flex column so it pushes the board, never overlays it.
- [x] React Router v6 is mounted with a single `/` route (the board); the router is in place so later issues can add routes without restructuring.
- [x] A `QueryClientProvider` (TanStack Query v5) wraps the app with documented defaults (`staleTime`, `refetchOnWindowFocus`) chosen to suit an SSE-invalidation model.
- [x] A health check (`GET /api/health` or the contract's equivalent) runs via TanStack Query on boot; a failed check renders a non-blocking "server unreachable" notice in the console strip rather than crashing the shell.
- [x] Playwright smoke spec in `apps/ui/e2e/` passes against the real app: the app boots, the topbar/board/console are present, and toggling the theme flips `data-theme` and a computed background color.

## Technical Design

### Files to Create/Modify

- `apps/ui/package.json` — add `vite`, `@vitejs/plugin-react`, `react`, `react-dom`, `react-router-dom`, `@tanstack/react-query`, `@corpus/kit`; scripts `dev`, `build`, `preview`, `typecheck`
- `apps/ui/vite.config.ts` — React plugin; `server.port = 5173`; `server.proxy` for `/api` and `/events` (see details)
- `apps/ui/index.html` — Vite entry document
- `apps/ui/src/main.tsx` — React root; imports `@corpus/kit/tokens.css` and `./app/global.css`
- `apps/ui/src/app/App.tsx` — router + `QueryClientProvider` + `<Shell />`
- `apps/ui/src/app/queryClient.ts` — configured `QueryClient` (kept here in this issue; UI-002 may relocate the shared instance into the kit)
- `apps/ui/src/app/global.css` — base/reset styles, focus-visible, reduced-motion (tokens themselves live in the kit)
- `apps/ui/src/shell/Shell.tsx` + `Shell.css` — topbar / board / console layout
- `apps/ui/src/shell/Topbar.tsx` + `Topbar.css` — wordmark, searchbar button, compose button, theme toggle
- `apps/ui/src/shell/Board.tsx` + `Board.css` — the horizontal scroller container
- `apps/ui/src/shell/ConsoleStrip.tsx` + `ConsoleStrip.css` — collapsed strip placeholder
- `apps/ui/src/shell/ThemeToggle.tsx` + `useTheme.ts` (+ `useTheme.test.ts`) — theme state, persistence, `data-theme` application
- `apps/ui/src/shell/useHealth.ts` — health-check query
- `apps/ui/src/shell/*.test.tsx` — component tests (see Testing Strategy)
- `packages/kit/src/tokens.css` — the ported token layer
- `packages/kit/package.json` — add a `./tokens.css` entry to the exports map
- `apps/ui/e2e/smoke.spec.ts` — Playwright smoke
- `apps/ui/playwright.config.ts` — add `webServer` (or document the run command) and `baseURL`
- `apps/ui/tsconfig.json` — JSX + DOM lib settings

### Key Implementation Details

**Token port.** Copy the four token blocks from `design/index.html` lines ~3–63 verbatim: the `:root` light defaults, the `@media (prefers-color-scheme: dark)` override, and the explicit `:root[data-theme="light"]` / `:root[data-theme="dark"]` blocks. The explicit attribute blocks must come **after** the media query in source order so the user's toggle wins in both directions. Do not "improve" values, rename roles, or collapse the duplication — the duplication is what makes the toggle beat the OS preference. Semantics to preserve in comments so later issues use them correctly:

- `--accent` (blue) = agent / interactive
- `--signal` (rust) = needs-you / destructive
- `--sepia` = the **dedicated staleness axis** (never reuse it for anything else)
- `--good` (green) = success / resolved

**Type families.** Three families, applied by role, not by taste: `--serif` (Iowan Old Style → Palatino → Charter → Georgia stack) for content, titles, and quotes; `--sans` (system stack) for chrome at `13.5px`/`1.45`; `--mono` for ids, paths, chips, `kbd`, and log output.

**Theme toggle** (the prototype's known gap). `useTheme()` holds `"system" | "light" | "dark"`, persists under a namespaced key (e.g. `corpus.theme`), and applies it by setting or removing `document.documentElement.dataset.theme`. Read the persisted value **before first paint** (a tiny inline script in `index.html` is acceptable and preferred) to avoid a flash of the wrong theme. The toggle lives in `.topbar-actions`, is a plain `button` styled like `.btn-queue`, and exposes an `aria-label` naming the current mode.

**Vite proxy.** `/api` → `http://127.0.0.1:8765`, `changeOrigin: false`. `/events` must proxy **without buffering** so SSE streams through: configure it as its own proxy entry and, if the default agent buffers, set `configure` to disable compression/timeouts for that path. UI-002 depends on this working.

**Shell layout.** `.app { display:flex; flex-direction:column; height:100vh }`; topbar `flex: none`; board `flex: 1`; console `flex: none`. The console is a sibling in the column — never `position: fixed` — because SPEC.md §11 requires it to push the board when expanded.

**Query client defaults.** With SSE-driven invalidation (SPEC.md §2 rule 3), background polling is wrong: set `refetchOnWindowFocus: false`, a generous `staleTime`, and `retry` low. Document the reasoning in a comment; UI-002 owns the invalidation wiring.

**Scope discipline.** The searchbar button and compose button are affordances only — clicking them may no-op (or open nothing) but must not render as disabled controls, since UI-009/UI-010 wire them.

### Edge Cases

- **Theme flash on load** — persisted theme must be applied before React mounts.
- **`system` mode after an OS theme change** — with no `data-theme` attribute present, the media query keeps working live; verify the toggle's `system` position actually removes the attribute rather than writing a resolved value.
- **SSE proxy buffering** — a proxy that buffers makes `/events` appear to hang; verify with `curl -N http://localhost:5173/events` through the dev server, not just against the server port.
- **Server not running** — the health check must fail soft (notice in the console strip), never an error boundary or a blank page.
- **`prefers-reduced-motion`** — the reduced-motion block must use `!important` on the animation rules exactly as the prototype does, since later issues add animated elements.
- **Custom scrollbars** — `::-webkit-scrollbar` rules are Chromium/WebKit-only; Firefox falls back to native scrollbars. That is acceptable; do not add a scrollbar library.
- **Kit CSS export** — `packages/kit/package.json` must expose `./tokens.css` in its `exports` map or the import from `apps/ui` fails under Node ESM resolution.

## Testing Strategy

Vitest + React Testing Library (jsdom) in `apps/ui`:

- `useTheme`: cycles `system → light → dark → system`; sets/removes `data-theme` on the document element; persists to and restores from `localStorage`; ignores a corrupt persisted value.
- `Topbar`: renders the wordmark, the eyebrow, the search button with a `⌘K` hint, the compose button with a `c` hint, and the theme toggle with an accessible label.
- `Shell`: renders topbar, board, and console strip in document order; the board container carries the scroll-snap class.
- `useHealth`/`Shell`: a failing health query renders the "server unreachable" notice and does not throw.
- A token-parity test that reads `packages/kit/src/tokens.css` and asserts every custom property declared in the `:root` block also appears in the `[data-theme="dark"]` block (guards against a half-ported theme).

## E2E Verification Plan

### Verification Steps

1. Start the real stack: the Corpus server on `:8765` and `npm run dev -w apps/ui`.
2. Open `http://localhost:5173` in Playwright — assert `.topbar`, `.board`, and the console strip render, and the wordmark reads "Corpus".
3. Assert the search affordance shows the `⌘K` hint and the compose button shows the `c` hint.
4. Click the theme toggle twice; after each click read `document.documentElement.getAttribute("data-theme")` and the computed `background-color` of `body`; assert light and dark differ and match the token values.
5. Reload the page; assert the chosen theme survives and that no light-theme frame is painted first (assert `data-theme` is already set on first evaluation).
6. `curl -N http://localhost:5173/events` — assert the SSE stream opens through the Vite proxy and heartbeats arrive (no buffering).
7. `curl http://localhost:5173/api/health` — assert it proxies to the server and returns the server's response.
8. Stop the server, reload the UI — assert the shell still renders and the console strip shows the "server unreachable" notice.
9. `npm run build -w apps/ui` — assert the production build succeeds.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable") — the audit trail for recalibrating Model recommendations. The
evaluator will reject issues without credible proof._

**implemented on: opus**

### Reproduction (bugs only)

N/A — feature issue, not a bug.

### Verification environment

Per `issues/sprints/sprint-001.md` → "Verification Environment": no Corpus server
exists in Phase 1, so the Vite proxy was verified against the sprint's **stub
origin** — a real Node `http` server on `127.0.0.1:8765` over a real socket,
serving `GET /api/health` (a `HealthSchema`-shaped body) and `GET /events`
(`text/event-stream`, `: heartbeat` comment every ~1 s). The stub lived in the
session scratchpad and is **not committed**.

One environment deviation, recorded rather than hidden: **an SSH tunnel owned by
the developer already held `127.0.0.1:5173`** on this machine:

```
$ lsof -nP -iTCP:5173 -sTCP:LISTEN
COMMAND   PID           USER   FD   TYPE             DEVICE SIZE/OFF NODE NAME
ssh     16094 theophanerupin   11u  IPv4 0xad73505c3a233da7      0t0  TCP 127.0.0.1:5173 (LISTEN)
```

`vite.config.ts` still pins `port: 5173, strictPort: true`, and Vite refused to
start rather than silently drifting to 5174 — itself proof `strictPort` is set:

```
$ npm run dev -w apps/ui
error when starting dev server:
Error: Port 5173 is already in use
```

Verification therefore ran on `--port 5273 --strictPort`, through the same Vite
config and the same proxy. `playwright.config.ts` reads `CORPUS_UI_PORT` for
exactly this case and defaults to 5173. **The `:5173` binding itself is
`DEFERRED → SERVER-003`**, when the port is free of the developer's tunnel.

### Post-Implementation Verification

**TEST-44 — `/api` proxies through Vite** (stub origin up, dev server on :5273):

```
$ curl -sS -i http://localhost:5273/api/health
HTTP/1.1 200 OK
Vary: Origin
content-type: application/json
connection: close
Transfer-Encoding: chunked

{"status":"ok","version":"0.0.0-stub","uptimeSeconds":49.827,"workspace":"/tmp/corpus-stub-workspace"}
```

PASS — the request reached `127.0.0.1:8765` through the proxy and returned the
stub's `HealthSchema` body verbatim.

**TEST-45 — `/events` proxies without buffering.** `curl -N -i --max-time 6`,
each line stamped with its wall-clock arrival offset:

```
+0.13s  content-type: text/event-stream
+0.18s  cache-control: no-cache, no-transform
+0.31s  x-accel-buffering: no
+0.43s  : heartbeat 2026-07-26T20:04:53.853Z
+1.03s  : heartbeat 2026-07-26T20:04:54.855Z
+2.04s  : heartbeat 2026-07-26T20:04:55.857Z
+3.04s  : heartbeat 2026-07-26T20:04:56.857Z
+4.04s  : heartbeat 2026-07-26T20:04:57.859Z
+5.04s  : heartbeat 2026-07-26T20:04:58.860Z
curl: (28) Operation timed out after 6011 milliseconds
```

PASS — first frame at **+0.43 s** (budget ~2 s), then one per second
*incrementally*; a buffering proxy would have delivered all six at close.

**Healthy-server path in a real browser** (stub up, headless Chromium):

```
console strip: ▴ / console / corpus 0.0.0-stub
c-status     : corpus 0.0.0-stub
c-failed cnt : 0
uncaught     : []
regions      : ["topbar","board","console"]
```

PASS — the health query, issued through the contract's generated typed client
(`uiClient.api.GET("/api/health")`), reached the stub through the proxy and its
`version` rendered in the console strip. This path is re-verified against the
real server in **SERVER-003**.

**Playwright smoke suite** (stub origin **stopped** — CI has no server either, so
the committed suite must be green with `127.0.0.1:8765` refusing connections):

```
$ CORPUS_UI_PORT=5273 npm run e2e
Running 13 tests using 4 workers
  ✓ shell › boots with the three regions in document order and no uncaught error
  ✓ shell › top bar matches the design prototype
  ✓ shell › the not-yet-wired affordances are enabled and inert
  ✓ shell › the board is a horizontal snap scroller that takes the flexible middle
  ✓ shell › the console strip pushes the board and never overlays it
  ✓ shell › no sidebar
  ✓ theme › the toggle cycles system → light → dark → system and repaints
  ✓ theme › the chosen theme survives a reload
  ✓ theme › the theme is applied before the bundle runs, so no light frame is painted
  ✓ theme › system mode follows the OS preference live, writing no attribute
  ✓ theme › focus rings match the prototype
  ✓ server state › a failing health check fails soft with a notice in the console strip
  ✓ server state › an unknown route renders the shell rather than a blank page
  13 passed (4.0s)
```

Covering TEST-33 / 34 / 35 / 36 / 37 / 38 / 39 / 42 / 46 / 48. Notes on three of
them:

- **TEST-35**: Chromium serialises the computed `scroll-snap-type` as `x`,
  because `proximity` is the initial strictness — so the spec asserts the
  computed axis (`/^x( proximity)?$/`) **and** that `Board.css` declares
  `scroll-snap-type: x proximity;`. Both hold.
- **TEST-38**: proven by blocking `/src/main.tsx` with `page.route(...).abort()`
  and reloading — `#root` is empty (React demonstrably never ran) while
  `data-theme` already reads `dark`, so the inline pre-paint script is what sets
  it. The painted dark `--bg` after a normal reload is asserted separately.
- **TEST-46**: the dev server logged the real refusal while the test passed —
  `[vite] http proxy error: /api/health / Error: connect ECONNREFUSED
  127.0.0.1:8765` — and the strip showed `server unreachable` with the top bar
  and board still rendered and zero `pageerror` events.

**Three real defects were found and fixed by this run** (first e2e attempt: 3
failed / 10 passed): the suite's own `addInitScript` storage reset re-ran on
reload and erased the value the persistence tests were checking; the
`scroll-snap-type` serialisation above; and a background assertion in the
blocked-bundle test that could never hold in dev, where the stylesheet ships
inside the blocked bundle.

**TEST-40 / 41 — token layer and no hard-coded colour.** `packages/kit/src/tokens.test.ts`
(54 assertions) parses `design/index.html` and `tokens.css` and compares them
property-by-property: all 24 `:root` tokens ported with identical values, all 21
of the prototype's dark tokens identical in both the media query and the
`[data-theme="dark"]` block, and the explicit theme blocks positioned after the
media query. Colour-literal sweep:

```
$ grep -rnE "#[0-9a-fA-F]{3,8}\b|rgb\(|rgba\(|hsl\(|hsla\(" apps/ui/src
NO COLOR LITERALS FOUND
```

**TEST-43 — reduced motion**: `apps/ui/src/app/global.css` carries the
prototype's block selector-for-selector, `!important` included.

**TEST-47 — production build and strict typecheck**, plus the rest of the gate,
from a clean tree:

```
$ npm run build
… contract ✓  kit ✓  cli ✓  server ✓
> @corpus/ui@0.0.0 build   (vite build)
✓ 215 modules transformed.
dist/index.html                   1.42 kB │ gzip:  0.77 kB
dist/assets/index-DBo_PnNP.css    6.01 kB │ gzip:  1.63 kB
dist/assets/index-CRi6zNLx.js   288.23 kB │ gzip: 89.12 kB
✓ built in 643ms

$ npm run lint          → clean
$ npm run format:check  → All matched files use Prettier code style!
$ npm run typecheck     → 5 workspaces, no errors
$ npm run test:coverage
 Test Files  35 passed (35)
      Tests  360 passed (360)
All files          |     100 |      100 |     100 |     100 |
 apps/ui/src       |     100 |      100 |     100 |     100 |
 apps/ui/src/app   |     100 |      100 |     100 |     100 |
 apps/ui/src/shell |     100 |      100 |     100 |     100 |
```

The `@corpus/kit/tokens.css` import resolves through the kit's `exports` map
(`"./tokens.css": "./src/tokens.css"`), not a relative path — the emitted
`index-*.css` contains the token layer.

**Visual self-review against `design/index.html`**: screenshots captured at
1440×900 in both explicit themes. Light and dark chrome match the prototype —
serif wordmark with mono uppercase eyebrow, centred `.searchbar` chip with the
`⌘K` key cap, accent `＋ Ask / Capture` button with its `c` cap, hairline
`--line` borders on `--surface`, and the collapsed console strip pinned below
the board.

### Deferred verification

| Check                                   | Status                                                       |
| --------------------------------------- | ------------------------------------------------------------ |
| `/api/health` + `/events` against the real Corpus server | `DEFERRED → SERVER-003` (no server exists in Phase 1; verified against the sprint's stub origin) |
| Dev server bound to `:5173` specifically | `DEFERRED → SERVER-003` (port held by a developer SSH tunnel; config pins it, `strictPort` proven by the refusal above) |
| Playwright coverage merged into the 90% gate | `DEFERRED → INFRA-004` (per sprint Out of Scope) |

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, foundational surface consumed by every later UI issue)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-001]` prefix
