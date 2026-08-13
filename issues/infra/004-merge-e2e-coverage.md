# [INFRA-004] Merge Playwright e2e coverage into the combined 90% gate

## Domain

infra

## Status

done — verified 2026-08-13 (INFRA-027): the work landed and PLAN.md has said so; this file was never ticked. Evidence: a commit carrying the id, or the named implementation and its tests in the tree.

## Priority

P1

## Model

opus — coverage-collection plumbing with a defined design; no architectural judgment required.

## Dependencies

- Depends on: INFRA-003, UI scaffold (Phase 1 — needs real e2e specs to exist)
- Blocks: —

## Spec References

- docs/TS_GUIDELINES.md — Coverage
- CLAUDE.md — Definition of Done (combined coverage ≥ 90%)

## Summary

The 90% coverage gate currently runs on unit tests alone (there are no e2e specs yet). Once the UI exists and Playwright specs land, e2e coverage must be **merged** with unit coverage so the 90% bar is truly combined — code exercised only through the browser counts, and the gate reflects total exercised behavior.

## Acceptance Criteria

- [x] Playwright runs collect V8 coverage from Chromium (CDP `startJSCoverage`/`stopJSCoverage` fixture) for the UI bundle, source-mapped back to `src/`. **The server half is `DEFERRED`** — the suite spawns no server (sprint-008 Open Conflict 12); the `NODE_V8_COVERAGE` seam exists and is demonstrated below on a real CLI spawn.
- [x] Real `corpus` CLI invocations count: `nodeCoverageEnv()` in `apps/ui/e2e/coverage.ts` sets `NODE_V8_COVERAGE`, and a real `corpus init` spawn attributed 150/179 lines to `apps/cli/src/commands/init/scaffold.ts` through the built `dist/` source maps. No shipped spec spawns a process yet, so the seam has no caller today.
- [x] A merge step (`monocart-coverage-reports` for source-mapped V8, `istanbul-lib-coverage` for the map) combines Vitest's istanbul-format `coverage/coverage-final.json` with Playwright's raw V8 into one report; the 90% thresholds are removed from `vitest.config.ts` and live only in `scripts/coverage-config.ts`, enforced only by the merged gate.
- [x] CI's `validate` job runs unit → e2e → merge → gate and enforces the gate on the merged report; local `npm run coverage` runs the identical chain.
- [x] Per-workspace numbers visible: a text table on stdout (so it is in CI logs) plus `coverage/merged/coverage-summary.json` and `coverage/merged/e2e-attribution.json`.

## Technical Design

### Files to Create/Modify

- `apps/ui/e2e/` coverage fixture or monocart reporter config
- `scripts/merge-coverage.ts` — merge + threshold check
- `vitest.config.ts` — keep raw json output; thresholds relocate to merged check
- `.github/workflows/ci.yml` — merge + gate step ordering (unit → e2e → merge → gate)

### Key Implementation Details

Vitest's v8 provider emits istanbul-format JSON (the raw V8 data is converted before reporters run), while Chromium CDP and `NODE_V8_COVERAGE` produce raw V8 — so the merge happens at the istanbul level (monocart accepts both inputs and normalizes). Don't downgrade to lcov before merging. Server-side coverage during e2e comes free via `NODE_V8_COVERAGE` env on the spawned server.

### Edge Cases

- Source maps must resolve built artifacts back to `src/` — the UI bundle AND the built CLI/server (their `NODE_V8_COVERAGE` output attributes to `dist/*`) — or e2e coverage is silently dropped by the `src/**` include filter.
- Files never loaded by any test must still count as 0% (include-based, not seen-based, accounting).

## Testing Strategy

Deliberately cover one module only via e2e (no unit test): the merged gate must count it; removing the e2e spec must drop combined coverage.

## E2E Verification Plan

### Verification Steps

1. Run unit + e2e + merge locally; observe one combined report and gate verdict.
2. CI run shows the merged gate failing when coverage is forced below 90% on a branch, passing on restore.

## E2E Verification Log

**Implemented on: opus.** Worktree `.claude/worktrees/infra-004`, branch base `de47882`. All runs
`CORPUS_UI_PORT=5273`, `8765` confirmed unbound before every e2e run, scratch under
`/tmp/corpus-i004-*`, no state-changing git command run.

