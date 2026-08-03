# [SERVER-053] Flaky: rollback's "nothing to restore" test has a 5s budget it needs 1s of

## Domain
server

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- —

## Summary
`apps/server/src/skills/rollback.test.ts:292` — _"refuses when the walk found
nothing, scoping the claim to what it examined"_ — timed out at the default
5000 ms during a pre-push gate on 2026-08-03, failing the whole run at
**1 failed / 9013 passed** and costing a full push cycle.

Re-run in isolation immediately afterwards: the same test passes in **1036 ms**,
whole file 33 tests in 7.5 s. So it is not broken, it is expensive — roughly a
fifth of the default budget when the machine is idle, which leaves no room on a
machine that has just finished an e2e run. The test walks fifteen revisions and
has `checkSave` refuse all of them.

This is the second load-sensitive failure in two days (UI-047 is the other), and
both cost a full gate cycle. Worth fixing the cause rather than raising the
timeout: a test that needs 20% of its budget idle is a test that will fail again.

## Acceptance Criteria
- [ ] The test passes reliably under load — verify with `--repeat-each`-style
      repetition while the machine is deliberately busy, not on an idle box
- [ ] Prefer making the test cheaper (fewer revisions, or a faster refusal path)
      over raising `testTimeout`; if the budget genuinely must rise, say why the
      work is irreducible
- [ ] Check its siblings in the same file for the same shape — the fifteen-deep
      walk may not be the only one
- [ ] What it asserts is unchanged: the refusal, and the claim being scoped to
      what was examined

## Technical Design
### Files to Create/Modify
- `apps/server/src/skills/rollback.test.ts`

## Testing Strategy
Repeat runs under CPU load; compare wall time before and after.

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
