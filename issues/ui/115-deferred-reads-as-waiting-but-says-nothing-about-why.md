# [UI-115] A deferred request reads as "waiting", which is honest but not the whole answer

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: UI-097 (which made `deferred` read as waiting in the first place)
- Related: UI-098 (the console's half of the same vocabulary)

## Spec References

- SPEC.md **§7** — `deferred` is "claimed work the agent parked because a person
  was editing the document", and it is neither in-progress nor terminal
- SPEC.md **§8** — the honest pending indicator

## Summary

`UI-097` split the pending indicator's one "working" claim into *working* and
*waiting*, and put `deferred` under **waiting**. That is more honest than what
was there — a deferred event is not being worked on — but it is not the whole
honest answer, and the gap is worth naming before it calcifies.

**A deferred request is not waiting to be picked up. It was picked up, looked
at, and put down on purpose** — because the agent saw a person editing the
document it needed. §7 is emphatic that this is a distinct state and not a
failure: *"Nothing refused it: the agent deferred because it saw, not because it
was blocked."*

So the surface currently tells a true thing that invites a false inference. Read
"still waiting to be picked up" against a deferred event and the reasonable
conclusion is that nothing is happening and nobody has looked — when in fact
something looked, and it is waiting on **you** to stop typing. That is the one
case where the person reading the indicator is the one who can clear it, and the
wording does not tell them so.

## What it should do

A third wording set for `deferred`, which says what it is parked on. The shape
of the sentence is roughly *"paused while you are editing <document>"* — the
detail being that it names the document, so a person with several open knows
which one to leave alone.

That needs `blockedOn` (or whatever the event carries that names the document it
parked for) to reach the surface. **Check first whether it already does**: if the
queue event's payload does not carry it, this issue is blocked on a server or
contract issue and should say so rather than inventing a heuristic. Do not infer
the document from "whichever one the person has open" — that is a guess that
will be wrong exactly when it matters, with two readers open.

## Acceptance Criteria

- [ ] `deferred` reads distinctly from both `pending` and `in-progress`, and the
      wording makes clear the request was seen rather than ignored
- [ ] It names the document it is parked on, or — if that is not available —
      this issue is blocked and names the issue that must supply it
- [ ] The time escalation does not shout: a deferral that lasts is not
      breakage, and the tiers must not read as one
- [ ] The row-level dot treats `deferred` consistently with the indicator; the
      two must not disagree about what state a row is in

## Technical Design

### Files to Create/Modify

- `apps/ui/src/thread/PendingIndicator.tsx` — the third wording set
- `apps/ui/src/thread/outstandingAgentRequest.ts` — surfacing `deferred`
  distinctly rather than folding it into `working: false`
- `packages/kit/src/row/useRowSignals.ts` — the row's matching signal

## Testing Strategy

Unit for the wording and the tier behaviour. An E2E is only worth it if the real
defer transition can be driven from the UI side; if it needs the server to park
an event, say so and test at the unit boundary rather than faking a state the
app cannot reach.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-115]` prefix
