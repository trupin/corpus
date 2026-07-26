# Evaluation: UI-001

**Date**: 2026-07-26
**Sprint**: sprint-001 (Phase 1 — Foundations)
**Verdict**: PASS (16 of 16 acceptance tests pass; 3 deferrals verified legitimate)

Verification followed sprint-001's Verification Environment for UI-001: a real
`npm run dev -w apps/ui` (on `:5273` — `:5173` is held by an unrelated developer SSH tunnel
on this machine, confirmed by `lsof`), driven by real `curl` and a real headless Chromium via
Playwright, against the sprint's stub origin on `127.0.0.1:8765`. The stub used here is the
**evaluator's own**, serving `version: "9.9.9-evalstub"` so that any value rendered in the UI
provably came through the proxy from my socket. No implementation source was read to reach
this verdict; `packages/kit/src/tokens.css`, `design/index.html` and `apps/ui/src/**/*.css`
were read only because TEST-40/41/43 name them as the artifacts under test.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                       |
| --------------------------------------- | ------ | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Filled per test, with a deferral table.                                                                                                       |
| Commands are specific and concrete      | PASS   | Real `curl -sS -i` output with headers, wall-clock-stamped SSE frames, a named Playwright run with 13 named specs.                             |
| Real E2E (not mocked)                   | PASS   | Real Vite dev server, real socket to a real stub origin, real browser. The `lsof` output proving the port conflict is the kind of detail a fabricated log does not carry. |
| Scenarios cover acceptance criteria     | PASS   | Every one of TEST-33…48 has evidence; three genuinely unrunnable checks are deferred with named destinations.                                  |
| Application restarted after changes     | PASS   | The log records a first failing e2e run (3 failed/10 passed), three fixes, then a green run — evidence of a real edit/restart/re-verify cycle. |
| Actual model recorded (implemented on:) | PASS   | "implemented on: opus".                                                                                                                       |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                |

The log's honesty holds up under spot-check: I independently reproduced the `:5173` conflict
(`ssh 16094 … TCP 127.0.0.1:5173 (LISTEN)`), and every number I re-measured landed where the
log said it would.

## Criteria Results

| #       | Criterion                                       | Result | Observed                                                                                                                                                    |
| ------- | ----------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TEST-33 | Dev server boots, shell renders in order        | PASS   | `HEADER.topbar` (0→56.6), `MAIN.board` (56.6→689.1), `DIV.console` (689.1→720), all visible, in that document order. Zero `pageerror`, zero console errors with the origin up. |
| TEST-34 | Top bar matches the prototype                   | PASS   | Serif wordmark "Corpus" (`Iowan Old Style, …, serif`) with a mono uppercase `<small>workbench</small>` (10px/600); search is a `BUTTON.searchbar` (0 `<input>` in the top bar) with the prototype's placeholder and a `<kbd>⌘K</kbd>`; `BUTTON.btn-compose` reads `＋ Ask / Capture` with `<kbd>c</kbd>`. Neither `disabled` nor `aria-disabled`; clicking every top-bar button threw nothing and produced no `pageerror`. |
| TEST-35 | Board is a horizontal snap scroller             | PASS   | `overflow-x: auto`, `overflow-y: hidden`, `flex-grow: 1`; computed `scroll-snap-type: x` (Chromium drops the initial `proximity` strictness) and `Board.css` declares `scroll-snap-type: x proximity`. Top bar and strip do not grow. |
| TEST-36 | Console strip pushes the board, never overlays  | PASS   | `position: static`, `flex-grow: 0`, flex sibling of the board in the same `flex-direction: column` parent; strip top 689.06 == board bottom 689.06 (no overlap); single collapsed line, 30.9 px tall. |
| TEST-37 | Theme toggle cycles and repaints                | PASS   | `null → light → dark → null`; `system` is the **absent** attribute; light `rgb(247,246,243)` == `--bg #f7f6f3`, dark `rgb(21,23,27)` == dark `--bg #15171b`; accessible name tracks state (`"Theme: dark — switch to system"`). |
| TEST-38 | Theme survives reload with no wrong-theme flash | PASS   | Reload with `**/src/main.tsx*` aborted: `data-theme="dark"` already set while `#root` is empty — React demonstrably never ran. Normal reload paints `rgb(21,23,27)`. |
| TEST-39 | `system` defers to the OS preference, live      | PASS   | With no attribute: `prefers-color-scheme: dark` → `rgb(21,23,27)`, `light` → `rgb(247,246,243)`, no reload, and `data-theme` stayed `null` throughout. |
| TEST-40 | Token layer complete and dark-parity            | PASS   | All 24 prototype `:root` tokens present in the kit's `:root` with identical values; all 21 prototype dark tokens identical in **both** the kit's `@media (prefers-color-scheme: dark)` and its `[data-theme="dark"]` block; all 24 `:root` keys present in the dark block; explicit theme blocks (lines 92, 119) come **after** the media block (line 63). Only textual difference is hex lettercase and `0.10`→`0.1` (Prettier normalization) — no value differs. |
| TEST-41 | No hard-coded colors in the app                 | PASS   | `grep -rnE "#[0-9a-fA-F]{3,8}\b\|rgba?\(\|hsla?\("` over `apps/ui/src` → no matches.                                                                          |
| TEST-42 | Focus rings match the prototype                 | PASS   | Every keyboard tab stop (search, theme, compose): `outline: rgb(59,95,151) solid 2px` — exactly `--accent #3b5f97` — `outline-offset: 2px`, `border-radius: 4px`. |
| TEST-43 | Reduced motion honored                          | PASS   | `apps/ui/src/app/global.css` carries the prototype's block selector-for-selector: `.agent-pill .dot.busy, .working-dot, .row.flash { animation: none !important; }` and `.col, .row.leaving { transition: none !important; }`. |
| TEST-44 | `/api` proxies through Vite                     | PASS   | `curl -sS -i http://localhost:5273/api/health` → `200`, `content-type: application/json`, body `{"status":"ok","version":"9.9.9-evalstub","uptimeSeconds":20.259,"workspace":"/tmp/eval-stub-workspace"}` — my stub's payload, through the proxy. |
| TEST-45 | `/events` proxies without buffering             | PASS   | `content-type: text/event-stream`, `cache-control: no-cache, no-transform`, `x-accel-buffering: no`; first frame at **+0.16 s** (budget ~2 s), then heartbeats at +1.02, +2.00, +3.03, +4.03, +5.00 s — incremental, not batched at close. |
| TEST-46 | A failing health check fails soft               | PASS   | Stub killed, page reloaded: top bar, board and console strip all render, strip reads `▴ console server unreachable`, `#root` has 1 child, **zero** `pageerror`. The only console output is the browser's own 500 resource-load notice from the refused proxy — not an uncaught exception. |
| TEST-47 | Production build and strict typecheck pass      | PASS   | `npm run build` (contract → kit → cli → server → ui) succeeds; `npm run typecheck` across 5 workspaces exit 0; the emitted `apps/ui/dist/assets/*.css` contains `--sepia-wash-2`, proving `@corpus/kit/tokens.css` resolved through the kit's `exports` map; no `any` in `apps/ui/src` app code. |
| TEST-48 | The router is mounted                           | PASS   | `/` renders the board shell; `/nope` renders the same shell (top bar + board + console, `#root` populated, text `… No lists yet ▴ console …`) with no uncaught router error. |

