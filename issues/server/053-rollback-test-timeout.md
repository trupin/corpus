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

## Investigation 2026-08-05 — it failed CI too, and the obvious fix is wrong

The same test failed **`CI / validate`** on `8f94954c` (run 31043340079), not
just a local gate — so this is not a property of one laptop.

**Measured cost.** `REVISION_SEARCH_LIMIT` is **50**, not fifteen as INFRA-020
recorded. The test commits `LIMIT + 1 = 51` revisions (52 `git` spawns, since only
the first needs an `add`) and the walk it then triggers runs one `git show` per
revision — roughly **a hundred processes in a single test case**. That is the
whole cost, and it is why an idle box needs ~1 s of the 5 s budget and a loaded
one has nothing left.

**The fix that looks right and is not.** Parameterise the bound
(`rollbackSkill(..., revisionSearchLimit = REVISION_SEARCH_LIMIT)`) and let the
test drive the same walk at depth 3. Implemented and then **reverted**: the test
exercises the **HTTP route**, so a function parameter is unreachable from it
without adding a query parameter or a server option that exists only for tests —
a production API surface bought for a test's convenience. An unused parameter is
worse than the flake.

**So the next attempt has to choose one, deliberately:**

1. Have this one test call `rollbackSkill` directly instead of through the route,
   asserting the thrown `notFound` rather than a 404. The refusal and its scoping
   are asserted unchanged; what is lost is route coverage for *this* case, which
   the three sibling 404 tests in the same describe already cover.
2. Lower `REVISION_SEARCH_LIMIT` itself. 50 `git show` calls inside a request
   handler is a real cost in production too, and the docblock already says the
   answer "is almost always the first or second one". If the shipped bound were
   ~10, the test would cost a fifth of what it costs now with no test-only seam
   at all — but this changes product behaviour and needs its own justification.
3. Raise the timeout for this file only, and say plainly that the hundred
   processes are irreducible. The weakest option; the criteria below prefer the
   others.

Option 2 is the most interesting and the least explored: it is the only one that
makes the *product* cheaper rather than the test.

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
