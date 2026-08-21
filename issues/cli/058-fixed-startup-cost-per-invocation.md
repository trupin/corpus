# [CLI-058] Every call pays ~210ms of startup, and the agent loop makes hundreds

## Domain
cli

## Status
todo

## Priority
P1

## Model
fable

## Dependencies
- Related: CLI-057 (batching, which reduces the count), CLI-055 (which reduces payload, not count)

## Spec References
- SPEC.md **§2** — the CLI is the agent's whole surface
- SPEC.md **§7** — the agent loop, which is made of CLI calls

## Summary

Reported from live use, 2026-08-21, measured: **~210ms fixed cost per call,
independent of payload.**

A skill making 20 calls spends **4.3 seconds** on overhead alone, and
`orchestrate` makes far more than 20.

This is filed as a question as much as a defect, because the answer may be
architectural rather than an optimisation.

## The three shapes, and none is obviously right

1. **Make startup cheaper.** Bundle analysis, lazy imports, deferring the client
   generation path. Bounded work with a bounded payoff — and 210ms is not
   obviously reducible to nothing, since some of it is Node itself.
2. **Batch.** CLI-057 does this for one verb. Generalised, it means a way to
   send several commands in one invocation. Cheap to build, but every verb needs
   to opt in and the agent's skills need teaching.
3. **A session mode.** A long-lived process the agent talks to, amortising
   startup across a whole loop. The largest payoff and the largest change: it
   introduces a stateful thing where today there is a stateless one, and §2's
   "nothing is global" and the workspace-resolution rule both have to be
   answered for it.

**Do not pick 3 by default because it is the biggest win.** The tool's
statelessness is a deliberate property and the server is already the stateful
half; a second stateful component wants a signed decision, not an
implementation.

## What this issue asks for first

**A measurement, before any building.** Break the 210ms down — Node boot, module
graph, config resolution, client construction, the HTTP round trip — so the
choice above is made against numbers rather than intuition. Report it, then
recommend, then stop and escalate rather than implementing option 3 unasked.

## Acceptance Criteria
- [ ] The 210ms is broken down by phase, measured, and reported
- [ ] A recommendation among the three shapes, with the rejected ones argued
- [ ] Anything in option 1 that is cheap and safe is done, and re-measured
- [ ] Options 2 and 3 are escalated with the numbers rather than built here

## Testing Strategy
A benchmark that can be re-run, checked in, so a later change cannot silently
undo the gain.

## E2E Verification Log
_[Agent fills — state the model]_
