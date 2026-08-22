# [INFRA-020] Tests that fail under gate load and pass in isolation

## Domain
infra

## Status
todo

**Amended 2026-08-22 by SHARED-065 (Phase 41), and kept open.** One of the two
tabled tests was `apps/ui/e2e/todos.spec.ts`, deleted with the plugin surface
(SHARED-064, UI-150). It is struck below rather than erased, because the table is
a record of what was actually observed.

**The issue survives its cause, and the reason is the whole point of it.** It was
filed *"as a pattern, not a third annoyance"*: the claim is that this suite holds
a class of tests whose budget is sized for an idle machine, and that a real
regression and a load flake are indistinguishable at the gate. Neither claim
depended on which two tests happened to demonstrate it. The general lesson at the
foot of the summary, and the `CLAUDE.md` criterion, are untouched.

**What does change is the SERVER-053 question.** With one tabled test left, and
SERVER-053 covering exactly that one, the fold-in-or-duplicate decision in the
notes is now the first thing to settle rather than a footnote. SHARED-065 does
not settle it — that is the implementing agent's call, and closing INFRA-020 into
SERVER-053 would lose the pattern.

The title drops its arithmetic.

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
Filed as a pattern, not a third annoyance. Distinct tests have failed inside a
full gate and passed in isolation on the same commit, each costing a complete
gate cycle (10–20 minutes with e2e):

| Test | Observed | In isolation |
| --- | --- | --- |
| `apps/server/src/skills/rollback.test.ts` → "nothing to restore" | timed out at 5000 ms | passes in **1036 ms** (SERVER-053) |
| ~~`apps/ui/e2e/todos.spec.ts` → "comments on the item the pointer chose"~~ | ~~3× consecutive under load~~ | ~~7/7 clean (noted in UI-073)~~ — **deleted 2026-08-22 with the plugin surface** |

**Resolved 2026-08-05 — the third entry was not one of these.** The
`requeueDeferredFor` failures (four in the end) were **the code**, and this issue
asking "establish which before fixing the test" is the only reason that was
found rather than papered over with a longer timeout: its assertion was true and
the queue's availability read was torn. Split out and fixed as **SERVER-060**.

The lesson generalizes and belongs here: the tell was that one of its failures
came on a run whose test time was **355 s — normal**, not the 3511 s of a
genuinely loaded gate. *A test that fails without contention is not
load-sensitive; it is racy, and the code may be too.* Check the duration of the
run before adding a test to this list.

The other two were a load story. One of them is now deleted code, so the standing
subject is `rollback.test.ts` plus the class it stands for.

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
- [ ] Each test still in the table is diagnosed: what it waits on, and why the
      margin is thin — not simply given a longer timeout
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
- `apps/server/src/skills/rollback.test.ts`

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
