# [INFRA-004] Merge Playwright e2e coverage into the combined 90% gate

## Domain

infra

## Status

todo

## Priority

P1

## Dependencies

- Depends on: INFRA-003, UI scaffold (Phase 1 — needs real e2e specs to exist)
- Blocks: —

## Spec References

- docs/TS_GUIDELINES.md — Coverage
- CLAUDE.md — Definition of Done (combined coverage ≥ 90%)

## Summary

The 90% coverage gate currently runs on unit tests alone (there are no e2e specs yet). Once the UI exists and Playwright specs land, e2e coverage must be **merged** with unit coverage so the 90% bar is truly combined — code exercised only through the browser counts, and the gate reflects total exercised behavior.

## Acceptance Criteria

- [ ] Playwright runs collect V8 coverage from Chromium (CDP `startJSCoverage`/`stopJSCoverage` fixture or monocart reporter) for both the UI bundle (source-mapped back to `src/`) and the server process under test (`NODE_V8_COVERAGE`).
- [ ] Real `corpus` CLI invocations count too: CLI processes spawned in e2e/integration tests run with `NODE_V8_COVERAGE` so `apps/cli` coverage reflects actual command executions, not just unit tests.
- [ ] A merge step (e.g. `monocart-coverage-reports`) combines Vitest's istanbul-format `coverage/coverage-final.json` with Playwright's collected coverage (raw V8 from CDP, source-mapped) into one report; the 90% thresholds move to the merged report and are removed from the vitest-only run in CI.
- [ ] CI's `validate` job enforces the gate on the merged report; local `npm run coverage` reproduces it.
- [ ] Per-workspace numbers visible in the report (text summary in CI logs).

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

_[Agent fills on implementation]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes
- [ ] Committed with `[INFRA-004]` prefix
