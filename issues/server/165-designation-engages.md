# [SERVER-165] Designating a thread engages it

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-078 (the decision — made 2026-09-06), the §7/§8 rider
  below being signed
- Blocks: AGENT-070

## Spec References

- SPEC.md **§7** — designation; **§8** — participation is opt-in per comment

## Summary

SHARED-078's decision, chosen by the user 2026-09-06: **designation engages.**
Designating a thread sets `agent: engaged` on it, server-side, in the same
write as the designation — so every plain turn thereafter enqueues on the
resident's lane. Release and resolve return the thread to the ordinary opt-in
state. No contract change: `agent` is an existing field and designation is an
existing route.

## The rider, drafted for signature at the next release proposal

To follow §8's opt-in rule (and be cross-referenced from §7's designation
text):

> **Designating a conversation engages it.** §8's opt-in rule is about the
> ordinary agent, where silence is the point. A designation is the person
> saying somebody owns this conversation, and handing it over is the opt-in:
> the server sets the thread engaged in the same act that designates it, so a
> plain message to a designated conversation reaches its resident without a
> mention. Releasing the resident — directly, or by resolving the thread —
> returns the conversation to the ordinary rule. A person who wants a silent
> owner releases it, which is the cost this trade accepts and states.
> _(Rider signed — date to be filled at signature.)_

## Acceptance Criteria

- [ ] The rider above (or the user's revision) is signed and applied before
      the behaviour lands — never after
- [ ] Designating (any surface: Ask, thread control, re-designation) sets
      `agent: engaged` in the same server write and same commit
- [ ] Release sets the thread back to its pre-designation participation;
      resolve keeps its existing release cascade and does the same
- [ ] A plain user turn on a designated thread enqueues on the resident's
      lane — verified E2E with a real listener answering an unmentioned message
- [ ] `resident.designated` / `resident.released` payloads unchanged (the
      lane semantics carry it; nothing new travels)
- [ ] Rehearsal scenario 10's seeding no longer needs the `@agent` workaround
      its E2E logs record — update it to a plain follow-up and note the change

## E2E Verification Log

_Implementing agent fills; state the model._
