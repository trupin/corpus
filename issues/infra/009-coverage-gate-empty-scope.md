# [INFRA-009] Coverage gate: empty in-scope set must fail, not pass at 100%

## Domain

infra

## Status

todo

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

- [ ] Zero files in scope → gate fails with a message naming the globs.
- [ ] Test covers it.

## E2E Verification Log

_(to be filled by the implementing agent)_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
