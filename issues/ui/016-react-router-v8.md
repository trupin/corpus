# [UI-016] Migrate to react-router v8 (clears GHSA-qwww-vcr4-c8h2)

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus — a mechanical major-version migration with a green e2e suite as the bar.

## Dependencies

- Depends on: UI-029 (React 19 prerequisite — ruling 2026-07-31, option 1), UI-005
- Blocks: —

## Spec References

- GHSA-wrjc-x8rr-h8h6 — open redirect via backslash in <Link>/useNavigate (high, 6.0.0–8.2.0)
- GHSA-337j-9hxr-rhxg — arbitrary constructor injection via deserializeErrors (SSR-only)
- GHSA-qwww-vcr4-c8h2 — RSC-mode CSRF (RSC-only), vulnerable 7.12.0–8.2.0
- issues/infra/010-audit-brace-expansion-vitest-peer.md

## Summary

The installed router is `react-router-dom@6.30.4` — the line the code is actually written for
(App.tsx passes v6 `future` flags; INFRA-010 found the declared `^7.18.2` had never truly
installed). npm audit unions three high advisories across 6.0.0–8.2.0, so NO 6.x or 7.x release
is clean; v8 (`react-router` only — the `-dom` package is gone) is the only fixed line.
Applicability here: the SSR-hydration and RSC-CSRF advisories cannot apply (client-only Vite
SPA, no SSR, no RSC); the backslash open-redirect nominally applies but is bounded by the
localhost single-user deployment. Still: migrate to `react-router@^8.3.0`, update imports
(including removing the v6 `future` flags), and absorb v8 breaking changes.

Do it as a focused migration: the router surface in this app is small (BrowserRouter, routes,
navigation in the reader stacks). Bar: full unit + e2e suites green, no behavior change.

## Acceptance Criteria

- [x] `react-router@^8.3.0` (or later), `react-router-dom` removed; imports updated.
      Done 2026-07-31: `apps/ui/package.json` declares `react-router: "^8.3.0"`, resolved
      `8.3.0`; `react-router-dom` is gone from the manifest, the lockfile and every source file.
      The 2026-07-31 **BLOCKED** annotation is history — UI-029 landed React 19.2.8 and the
      `8.x` peer floor (`react >=19.2.7`) is satisfied.
- [x] `npm audit` reports zero known-vulnerable router findings.
      Done 2026-07-31: `metadata.vulnerabilities.total === 0` measured **in this tree**
      (sprint-020 TEST-753), not in a scratch package. Full block in the log below.
- [x] Unit + e2e suites green; reader navigation stacks behave identically (Back, scroll
      restoration, stack-empty exit).
      Done 2026-07-31: 1556 unit tests (104 files, `apps/ui`) and all 14 e2e specs (148 tests)
      green with no assertion edited. The three nav-stack files carry **zero** react-router
      involvement and were not opened for writing; the three behaviours were additionally driven
      by hand against the real app (sprint-018 TEST-598 could only restate this claim — it is now
      tested).

## E2E Verification Log

### 2026-07-31 — ui-dev, model **opus** (claude-opus-5[1m]) — BLOCKED before implementation

No source file, manifest or lockfile was modified. The migration cannot be performed within this
issue's scope; the blocker and the evidence are below. Sprint-018 ports (`8795`/`8796`, Vite
`5275`) were never bound, because no code change reached a state worth booting.

**Blocker: `react-router@8.x` is React 19-only, in declaration and in fact.**

```
$ npm view react-router@8.0.0/8.1.0/8.2.0/8.3.0 peerDependencies
{ "react": ">=19.2.7", "react-dom": ">=19.2.7" }      # identical for all four
```

Not just a declared peer — the shipped bundle statically imports a React 19 hook:

```
$ /usr/bin/grep -n "useOptimistic" package/dist/production/lib/components.js
18:import { useOptimistic } from "react";
123:	let [state, setOptimisticState] = useOptimistic(_state);
```

