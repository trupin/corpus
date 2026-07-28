# Evaluation: INFRA-004

**Date**: 2026-07-27
**Sprint**: sprint-008
**Verdict**: PASS

Merge Playwright e2e coverage into the combined 90 % gate. 14 criteria (TEST-141 … TEST-154):
**12 PASS, 1 PASS-with-deferred-half (TEST-149), 1 DEFERRED → named issue (TEST-151)** — both
deferrals pre-adjudicated under sprint-008 Open Conflict 12.

Verified by running the real chain end to end on the phase branch tip `4ea3e4b`: real
`npm run coverage` (unit → e2e → merge → gate), three real `CORPUS_UI_PORT=5273 npm run e2e` runs,
a real forced gate failure, and a real fail-closed control. `8765` unbound throughout; `5273` free
before and after every run.

---

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                              |
| --------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Per-criterion, with a "what ships" file table and a dependency list with pinned versions.                                                                            |
| Commands are specific and concrete      | PASS   | Exact commands, exact exit codes, full per-workspace tables, the failing gate's exact message, the real `.githooks/pre-push` transcript.                              |
| Real E2E (not mocked)                   | PASS   | Real `npm run coverage`, real Playwright run, real CDP `startJSCoverage`, real hook execution with `CORPUS_UI_PORT` unset — the exact condition that used to fail.    |
| Scenarios cover acceptance criteria     | PASS   | AC 1's server half and AC 2's caller are deferred **with written rationale**, not silently dropped.                                                                  |
| Application restarted after changes     | PASS   | Every measurement is a fresh full run; `coverage-raw/` is wiped per run by a Playwright `globalSetup`.                                                                |
| Actual model recorded (implemented on:) | PASS   | `**Implemented on: opus.**`                                                                                                                                          |
| Reproduction logged before fix (bugs)   | PASS   | For the one genuine bug it fixed (Open Conflict 13, `pre-push` on 5173): the failure is described, the fix applied, and the hook re-run from a shell with `CORPUS_UI_PORT` unset. |

**Notable honesty markers.** The log records a **wrong first design and the measurement that killed
it**: the obvious `createCoverageMap(unit).merge(e2e)` was built, measured, and found to *lower*
every percentage (statements 98.73 → 98.57, functions 98.48 → 97.97, branches 94.74 → 94.41) because
Vitest's v8 provider and monocart disagree on statement start columns. It also discloses that
`scripts/` had never been typechecked by anything and that adding it surfaced two real type errors.
Neither disclosure was necessary; both are the kind a fabricated log does not contain.

---

## Log Honesty Re-derivation

