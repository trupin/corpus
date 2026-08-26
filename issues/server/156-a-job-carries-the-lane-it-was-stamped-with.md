# [SERVER-156] A job carries the lane it was stamped with

## Domain

server

## Status

done

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

- [x] `Job` carries `lane`, read from `events.lane` and never recomputed
- [x] A legacy event with no stamp reads as the orchestrator's, the same way the
      claim path reads it — one interpretation of a missing stamp, not two
- [x] The projection mirrors it wherever it mirrors an event into a job, and a
      rebuild produces the same value as the live path
- [x] Test: a `resident.designated` on a designated thread carries the
      **orchestrator's** lane, which is the case UI-109 saw go wrong
- [x] Test: a message naming a `recipient` carries the recipient's lane, which is
      the case a client cannot derive at all
- [x] **Falsified**: deriving the lane from the payload's thread instead turns
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

Implemented by the orchestrator on opus, 2026-08-26.

### I wrote the fallback the schema exists to prevent, and a test found it

First attempt mirrored the column as `row.lane ?? ORCHESTRATOR_LANE`, reasoning
that an unstamped legacy event should read as the orchestrator's. It should — and
`events.lane` already says so:

```sql
-- NOT NULL because the orchestrator's lane is a lane like any other and has a
-- name: an event file with no stamp reads as the orchestrator's, and the
-- default writes that reading down rather than inventing a second spelling.
lane TEXT NOT NULL DEFAULT 'orchestrator'
```

**My `??` was the second spelling.** One more place that would have to be found
and changed if that reading ever moved. It surfaced because a test tried to
insert a null and hit the `NOT NULL` constraint — the column refusing to let the
duplication be reachable.

The mirror is `lane: row.lane` now, and the test inserts a row **without the
column at all** — the shape a pre-lanes event mirrors as — so what it proves is
that the default does the work and nothing downstream disagrees with it.

### The two carve-outs, each tested for its own reason

- A `resident.designated` carries the **orchestrator's** lane though its payload
  names the designated thread. A walk would answer the thread. This is the case
  UI-109 saw live.
- A summons carries the **recipient's** lane though its payload names another
  thread entirely. No walk could recover it, which is what makes the field a
  contract change rather than a client fix.

### Falsification

Hard-coding the lane:

```
× is the recipient's for a summons, which no walk could recover
  Tests  1 failed | 31 passed
```

### Checks

```
vitest run apps/server            205 files, 4691 tests passed   exit 0
eslint apps/server/src                        0 problems         exit 0
tsc --noEmit -p apps/server                                      exit 0
```


## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[SERVER-156]` prefix
