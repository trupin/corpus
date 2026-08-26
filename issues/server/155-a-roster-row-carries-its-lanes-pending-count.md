# [SERVER-155] A roster row carries its lane's pending count

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-087
- Blocks: AGENT-053, UI-174

## Spec References

- SPEC.md §7 — rider D signed 2026-08-25

## Summary

Implements CONTRACT-087. `GET /api/agents` fills the `pending` field on every
roster row.

This is the fact rider D's orchestrator reads instead of inferring from absence,
and the fact UI-174 shows a person so a stalled conversation names its own cause.

## Acceptance Criteria

- [ ] Every roster row carries `pending`: the count of **pending** events stamped
      for that lane
- [ ] `in-progress` and `deferred` are **excluded**, per CONTRACT-087 — the
      question is "is anyone waiting", and an event being worked is not waiting
- [ ] The orchestrator's own row carries a real count, not a zero or a null
- [ ] The count is computed in **one pass over the queue**, not one query per
      lane. A roster of thirty lanes must not cost thirty scans
- [ ] A lane with no pending events reports `0`, never null and never absent
- [ ] Test: events on two lanes produce two correct counts, and settling one
      moves only its own

## Technical Design

### Files to Create/Modify

- the roster assembly behind `GET /api/agents`
- `apps/server/src/queue/` — whatever already enumerates pending events, reused

### Key Implementation Details

The queue's pending set is already enumerated for `corpus queue status`. Group it
by lane once and index the roster off that, rather than filtering per row.

**Read the same source `laneVisibleTo` reads.** A count that disagrees with what
a claim would return is worse than no count: it would send AGENT-053 to launch a
listener for a lane with nothing on it, or leave a waiting lane unlaunched.

### Edge Cases

- A pending event stamped for a lane with no roster row (a thread whose resident
  was released): it is not on the roster, so it is not counted here. That work is
  the orchestrator's by SERVER-153, and its visibility is that issue's business.
- Counts under concurrent settlement: a count is a snapshot, and the contract
  does not promise otherwise. Say so rather than locking.

## Testing Strategy

Unit tests over the grouping, and a test that the count matches what a scoped
claim would actually return for that lane — the agreement that matters.

## E2E Verification Plan

Real server: designate two threads, post to one twice and the other once with no
listeners, read `GET /api/agents`, confirm 2 and 1. Start a listener on one,
let it settle, re-read, confirm 0.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-155]` prefix
