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

- [ ] `npm run dev -w apps/ui` starts Vite on `:5173` and proxies `/api` and `/events` to `http://127.0.0.1:8765` (SSE proxying works — no response buffering).
- [ ] `apps/ui` builds (`npm run build -w apps/ui`) and typechecks under TS strict with no `any` in app code.
- [ ] `packages/kit/src/tokens.css` defines every token from `design/index.html` `:root` — colors (`--bg`, `--surface`, `--surface-2`, `--ink`, `--ink-2`, `--ink-3`, `--line`, `--line-strong`, `--accent`/`--accent-ink`/`--accent-wash`, `--signal`/`--signal-wash`, `--sepia`/`--sepia-ink`/`--sepia-wash`/`--sepia-wash-2`, `--good`/`--good-wash`), shadows (`--shadow`, `--shadow-soft`), and type families (`--serif`, `--sans`, `--mono`) — with identical values.
- [ ] Theming works three ways, in this precedence: `prefers-color-scheme: dark` as the default signal, overridden by `:root[data-theme="light"]` and `:root[data-theme="dark"]`.
- [ ] `packages/kit` exports the stylesheet (`@corpus/kit/tokens.css`) and `apps/ui` imports it once at the app root; no hard-coded hex color exists anywhere in `apps/ui/src` (lint-visible convention, checked by review).
- [ ] A theme toggle in the top bar cycles `system → light → dark`, writes `data-theme` on `<html>` (removing the attribute for `system`), and persists the choice in `localStorage` across reloads.
- [ ] Global base styles match the prototype: `body` uses `--sans` at `13.5px`/`1.45` on `--bg`/`--ink`, `overflow: hidden`, `box-sizing: border-box` reset, `button { font: inherit; … }` reset.
- [ ] `:focus-visible` renders a `2px solid var(--accent)` outline with `2px` offset and `4px` radius on buttons, inputs, and `[tabindex]` elements.
- [ ] A `@media (prefers-reduced-motion: reduce)` block disables the pulse animation and column/row transitions (same rules as the prototype).
- [ ] Shell renders: `.topbar` with a serif wordmark ("Corpus") plus a mono uppercase eyebrow ("workbench"), a centered `.searchbar` **button** showing the placeholder copy and a `⌘K` `<kbd>` hint, and an accent `＋ Ask / Capture` button with a `c` `<kbd>` hint (both are non-functional affordances in this issue — search overlay and composer are later issues; they must not appear disabled).
- [ ] `.board` is a horizontal scroller with `scroll-snap-type: x proximity`, `overflow-y: hidden`, the prototype's padding/gap, and the custom `10px` scrollbar thumb; it renders placeholder/empty content in this issue.
- [ ] `.console` renders as a collapsed one-line strip pinned below the board (static placeholder text — the real console is UI-011); it is part of the flex column so it pushes the board, never overlays it.
- [ ] React Router v6 is mounted with a single `/` route (the board); the router is in place so later issues can add routes without restructuring.
- [ ] A `QueryClientProvider` (TanStack Query v5) wraps the app with documented defaults (`staleTime`, `refetchOnWindowFocus`) chosen to suit an SSE-invalidation model.
- [ ] A health check (`GET /api/health` or the contract's equivalent) runs via TanStack Query on boot; a failed check renders a non-blocking "server unreachable" notice in the console strip rather than crashing the shell.
- [ ] Playwright smoke spec in `apps/ui/e2e/` passes against the real app: the app boots, the topbar/board/console are present, and toggling the theme flips `data-theme` and a computed background color.

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

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (P0, foundational surface consumed by every later UI issue)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[UI-001]` prefix