### What ships

| Piece | File |
| --- | --- |
| Thresholds + include/exclude globs, one source | `scripts/coverage-config.ts` |
| Merge/projection/summary logic (35 unit tests) | `scripts/coverage-gate.ts`, `scripts/coverage-gate.test.ts` |
| The gate executable | `scripts/merge-coverage.ts` |
| Browser + spawned-process V8 collection | `apps/ui/e2e/coverage.ts` |
| Per-run wipe of the raw dumps | `apps/ui/e2e/coverage-setup.ts` (Playwright `globalSetup`) |
| `npm run coverage`, `npm run coverage:merge` | `package.json` |
| unit → e2e → merge → gate, artifact upload | `.github/workflows/ci.yml` |

Merge tooling added, all devDependencies: **`monocart-coverage-reports@2.12.12`** (unpacks raw V8
through source maps into per-source line hits), **`istanbul-lib-coverage@3.2.2`** (+ its `@types`,
the coverage map and summaries), **`picomatch@4.0.5`** (+ `@types`, the include/exclude globs).

### The design decision, and the measurement behind it (TEST-144)

The obvious merge — `createCoverageMap(unit).merge(e2eIstanbul)` — was built first and **measured
to be wrong**. Vitest's v8 provider and `monocart`'s V8→istanbul conversion disagree on where a
statement starts (`apps/ui/src/shell/theme.ts`: unit says line 12 col 0, browser says line 12
col 7). `FileCoverage.merge` keys by location, so the disagreement lands as *extra* statements:

```
BEFORE (unit only) statements 15656/15856 98.73%   functions 1043/1059 98.48%   branches 4685/4945 94.74%
AFTER  (naive merge) statements 16019/16250 98.57%  functions 1114/1137 97.97%  branches 4732/5012 94.41%
```

