# [INFRA-015] Audit checker: output overflow / spawn failure must not select the fail-open branch

## Domain
infra

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: INFRA-013
- Blocks: —

## Spec References
- None product-behavioral — dev-harness (PR #16 review finding 3, 2026-07-31)

## Summary
`check-audit.ts` spawns `npm audit --json` without `maxBuffer` (1 MiB default) and
never consults `spawnSync().error`. A tree with more than ~1 MiB of advisories gets
truncated stdout → JSON.parse fails → classified `unreachable` → pre-commit (which
passes the tolerate flag) warns and PROCEEDS on exactly the trees with the most
findings, misattributing the cause to the registry. Same path if npm fails to spawn.
CI runs flag-less and fails closed, so the backstop holds — but the local fail-open
branch must be selectable only by genuine unreachability. Fix: generous `maxBuffer`
(e.g. 64 MiB); consult `error`/null `status` and classify spawn failure as its own
fail-closed verdict distinct from `unreachable`; add fixtures for truncated-JSON and
spawn-error. Also worth folding in: strip control chars/ANSI from registry-controlled
advisory text before rendering (review finding 2 — human-facing spoofing only).

## Acceptance Criteria
- [ ] Truncated/oversized audit output fails closed in BOTH forms with an honest cause message (test with a fixture > buffer)
- [ ] Spawn failure (npm absent) fails closed in both forms
- [ ] Genuine unreachable payload still warns-and-proceeds locally, fails CI (existing tests untouched)
- [ ] Advisory text sanitized (newlines/ANSI stripped) in the human report

## Technical Design
### Files to Create/Modify
- `scripts/check-audit.ts`, `scripts/audit-report.ts` (+ tests)

## Testing Strategy
scripts-level (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Fixture-driven; the offline and pin drills from INFRA-013's log re-run unchanged.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
