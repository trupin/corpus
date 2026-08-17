# [CONTRACT-056] `Job` carries no lane, so a surface showing "who is waiting on this" has to guess

## Domain

contract (then server, then ui)

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-109 (which found it and worked around it in display only),
  SERVER-111 (the lane stamp), CONTRACT-051

## Spec References

- SPEC.md **§7** — *"Two kinds of event do not take the lane of the scope they
  fall in"*: a message that named a recipient takes that recipient's lane, and a
  `resident.designated` takes the orchestrator's lane whoever is designated

## Summary

`SERVER-111` stamps every event with its lane, and the projection mirrors
events into jobs — but **`Job` (`packages/contract/src/schemas/job.ts`) carries
no lane**. `UI-109`'s issue assumed the mirror had put one there. It had not.

So a surface that wants to say *who is waiting on this* has to re-derive the
lane by walking the scope, and **the walk is wrong for exactly the two cases §7
carves out**:

- a `resident.designated` event, which takes the **orchestrator's** lane
  whoever is designated — because a resident does not announce itself to itself
- a message that **named a recipient**, which takes that recipient's lane

`UI-109` saw the first one live: for the seconds after designating a thread, the
card reads *"waiting for researcher"* about an event **the orchestrator holds**.

**This is display only and never routing** — the server stamps the lane and
routes on it, and no client decision depends on the walk. So it is a wrong
sentence, not a misrouted event, which is why it is P1 rather than P0 and why it
was documented at the head of `PendingIndicator.tsx` rather than worked around
with a special case.

## Why the fix is a contract change rather than a UI one

The client cannot compute the answer. The two carve-outs are facts about how the
event was *enqueued* — which recipient it named, and what kind of event it is —
and the second is not recoverable from the scope at all. Re-deriving a value the
server already holds is the shape of the whole class of bugs this release spent
its time on: `SERVER-114`'s invalidation, `CONTRACT-052`'s descriptions, and
`SHARED-044`'s two routes into one scope are all one fact stated twice and
allowed to drift.

## Acceptance Criteria

- [ ] `Job` carries its event's lane, as stamped — not a derivation
- [ ] The projection mirrors it (`SERVER-111` already stores `events.lane`, so
      this is a mirror, not a new fact)
- [ ] `UI-109`'s scope-walk fallback in `PendingIndicator.tsx` is removed, and
      the docblock explaining why it was there goes with it
- [ ] A test covers **both** carve-outs, since they are exactly what the walk
      gets wrong: a `resident.designated` reads as the orchestrator's, and a
      recipient-named message reads as the recipient's
- [ ] `openapi.json` regenerated and swept structurally, per CONTRACT-052's
      discipline

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/job.ts`
- `apps/server` — the projection's job mirror
- `apps/ui/src/thread/PendingIndicator.tsx` — remove the fallback

### Notes

Three domains, so this is likely three issues under one dependency chain rather
than one. Split it at the seams when it is scheduled.

## Testing Strategy

Contract: schema and generation. Server: the mirror, with both carve-outs.
UI: the pending row reads the field rather than walking.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-056]` prefix
