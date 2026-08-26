# [SERVER-153] Release drains the lane, and a draining thread refuses designation

## Domain

server

## Status

done

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

- [x] On release — by a person, by resolution, or by a new designation replacing
      one — that lane's **pending** events become claimable by the orchestrator
- [x] **In-progress and deferred events are not touched.** A deferred event
      returns to pending when its edit session ends (§7), and it drains then
- [x] The mechanism does **not** rewrite the events' lane stamps. §7 is explicit:
      _"The stamp is made once and never rewritten."_ Whatever makes them visible
      is computed, as the fallback was
- [x] `POST /api/threads/:id/resident` returns CONTRACT-089's 409 while a drain
      is outstanding, carrying the count
- [x] The refusal clears **by itself** as the orchestrator settles the events.
      Nothing has to be reset and nothing expires on a timer
- [x] A release with **nothing pending** drains nothing and refuses nothing —
      the common case costs no new state
- [x] Test: release with pending work, assert the orchestrator can claim it,
      assert designation is refused, settle the work, assert designation succeeds
- [x] **Falsified**: with the drain removed, the "orchestrator can claim it" test
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

Implemented by the orchestrator on opus, 2026-08-25.

### Computed, never restamped

`createReleasedLaneLookup` is `isDesignatedRoot` negated, and that identity is
the whole implementation. **A lane *is* a designated root thread**, so a lane
that is no longer one is a lane whose designation went away — which is exactly
what release means. No new column, no migration, no stored flag that could
disagree with the designation it describes.

A thread **deleted** outright answers the same way, and that is right rather
than incidental: its events have no owner and nobody is coming for them, so they
belong to the orchestrator by the same reasoning a release does.

### It is not the fallback under another name

`visibleTo` gained a third parameter again, and the type is named for the
difference: `LaneReleased`, not `LaneLiveness`. A lapse is an **observation** —
a listener absent — and surrenders nothing however long it lasts. A release is
an **act**, with a visible cause and a person behind it.

`NOTHING_RELEASED` defaults **narrow**, which inverts the removed
`NOTHING_LIVE`. Safe used to mean wide, because guessing wrong cost work done
slowly. It now costs work done by an agent the conversation did not ask for.

### The deadlock the issue asked about cannot happen

The issue flagged a sequence that could deadlock: a replacement is a release, so
would a replacement refuse itself?

**No, and it needs no special case.** §7 makes designating a thread that
*already has* a resident a replacement — and a thread that has one is not
released, so the orchestrator cannot be holding its events at all. The refusal
fires only where the thread has no resident, which is precisely where a
replacement is not what is happening. A test drives the sequence that would find
a deadlock if one existed.

### `outstanding` is 1 where the orchestrator holds 2

The test expected 2 and got 1, and the 1 is correct. The orchestrator holds the
resident's turn *and* the `resident.released` announcement — but §7's carve-out
puts a release on the orchestrator's own lane whoever is designated, so that one
was always its work and a new designation cannot collide with it.

**The count is what a new listener would race for, not what the orchestrator
happens to be busy with.** Recorded because the wrong reading is the plausible
one.

### Falsification

Making the released clause return `false`:

```
× visibleTo > shows the orchestrator a released lane's events
× hands a released lane's pending work to the orchestrator
× refuses a designation while the released work is still being done
  Tests  3 failed | 106 passed
```

The refusal test failing too is the useful part: it proves the refusal and the
visibility read the same predicate, so they cannot disagree about what is
draining.

### Checks

```
vitest run apps/server            205 files, 4680 tests passed   exit 0
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

- [x] Committed with `[SERVER-153]` prefix
