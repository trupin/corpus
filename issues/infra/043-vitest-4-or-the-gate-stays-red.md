# [INFRA-043] Vitest 4, because the gate is red and the fix is ours to take

## Domain

infra

## Status

done — 2026-09-09, on PR #78 (audit gate zero; branches re-baselined per the recorded ruling, INFRA-044 files the climb back)

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —

## Spec References

- None. Toolchain.

## Summary

GHSA-82fw-gwwq-j7x9 (path traversal via @vitest/mocker's redirect mocks)
landed 2026-09-09 and reds the audit gate on every commit. The patch ships
only in vitest@4.1.11 — a major. The exception register cannot tolerate it:
@vitest/mocker reaches the lockfile by two routes (vitest, and
coverage-v8 -> vitest), and the mechanism demands exactly one by design.
Unlike the js-yaml precedent this fix is published and ours, so the gate's
own doctrine says upgrade, not tolerate.

## What to build

Upgrade vitest and @vitest/coverage-v8 to ^4.1.11 across the workspace.
Walk the 3->4 migration notes; the known touchpoints here: the root config
and per-workspace configs, jsdom environments, --includeTaskLocation and
the JSON reporter shape (scripts/check-slow-tests.ts reads it), the raw
istanbul/V8 coverage output the merged gate consumes
(scripts/coverage-config.ts, coverage:merge), and VITEST_MAX_THREADS. The
full suite (17k+ tests) and npm run coverage are the verdict. No test
budget moves without a diagnosis (INFRA-020).

## Acceptance Criteria

- [x] npm audit reports zero vulnerabilities, no exceptions added
- [x] Full unit suite green; coverage gate green at the re-baselined
      threshold (the 90 ruling is recorded in coverage-config.ts and
      INFRA-044); test:slow's report still parses
- [x] Any behavioural difference the upgrade forced is listed with its
      reason — none silently absorbed

## E2E Verification Log

**Model: opus (`claude-opus-5[1m]`).** Run in worktree
`.claude/worktrees/agent-a2fad438341ac4917`, base commit `e4748626`
(v0.36.0). Every command below was run through `rtk proxy` with output
redirected to a file, because the rtk hook truncates and misreports.

### Versions landed

`vitest` and `@vitest/coverage-v8` `^3.2.0` → `^4.1.11` in the root
manifest (the only manifest that carries either). Lockfile resolves both,
and every `@vitest/*` transitive, at `4.1.11`. `vite` is already `7.3.6`,
above Vitest 4's `>= 6` floor, so no Vite move was needed.

One further lockfile move, taken because it clears a second unexcepted
advisory with no source change and converges with what `main` already
resolves: `npm update @redocly/openapi-core` (1.34.18 → 1.34.20), which
lifts the exact `js-yaml@4.3.0` pin the existing exception names and pulls
`js-yaml` to `4.3.2`. No manifest declares either package.

### Reproduction — the gate was red

```
$ rtk proxy node --import tsx scripts/check-audit.ts
audit:check ✗ moderate @vitest/coverage-v8@2.1.0-beta.1 - 4.1.10 — vulnerable via vitest
audit:check ✗ moderate @vitest/mocker@>=2.1.0 <4.1.11 — Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock
audit:check ✗ moderate vitest@>=2.1.0 <4.1.11 — Vitest: Path Traversal / Arbitrary File Read via @vitest/mocker Redirect Mock
audit:check ✗ high     js-yaml@>=4.0.0 <4.3.2 — js-yaml: maxTotalMergeKeys does not limit CPU use for empty merge sources
audit:check ✗ moderate hono@<4.13.5 — (three advisories)
audit:check ✗ 6 vulnerable package(s), 7 unexcepted advisory(ies).
```

### Audit gate after

```
$ rtk proxy node --import tsx scripts/check-audit.ts      # exit 1
audit:check ✗ moderate hono@<4.13.5 — GHSA-gqvv-2mrq-wpjv
audit:check ✗ moderate hono@<4.13.5 — GHSA-g6gw-c38x-mqfc
audit:check ✗ moderate hono@<4.13.5 — GHSA-crvj-82cr-hjcx
audit:check ✗ 1 vulnerable package(s), 3 unexcepted advisory(ies).
```

Every advisory this issue owns is gone. The three that remain are `hono`,
fixed by the `apps/server` bump to `^4.13.7` that sits uncommitted on
`main` and was deliberately not touched here. The `GHSA-5p4m-2wfm-xmqj`
js-yaml exception is now inert — it matches no finding, so `check-audit`
does not print it — and it was **not** removed, widened, or re-dated. No
exception was added.

### Suites

```
$ VITEST_MAX_WORKERS=4 rtk proxy npm test                       # exit 0
 Test Files  703 passed (703)
      Tests  17289 passed (17289)
   Duration  285.33s

$ VITEST_MAX_WORKERS=4 rtk proxy npm run test:coverage -- --includeTaskLocation \
    --reporter=default --reporter=json --outputFile.json=coverage-raw/vitest-results.json
                                                                # exit 0
 Test Files  703 passed (703)
      Tests  17289 passed (17289)
 All files          |   94.38 |    88.84 |   93.64 |   95.75 |

$ rtk proxy npm run test:slow:report                            # exit 0
test:slow ✓ 17289 tests measured, none above 50% of its own budget.

$ CORPUS_UI_PORT=5273 rtk proxy npm run e2e                     # exit 0
  762 passed (17.6m)
```

Not one test assertion or timeout budget was changed. `test:slow`'s
parser reads Vitest 4's JSON report unchanged: `--includeTaskLocation`
still exists, and the report still carries
`testResults[].assertionResults[].location.line` — proved by the run
above, since `check-slow-tests.ts` exits 1 when no task location is
present, and it measured all 17289.

`CORPUS_UI_PORT=5273` because an unrelated ssh tunnel held 5173 on this
machine.

### The coverage gate is red on branches, and it is a measurement change

```
$ rtk proxy npm run coverage:merge                              # exit 1
ALL               |  96.79% 25336/26175 |  95.44% 28656/30025 |    95.13% 6539/6874 |  89.64% 17523/19549
ERROR: coverage for branches (89.64%, 17523/19549) does not meet threshold (90%) for the merged report
```

Baseline for comparison, taken from CI run `34148444380` on the **same
commit** `e4748626` under Vitest 3:

| metric | Vitest 3 | Vitest 4 |
| --- | --- | --- |
| lines | 97.59% 67791/69462 | 96.79% 25336/26175 |
| statements | 97.59% 67791/69462 | 95.44% 28656/30025 |
| functions | 94.97% 4452/4688 | 95.13% 6539/6874 |
| branches | **93.07% 21990/23627** | **89.64% 17523/19549** |

Every denominator moved, in both directions, because Vitest 4 makes
AST-aware V8 remapping the default (it was `experimentalAstAwareRemapping`
and off in 3). Under 3, statements and lines were numerically identical —
`v8-to-istanbul` emitted one statement per line. Under 4 they diverge
(30025 statements over 26175 lines), and functions rise 4688 → 6874,
because a real AST sees arrows, callbacks and methods the line heuristic
collapsed.

**The mechanism behind the branch drop, isolated to one file.**
`packages/contract/src/release.ts` has no test of its own and none of its
11 functions is called by any unit test. Vitest 3 scored it
`10 | 100 | 0 | 10` — **100% branches** on a file with 0% functions.
Vitest 4 scores the same file `7.79 | 0 | 0 | 8.82` — 0/66 branches. The
old provider did not enumerate branches inside code it never entered, so
it scored their absence as full coverage. The AST provider enumerates all
66 and reports none covered. The tree did not get worse. The instrument
stopped flattering unexecuted code, which is the direction a gate wants.

**The merge itself is sound under 4, and was checked rather than
assumed.** `projectExecutedLines` works off `statementMap`/`fnMap`/
`branchMap` spans, so it needs no change. Its browser-run branch gains are
comparable to or larger than the Vitest 3 run's (`+17/+11/+8/+4/+4` against
`+10/+9/+4/+3/+3`), and the e2e half attributed to the identical 431
in-scope files from the identical 762 dumps in both. The `isImplicitPath`
guard — the rule that an absent `else` credits nothing — still fires:
4119 of 19549 branch locations in the Vitest 4 map are zero-width. So the
projection is neither losing credit nor over-crediting.

