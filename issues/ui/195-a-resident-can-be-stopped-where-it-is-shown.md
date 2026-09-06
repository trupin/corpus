# [UI-195] A resident can be stopped where it is shown

## Domain

ui

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-165 (release semantics under designation-engages —
  landed 2026-09-06)
- Related: UI-186 (the Residents pane this control lands in)

## Spec References

- SPEC.md **§7** — dissolution returns the scope to ordinary routing
- SPEC.md **§9.2** — `DELETE /api/threads/:id/resident` releases, idempotent,
  takes effect at once: *"'stop this agent' is an act with an observable
  end"*
- SPEC.md **§8**, rider signed 2026-09-06 — release keeps the thread
  engaged; the ordinary agent answers from then on

## Summary

**User directive, 2026-09-06: "I want to be able to stop a resident agent
from the console pannel."** The Residents pane shows every lane and what it
runs at, but stopping one means leaving the console for the thread's own
menu. The place that shows a running agent is the place a person reaches to
stop it.

## What to build

A stop control on each resident row in the console's Residents pane:

- It calls the existing release route (`DELETE /api/threads/:id/resident`)
  through the kit's mutation — no new contract or server surface.
- "Stop" is release, the one spec-backed stop with an observable end. The
  control says what it does before it does it: the resident is released, the
  conversation stays open and engaged, and the ordinary agent answers it
  from now on (the §8 rider's semantics — quote the consequence, not the
  mechanism).
- The row reflects the release when the server confirms it (SSE
  `resident.released` reaches the pane's model) — no optimistic pretending
  an agent stopped before it did, because §9.2 makes the release's effect
  observable and the pane's honesty is its point.
- Idempotence per §9.2: a row whose resident is already gone offers nothing.

## Acceptance Criteria

- [ ] Each resident row offers the stop control, worded as release with its
      consequence stated before the act
- [ ] Releasing from the pane updates the row on the server's confirmation,
      and the lane returns to ordinary routing (E2E: a parked listener's
      park returns, the next plain turn goes to the orchestrator's lane)
- [ ] The thread's own menu and the pane agree afterwards — one state, two
      surfaces
- [ ] No new contract surface; the kit mutation is reused or added in
      packages/kit only

## E2E Verification Log

_Implementing agent fills; state the model._
