# [SHARED-074] May the reaper touch a resident lane's held work?

## Domain

shared

## Status

done — decided 2026-08-27: it stays lane-blind, and the reason it gives
is corrected.

## Priority

P1

## Model

fable

## Dependencies

- Depends on: —
- Related: AGENT-056 (the duplication this question sits under), SERVER-152 (the
  rider that answered the same question for *claiming*)

## Spec References

- SPEC.md §7 — lanes, and the rider signed 2026-08-25 removing the lapse fallback

## Summary

Raised by AGENT-056, which fixed the **symptom** by reordering the orchestrator's
loop and deliberately did not answer this.

`corpus queue reap-stale` is lane-blind by design. Its docblock argues the case:

> Staleness is staleness: a held event nobody can account for is stuck whichever
> agent claimed it, and scoping the reaper would leave a dead resident's work
> unrecoverable by the one agent still running.

That was written while the **fallback** existed — while the orchestrator could
claim a lapsed lane's work and therefore actually finish it. The rider signed
2026-08-25 removed that: a resident's work is claimable by nobody else, ever. So
what a reap of a resident lane now accomplishes is narrower than when the rule
was written — it returns the event to `pending/` on its own lane, where only that
lane's listener can take it.

## The question

**Should a reap of a resident lane require evidence the listener is gone, rather
than only that the event is old?**

The difficulty is that no such evidence exists today. Presence is holding a
parked `idle`, and a listener inside a long turn holds none — so "working
slowly" and "died mid-turn" are indistinguishable by every signal the server
has. Fifteen minutes is a guess about how long a turn may reasonably take, and a
turn longer than that is currently treated as a death.

Options, none costless:

1. **Leave it lane-blind.** AGENT-056's reordering already removes the duplicate,
   at one pass of delay. The reap still resets a live resident's attempt count
   and requeues an event it is mid-way through answering, which is invisible but
   not nothing.
2. **A heartbeat.** A working listener touches its held event periodically, and
   staleness becomes real evidence. It is the only option that actually
   distinguishes the two states, and it puts a new obligation on every resident.
3. **A longer window for resident lanes than for the orchestrator's.** Cheap, and
   still a guess — it moves the number rather than removing it.

## Acceptance Criteria

- [x] The question is answered — **declined**, with the reason, in the code
      rather than in §7 (see below)
- [x] `reapStale`'s docblock stops citing the fallback as its justification

## The decision

**The reaper stays lane-blind, and no §7 rider is drafted.** Recorded here and in
`reapStale`'s docblock, which is where the wrong reason had been living.

### Why not option 2 or 3

The question turns on evidence that does not exist and cannot be cheaply made to.
Presence is holding a parked `idle`; a resident inside a long turn holds none.
And a listener cannot signal life by touching what it holds, because
`QueueStore.lastTouched` returns the **older** of the file's mtime and the
event's `updated` — so a touch is invisible by construction.

- **A heartbeat** is the only option that would make staleness real evidence. It
  is also a new obligation on every resident and a new way to die: a listener
  that forgets to beat is declared dead while it is answering somebody. That is a
  worse failure than the one being fixed.
- **A longer window for resident lanes** replaces one guess with another.

### Why leaving it is defensible rather than merely cheaper

The premise the old reason rested on has inverted, and the inversion argues
*for* the current behaviour rather than against it. A reaped resident event
returns to **its own lane**, where since the rider signed 2026-08-25 only that
lane's listener can ever claim it. So a reap hands a resident's work to nobody.
What it does is make the work claimable again by whatever listener is launched
next, and clear the `working` flag that would otherwise report a dead lane as
busy for ever. Both are wanted.

### What it still costs, stated rather than waved past

A resident mid-turn has its held event returned under it, so a `complete` for
that event arrives for something no longer `in-progress`. Bounded, rare, and
untidy.

**The duplication that prompted this question is fixed elsewhere and properly.**
AGENT-056 has the orchestrator read the roster *before* reaping, so a busy lane
still reads `working` at the moment the launch decision is made. This issue was
raised to ask whether the reaper itself should change; the answer is that the
symptom belonged to the loop's ordering, and the reaper's own behaviour is
right for a reason it had stopped stating correctly.

## Testing Strategy

None — no behaviour changed. The reasoning is in the code, beside the code it
explains.

## E2E Verification Log

_N/A — a decision. Nothing shipped but a corrected justification._

## Completion Checklist (orchestrator)

- [x] Decided, under the v0.27.0 go-ahead that named this issue