`useOptimistic` does not exist in React 18, and `lib/components.js` is the declarative-router
module (`BrowserRouter`, `Routes`, `Route`). A `--legacy-peer-deps` install would therefore not
merely warn — and it would independently fail sprint-018 TEST-654, which requires `npm ls` to
report no unmet peer.

**Measured: no react-router line below 8.3.0 is audit-clean.** Each probed in an isolated scratch
package (`npm install --package-lock-only` + `npm audit`), never in this tree:

| version              | audit result                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `6.30.4` (installed) | 2 moderate — backslash open redirect (`>=6.0.0 <7.18.0`), `deserializeErrors` SSR (`>=6.4.0 <7.18.0`) |
| `7.11.0`             | 14 findings (7 high)                                                  |
| `7.18.0` / `7.18.2`  | 1 high — RSC-mode CSRF bypass, `>=7.12.0 <8.3.0`                       |
| `8.3.0`              | **0**                                                                 |

So the issue's own second criterion is reachable only at `8.3.0`, i.e. only on React 19. Note the
issue's advisory ranges were slightly off: the backslash open redirect is fixed in **7.18.0**, not
open through 8.2.0.

**Why this is out of scope rather than "absorb the breaking change".** React 19 must be adopted in
`apps/ui` **and** `packages/kit` — the kit declares `peerDependencies.react: "^18.3.1"` plus React
18 devDependencies (`packages/kit/package.json:...`). Sprint-018's Out of Scope and Adjudication 6
forbid any `packages/kit` change outside UI-020's named client method, "by name, not by category".
A React major also revalidates both suites, which is a different issue from a router import swap.

**Feasibility survey for that follow-up (all facts, no changes made):**

- Every other React consumer already accepts 19: `@tanstack/react-query@5.101.4` (`^18 || ^19`),
  `@tiptap/react@2.27.2` (`^17 || ^18 || ^19`), `@testing-library/react@16.3.2` (`^18 || ^19`),
  `react-markdown@9.1.0` (`>=18`), `use-sync-external-store@1.6.0` (`… || ^19`). Only `react-dom`
  itself and the router pin 18.
- `/usr/bin/grep` over `apps/ui/src`, `packages/kit/src`, `plugins/` finds **zero** React
  19-removed patterns: no `defaultProps`/`propTypes` on components, no `ReactDOM.render`, no
  `react-dom/test-utils`, no string refs, no no-argument `useRef()`, no global `JSX.` namespace
  references. (The `.ref` hits are CSS class names in tests.)
- `react-router@8.3.0` still exports `BrowserRouter`, `MemoryRouter`, `Route`, `Routes`,
  `createBrowserRouter`, `useSearchParams` — so once React 19 lands, this issue really is the
  4-file import swap the contract scoped, and the `<Route>`-as-child question (Open Conflict 2)
  can be answered then.

**Router surface reproduced before any change (sprint-018 TEST-594 baseline, `/usr/bin/grep`):**

```
apps/ui/package.json:31:    "react-router-dom": "^6.30.4",
apps/ui/src/app/App.tsx:4:import { BrowserRouter, Route, Routes } from "react-router-dom";
apps/ui/src/dev/devRoutes.tsx:2:import { Route } from "react-router-dom";
apps/ui/src/dev/DataProbe.tsx:13:import { useSearchParams } from "react-router-dom";
apps/ui/src/dev/DataProbe.test.tsx:5:import { MemoryRouter } from "react-router-dom";
```

Installed tree matches the declaration (`npm ls`): `react-router-dom@6.30.4 → react-router@6.30.4`,
hoisted, no nested copies.

**Options put to the orchestrator** (ranked; none taken unilaterally):

1. **File a React 18→19 upgrade issue** covering `apps/ui` + `packages/kit`, make UI-016 depend on
   it, and re-run UI-016 afterwards as the mechanical 4-file swap. Needs an adjudication amendment
   for the kit manifest.
