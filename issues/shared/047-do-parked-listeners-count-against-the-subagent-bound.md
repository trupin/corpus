# [SHARED-047] §7 does not say whether parked listeners count against the concurrency bound

## Domain

shared (SPEC amendment — requires user sign-off)

## Status

todo

## Priority

P2

## Model

fable

## Dependencies

- Depends on: —
- Related: SHARED-043 (the rider that introduced residents), AGENT-026

## Spec References

- SPEC.md **§7** — the orchestrator skill's concurrency bound
- SPEC.md **§7** — *"Presence is the parked request, and nothing else"*

## Summary

The orchestrator skill bounds how many subagents run at once. `SHARED-043`'s
resident rider introduced a second kind of long-lived process — a listener
parked on a scoped `idle` — and **says nothing about whether those count against
that bound.**

`AGENT-026` had to decide in order to write the skill at all, and took the only
workable reading: **parked listeners are excluded.** Its reasoning is in the
skill rather than hidden, and it is sound — a parked listener is consuming
nothing; §7 defines presence as *the parked request and nothing else*, and a
bound that counted sleeping processes would let a handful of quiet conversations
starve the orchestrator of its ability to do any work at all.

But that is an agent's reading of an unsigned gap, not a signed rule, and it
governs how much the machine is allowed to run.

## What the amendment must decide

- [ ] Whether a parked listener counts against the bound (almost certainly not,
      per the reasoning above — but it should be signed rather than inferred)
- [ ] Whether there is a **separate** bound on listeners. A resident per
      conversation is unbounded by design, and a workspace with fifty designated
      threads would try to hold fifty live processes. Nothing currently says
      otherwise, and that is a more interesting question than the first one
- [ ] What happens when that bound, if any, is reached — a refusal, a queue, or
      lanes simply lapsing to the orchestrator, which is already the defined
      behaviour for an absent resident and may be the right answer for free

## Signed 2026-08-24 — parked listeners do not count

§7's parallelism rule now says it outright: **a parked listener does not count
against the subagent bound.** The bound counts work in flight, never attention
held.

This ratifies the reading AGENT-026 had to take to write the skill at all. The
spec was silent, the decision was recorded in the skill rather than hidden, and
it now lives in the spec rather than in an implementation's prose.

## Acceptance Criteria

- [ ] Drafted amendment text quoted to the user **verbatim** and signed before
      anything is applied
- [ ] `assets/workspace/claude/skills/orchestrate/SKILL.md` cites the signed
      text rather than its own reasoning

## Testing Strategy

Not applicable — spec text.

## E2E Verification Log

_Not applicable until the amendment is signed._

## Completion Checklist (orchestrator)

- [ ] User sign-off on the amendment text
- [ ] Committed with `[SHARED-047]` prefix
