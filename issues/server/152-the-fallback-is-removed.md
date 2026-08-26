# [SERVER-152] The fallback is removed — every claim sees its own lane and no other

## Domain

server

## Status

done

## Priority

P0

## Model

fable

## Dependencies

- Depends on: SHARED-072
- Blocks: SERVER-153, AGENT-053, AGENT-054

## Spec References

- SPEC.md §7 — rider C signed 2026-08-25, which **replaces** the lapse fallback:
  _"A lane's work is done by that lane's agent, and by nobody else… There is no
  fallback and no timer: an unscoped claim never sees another lane's events,
  whether that lane is live or not."_

## Summary

**This is the load-bearing issue of the release, and the one that proves the
livelock is fixed.**

`laneVisibleTo` in `apps/server/src/queue/lanes.ts` has one asymmetric clause:
_"The orchestrator's claim sees its own lane, plus every lane that is not
live."_ Rider C makes it symmetric. Every claim, scoped or unscoped, sees its own
lane and no other.

**The livelock is a consequence of that clause, and it dies with it.** The
orchestrate skill forbids launching a listener in the same pass it takes that
lane's work, because events claimed under the fallback sit in `in-progress/`
still stamped for that lane, and a listener launched then reads them as work it
has no memory of claiming. A conversation somebody keeps using never has a clear
pass, so its listener never launches. The skill's own text names the cause: _"it
is the one collision **the fallback** can actually produce."_ With no fallback
there is nothing in flight to collide with, and the deferral rule has nothing
left to guard.

## Acceptance Criteria

- [x] `laneVisibleTo` is exact equality for every claim. No liveness argument,
      no orchestrator special case
- [x] **Liveness leaves the claim path entirely.** `LaneLiveness` survives only
      where a roster row's `live` is computed. Every parameter, every injection
      point and every default that existed to feed the claim predicate is
      deleted rather than left unused
- [x] `NOTHING_LIVE` and its rationale go with it. Its comment argues the
      **opposite** of rider C — _"With nothing live, every thread lane counts as
      lapsed and its pending events are visible to the orchestrator's unscoped
      claim"_ — so leaving it is leaving a signed decision contradicted in the
      code
- [x] `held.ts`'s fallback note (~line 42) is repaired, not deleted blind: read
      what it was compensating for and decide whether the compensation is still
      needed
- [x] **The reproduction is written before the fix and watched to fail.** A test
      that a pending event on an absent lane is **invisible** to an unscoped
      claim. It must be red on today's code
- [x] **And its converse, in the same test file.** The identical fixture is
      claimable by a claim scoped to that lane. "Nothing was returned" passes
      when the whole queue is broken, so the absence assertion is worthless
      alone
- [x] The grace window's remaining job is stated in code where it is computed:
      it decides what `live` says, and routes nothing

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/lanes.ts` — `laneVisibleTo`, `LaneLiveness`,
  `NOTHING_LIVE`
- `apps/server/src/queue/liveness.ts` — the fallback predicate at ~line 135, and
  the comments at ~21 and ~144 that describe the fallback as the reason
- `apps/server/src/queue/held.ts` — the note at ~line 42
- Every caller that threads a `LaneLiveness` into a claim

### Key Implementation Details

**Sweep the callers before changing the predicate.** The signature change is what
finds them, so make it first and let the compiler enumerate the work rather than
grepping.

**Do not soften rider C into a flag.** There is no configuration for this, no
opt-in, and no "fallback after a long enough absence". The rider is absolute and
its own text says the alternative _"is available at every moment and looks like
helping"_ — a flag is exactly that temptation, preserved.

### Edge Cases

- **A server with no liveness tracker** used to be the safe case and is now the
  ordinary one, because liveness no longer affects claims at all. Say so where
  `NOTHING_LIVE` used to argue the opposite.
- Events stamped for a lane whose thread was deleted: out of scope here, and if
  it has no owner today it has none after. Do not fix it silently — file it.

## Testing Strategy

The reproduction above is the test that matters, and it is falsifiable by
construction: revert the predicate and the absence assertion goes green while the
converse stays green, which is exactly the false negative to guard against.

Beyond it: a scoped claim still sees everything on its own lane whether that lane
reads live or not, and the summons path (a recipient-stamped event) still reaches
its recipient.

## E2E Verification Plan

Against a real server and a real workspace, with **no listener running**: post a
turn to a thread with a resident, run an unscoped `corpus queue claim-all`, and
confirm it returns nothing. Then park a scoped listener and confirm the same
event is claimed. Log both.

## E2E Verification Log

Implemented by the orchestrator on opus, 2026-08-25.

### The change is four lines. Everything else is the sweep.

```ts
export function visibleTo(scope: Lane, lane: Lane): boolean {
  return lane === scope;
}
```

The `isLive` parameter is gone, which is the guarantee: nothing can thread
liveness back into a claim without changing the signature.

### What went with it

- **`NOTHING_LIVE`**, whose comment argued the opposite of the rider in as many
  words — *"With nothing live, every thread lane counts as lapsed and its
  pending events are visible to the orchestrator's unscoped claim."* Leaving it
  would have left a signed decision contradicted in the code.
- **`QueueService.attachLaneLiveness`** and the `laneIsLive` field. The claim
  path was its only consumer.
- **The whole `onLapsed` hook** — the tracker's option, `app.ts`'s wiring and
  `notifyLaneLapsed`. It existed to wake a parked orchestrator the instant a
  lane's work fell to it, and no work falls to it now. A lapse is a change to
  what a roster row says, which `onPresenceChanged` already announced.

`attachLaneTracker` survives and still feeds the park observation and the status
aggregate — both of which a person reads.

### Falsification

Restoring the widening clause:

```
× visibleTo > hides another lane's events from the orchestrator, absent listener or not
× visibleTo > answers from the two lanes alone, whatever a listener is doing
× lanes > never shows the orchestrator another lane's events
× lanes > leaves an absent lane's work alone, however long nobody listens
× lanes > hands that identical event to the resident the moment it claims
× lanes > scopes the held report the way it scopes the claim
× lanes > parking > ends a scoped park on its own lane…
× lanes > parking > reports availability per lane…
× lanes > the presence tracker > feeds the roster and never the claim…
× lanes > the presence tracker > wakes nobody when a lane's listener goes away…
```

Ten, across the predicate, the service, the parking and the tracker.

### The converse is in every one of them

*"Nothing was returned"* is also what a wholly broken queue produces. So each
absence assertion has a partner proving the same fixture is claimable by the
lane that owns it — including the HTTP-level one in `roster.test.ts`, which ends
by reading the roster and asserting `live: false` with `pending: 1`: the lapse is
not invisible, it is visible where it belongs.

### Five tests asserted the old doctrine and were rewritten, not deleted

Each kept whatever it still guarded. The clearest is
`liveness.test.ts` — its lapse tests still matter, because the grace window still
decides what `live` says. What changed is the cost of getting it wrong: a
flickering verdict used to mean a conversation answered by the wrong agent, and
now means a blinking roster and a duplicate listener. That is written where the
window is defined.

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

- [x] Committed with `[SERVER-152]` prefix
