# [UI-175] The pending row asks the workspace, not the lane

## Domain

ui

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: UI-174
- Blocks: —

## Spec References

- SPEC.md §8 — the pending-indicator rider, amended 2026-08-25

## Corrected 2026-08-26 — the premise was imprecise, and the defect is worse

**The row does ask the lane.** It carries `PendingLane` and has per-lane wording
throughout — `laneWaitingLabel`, `laneWorkingLabel`, `laneAwayClause`. Filing
this as *asks the workspace, not the lane* was a reading of the code from the
outside, and it was wrong.

What the row actually did was worse. `laneAwayClause` appended:

```ts
export const LANE_FALLBACK_CLAUSE = "the agent will pick this up";
```

So a thread whose resident was not running read **"researcher is away, the agent
will pick this up"** — an active false promise, on the surface a person reads
*while they are waiting*, introduced by v0.23.0 removing the fallback and missed
by UI-174 because UI-174 fixed the roster's wording and this is a different
file.

The workspace-versus-lane question is real and is **UI-176**, which reads the
job's stamped lane instead of walking the scope. It is a different fault and did
not need to block this one.

## Summary

Found while finishing UI-174, and left rather than half-done.

§8's amended rider says a waiting row must report that **its lane** has no
listener. `PendingIndicator` reports something adjacent and coarser: whether
**anybody at all** is parked, anywhere in the workspace, read off
`QueueStatus.agent`.

The two came apart with SPEC.md §7's rider signed 2026-08-25. They used to
differ only in precision, because the orchestrator picked up an unattended lane's
work either way. Now a workspace can have a busy orchestrator and a conversation
nobody will ever answer, and this row says nothing is wrong.

UI-174 shipped the honest line everywhere a **lane** is drawn — the roster, the
console's Residents tab, and `ScopeProvenance` — because all three read
`laneLine` in `@corpus/kit`. The pending row does not.

## Acceptance Criteria

- [x] A waiting row on a designated thread reports **its own lane's** liveness,
      not the workspace aggregate
- [x] The wording is `laneRows`', not a fourth phrasing of the same fact — the
      kit already owns it, and a surface that invented its own would be the
      second spelling this repository keeps warning about
- [x] **The thresholds are re-judged, not inherited.** `absent` appears at three
      minutes, tuned for a world where the orchestrator would take the work
      eventually. Nobody takes it now, so three minutes may be too patient
- [x] Unknown still counts as present: a row does not claim nobody is there on
      the strength of not having read the roster (UI-098)
- [x] A thread with **no** resident is unchanged — its work really is the
      orchestrator's, and the workspace aggregate is the right question for it

## Technical Design

`useResidentLane(threadId)` already returns the `LaneRow` this needs, and
`ScopeProvenance` shows the pattern. The work is wiring it into
`outstandingAgentRequest`'s inputs and deciding the thresholds.

## Testing Strategy

A designated thread whose lane is not live says so while the workspace has a
live orchestrator — the case that is currently silent. An undesignated thread
keeps the aggregate reading. Falsify by pointing the row back at
`QueueStatus.agent` and watching the first case go quiet.

## E2E Verification Plan

Against the real app: designate a thread, post a turn with no listener running,
start the orchestrator so the workspace reads live, and confirm the row still
says this conversation's agent is not running.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-26.

### What it says now

```
waiting — researcher is away — nothing will answer until it starts
still waiting — 22m, researcher is not running — nothing will answer until it starts
```

**It names the fact and stops.** Not why the listener is gone — this row cannot
know — and not an instruction to start one, because the product gives nobody a
way to follow it. A test asserts the line matches none of
`crash|restart|start it|run \`|try again`.

**The one thing it adds is that waiting is what happens next**, because the
alternative reading of open-ended silence is that the message was lost, and that
is the wrong thing for a person to conclude.

### The timing argument got stronger

The lane-grained row says the lane is absent from its **first** tier, where the
workspace-grained row waits three minutes. That was argued on the grounds that
the roster has already told us this listener is gone, so withholding a fact we
hold would be its own dishonesty. With the fallback removed the wait is
open-ended, so the argument holds harder rather than needing revisiting.

### Falsification

Restoring `"the agent will pick this up"`:

```
× promises nobody else, because since v0.23.0 there is nobody else
× says a lapsed lane is away, and that nothing else is coming
  Tests  2 failed | 35 passed
```

### Checks

```
vitest run apps/ui/src/thread     452 tests passed   exit 0
eslint apps/ui/src/thread          0 errors          exit 0
tsc --noEmit -p apps/ui                              exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[UI-175]` prefix