### Deferrals — all verified legitimate

| Deferral                                         | Destination     | Verdict on the deferral                                                                                            |
| ------------------------------------------------ | --------------- | -------------------------------------------------------------------------------------------------------------------- |
| `/api/health` + `/events` against the real server | SERVER-003      | Legitimate — sprint's Verification Environment sanctions the stub origin explicitly; SERVER-003 is the Hono bootstrap that will provide the real one. |
| Dev server bound to `:5173` specifically          | SERVER-003      | Legitimate — I independently confirmed `ssh` (PID 16094) holds `127.0.0.1:5173`. The config pins the port and `strictPort` is proven by Vite refusing to start rather than drifting. |
| Playwright coverage merged into the 90% gate      | INFRA-004       | Legitimate — sprint's Out of Scope names INFRA-004 for exactly this.                                                  |

No throwaway scaffolding was committed: `apps/ui/e2e/` holds real specs only, and `git status`
shows no stub server in the tree.

## Subjective Quality Grading

Judged against `design/index.html` as the authoritative look-and-feel, at 1440×900 in both
themes, and constrained to what this issue ships (a shell — columns, readers and the composer
are later issues, so this is graded as chrome, not as a product).

- **Design Quality — 4/5.** Deliberate identity: serif wordmark against a mono uppercase
  eyebrow, warm paper `#f7f6f3` ground, hairline `--line` borders, a single accent. Reads as
  one considered surface rather than assembled parts. Not a 5 only because the shell is mostly
  empty in this issue, so the system has little to prove itself on yet.
- **Originality — 4/5.** Nothing framework-default about it: no component library, custom
  token layer with four documented semantic roles (`--accent`, `--signal`, `--sepia` as a
  dedicated staleness axis, `--good`), and a horizontally snapping board rather than the
  default vertical dashboard.
- **Craft — 5/5.** Zero color literals outside the token layer, full light/dark parity across
  all 24 tokens, theme applied pre-paint (proven with the bundle blocked), focus rings exactly
  `2px solid var(--accent)` with 2px offset on every tab stop, reduced-motion honored, strip
  and board geometrically flush with no overlap.
- **Functionality — 4/5.** Every affordance present is discoverable and labeled (`⌘K`, `c`,
  theme toggle with a state-naming accessible name); the empty board says "No lists yet"; the
  console strip reports server state honestly. Capped at 4 because the affordances are inert
  by design in this issue — correct per the sprint, but a user cannot yet complete a task.

**Average 4.25/5** — comfortably above the 3.0 threshold, no individual 1.

## Summary

16 of 16 acceptance tests pass, with three deferrals whose destinations I verified are real
and correctly scoped. Every claim I spot-checked in the E2E log reproduced, including the
awkward ones (the port conflict, the `scroll-snap-type` serialization, the pre-paint theme
proof). `npm run e2e` runs 13 real Playwright specs green rather than skipping for want of
specs, which is what the sprint asked UI-001 to deliver to INFRA-004.

**Verdict: PASS.**
