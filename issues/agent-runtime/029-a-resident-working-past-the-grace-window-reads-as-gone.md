# [AGENT-029] A resident working longer than the grace window reads as absent, and gets a second listener

## Domain

agent-runtime (may require server or contract work — see below)

## Status

todo

## Priority

P0

## Model

fable

## Dependencies

- Related: AGENT-025, AGENT-026, AGENT-027, SERVER-112, SHARED-047

## Spec References

- SPEC.md **§7** — *"A resident is **live** exactly while it holds a parked
  scoped `idle`"*
- SPEC.md **§7** — the lapse fallback and its grace window

## Summary

PR #48's review found the seam defect that AGENT-026 and AGENT-027 each closed
half of a different hole around. **This one arrives through neither.**

Presence is *only* `observePark`, whose single production call site is the idle
path. The converse loop holds no park while working: claim → work → settle →
check the roster → park. And converse is explicitly told to do long unparked
work — *"You await what you launch; you do not park on it."*

So a turn that takes longer than the 960 s grace window is **designed
behaviour**, and while it runs the lane reads `live: false`.

The reviewer's sequence:

> L1 claims an event at T and works it for 20 minutes. At T+16min the lane reads
> `live: false`. The orchestrator's pass reads the roster; its rule is
> unqualified — *"For every roster row that is not the orchestrator's and does
> not read `live`, launch a listener"* — and its two guards do not fire: no work
> was taken from that lane this pass (nothing new was pending), and this is not a
> relaunch. L2 starts. L2's own startup guard (*"Your row reads `live` → exit"*)
> also sees `live: false`, so it parks. L1 finishes and parks. **Two listeners on
> one conversation.**

That is the split-story failure both skills spend paragraphs preventing, with no
error anywhere — the third instance this phase of *two agents, one conversation,
everything behaving as written*.

## Why it cannot be fixed in the skill text alone

The roster **does** carry the distinguishing signal: a lapsed-but-working lane
has `summary: "working <title>"` from `workSummary`'s in-progress read, while a
dead one reads `idle — last active …`. But AGENT-027's own E2E log establishes
that `summary` **must not be parsed** — the contract promises only its length.

So there is currently **no sanctioned way** for the orchestrator to tell a busy
listener from a dead one, and it launches into both.

## Directions to weigh — this is a design decision, not a text fix

1. **A working resident stays present.** Make presence survive work — the
   listener re-parks between steps, or the server treats a lane holding an
   in-progress event it claimed as live. Note this collides with §7's flat
   sentence that presence is the parked request *and nothing else*, so it may
   need a signed rider.
2. **Publish the distinction the roster already computes** — a structured field
   saying this lane holds work, rather than prose the contract forbids parsing.
   Contract + server work, and probably the cleanest.
3. **Make the launch idempotent at the lane** rather than at the orchestrator's
   knowledge — if a second listener cannot cause harm, the race stops mattering.
   Consider whether AGENT-027's "not yours" rule already gets most of the way,
   and say why it does not get all the way.

Whichever is chosen, say why the other two were not.

## Acceptance Criteria

- [ ] The reviewer's sequence is reproduced first, with a real long-running turn
      or a shortened window — the reproduction is the evidence this is real
- [ ] One conversation ends with one listener, shown by a drill with two live
      processes
- [ ] Any contract or server change is filed as its own issue in its own domain
      rather than done here
- [ ] If the fix needs a SPEC rider, it is drafted for the user and **not
      applied** — this phase already edited SPEC.md once without sign-off
      (PR #48 finding 6) and that must not repeat

## Testing Strategy

Template assertions for the text. The real test is two live sessions and one
long turn.

## E2E Verification Log

_Filled by the implementing agent. Reproduce first._

## Completion Checklist (orchestrator)

- [ ] Committed with `[AGENT-029]` prefix