2. **Stopgap to `react-router@7.18.2`** (peer `react >=18`, installs today): removes
   `react-router-dom`, drops the v6 `future` flags, performs the exact 4-file import migration, and
   clears both advisories currently reported. Residual: the RSC-mode CSRF finding, structurally
   inapplicable here (client-only Vite SPA, no SSR, no RSC) and not gated by CI (`/usr/bin/grep`
   finds no `npm audit` in `.github/workflows/` or `.githooks/`) — but it trades a reported
   *moderate* for a reported *high*, so TEST-593 still fails and the audit reads worse.
3. **Defer UI-016** until React 19 lands, accepting the backslash open redirect, which is bounded
   by the localhost single-user deployment.

**Hygiene.** `/Users/theophanerupin/code/corpus/.corpus` absent ("No such file or directory").
`8765` still pid 15627, never bound, never proxied. All scratch under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s018-ui/ui-016-yUX6yT/`. No vitest, Playwright or
Vite process started; no `npm install` run in this tree. No git command run.

### 2026-07-31 — ui-dev, model **opus** (claude-opus-5[1m]) — MIGRATED, all criteria met

Blocker cleared upstream: UI-029 landed **React 19.2.8** (`node -p` on the installed
`react`/`react-dom` manifests), and `react-router@8.3.0`'s peer floor is `react >=19.2.7`. The
entry above is retained as history.

**Install.** Plain `npm install` — **no `--legacy-peer-deps`, no `--force`, no `npm audit fix`**:

```
added 2 packages, removed 3 packages, and audited 559 packages in 2s
found 0 vulnerabilities
```

Added: `react-router@8.3.0`, `cookie-es@3.1.1` (router 8's new transitive). Removed:
`react-router-dom@6.30.4`, `react-router@6.30.4`, `@remix-run/router` — `/usr/bin/grep -c
"@remix-run/router" package-lock.json` → **0**. Lockfile churn is router-scoped.

**TEST-753 — `npm audit --json`, measured in THIS tree after the install:**

```
top-level keys: auditReportVersion,vulnerabilities,metadata
metadata.vulnerabilities: {
  "info": 0,
  "low": 0,
  "moderate": 0,
  "high": 0,
  "critical": 0,
  "total": 0
}
vulnerabilities map keys: []
```

Contract-time was `{moderate:2, total:2}`, keyed `react-router`/`react-router-dom`. Both are gone
and `cookie-es` added nothing. **TEST-754 does not trigger** — the total is zero, so INFRA-013's
precondition is met and no stop condition was raised.

**TEST-749 — `npm ls react-router react-router-dom`:**

```
corpus-monorepo@0.0.0 /Users/theophanerupin/code/corpus
└─┬ @corpus/ui@0.0.0 -> ./apps/ui
  └── react-router@8.3.0