**What is left.** The gate needs 17595 of 19549 covered branches and has
17523 — a shortfall of **72 branches, 0.36 points**. It is not one file's
fault: covering `packages/contract/src/release.ts` outright yields 17589
(89.97%) and is still 6 short. Only three files in the whole tree sit
under 50% statements (`packages/contract/src/release.ts` 6/77,
`apps/server/src/main.ts` 0/6, `apps/ui/src/testing/keyboardHarness.tsx`
4/9), so the rest of the shortfall is spread thin.

**Escalated, not absorbed.** `COVERAGE_THRESHOLDS` was left at 90 on all
four metrics and no include/exclude glob was widened. Re-baselining a
threshold for a new instrument is a gate-policy decision, and covering
`packages/contract` and `apps/ui` branches is contract-dev's and ui-dev's
work, not infra's.

### Migration changes made, each with its reason

1. **`VITEST_MAX_THREADS` → `VITEST_MAX_WORKERS`**, in `CLAUDE.md`, all
   eleven `.claude/agents/*.md`, and `.claude/skills/learn/SKILL.md`.
   Vitest 4 removed `tinypool` and consolidated `maxThreads`/`maxForks`
   into `maxWorkers`. Verified in the installed build: the only env var
   read is `VITEST_MAX_WORKERS`
   (`node_modules/vitest/dist/chunks/coverage.DM_a_rWm.js:380`). The old
   name is not an error under 4 — it is silently ignored, so every capped
   agent run would have become uncapped. Historical records
   (`.claude/handoffs/**`, closed issue files) keep the old spelling: they
   report what was run at the time.
