# [SHARED-078] A designated thread whose `agent` is `none` enqueues nothing for a plain turn

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

## Spec References

- SPEC.md **§7** — a resident owns the conversation and its lane
- SPEC.md **§8** — agent participation is opt-in per comment

## Summary

Found during AGENT-068's E2E (2026-09-05), reported by the implementing agent
and reproduced in a real workspace: a **designated** thread whose `agent` field
is `none` enqueues nothing when the person posts a plain turn. Only an
`@agent` mention (or `--requests-agent` at create) reaches the resident's lane.
So a resident can sit parked — present, live on the roster — while its person
talks into the conversation and nobody is triggered to answer.

§8's opt-in rule was written for the ordinary agent, where silence is the
point. A designation is the person saying somebody owns this conversation —
whether that act implies participation on every turn is a §7/§8 interaction
the spec does not currently answer.

## What this issue asks

A decision, then the trio it implies:

1. Does designating a thread set (or imply) `agent: engaged`?
2. If yes: where — at designation time (server), or read-side (the lane's
   idle matches plain turns on designated threads)?
3. If no: the converse skill should say plainly that a parked resident answers
   only mentions, so the person's expectation is set by the UI/docs.

Not scoped for v0.33.0 — filed so the finding is not lost.
