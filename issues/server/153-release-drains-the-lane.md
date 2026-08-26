# [SERVER-153] Release drains the lane, and a draining thread refuses designation

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SERVER-152, CONTRACT-089
- Blocks: —

## Spec References

- SPEC.md §7 — rider C signed 2026-08-25: _"Release is the one thing that returns
  work, and a person does it on purpose… A thread whose release is still draining
  refuses a new designation."_

## Summary

SERVER-152 removes every automatic path by which the orchestrator sees another
lane's work. This issue builds the one deliberate path back: **release**.

When a person releases a resident, or a thread is resolved and releases its own,
that lane's pending events become the orchestrator's. They are no longer a
resident's messages, because the person removed the resident.

And it closes the seam that opens: designating again mid-drain would hand the
same turns to two agents.

## Acceptance Criteria

- [ ] On release — by a person, by resolution, or by a new designation replacing
      one — that lane's **pending** events become claimable by the orchestrator
- [ ] **In-progress and deferred events are not touched.** A deferred event
      returns to pending when its edit session ends (§7), and it drains then
- [ ] The mechanism does **not** rewrite the events' lane stamps. §7 is explicit:
      _"The stamp is made once and never rewritten."_ Whatever makes them visible
      is computed, as the fallback was
- [ ] `POST /api/threads/:id/resident` returns CONTRACT-089's 409 while a drain
      is outstanding, carrying the count
- [ ] The refusal clears **by itself** as the orchestrator settles the events.
      Nothing has to be reset and nothing expires on a timer
- [ ] A release with **nothing pending** drains nothing and refuses nothing —
      the common case costs no new state
- [ ] Test: release with pending work, assert the orchestrator can claim it,
      assert designation is refused, settle the work, assert designation succeeds
- [ ] **Falsified**: with the drain removed, the "orchestrator can claim it" test
      goes red rather than the suite staying green

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/lanes.ts` — the released-lane visibility, beside the
  now-symmetric `laneVisibleTo`
- The resident release path, and the resolution path that releases with a thread
- The designate route's guard

### Key Implementation Details

**Compute, never rewrite.** The released set is derivable — a lane whose thread
has no current resident, holding pending events. That is a predicate over state
already recorded, and it needs no new column and no migration. Prefer it to a
stored "draining" flag, which would be a second source of truth for a fact the
data already carries.

**The refusal and the drain read the same predicate.** Two implementations of
"is this lane draining" would drift, and a designate that is refused while the
orchestrator sees nothing (or the reverse) is the worst possible pair.

### Edge Cases

- **A new designation replacing an existing one** is a release per §7, so it
  drains — and then the refusal would block the very designation that caused it.
  Decide this explicitly and write down which way: the sequence must not
  deadlock.
- A thread resolved and reopened: §8 says reopening does not restore a resident,
  so the lane stays released and the drain stands.

## Testing Strategy

As above, plus the replace-a-designation sequence, which is the one that can
deadlock.

## E2E Verification Plan

Real server: designate, post two turns with no listener, release, claim as the
orchestrator, attempt a re-designation and read the 409 with its count, settle
both events, designate again successfully. Log every step's output.

## E2E Verification Log

<!-- filled by the implementing agent -->

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-153]` prefix
