# [INFRA-009] Coverage gate: empty in-scope set must fail, not pass at 100%

## Domain

infra

## Status

done

## Priority

P2

## Model

opus — one guard plus a test.

## Dependencies

- Depends on: INFRA-004
- Blocks: —

## Spec References

- PR #10 review (2026-07-28), finding 17

## Summary

`scripts/coverage-gate.ts:289-291` — `percent(0,0) = 100` with no zero-files guard: a
`COVERAGE_INCLUDE` glob typo yielding an empty in-scope set passes the gate at 100%. An empty
scope is a configuration error and must fail loudly.

## Acceptance Criteria

- [x] Zero files in scope → gate fails with a message naming the globs.
- [x] Test covers it.

## E2E Verification Log

**Implemented on: opus.** 2026-07-29. Verified by running the real merge/gate script
(`tsx scripts/merge-coverage.ts`) over a fabricated empty scope — the full `npm run coverage` chain
was deliberately **not** run (machine-load discipline; it would prove nothing this does not).

The empty scope was staged the way the real failure produces it: a `COVERAGE_INCLUDE` that matches
nothing leaves Vitest writing an empty `coverage/coverage-final.json`, so that is what was written,
alongside one browser dump so the merge reaches the gate rather than the "no browser coverage"
early exit.

```
$ mkdir -p coverage coverage-raw/browser-v8
$ echo '{}' > coverage/coverage-final.json
$ echo '{"root":"apps/ui","entries":[]}' > coverage-raw/browser-v8/empty-scope.json
```

### Pre-fix — the gate passes on nothing

```
$ tsx scripts/merge-coverage.ts
  inputs: 0 files from coverage/coverage-final.json, 1 browser dumps from coverage-raw/browser-v8, ...
workspace |               lines |          statements |           functions |            branches
-------------------------------------------------------------------------------------------------
-------------------------------------------------------------------------------------------------
ALL       |         100.00% 0/0 |         100.00% 0/0 |         100.00% 0/0 |         100.00% 0/0

coverage: merged gate passed — all four metrics at or above 90%.
exit=0
```

An empty table with no workspace rows at all, four 100%s, and a green gate.

### Post-fix — the same input is refused

```
$ tsx scripts/merge-coverage.ts
ERROR: the merged report describes 0 source files, so every metric is a vacuous 100%. Nothing matched the coverage scope — include [apps/*/src/**, packages/*/src/**, plugins/*/**] minus exclude [**/*.test.{ts,tsx}, apps/*/src/bin/**, **/*.generated.ts, plugins/_*/**]. Fix the globs in scripts/coverage-config.ts, or find out why the unit run covered nothing.
exit=1
```

Both glob lists are named verbatim, and no merged report is written for an input that measured
nothing.

### Positive control — the guard is silent when there is something to measure

One real in-scope file (`apps/cli/src/version.ts`) with one covered statement in the unit report,
same browser dump:

```
$ tsx scripts/merge-coverage.ts
  inputs: 1 files from coverage/coverage-final.json, ...
apps/cli  |         100.00% 1/1 |         100.00% 1/1 |         100.00% 0/0 |         100.00% 0/0
ALL       |         100.00% 1/1 |         100.00% 1/1 |         100.00% 0/0 |         100.00% 0/0
coverage: merged gate passed — all four metrics at or above 90%.
exit=0
```

The fabricated `coverage/` and `coverage-raw/` directories were removed afterwards.

### Change

- `scripts/coverage-gate.ts`: `CoverageSummary` gained `files` (counted in `summarize`), and a new
  `emptyScopeFailure(summary, include?, exclude?)` returns the message or `null`. `percent` keeps
  `0/0 = 100` — a file with no branches must not read as 0% — with a comment pointing at the guard
  that makes that safe.
- `scripts/merge-coverage.ts`: the guard runs immediately after `summarize`, before any report is
  written, and exits 1.

### Tests

`VITEST_MAX_THREADS=4 vitest run scripts/` → 8 files, 236 tests passed. New in
`scripts/coverage-gate.test.ts`:

- `summarize` counts the files it measured (2 for the fixture, 0 for an empty map).
- `emptyScopeFailure` fails an empty report — asserted alongside the fact that `thresholdFailures`
  finds nothing wrong with it and every metric reads `pct: 100`, which is the bug in one assertion —
  and its message contains every configured include and exclude glob.
- it names caller-supplied globs instead of the configured ones.
- it returns `null` for a report with at least one file.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
