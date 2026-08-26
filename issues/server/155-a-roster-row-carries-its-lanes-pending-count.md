# [SERVER-155] A roster row carries its lane's pending count

## Domain

server

## Status

done

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

- [x] Every roster row carries `pending`: the count of **pending** events stamped
      for that lane
- [x] `in-progress` and `deferred` are **excluded**, per CONTRACT-087 — the
      question is "is anyone waiting", and an event being worked is not waiting
- [x] The orchestrator's own row carries a real count, not a zero or a null
- [x] The count is computed in **one pass over the queue**, not one query per
      lane. A roster of thirty lanes must not cost thirty scans
- [x] A lane with no pending events reports `0`, never null and never absent
- [x] Test: events on two lanes produce two correct counts, and settling one
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

Implemented by the orchestrator on opus, 2026-08-25.

### The count had to reach the invalidation, and that reversed SERVER-115

Filling the field was one grouped query. What the issue did not anticipate is
that **a count nobody announces is a count nobody reads.**

`rosterSignature` is what decides whether a write names `["agents"]`, and it
deliberately excluded anything that moves with the clock. `pending` qualifies —
it is derived from rows a write moves — so it went in. That made an **enqueue**
move the roster, which SERVER-115 had explicitly decided must not name it:

> A lane reports the work it is *holding*, and nobody is holding a `pending`
> event — so adding `["agents"]` to every queue frame would send every open
> client to refetch a response that cannot have moved.

That was right while a row reported only held work. It is now false, and the
reversal is the feature: since SPEC.md §7's rider removed the fallback, a
conversation whose listener is not running waits until one starts, and
`pending > 0 && !live` is the only thing that tells the orchestrator to start
it. A roster stale on an enqueue leaves that conversation waiting **indefinitely**
with nothing announcing that anything changed.

`queueTransitionKeys` now names the roster for `pending` as well as
`in-progress`, keeping its shape as a total over statuses rather than a
judgement per verb — the property SERVER-115 introduced it for.

### Six tests asserted the old rule, and each was rewritten with its reason

The measured scheme is why this was tractable. The watcher's own test flipped
without touching the watcher: it measures the signature, so an out-of-band file
drop is announced correctly with nobody remembering to add a key.

One is worth noting for its shape. A release now names the roster in **both** of
its two frames, and that is not a doubling to fix — the first says *this thread
no longer has a resident*, the second says *the orchestrator has one more thing
waiting*, which since the fallback is gone is the news that matters.

### The count agrees with the claim, deliberately

Unstamped legacy events fold into the orchestrator's count, because the claim
path reads a missing `lane` as the orchestrator's. A count that disagreed with
what a scoped claim returns would send the orchestrator to launch a listener for
an empty lane, or leave a waiting lane unlaunched.

### Checks

```
vitest run apps/server            205 files, 4674 tests passed   exit 0
eslint apps/server/src                          0 problems       exit 0
tsc --noEmit -p apps/server                                      exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[SERVER-155]` prefix