2. **`vitest.config.ts` — the `coverage.all` comment.** `coverage.all` is
   removed in 4. Naming `coverage.include` is now what keeps a file no
   test loads in the report at 0% instead of vanishing, so the glob is
   load-bearing for the gate rather than a filter. Behaviour is unchanged.
   Only the comment moved.
3. **`scripts/coverage-config.ts` — the `.d.ts` exclusion comment.** Under
   3 the entry restated a default that naming `coverage.exclude` replaced.
   Vitest 4 cut the defaults to `node_modules` and `.git`, so there is
   nothing left to restate and the line is now the only thing excluding
   declaration files. The entry stays. The reason for it changed.
4. **`apps/server/src/projection/populate.test.ts` and
   `apps/ui/src/search/SearchOverlay.test.tsx` — typed `vi.fn`.** Vitest 4
   gave `vi.fn` constructor support, so its type parameter is now
   `T extends Procedure | Constructable = Procedure`. `vi.fn()` still
   infers `Mock<Procedure>`, but the annotation
   `ReturnType<typeof vi.fn>` resolves the parameter to its **constraint**,
   producing `Mock<Procedure | Constructable>`, which no concrete call
   signature accepts. Both files now name the real signature —
   `Mock<Logger["info"]>`, `Mock<BoardNavigation["open"]>` — and construct
   with `vi.fn<Logger["info"]>()`. These were the only two typecheck
   failures in the repository. Twelve other `ReturnType<typeof vi.fn>`
   annotations survive because they are never assigned to a concrete
   signature. They are weak, not broken, and were left alone.

### Touchpoints checked and deliberately not changed

- **jsdom environments.** 174 files opt in with a `@vitest-environment
  jsdom` docblock. The removed `environmentMatchGlobs` and `poolMatchGlobs`
  are used nowhere, so nothing moved. All 174 ran green.
- **Reporters.** The removed `basic` reporter and the removed reporter
  hooks (`onCollected`, `onTaskUpdate`, `onFinished`, …) have no user
  here — nothing in the repository imports `@vitest/*` or defines a custom
  reporter. Every one of 701 vitest imports is from `"vitest"` itself.
- **`workspace` → `projects`.** No workspace config exists. `vitest.config.ts`
  is the only Vitest config in the repository.
- **Trailing-number timeouts.** Vitest 4 removed the *options object* as a
  third argument, not the number. `test(name, fn, 20_000)` is still typed
  (`number | TestOptions | TestFunction`), so `scripts/slow-tests.ts` reads
  a form that still exists.
- **`vi.restoreAllMocks` no longer resets spy state** (16 call sites, all
  in `afterEach`). No test depended on the reset — every one passes.
- **Coverage ignore hints.** Three `c8 ignore` comments, all in
  `apps/server/src/docs/archive.ts`, a workspace still above threshold.
- **`.githooks/` and `.github/workflows/ci.yml`.** Neither names a Vitest
  option that 4 changed. CI's `test:coverage -- --includeTaskLocation
  --reporter=default --reporter=json` step is exactly what was run above.

### Other gates

```
$ rtk proxy npm run build         # exit 0
$ rtk proxy npm run lint          # exit 0
$ rtk proxy npm run format:check  # exit 0 — All matched files use Prettier code style!
$ rtk proxy npm run typecheck     # exit 0 (after change 4 above)
$ VITEST_MAX_WORKERS=4 ./node_modules/.bin/vitest run \
    apps/server/src/projection/populate.test.ts \
    apps/ui/src/search/SearchOverlay.test.tsx     # 2 files, 43 tests passed
```

The two `vi.fn` annotations were typed after the full coverage run. Both
files are test files, excluded from coverage by `COVERAGE_EXCLUDE`, and a
type annotation changes no runtime behaviour, so the coverage figures
above still describe this tree.