```

One `react-router`, no `react-router-dom` at any depth.

**TEST-750 — negative evidence.** `/usr/bin/grep -rn "react-router-dom" apps packages plugins
scripts | /usr/bin/grep -v node_modules` → **zero hits** (exit 1). `/usr/bin/grep -c
"react-router-dom" package-lock.json` → **0**. The four sites now read:

```
apps/ui/src/app/App.tsx:4:import { BrowserRouter, Route, Routes } from "react-router";
apps/ui/src/dev/devRoutes.tsx:2:import { Route } from "react-router";
apps/ui/src/dev/DataProbe.tsx:13:import { useSearchParams } from "react-router";
apps/ui/src/dev/DataProbe.test.tsx:5:import { MemoryRouter } from "react-router";
```

All five exports confirmed present in `8.3.0`'s single top-level `export {…}`
(`dist/production/index.d.ts:44`): `BrowserRouter`, `MemoryRouter`, `Route`, `Routes`,
`useSearchParams`.

**TEST-751 — v6 `future` flags removed.** `App.tsx` now opens `<BrowserRouter>` with no props,
and the comment "Opt into the v7 behaviours now, while there is one route to migrate" — false on
v8 — was deleted with it.

**TEST-752 — route declaration style (sprint-018 Open Conflict 2, answered).** **v8 demanded
nothing.** `<Route>` as a child of `<Routes>` is still the supported declarative form, and
`devRoutes()`'s return type did **not** have to change: it still returns `ReactElement | null`
and `App.tsx` still splices `{devRoutes()}` directly into `<Routes>`. `npm run typecheck` is
green across all 7 workspaces with both files untouched beyond the import specifier. No
`createBrowserRouter`/`RouterProvider` conversion was needed or made.

**TEST-757 — the `useOptimistic` blocker, confirmed resolved rather than assumed.** The shipped
bundle still statically imports it —
`/usr/bin/grep -n "useOptimistic" apps/ui/node_modules/react-router/dist/production/lib/components.js`:

```
18:import { useOptimistic } from "react";
123:	let [state, setOptimisticState] = useOptimistic(_state);
```

and `node -e "'useOptimistic' in require('react')"` → **yes**. The import resolves at runtime, not
merely in a type-check: the declarative router rendered in a real browser in the walk below.

**TEST-755 / TEST-747 — real app, hand-driven.** Workspace seeded by this agent
(`corpus init --port 8805`), server on **8805** (pid 34958), Vite on **5283** proxying to it via
`CORPUS_SERVER_ORIGIN`. `8765` never bound, never proxied into. Two documents created: `Long
Source` (`doc_zazfgq6f`, 120 filler paragraphs with `[[doc_v673fxf2|Target Doc]]` below the fold)
and `Target Doc` (`doc_v673fxf2`). Driven in headless Chromium:

```
STEP 1  GET /            → .topbar: true | .board: true
        console strip: "agent: idle · queue 0 · 0 running · 0 done · 0 failed  corpus 0.0.0"
        columns rendered: 3            ← <Route path="/"> matched against a LIVE server
STEP 2  clicked 'Long Source' → .reader visible, data-reader-doc = doc_zazfgq6f
        reader head id: doc_zazfgq6f · git ✓
        back button label (depth 0): '‹ Inbox'      ← column name, stack empty
STEP 3  scrolled reader to scrollTop = 3773
STEP 4  refs in body: 1 | class: ref | text: 'Target Doc'
        after clicking ref → data-reader-doc = doc_v673fxf2      ← PUSH
        back button label (depth 1): '‹ Long Source'             ← previous doc's title
STEP 5  Back → data-reader-doc = doc_zazfgq6f                    ← POP
        scrollTop restored to: 3773 (was 3773)                   ← SCROLL RESTORATION
STEP 6  back label at depth 0: '‹ Inbox'
        after Back at depth 0 → .reader count = 0                ← STACK-EMPTY EXIT
        board still visible: true
STEP 7  GET /nope        → .topbar: true | .board: true          ← <Route path="*"> catch-all
STEP 8  GET /__probe?doc=doc_v673fxf2 → dev <Route> matched; useSearchParams read the query.
        probe body: "@corpus/kit data probe  connection: open  useDocs ok 11 rows
                     useTree ok 3 folders  useJobs ok 0 jobs  useLocks ok 0 locks
                     Long Source  Target Doc  Comment  Orchestrate"

