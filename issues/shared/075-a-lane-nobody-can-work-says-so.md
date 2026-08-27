# [SHARED-075] A lane nobody can work announces itself to the orchestrator

## Domain

shared

## Status

done — drafted and **signed 2026-08-27**, applied to §7 the same day.

## Priority

P0

## Model

fable

## Dependencies

- Depends on: —
- Related: SERVER-160 (the same defect at the creation door), SERVER-152 (the
  removal that makes it total), AGENT-053 (the launch rule this feeds)

## Spec References

- SPEC.md §7 — lanes, the `resident.designated` carve-out, and "Core event types"
- SPEC.md §7, rider A (signed 2026-08-25) — *"a listener is started when its lane
  has something pending and none is running"*

## Summary

**User instruction, 2026-08-27:**

> "When restarting the orchestrator agent, it does not receive a message when a
> listener receives a message, which means it's not aware that a listener agent
> might need to be spawned. So what I recommend you do is always send the
> message to both. One to the orchestrator (not for the orchestrator to tackle,
> but for the orchestrator to make sure someone can work on it), another to the
> listener agent."

This is the half of SERVER-160 that release left open, and the issue's own notes
predicted it: *"A message sent to an existing conversation whose agent has
stopped still waits for the orchestrator's next pass rather than announcing
itself."* v0.26.0 fixed the door where a conversation is **created**. Every later
message through that door is still silent.

## Why it is silent

A message to a designated conversation is stamped with **that conversation's**
lane. Since the rider signed 2026-08-25, `visibleTo` is exact equality, so the
orchestrator cannot see it — and `wake` reaches only lanes an arrival is visible
to, so its parked `queue idle` is not ended either. The orchestrator learns the
lane is waiting only when its own park expires and it re-reads the roster, which
is up to a full window away.

**Restarting the orchestrator makes it worse, which is how the user hit it.**
Killing the agent session kills the listeners with it, so every designated lane
loses its listener at once, while every one of their conversations keeps
accepting messages that reach nobody.

## The rider this needs

APPEND to §7's lane rules:

> **A lane that cannot be worked says so.** When an event is enqueued on a lane
> whose listener is not present, a second event — `lane.waiting` — is enqueued on
> the **orchestrator's** lane naming that lane. It is not the work and never
> becomes the work: it carries no turn, no document and no instruction to answer
> anything, and the orchestrator settles it by making sure a listener is running
> for the lane it names. The conversation's own event stays where it was
> stamped, claimable by its listener alone. This is the third member of the
> family `resident.designated` and `resident.released` belong to — an
> announcement the orchestrator must hear because it is what launches and
> relaunches listeners — and it exists because the other two only fire when a
> designation changes, while a conversation goes unanswered on the messages in
> between.

And to §7's **Core event types**, which the same rider should bring current:
`resident.released` and `lane.waiting`, neither of which the sentence names
today (`packages/contract/src/routes/inventory.ts` has been carrying
`resident.released` as a pending amendment).

## The one place this draft narrows the instruction, and why it is a question

The user said **always** send to both. This draft says *when the listener is not
present*.

- **For the reported failure they are the same thing.** A restarted orchestrator
  has no listeners running, so every lane is absent and every message announces.
- **They differ on a healthy conversation.** With a listener parked and working
  its lane, "always" enqueues a second event per message that the orchestrator
  claims, reads, and discards — on a busy workspace, one extra claim per message
  per conversation, in a loop whose whole design is to cost nothing while idle.

The draft's rule is the cheaper reading of the same intent — *make sure someone
can work on it* is already true when someone is. **If the user wants it
unconditional, say so at signing and the condition comes out**: the mechanism is
identical and only the `if` differs.

## What must not be built, and this is the load-bearing part

**Not a copy of the message on the orchestrator's lane.** The orchestrator's
loop dispatches what it claims. Handed a second `comment.created` it would
answer the conversation itself — which is exactly what the rider signed
2026-08-25 removed the fallback to prevent: *"answering in the resident's place
is not a slower version of the same answer — it is a different agent, with none
of the conversation, writing in its name."*

So the notice must be a **distinct type carrying no answerable content**, and the
orchestrate skill must settle it by launching rather than by replying. A shared
type with a flag would put one bad dispatch one misread field away.

## Acceptance Criteria

- [x] The rider above is signed and applied to §7, including the Core event
      types sentence brought current
- [x] The condition (always, or only when absent) is settled at signing

## Technical Design

The chain this implies, filed separately and none of it started:

- **CONTRACT-093** — `lane.waiting` joins `CORE_QUEUE_EVENT_TYPES`, with a
  payload naming the lane and nothing else
- **SERVER-161** — `enqueue` writes the notice on the orchestrator's lane
- **AGENT-057** — the orchestrate skill settles a `lane.waiting` by launching,
  never by dispatching, and says why the two must not be confused

## How the condition was settled

The go-ahead read *"SHARED-075 signed as drafted [or: signed with \"always\"
instead of \"when absent\"]"* — the bracket being the alternative this issue
offered, left unexercised. **Taken as signed as drafted**: absence is the
condition.

Two things make that the safe reading rather than a guess. The primary clause
stands on its own and the bracket is visibly the offer, not a choice; and the two
readings **coincide in the case that prompted the report** — a restarted
orchestrator has no listeners running, so every lane announces either way.

The implementation puts the condition in **one named predicate** so the other
reading is a one-line change and a test, never a redesign. §7's rider states the
condition and records that the instruction asked for it unconditionally, so the
next reader finds the question rather than only the answer.

## Testing Strategy

The chain's, not this issue's — this is spec text.

## E2E Verification Log

_N/A — spec text._

## Completion Checklist (orchestrator)

- [x] Read the drafted rider aloud to the user, verbatim
- [x] Signed
- [x] Applied to SPEC.md
