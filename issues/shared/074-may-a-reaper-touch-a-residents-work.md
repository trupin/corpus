# [SHARED-074] May the reaper touch a resident lane's held work?

## Domain

shared

## Status

todo

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

- [ ] The question is answered in §7, or explicitly declined with the reason
- [ ] Whatever is decided, `reapStale`'s docblock stops citing the fallback as
      its justification — that fallback is gone

## Technical Design

_Depends on the answer._

## Testing Strategy

_Depends on the answer._

## E2E Verification Log

_N/A — a decision, not an implementation._

## Completion Checklist (orchestrator)

- [ ] Decided with the user
