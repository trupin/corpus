# [INFRA-020] Tests that fail under gate load and pass in isolation

## Domain
infra

## Status
todo

**Amended 2026-08-22 by SHARED-065 (Phase 41), and kept open.** One of the two
tabled tests was `apps/ui/e2e/todos.spec.ts`, deleted with the plugin surface
(SHARED-067, UI-155). It is struck below rather than erased, because the table is
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

---

## Another instance, v0.20.0 harvest (2026-08-23)

Recorded here rather than filed, because this issue exists for exactly this
pattern and a fourth issue describing it would be a fourth description of one
thing.

Two whole-suite Playwright runs under load, single worker, on an unchanged tree:

- run 1 failed `query-editor`, `reflect`, `resident`
- run 2 failed `menu-room-geometry`, `table-pipes` — **a disjoint set**

All 33 tests across those five files pass in isolation. The disjointness is the
finding: it is the load, not the specs. The orchestrator's own final harvest run
of the same suite passed 609 of 609.

Two related facts from the same release, both worth having beside this:

- **SERVER-140** was this shape and turned out to be a real ordering bug in a
  test, not load — 3 of 4 runs green before, 10 of 10 after. So this pattern is
  not a safe thing to assume.
- **SERVER-146** was filed because one server test failed once in a gate and the
  orchestrator read the summary line instead of keeping the log, losing the
  name. Whatever is done here, capture to a file.

---

## A third instance, named at last (SERVER-146, 2026-08-23)

SERVER-146's bounded search caught a server test under deliberate load **with its
name**, which is what that issue existed for. Recorded here because it is this
pattern rather than a new thing, and because the diagnosis matters more than the
instance.

**The test.**
`apps/server/src/semantic/worker.test.ts` →
`startEmbedWorker — debounce behind the write path (TEST-864)` →
`embeds the final content once after a burst of saves`.

**The shape that reproduces it.** Two full `apps/server` suites running at once,
four workers each. Round 1:

```
arm a   Tests  1 failed | 4610 passed (4611)   Duration 373.40s
        × embeds the final content once after a burst of saves   446ms
          AssertionError: expected [ …(2) ] to have a length of 1 but got 2
arm b   Tests  4611 passed (4611)              Duration 373.40s
```

Same tree, same instant, one arm red and one green — so it is not the code.
373 s against a normal ~140 s is the contention, which is what separates this
from INFRA-020's own warning about tests that fail on an *uncontended* run.

**It does not reproduce more cheaply.** The file alone, ten times, with one full
suite beside it as load: **10 passed, 0 failed**. Running the file alone gives it
the whole event loop. The failure needs the test to be *inside* a saturated
suite, which is precisely why "it passed on retry" is not evidence of anything.

**Why the margin is thin.** The test makes ten saves with an `await` of 5 ms
between them, against a 60 ms debounce. Ten 5 ms gaps sit comfortably inside the
window until the event loop is contended; then one gap outgrows it, the worker
embeds an intermediate revision, and the count is 2.

**The obvious fix is worse, and was tried and reverted.** Removing the sleeps
makes the burst synchronous, and a `setTimeout` callback cannot fire inside
synchronous code — deterministic under any load. It also makes the test pass with
`debounceMs: 0`, **measured**, which is to say vacuous about the one thing it is
named for. The claim is a claim about wall-clock time, so the only honest way to
decide it is fake timers over the worker's scheduler. That belongs to this issue,
not to a P2 flake hunt passing through. The test now carries a comment saying so.

**A second observation, weaker, kept for the record.** Round 2's two arms both
failed the *same* two tests at ~6 s —
`threads/create.test.ts → mints distinct anchor ids for concurrent comments on one document`
and `docs/acts.test.ts → an ordinary save of a document body, whichever document it is to`.
Both arms were killed before they printed a summary, so those two are **not**
trustworthy evidence and are noted rather than tabled.

### A fourth instance, and the best-measured one (same search)

`apps/server/src/docs/acts.test.ts` →
`what does not close a window (§4)` →
`an ordinary save of a document body, whichever document it is to`.

It is the most expensive test in its file: **fourteen real HTTP mutations, each
with a real git commit** — two creates, five create/save pairs, two more saves.

```
alone, load average ~7:   2783ms  ✓ | 3120ms ✓ | 6110ms × (timed out at 5000ms)
alone, quieter:           3110ms  ✓
inside a full suite competing with another agent's:  ×  6023–6708ms
```

**2.8–3.1 s against vitest's 5 s default is 62% of its budget at rest** — which
is this issue's own proposed rule ("a test that needs >20% of its timeout idle
will flake under the gate") met three times over. It failed **1 in 3 running
alone**, which is why it is tabled rather than merely noted.

**Given an explicit 20 s budget, with the measurement written beside it.** Not
raised across the board — every other test in that file keeps the default — and
not a fix: the real remedy is this issue's second criterion, *make the genuine
work cheaper*. Fourteen commits to prove that six saves fold into one window is
more setup than the claim needs.

| Test | Observed | Alone |
| --- | --- | --- |
| `apps/server/src/semantic/worker.test.ts` → "embeds the final content once after a burst of saves" | assertion failure at 446 ms inside a doubly-saturated suite | 10/10 pass |
| `apps/server/src/docs/acts.test.ts` → "an ordinary save of a document body, whichever document it is to" | timed out at 5000 ms, 1 in 3 | **2.8–3.1 s of a 5 s budget** |

### And the disjoint-set signature again, on `apps/server` this time

Three full `apps/server` runs on the same tree while other agents ran their own
suites, after the two fixes above:

```
run A  2 failed | 4609 passed   Duration 474s   update.test.ts, key.test.ts
run B  5 failed | 4606 passed   Duration 452s   acknowledgment.test.ts ×2, resident.test.ts, acts.test.ts ×2
run C  0 failed | 4611 passed   Duration 373s
```

Every failure is a **5.1–7.0 s timeout**, never an assertion, and the sets are
**disjoint between runs** — the same signature the Playwright note above records.
All of them pass in isolation: `update.test.ts` + `key.test.ts` → 83 of 83 at
load average 12.

A normal `apps/server` run on this machine is ~140 s. At 450–475 s the suite is
not measuring the code.

## A third instance, v0.21.0 (2026-08-24)

`apps/cli/src/commands/workspace/maintenance.test.ts > stops git repacking the
repository behind us across a run of commits` — **timed out at 5000ms** in a
full `apps/cli` run while a ui-dev agent worked, and passed **3 of 3** in
isolation immediately afterwards.

It is the same shape SERVER-146 diagnosed hours earlier in `apps/server`: a
git-heavy test on a fixed millisecond budget, where the budget was chosen when
the machine was quiet. SERVER-146's own fix is the precedent worth copying —
**measure what the test costs at rest, then size the budget to the
measurement**, rather than raising budgets across the board.

Routed to cli-dev with that instruction. Recorded here because this issue exists
for the pattern, and because the pattern now has instances in two workspaces
found on the same day.
