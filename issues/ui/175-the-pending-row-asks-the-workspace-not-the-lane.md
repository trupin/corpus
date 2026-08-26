# [UI-175] The pending row asks the workspace, not the lane

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: UI-174
- Blocks: —

## Spec References

- SPEC.md §8 — the pending-indicator rider, amended 2026-08-25

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

- [ ] A waiting row on a designated thread reports **its own lane's** liveness,
      not the workspace aggregate
- [ ] The wording is `laneRows`', not a fourth phrasing of the same fact — the
      kit already owns it, and a surface that invented its own would be the
      second spelling this repository keeps warning about
- [ ] **The thresholds are re-judged, not inherited.** `absent` appears at three
      minutes, tuned for a world where the orchestrator would take the work
      eventually. Nobody takes it now, so three minutes may be too patient
- [ ] Unknown still counts as present: a row does not claim nobody is there on
      the strength of not having read the roster (UI-098)
- [ ] A thread with **no** resident is unchanged — its work really is the
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

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-175]` prefix
