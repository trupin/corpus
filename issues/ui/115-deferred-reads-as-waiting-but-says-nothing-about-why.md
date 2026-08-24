# [UI-115] A deferred request reads as "waiting", which is honest but not the whole answer

## Domain

ui

## Status

done

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

- [x] `deferred` reads distinctly from both `pending` and `in-progress`, and the
      wording makes clear the request was seen rather than ignored
- [x] It names the document it is parked on, or — if that is not available —
      this issue is blocked and names the issue that must supply it
- [x] The time escalation does not shout: a deferral that lasts is not
      breakage, and the tiers must not read as one
- [x] The row-level dot treats `deferred` consistently with the indicator; the
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

**Model: Opus 5 (1M context).** 2026-08-24.

### The blocking question, answered first

**Not blocked.** `Job` already carries `blockedOn` **and** `blockedOnTitle`
(`packages/contract/src/schemas/job.ts`, CONTRACT-021): `blockedOn` is non-null
exactly when `status` is `deferred`, and `blockedOnTitle` is the denormalised
title read at response time. No server or contract issue was needed, and nothing
is inferred from "whichever document the person has open".

### What changed

- `apps/ui/src/thread/outstandingAgentRequest.ts` — `PendingState` becomes three
  words (`working | deferred | waiting`) and moves here, where the queue is read;
  `OutstandingAgentRequest` gains `deferred: DeferredOn | null`, the **oldest**
  parked job's document, for the same reason the clock takes the oldest job.
  `pendingStateOf` states the precedence in one place.
- `apps/ui/src/thread/PendingIndicator.tsx` — `DEFERRED_TIERS`,
  `DEFERRED_TIERS_UNNAMED` and `deferredLabel`, at the same 45 s / 3 m / 15 m
  thresholds. `pendingLabel` routes `deferred` before it considers the lane.
- `packages/kit/src/row/useRowSignals.ts` — `deferredRowTitle`, and the same
  precedence for the board row's dot.

### The wording, and the three things it had to do

`paused while you are editing <document>` → `still paused while you are editing
<document>` → `still paused — it resumes when you finish editing <document>` →
`still paused for 22m — it resumes when you finish editing <document>`.

1. It says the request was **seen**. §7: *"Nothing refused it: the agent deferred
   because it saw, not because it was blocked."* No tier contains "waiting" or
   "picked up".
2. It **names the document**, off the job.
3. It **does not shout.** The escalation is in precision — the third tier adds
   what ends it, the fourth adds a duration — and never in volume. Asserted:
   no tier contains `NO_AGENT_CLAUSE` or `longer than usual`.

Where the wire names no document, a fourth set drops the clause rather than
printing an empty quotation, and the state is still `deferred` — falling back to
"waiting" there would be the false inference all over again.

**The lane is deliberately not named.** A deferral has already been claimed, so
which resident holds it is settled; what the reader needs is what it is parked on
and who can move it, and both of those are about the document. Asserted directly
(`prefers the deferral to the lane's own wording`).

### The dot, and why it did not become a third shape

The dot answers *is anything being worked*, which is a two-state question, so a
deferral keeps the **queued** dot on both surfaces. Its distinctness is in the
sentence, where it can be explained; a third shape would need a sentence to
explain it and the sentence is already there. Consistency is by construction:
`pendingStateOf` and `useAgentActivity` apply one precedence — working, then
deferred, then unclaimed — and each docblock names the other.

### Real browser (chromium, `CORPUS_UI_PORT=5373`)

`apps/ui/e2e/pending-claim.spec.ts` → *"a request the agent parked on somebody's
editing"*. Deferring is something the agent does through the CLI while somebody
holds an edit session, so the job is **seeded**; what the browser is for is that
the sentence and the dot come from two different modules and must agree — which
is the last acceptance criterion and is not a thing either module's unit test can
check. Observed:

- the board row: `.working-dot` × 0, and the `.queued-dot`'s `title` is
  `Paused while The reimbursement policy is being edited`;
- the card: `data-pending-state="deferred"`, text `paused while you are editing
  The reimbursement policy`, no `picked up`, `data-working-since` unchanged (the
  clock is the wait's — being parked is not a fresh request), `.queued-dot` × 1
  and `.working-dot` × 0.

### Falsification

`ThreadCard.test.tsx`'s existing deferred case failed with
`expected 'deferred' to be 'waiting'` before its assertion was updated — the
change is observable at the seam the old behaviour was pinned at.

### Tests

- `apps/ui/src/thread/PendingIndicator.test.tsx` — the ladder, the tone, the
  unnamed fallback, the lane preference, and the rendered row on fake timers
  crossing a tier.
- `apps/ui/src/thread/outstandingAgentRequest.test.ts` — the state machine:
  claimed outranks parked, parked outranks unclaimed, oldest deferral wins, and
  an off-contract deferral with no document is still a deferral.
- `packages/kit/src/row/Row.test.tsx` — the row's dot and title, plus
  `deferredRowTitle` on its own.
- `vitest run apps/ui/src/thread packages/kit/src/row` — 627 green.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[UI-115]` prefix
