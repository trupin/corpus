# [INFRA-020] Three tests fail under gate load and pass in isolation

## Domain
infra

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
Filed as a pattern, not a third annoyance. Three distinct tests have now failed
inside a full gate and passed in isolation on the same commit, each costing a
complete gate cycle (10–20 minutes with e2e):

| Test | Observed | In isolation |
| --- | --- | --- |
| `apps/server/src/queue/service.test.ts` → `requeueDeferredFor` | **three times** (2026-08-03, 2026-08-05 ×2) — one event returned where two were expected | 56/56 |
| `apps/server/src/skills/rollback.test.ts` → "nothing to restore" | timed out at 5000 ms | passes in **1036 ms** (SERVER-053) |
| `apps/ui/e2e/todos.spec.ts` → "comments on the item the pointer chose" | 3× consecutive under load | 7/7 clean (noted in UI-073) |

**Sharpened 2026-08-05, and the queue one may not belong on this list.** Its
third failure came on a run whose test time was **355s — normal**, not the 3511s
of a genuinely loaded gate. A test that fails without contention is not
load-sensitive; it is racy, and possibly the code is.

Read the assertion before assuming the test is at fault: `requeueDeferredFor`
claims to return **every** event deferred on a document to `pending` and wake a
parked poll, and it returned one of two. If that under-return is reachable in
production, a deferred event stays deferred when its lock clears — the queue
quietly holding work it promised to release, which no user would ever see as
anything but the agent not responding. **Establish which before fixing the
test**, and if it is the code, this becomes a SERVER issue and leaves this one.

The other two remain a load story.

Individually each looks like bad luck. Together they say the suite has a class of
tests whose **budget is sized for an idle machine** — a 5 s timeout on work that
takes 1 s, a wake-up assertion with no slack, a pointer gesture racing a layout.
Under the gate they compete with vitest workers and a Playwright browser, and the
margin disappears.

The cost is not the failure; it is that **a real regression and a load flake look
identical at the gate**, so every one has to be investigated by hand before a
push can proceed. That happened three times today and twice the answer was
"nothing wrong". The third time it was a genuine regression (five reveal specs),
and the only reason it was caught rather than retried away was a deliberate
decision to re-run in isolation first.

## Acceptance Criteria
- [ ] Each of the three is diagnosed: what it waits on, and why the margin is
      thin — not simply given a longer timeout
- [ ] Where the wait is genuine work, make it cheaper (SERVER-053 already notes
      the rollback test walks fifteen revisions)
- [ ] Where the wait is a race with no slack, make it deterministic — wait on the
      condition, not on a duration
- [ ] Verified under deliberate load (`--repeat-each` with the machine busy),
      because a green run on an idle box proves nothing about any of these
- [ ] A note in the machine-load section of `CLAUDE.md` if a general rule emerges
      (e.g. "a test that needs >20% of its timeout idle will flake under the
      gate")

## Technical Design
### Files to Create/Modify
- `apps/server/src/queue/service.test.ts`, `apps/server/src/skills/rollback.test.ts`,
  `apps/ui/e2e/todos.spec.ts`

### Notes
- SERVER-053 covers the rollback test alone and should be folded in or closed as
  a duplicate — decide which rather than leaving both open.
- Do not fix these by raising timeouts across the board. A suite whose timeouts
  are all generous stops catching the thing timeouts exist to catch.

## Testing Strategy
Repeat runs under deliberate CPU load, before and after.

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
