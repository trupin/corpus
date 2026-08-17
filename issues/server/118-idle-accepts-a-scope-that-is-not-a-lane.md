# [SERVER-118] `GET /api/queue/idle` accepts any thread id as a scope, and `agent.live` then lies

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Related: SERVER-112, CONTRACT-053, CLI-046

## Spec References

- SPEC.md **§7** — presence is the parked request; a lane is a designated
  thread's scope

## Summary

`recipient` is validated against `isDesignatedRoot` and refused with a 422.
**`scope` on `GET /api/queue/idle` is validated only as `LaneSchema`** — any
`th_` id passes — and flows straight into `observePark(scope)`.

`LaneTracker.presence()` aggregates over every lane anything has parked on, so
**parking on an undesignated thread makes `agent.live` true indefinitely**,
while `GET /api/agents` never lists that lane.

`packages/contract/src/schemas/queue.ts` publishes: *"`agent.live` is true
exactly when some `AgentLane.live` is."* That is false as shipped.

**It is reachable exactly as the converse skill predicts** — *"a wrong lane is
honoured in silence"*. A typo'd or stale `--thread` parks forever and the
workspace reports an agent listening when none is.

**And it is a decision use, not a display.** `apps/cli/src/commands/queue/
control.ts` and `docs/cli.md` advertise
`corpus queue status --json | jq -e '.agent.live'` as *"a guard before enqueuing
work"*. CONTRACT-053's "display-only, nothing should change on the server" does
not cover this.

## A second, smaller way the same sentence is false

`liveness.ts`'s `presence().since` takes the max `lastSeen` across **all**
records regardless of liveness, so `agent.since` can be an instant belonging to
a lapsed, non-roster lane — one no `AgentLane.since` carries. The contract says
"the most recent of theirs". The direction is safe (a client can only be more
generous about expiring), but it is a second falsehood in one published
sentence, and CONTRACT-053 names neither.

## Acceptance Criteria

- [ ] `scope` on `idle` is validated the way `recipient` is: a scope that is not
      a designated root is refused, with the same 422 shape and a message that
      names the fix
- [ ] Decide and state whether a lane that **lapses out of designation** while
      parked is refused on re-park or tolerated until it returns — a resident
      released mid-park is a real sequence and the answer should be deliberate
- [ ] `presence().since` is the most recent among **live** lanes, matching the
      published sentence
- [ ] A test asserts `agent.live` and `GET /api/agents` cannot disagree in this
      direction — CONTRACT-053's grace-window disagreement is a different case
      and must still be allowed
- [ ] Every test checked red first

## Testing Strategy

Route-level for the refusal; unit for `presence()`. An integration test that
parks on an undesignated thread and asserts `agent.live` stays false is the one
that matters.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first._

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-118]` prefix
