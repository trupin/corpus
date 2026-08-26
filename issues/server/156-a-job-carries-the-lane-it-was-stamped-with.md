# [SERVER-156] A job carries the lane it was stamped with

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: CONTRACT-056
- Blocks: UI-176

## Spec References

- SPEC.md §7 — "The queue is partitioned into lanes", and its two carve-outs

## Summary

Implements CONTRACT-056's server half. `events.lane` is already stored
(SERVER-111); `Job` does not carry it, so a surface that wants to say *who is
waiting on this* re-derives it by walking the scope — and the walk is wrong for
exactly the two cases §7 carves out.

**This is a mirror, not a new fact.** The lane was stamped once at enqueue time
and never rewritten. Everything here does is carry it to the reader that already
has the row.

## Acceptance Criteria

- [ ] `Job` carries `lane`, read from `events.lane` and never recomputed
- [ ] A legacy event with no stamp reads as the orchestrator's, the same way the
      claim path reads it — one interpretation of a missing stamp, not two
- [ ] The projection mirrors it wherever it mirrors an event into a job, and a
      rebuild produces the same value as the live path
- [ ] Test: a `resident.designated` on a designated thread carries the
      **orchestrator's** lane, which is the case UI-109 saw go wrong
- [ ] Test: a message naming a `recipient` carries the recipient's lane, which is
      the case a client cannot derive at all
- [ ] **Falsified**: deriving the lane from the payload's thread instead turns
      both tests red

## Technical Design

### Files to Create/Modify

- the job projection and its row type
- the job response assembly

### Key Implementation Details

Read it off the same column `laneOf` reads. A second reading of "what lane is
this" is the shape of the bug this closes.

### Edge Cases

- An event with no `lane` on disk (written before lanes existed): the
  orchestrator's, matching `laneOf`.
- A job whose event has been settled and removed: unchanged by this issue.

## Testing Strategy

Unit tests over both carve-outs, plus a rebuild-equals-live check. Falsify by
re-deriving from the payload.

## E2E Verification Plan

Real server: designate a thread, read the resulting job, and confirm its lane is
the orchestrator's rather than the designated thread's.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-156]` prefix