| Claim in log                                                                  | Re-derived? | Actual observation                                                                                                                                       |
| ----------------------------------------------------------------------------- | ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run coverage` = unit → e2e → merge → gate, exit 0                        | CONFIRMED   | Ran it at the tip. Exit **0**. `coverage: merged gate passed — all four metrics at or above 90%.`                                                            |
| Thresholds live in exactly one place                                          | CONFIRMED   | `grep` over `vitest.config.ts`, `scripts/coverage-config.ts`, `ci.yml`: the number 90 appears as a threshold **only** in `COVERAGE_THRESHOLDS`. `vitest.config.ts` has no `thresholds` block — only a comment naming INFRA-004. |
| The gate fails below the bar with a message naming metric and number          | CONFIRMED   | Forced `branches: 96`, ran `coverage:merge` → exit **1**, `ERROR: coverage for branches (94.66%, 5065/5351) does not meet threshold (96%) for the merged report`. Reverted; `git diff` empty. |
| Source maps resolve back to real `src/` files                                 | CONFIRMED   | `coverage/merged/e2e-attribution.json`: **47 in-scope files** attributed from the browser, incl. `apps/ui/src/shell/theme.ts 52/62 (83.9 %)` and `packages/kit/src/events/sseBridge.ts 126/183`. |
| A file no runner loads is present at 0 %, not absent                          | CONFIRMED   | `apps/server/src/main.ts`: statements **0/18**, present in `coverage/merged/coverage-final.json` (264 files).                                                |
| CI order is unit → e2e → merge → gate                                         | CONFIRMED   | `.github/workflows/ci.yml`: `unit tests (raw coverage, no gate)` → `e2e (Playwright, browser V8 coverage)` → `merged coverage gate (unit + e2e, >=90%)` → artifact upload. |
| e2e is 13 specs and is not made flakier                                       | CONFIRMED   | **13 passed** on three consecutive runs (4.1 s / 3.9 s / 3.9 s), `8765` verified unbound before each.                                                        |
| The stale `CLAUDE.md` line is corrected                                       | CONFIRMED   | "skipped automatically when no specs exist" is **gone**; replaced with an accurate line naming the 13 specs, the coverage role, and the `CORPUS_UI_PORT` override. |
| `NODE_V8_COVERAGE` seam exists                                                | CONFIRMED   | `nodeCoverageEnv()` in `apps/ui/e2e/coverage.ts:47`; consumed by `scripts/merge-coverage.ts:177`; documented in `docs/TS_GUIDELINES.md:70` **with the honest caveat** "nothing in the shipped suite spawns one yet". |
| `coverage-raw/` is ignored by git/prettier and cleaned                        | CONFIRMED   | `.gitignore:6`, `.prettierignore:5`, and `npm run clean` removes it.                                                                                        |
| Baseline figures (TEST-141)                                                   | NOT RE-DERIVABLE at tip | A "before work started" measurement cannot be reproduced after the sprint's other seven issues landed. The log records it against the contract's baseline with a delta and a four-run variance band that explains it. Accepted as recorded. |

No claim was contradicted.

---

## Criteria Results

| #        | Criterion                                                    | Result                          | Notes                                                                                                                                                       |
| -------- | ------------------------------------------------------------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| TEST-141 | Baseline recorded before anything moved                      | PASS                            | Recorded per workspace vs. the contract's numbers, with the +3-covered delta explained as unit-run branch variance and evidenced by four further runs (±0.03 pt band). Not re-derivable at the tip by construction. |
| TEST-142 | Chromium V8 coverage collected from the real e2e run         | PASS                            | Mechanism named: a Playwright auto fixture wrapping every test in CDP `startJSCoverage({resetOnNavigation:false})`, dumping to `coverage-raw/browser-v8/`. **13 dumps present** — one per spec. |
| TEST-143 | Source maps actually resolve — proven by a file              | PASS                            | `apps/ui/src/shell/theme.ts` at **52/62 browser-attributed lines**, quoted from the shipped `e2e-attribution.json`. The Vite bare-`sources` trap (`"App.tsx"`) was hit live and is fixed by `rewriteEntrySources`. |
| TEST-144 | Merge at the istanbul level, losing nothing                  | PASS                            | Unit istanbul map is the structure; browser hits are projected onto it; nothing downgraded to lcov. The naive `FileCoverage.merge` was tried, **measured to lower every metric**, and rejected with the numbers recorded. Union-of-hits semantics; totals provably stable. |
| TEST-145 | Files no test loads still count as 0 %                       | PASS                            | Globs come from `scripts/coverage-config.ts` for **both** `vitest.config.ts` and the merge, so they cannot drift. `apps/server/src/main.ts` present at 0/18. |
| TEST-146 | Thresholds move, are not duplicated                          | PASS                            | Exactly one enforcement site. `npm run test:coverage` emits raw coverage and enforces nothing.                                                                |
| TEST-147 | `npm run coverage` reproduces the CI verdict locally         | PASS                            | Exit 0 with a per-workspace text summary (table below). CI runs the same three commands as three steps.                                                       |
| TEST-148 | CI enforces the merged gate in the right order               | PASS                            | Order verified in `ci.yml`; the gate step is named as the merged gate; the `compgen -G` guard was **removed with a note** so a run producing no e2e output fails rather than skips. |
| TEST-149 | The gate demonstrably FAILS below 90                         | PASS (local) / DEFERRED (CI half) | Local half **demonstrated by me**, not just claimed: exit 1 with metric and number. CI half `DEFERRED → phase-3 PR CI run` — a domain agent may run no state-changing git command, so no branch could be pushed. Pre-adjudicated (Open Conflict 12). |
| TEST-150 | The negative control proves e2e coverage actually counts     | PASS                            | The reversible experiment TEST-150 explicitly sanctions was run and recorded (12 `apps/ui` unit files moved aside, number holds; e2e disabled, number drops; both reverted). I independently confirmed the load-bearing precondition — the browser genuinely reaches `apps/ui/src` lines. See OBS-1. |
| TEST-151 | Server/CLI coverage plumbing seamed, its gap named           | DEFERRED → SERVER-backed e2e spec | The seam exists (`nodeCoverageEnv()`), is consumed by the merge, and is documented. It has **no caller** because the e2e suite spawns no server and no CLI. Deferral is explicit in the log, in `docs/TS_GUIDELINES.md`, and in `.claude/agents/infra-dev.md`. Exactly what Open Conflict 12 permits. |
| TEST-152 | e2e not made flakier by being instrumented                   | PASS                            | **13 passed, three times**, `8765` unbound each time, `CORPUS_UI_PORT=5273`. The `expect(uncaught).toEqual([])` assertions still hold.                        |
| TEST-153 | The stale documentation is corrected                         | PASS                            | `CLAUDE.md`'s stale line replaced; `docs/TS_GUIDELINES.md` § Coverage rewritten to describe the shipped merge, the single gate location, the attribution file, and the un-called spawn seam. |
| TEST-154 | The 90 % bar holds with all of this sprint's code in it      | PASS                            | Measured at the tip with UI-002's `packages/kit`, CONTRACT-007/009, SERVER-014/020/022/023 and CLI-008 all landed. All four metrics ≥ 90. Table below.        |

### The merged gate at the phase-branch tip (`4ea3e4b`), measured by me

```
workspace         |               lines |          statements |           functions |            branches
apps/cli          |    99.26% 4164/4195 |    99.26% 4164/4195 |      95.29% 283/297 |    95.92% 1198/1249
apps/server       |    98.10% 8910/9083 |    98.10% 8910/9083 |      99.57% 690/693 |    94.15% 3413/3625
apps/ui           |     100.00% 369/369 |     100.00% 369/369 |       100.00% 38/38 |         97.92% 94/96
packages/contract |   100.00% 2804/2804 |   100.00% 2804/2804 |       100.00% 67/67 |      99.34% 151/152
packages/kit      |     100.00% 640/640 |     100.00% 640/640 |       100.00% 85/85 |     91.27% 209/229
ALL               |  98.81% 16887/17091 |  98.81% 16887/17091 |    98.56% 1163/1180 |    94.66% 5065/5351