Adding coverage lowered every percentage. `ast-v8-to-istanbul` (Vitest's own converter) fed the
browser data was tried next and produced maps just as divergent (26 vs 61 statements for the same
file). So the shipped merge keeps **the unit run's istanbul map as the structure** and lets the
browser run **contribute hits onto it**: an item counts as covered when every line it spans was
fully executed in the browser, with blank/comment lines stepped over, partially executed lines
(`"1/2"`) crediting nothing, and zero-width branch locations (an implicit `else`) never credited.
Totals therefore never move and coverage can only rise. Nothing is downgraded to lcov anywhere.

### TEST-141 — baseline before anything moved

Fresh unit-only run on the untouched tree (`npm run build && npm run test:coverage`), compared to
the contract's recorded baseline:

| metric | contract baseline | measured here | delta |
| --- | --- | --- | --- |
| lines | 98.71% 15653/15856 | **98.73% 15656/15856** | +3 covered |
| statements | 98.71% | **98.73%** | +3 covered |
| functions | 98.48% 1043/1059 | **98.48% 1043/1059** | none |
| branches | 94.73% 4682/4942 | **94.74% 4685/4945** | +3 covered, +3 total |

Per workspace: `apps/cli` 99.29% lines (4051/4080), `apps/server` 98.09% (8786/8957), `apps/ui`
100% (271/271), `packages/contract` 100% (2547/2547), `packages/kit` 100% (1/1).

**Explanation of the delta**: `git diff abb6b48..HEAD -- apps packages plugins scripts` is empty, so
no code changed. The movement is **run-to-run variance in the unit run itself**: V8 reports branches
only inside functions that executed, so a timing-dependent path in `apps/server`/`apps/cli` shifts
both the covered and the total count. Four further unit runs during this issue produced ALL-branches
of 94.74% (4685/4945), 94.76% (4684/4943), 94.74% (4681/4941) and 94.74% (4685/4945) — a ±0.03pt
band that the contract's 94.73% sits inside. This is pre-existing and unrelated to the merge; the
merge's own contribution to the totals is provably zero (TEST-144 above).

### TEST-142 / TEST-143 — browser V8 collected and source maps actually resolve

Mechanism: a Playwright auto fixture (`apps/ui/e2e/coverage.ts`) wrapping every test in CDP
`page.coverage.startJSCoverage({ resetOnNavigation: false })` / `stopJSCoverage()`, dumping raw V8
plus the Vite root to `coverage-raw/browser-v8/<uuid>.json`. `resetOnNavigation: false` is required
by the three specs that reload. `monocart` then unpacks each entry through its (rewritten) inline
source map.

Vite dev serves `sources: ["App.tsx"]` and `["../../src/client/index.ts"]`, which resolve to
`App.tsx` and `localhost-5273/...` — matching no include glob, silently dropped. That is exactly the
issue's edge case, and it was observed live before `rewriteEntrySources` was written. After the fix,
from the shipped run (`coverage/merged/e2e-attribution.json`):

```
  e2e attributed coverage to 28 in-scope source files, top 8 by executed lines:
    packages/contract/src/schemas/thread.ts  187/188 lines (99.5%)
    packages/contract/src/query-keys.ts      97/112 lines (86.6%)
    packages/contract/src/client/index.ts    93/99  lines (93.9%)
    packages/contract/src/schemas/error.ts   85/88  lines (96.6%)
    apps/ui/src/shell/theme.ts               52/62  lines (83.9%)
    packages/contract/src/schemas/lock.ts    50/50  lines (100.0%)
    apps/ui/src/shell/Topbar.tsx             40/40  lines (100.0%)
    packages/contract/src/schemas/warning.ts 37/37  lines (100.0%)
```

**`apps/ui/src/shell/Topbar.tsx`: 40/40 lines attributed from the browser**, and
`apps/ui/src/shell/theme.ts`: 52/62. The `packages/contract/src/**` rows are the *built* `dist/*.js`
the app imports, followed back through their tsc source maps into `src/` — the second half of the
issue's edge case. This per-file attribution is written to `coverage/merged/e2e-attribution.json` on
every run precisely because "e2e added nothing because unit already covers it" and "e2e added
nothing because the source maps broke" are indistinguishable in any summary metric.

### TEST-145 — include-based, not seen-based

`vitest.config.ts` and `scripts/merge-coverage.ts` both take their globs from
`scripts/coverage-config.ts` (`COVERAGE_INCLUDE` / `COVERAGE_EXCLUDE`), so they cannot drift.
The merged report's file set **is** the unit run's (239 files, Vitest's `all` default), and the
projection only ever raises hit counts. `apps/server/src/main.ts` is loaded by no test and no
browser and appears in `coverage/merged/coverage-final.json` at 0%, not absent. Unit-tested by
`"leaves a file no runner loaded present and at zero"` and `"leaves the unit report's totals alone"`.

### TEST-146 — the thresholds moved, they were not duplicated

`vitest.config.ts` no longer has a `thresholds` block; `npm run test:coverage` emits raw coverage and
enforces nothing. `grep -rn "90" vitest.config.ts scripts/coverage-config.ts .github/workflows/ci.yml`
finds the number only in `COVERAGE_THRESHOLDS` (and the human-readable step name `>=90%`).

### TEST-147 — `npm run coverage` reproduces the CI verdict locally

`npm run coverage` = `test:coverage && e2e && coverage:merge`; CI runs the same three commands as
three steps. Final clean run, exit code **0**:

```
workspace         |               lines |          statements |           functions |            branches
apps/cli          |    99.29% 4051/4080 |    99.29% 4051/4080 |      95.50% 276/289 |    95.82% 1169/1220
apps/server       |    98.09% 8786/8957 |    98.09% 8786/8957 |      99.56% 682/685 |    94.14% 3342/3550
apps/ui           |     100.00% 271/271 |     100.00% 271/271 |       100.00% 32/32 |       100.00% 63/63
packages/contract |   100.00% 2547/2547 |   100.00% 2547/2547 |       100.00% 53/53 |      99.07% 107/108
packages/kit      |         100.00% 1/1 |         100.00% 1/1 |         100.00% 0/0 |         100.00% 0/0
ALL               |  98.74% 15656/15856 |  98.74% 15656/15856 |    98.49% 1043/1059 |    94.74% 4681/4941

coverage: merged gate passed — all four metrics at or above 90%.
```

The raw dumps live in `coverage-raw/`, **not** under `coverage/`: Vitest empties its whole
`reportsDirectory` on every run, and the first version of this kept them in `coverage/e2e-v8`, where
running the unit half second deleted them. `coverage-raw/` is git-, prettier- and eslint-ignored and
removed by `npm run clean`.

### TEST-148 — CI order

`.github/workflows/ci.yml`: `npm run test:coverage` (named "unit tests (raw coverage, no gate)") →
`npx playwright install` + `npm run e2e` → `npm run coverage:merge` (named "merged coverage gate
(unit + e2e, >=90%)") → artifact upload of `coverage/merged`. The `compgen -G` guard was **removed
with a note in the workflow**: the 13 specs exist and e2e output is now an input to the gate, so a
run that quietly produced none has to fail rather than skip.

### TEST-149 — the gate demonstrably fails below 90

`COVERAGE_THRESHOLDS.branches` temporarily set to 95 (measured branches 94.74%), nothing else
touched:

```
ALL               |  98.74% 15656/15856 | ... | 94.74% 4685/4945
ERROR: coverage for branches (94.74%, 4685/4945) does not meet threshold (95%) for the merged report
$ echo $?  →  1
```

Restored to 90 → exit code **0**. The diff was a single character and is reverted; `git diff` over
`scripts/coverage-config.ts` shows `branches: 90`.

**`DEFERRED → phase-3 PR CI run`: the "real CI run FAILS" half.** A domain agent may run no
state-changing git command, so no branch could be pushed to observe a red Actions run. CI executes
`npm run coverage:merge` — byte-identical to the command that produced the failure above — as the
step named "merged coverage gate (unit + e2e, >=90%)", and a non-zero exit fails the job. The
orchestrator sees the green half on the phase PR.

### TEST-150 — the negative control: e2e coverage really counts

Every `apps/ui/src` file is already 100% from unit tests, so the control disables unit tests rather
than adding an untested module. Disabling `Topbar.test.tsx` alone changed nothing (`Shell.test.tsx`
renders the whole shell), so the whole `apps/ui` unit suite was moved aside — **12 files**:
`app/apiClient.test.ts`, `app/App.test.tsx`, `app/queryClient.test.ts`, `main.test.tsx`,
`shell/Board.test.tsx`, `shell/ConsoleStrip.test.tsx`, `shell/Shell.test.tsx`, `shell/theme.test.ts`,
`shell/Topbar.test.tsx`, `shell/useHealth.test.tsx`, `shell/useTheme.test.ts`,
`testing/memoryStorage.test.ts`.

| state | unit-only `apps/ui` lines | merged `apps/ui` lines | merged ALL lines |
| --- | --- | --- | --- |
| shipped | 271/271 100% | **271/271 100%** | 98.74% |
| UI unit suite disabled, e2e intact | 0/271 0% | **224/271 82.66%** | **98.44%** |
| UI unit suite disabled, e2e also disabled | 0/271 0% | **0/271 0.00%** | **97.03%** |

The middle row is the criterion: with **zero** UI unit tests, the browser run alone recovered 224
lines across 12 files —

```
  raised by the browser run (statements/functions/branches):
    apps/ui/src/shell/theme.ts        +51/+0/+0      apps/ui/src/shell/useHealth.ts    +15/+0/+0
    apps/ui/src/shell/Topbar.tsx      +36/+0/+0      apps/ui/src/shell/useTheme.ts     +13/+1/+1
    apps/ui/src/shell/ConsoleStrip.tsx +27/+0/+0     apps/ui/src/shell/Shell.tsx       +12/+0/+0
    apps/ui/src/app/App.tsx           +15/+1/+1      apps/ui/src/main.tsx              +11/+0/+0
    apps/ui/src/app/queryClient.ts    +15/+1/+1      apps/ui/src/shell/ThemeToggle.tsx  +9/+0/+0
    apps/ui/src/app/apiClient.ts      +13/+1/+1      apps/ui/src/shell/Board.tsx        +7/+0/+0
```

— and removing the e2e contribution dropped it straight back to 0/271 and ALL from 98.44% to 97.03%.
(The 47 lines the browser never recovers are `apps/ui/src/testing/memoryStorage.ts`, a test helper the
browser never loads.) The third row was produced by moving `smoke.spec.ts` aside and running a
one-test `control.spec.ts` that only visits `about:blank`. **All three temporary changes are
reverted** — `smoke.spec.ts` restored, all 12 test files restored, `control.spec.ts` deleted;
`git status` lists only the files this issue intends to change, and the full suite is green
(202 files / 3448 tests).

### TEST-151 — the `NODE_V8_COVERAGE` seam, exercised

`nodeCoverageEnv()` (`apps/ui/e2e/coverage.ts`) returns `{ NODE_V8_COVERAGE: "coverage-raw/node-v8" }`
for any process a spec spawns; `merge-coverage.ts` calls `report.addFromDir()` on that directory when
it is populated and prints the dump count either way, so an empty seam is stated, never silent.

Exercised on a **real spawn** — the built CLI against a real scratch workspace on port 8962:

```
$ NODE_V8_COVERAGE=$PWD/coverage-raw/node-v8 node apps/cli/dist/bin/corpus.js init --port 8962
  port 8962, token in .corpus/config.json (mode 600)
  git: initialized on main, one commit authored as user
  installed 8 template files, recorded in .corpus/template-manifest.json

$ npm run coverage:merge
  inputs: 239 files ..., 13 browser dumps ..., 3 NODE_V8_COVERAGE dumps from coverage-raw/node-v8
  e2e attributed coverage to 108 in-scope source files, top 8 by executed lines:
    packages/contract/src/schemas/query.ts     259/260 lines (99.6%)
    packages/contract/src/routes/docs.ts       201/201 lines (100.0%)
    ...
    apps/cli/src/commands/init/scaffold.ts     150/179 lines (83.8%)
    apps/cli/src/commands/init/index.ts        131/161 lines (81.4%)
```

`apps/cli/dist/**` was source-mapped back to `apps/cli/src/**` with no extra configuration — the
in-scope file count went 28 → 108 from that one command. The scratch workspace was deleted and the
dumps wiped afterwards, so the shipped run reports `0 NODE_V8_COVERAGE dumps`.

**`DEFERRED → a UI/e2e issue that drives a real server`** (sprint-008 "Out of Scope": *"Rewriting the
e2e suite to drive a real server ... is a UI issue's job"*). `playwright.config.ts` starts Vite and
nothing else, so **no shipped spec calls `nodeCoverageEnv()` today**; the seam is proven, its caller
is not yet written. AC 2's server half is deferred on the same grounds — there is no server spawn
point to attach to.

### TEST-152 — instrumentation did not make the suite flakier

Three consecutive instrumented runs **after the `reuseExistingServer` fix**, so each one drove a
Vite server started from this worktree; `8765` checked unbound before each:

```
--- e2e run 1 --- exit=0  13 passed
--- e2e run 2 --- exit=0  13 passed
--- e2e run 3 --- exit=0  13 passed
```

Plus two further passes inside the full `npm run coverage` runs. The `expect(uncaught).toEqual([])`
assertions in three specs still hold; the only change to `smoke.spec.ts` is its import line. The
`globalSetup` wipe is what keeps the dump count at exactly 13 rather than accumulating.

### TEST-153 — stale documentation corrected

- `CLAUDE.md` → Build & Dev Commands: the "skipped automatically when no specs exist" line is gone;
  `npm run e2e` is described as it is (13 specs, collects browser coverage, `CORPUS_UI_PORT`), and
  `npm run coverage` / `npm run coverage:merge` are documented with where the gate lives.
- `docs/TS_GUIDELINES.md` → Coverage: rewritten to describe the merged gate, the projection rule and
  its consequences, `e2e-attribution.json`, and the `NODE_V8_COVERAGE` seam.

### TEST-154 — the bar holds with this sprint's code in the tree

At this worktree's base (`de47882`) the other seven sprint-008 issues had not landed, so the honest
statement is: **the bar holds on everything in the tree now**, all four metrics above, tightest
being branches at 94.74% (4681/4941) — 4.7 points of head-room. The merge provably contributes 0 to
the denominators, so the only thing that can move the number is the other issues' own code. The
orchestrator re-runs `npm run coverage` on the assembled phase branch.

### Open Conflict 13 — `.githooks/pre-push` port

**Reproduced first.** `.githooks/pre-push` ran `npm run e2e` with no port override; `vite.config.ts`
pins 5173 with `strictPort`, and 5173 is held on this machine, so the `playwright e2e` step failed on
every unqualified `git push`.

**Fix**: `export CORPUS_UI_PORT="${CORPUS_UI_PORT:-5273}"` at the top of the hook.

**Rationale for the default over a git-ignored local env file**: an untracked file does not exist in
a fresh clone or in the orchestrator's shell, so it would not actually fix the reported failure.
Beyond this machine, a pre-push hook binding 5173 is wrong on its own terms — it fights any dev
server the developer already has running, and a hook that fails because you were working is a hook
people learn to `--no-verify`. 5273 is the port the whole sprint already uses. The `:-` form means an
explicit value always wins (`CORPUS_UI_PORT=5999 git push`), and `vite.config.ts`'s SPEC §3 default
of 5173 for `npm run dev` is untouched. The hook's gate steps are otherwise unchanged: it still runs
unit tests and e2e but **not** the coverage gate — what pre-commit/pre-push run is a user-level
decision and is not mine to change.

**Verified with the real hook**, run from a shell with `CORPUS_UI_PORT` unset — the exact condition
that used to fail:

```
$ unset CORPUS_UI_PORT; bash .githooks/pre-push
pre-push ▶ build
pre-push ▶ generated artifacts drift
pre-push ▶ eslint
pre-push ▶ prettier check
pre-push ▶ typecheck
pre-push ▶ unit tests
pre-push ▶ playwright e2e
pre-push ✓ all checks passed
$ echo $?  →  0
```

`8765` was confirmed unbound before and after; nothing was left listening on `5273`.

### Repo-wide checks after the change

`npm run lint` clean · `npm run format:check` clean · `npm run typecheck` clean · `npm test`
**202 files / 3450 tests passed** (was 201/3415; +1 file, +35 tests, all in
`scripts/coverage-gate.test.ts`) · `npm run coverage` exit 0.

`npm run typecheck` now also runs `tsc --noEmit -p scripts/tsconfig.json`. `scripts/` was in no
workspace and therefore typechecked by nothing — the two genuine type errors that surfaced in the
new files on first run are the evidence that gap was real.

**One load-induced flake to disclose, not caused by this change.** A verification run taken while six
sibling agents were saturating the machine (`load average 120`) failed four wall-clock assertions in
workspaces this issue does not touch: `apps/server/src/anchors/reconcile.test.ts` *"reconciles 50
anchors over a ~1 MB body in under a second"* (took **19.9 s**),
`apps/server/src/docs/update.test.ts`'s two concurrent-save tests (5 s timeouts) and
`apps/cli/src/commands/queue/idle.test.ts` *"writes nothing at all while parked"* (5 s). All four are
pre-existing timing assertions — `reconcile.test.ts:1150` is literally
`expect(elapsedMs).toBeLessThan(1000)` — and all four pass at normal load, including in the
`.githooks/pre-push` run recorded above and in every other full run in this log. This issue changes
no `apps/server` or `apps/cli` source (`git diff --stat` touches neither). Flagged for the
orchestrator as a robustness question for those domains, not fixed here.

## Completion Checklist (domain agent)

- [x] Tests written and passing (35 new tests in `scripts/coverage-gate.test.ts`)
- [x] `/lint` passes (eslint, prettier, tsc — including `scripts/` for the first time)
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (AC 1 server half and AC 2's caller deferred with rationale above)

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[INFRA-004]` prefix

> Post-harvest note (orchestrator, 2026-07-27): the implementing agent additionally ruled out this issue as a cause of the `apps/server` wall-clock test flakes — its entire `vitest.config.ts` diff sits inside `test.coverage` (identical glob values, unchanged reportsDirectory), and `npm test` passes no `--coverage`, so the unit run is provably unaffected. The flaky bound itself was made load-tolerant in SERVER-023's session.