=== console errors/warnings ===  (none)
=== uncaught page errors ===     (none)
```

All three behaviours the criterion names — **Back**, **scroll restoration on return**, and
**stack-empty exit** — exercised and observed. Zero React errors or warnings.

**The nav-stack no-diff claim, now verified rather than restated.** `/usr/bin/grep -n
"react-router" apps/ui/src/reader/useNavStack.ts apps/ui/src/board/useBoardLocalState.ts
apps/ui/src/reader/useReaderSurface.ts` → **zero hits**: they are localStorage state with no
router involvement. mtimes confirm none was opened by this session (my six edits are all
11:21:58–11:22:17): `useNavStack.ts` 2026-07-30 18:06:32, `useBoardLocalState.ts` 2026-07-28
16:39:31, `useReaderSurface.ts` 2026-07-31 10:58:58 (UI-029's `RefObject` migration, before this
session).

**TEST-756 — suites, unmodified.**

| Run | Result |
| --- | ------ |
| `vitest run apps/ui/src/dev/DataProbe.test.tsx apps/ui/src/dev/devRoutes.test.tsx apps/ui/src/app` | 5 files, **38 passed** |
| `vitest run apps/ui` (`VITEST_MAX_THREADS=4`) | 104 files, **1556 passed** |
| `CORPUS_UI_PORT=5283 CORPUS_SERVER_ORIGIN=http://127.0.0.1:8790 npm run e2e` | 14 specs, **148 passed** (50.5s) |

`apps/ui/src/dev/DataProbe.test.tsx` — the only router-touching unit test — passes with its 7
tests and only its import specifier changed. All 14 specs collected and green: `abandon` (6),
`anchor-layer` (6), `anchors` (10), `board` (7), `column-width` (9), `compose-keyboard` (19),
`console` (14), `context-menu` (20), `editor` (10), `reader` (6), `search` (11), `smoke` (13),
`thread` (10), `todos` (7). **No assertion was edited.** `smoke.spec.ts:255` — the one spec that
navigates off `/` — was additionally run on its own first and is green in both runs:

```
✓ 131 [chromium] › apps/ui/e2e/smoke.spec.ts:255:3 › server state ›
      an unknown route renders the shell rather than a blank page (963ms)
```

`npm run build`, `npm run lint`, `npm run format:check` and `npm run typecheck` (7 workspaces) all
green.

**TEST-758 — the four-file claim held.** No git command was run (domain agents never do), so the
diff is evidenced by mtime: exactly `apps/ui/package.json`, `apps/ui/src/app/App.tsx`,
`apps/ui/src/dev/devRoutes.tsx`, `apps/ui/src/dev/DataProbe.tsx`,
`apps/ui/src/dev/DataProbe.test.tsx` and `package-lock.json` were written, all between 11:21:58
and 11:22:17, plus this issue file. Nothing else was reached. (`useAnchorLayer.ts` 11:03:01,
`useAnchorLayer.test.tsx` 11:02:37 and `issues/ui/029-react-19-upgrade.md` 11:14:12 predate this
session — UI-029's work, already on the branch.)

**Hygiene.** Scratch confined to
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s020-ui/ui-016-nC2SrS/`. Server pid 34958 stopped
via `corpus server stop`; Vite pid 35915 killed by recorded pid. `lsof -nP -iTCP:<port>
-sTCP:LISTEN` afterwards: **5283 → 0, 8805 → 0**. `5173` holds `ssh` pid 16094, exactly as the
contract recorded — never mine, never touched. `8765` never bound, never killed, never proxied
into. No `pkill`/`killall` used. No git command run.

## Completion Checklist (domain agent)

- [x] Tests written and passing — 38 targeted + 1556 workspace unit tests + 148 e2e, all green;
      no new tests needed (a dependency swap with zero intended behavior delta — the bar is the
      existing suites staying green unmodified, and they did)
- [x] `/lint` passes — eslint, prettier and tsc (7 workspaces) all clean
- [x] E2E verification log filled — audit metadata block, route walk incl. the catch-all and the
      dev route, real-app boot on 8805 with the nav-stack walk
- [x] Self-review — scope held to the contracted surface; sprint-018 Open Conflict 2 answered in
      writing (TEST-752); no `packages/kit` file touched
- [x] Acceptance criteria verified — all three met and evidenced above

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