coverage: merged gate passed — all four metrics at or above 90%.
```

Unit run at the same tip: **214 test files, 3818 tests, all passing** (sprint baseline 201 / 3415).
e2e: **13 passed**. Branches remains the tightest metric at 94.66 %, 4.66 pt of headroom.

---

## Failures

None.

---

## Observations (not criterion failures)

### OBS-1 — at the tip, the merge contributes **+0 covered items**, and that is correct

I measured the merge's actual contribution by diffing the unit-only summary against the merged one,
per metric and per file:

```
metric        unit-only            merged (unit+e2e)     delta
lines         98.80% 16887/17091   98.81% 16887/17091      +0
statements    98.80% 16887/17091   98.81% 16887/17091      +0
functions     98.55%  1163/1180    98.56%  1163/1180       +0
branches      94.65%  5065/5351    94.66%  5065/5351       +0

files where the merge raised any count: 0
files below 100% lines in the unit run: 41
   ...of those, also reached by the browser: 0
```

This is **not** the silent-zero failure TEST-143 exists to catch. The browser genuinely reaches 47
in-scope source files with real per-line attribution; every one of them is *already* at 100 % lines
from unit tests, and the 41 files the unit run leaves short are all in `apps/cli` / `apps/server`,
which no browser can reach because no e2e spec drives a server or the CLI. That is precisely the
state Open Conflict 12 predicted and TEST-151 defers.

The practical consequence, worth stating plainly for the orchestrator: **today the merged gate is
numerically identical to the unit-only gate.** The machinery is correct, proven, and fail-closed —
it simply has nothing incremental to lift until a server-backed e2e spec exists. The value INFRA-004
delivers right now is the single relocated gate, the drift-proof shared globs, and the attribution
artifact; the coverage *lift* arrives with the deferred half.

### OBS-2 — the merge fails closed on missing browser data, which is better than the criterion asked for

I removed all 13 browser V8 dumps and re-ran `npm run coverage:merge`. It did **not** silently
degrade to a unit-only report:

```
exit=1
coverage: no browser coverage in coverage-raw/browser-v8.
coverage: run `npm run e2e` first, or use `npm run coverage`.
```

Restoring the dumps returned it to exit 0. This closes the exact hazard TEST-143 names — "a merge
that silently contributes zero rows … looks identical to success in every summary" — at the
structural level rather than by inspection. It is also why I could not measure the e2e drop by
deleting dumps, and why TEST-150's reversible unit-side experiment is the right control.

### OBS-3 — the `pre-push` hook fix (Open Conflict 13) is real and verified

`.githooks/pre-push` now does `export CORPUS_UI_PORT="${CORPUS_UI_PORT:-5273}"`. The log records the
hook run end to end from a shell with the variable **unset** — the exact condition that used to fail
— reaching `pre-push ✓ all checks passed`, exit 0. The `:-` form keeps an explicit override winning
and leaves `vite.config.ts`'s SPEC §3 default of 5173 untouched. The agent explicitly declined to
change *which* gates the hook runs, correctly calling that a user-level decision.

### OBS-4 — a disclosed load-induced flake class, correctly attributed elsewhere

The log discloses four wall-clock assertion failures observed at load average 120 with six sibling
agents running (`reconcile.test.ts` "under a second" took 19.9 s; two `docs/update.test.ts`
concurrency tests; `queue/idle.test.ts`). It demonstrates they are untouched by this issue
(`vitest.config.ts`'s entire diff is inside `test.coverage`; `npm test` passes no `--coverage`) and
flags them as a robustness question for `apps/server`/`apps/cli`. A post-harvest note records that
the flaky bound was made load-tolerant in SERVER-023's session. My own full run — taken with four
sibling evaluator agents active — was **214 files / 3818 tests, zero failures**, consistent with the
flakes being load artifacts rather than defects.

---

## Summary

**12 of 14 criteria PASS outright, 1 PASS with its CI half deferred, 1 DEFERRED to a named
follow-on** — both deferrals pre-adjudicated under Open Conflict 12 and recorded in the log, in
`docs/TS_GUIDELINES.md` and in the domain agent's Domain Knowledge, rather than quietly skipped.

The gate that every other issue in this sprint is measured by now lives in exactly one place, is
computed from a merged unit + browser report, refuses to run on incomplete inputs, and has been
observed both passing and failing. I verified the failing half myself rather than accepting it on
the log's word, and reverted cleanly.

The most useful thing this evaluation establishes is the one number the log does not state outright:
the merge's contribution at the tip is **+0 covered items**, because everything the browser reaches
is already unit-covered and everything the unit run misses is unreachable from a browser. That is a
correct, explained, fail-closed zero — but it means the merged gate is currently equivalent to the
unit gate in value, and the payoff waits on the server-backed e2e spec TEST-151 defers. The
`e2e-attribution.json` artifact the agent insisted on shipping is what makes that distinction
observable at all, and it is the reason this issue can be passed with confidence instead of guessed
at.
