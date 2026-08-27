# [CONTRACT-093] `lane.waiting` is a core event type

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: SHARED-075
- Blocks: SERVER-161, AGENT-057

## Spec References

- SPEC.md §7 — **A lane that cannot be worked says so** (rider signed 2026-08-27)
- SPEC.md §7 — Core event types

## Summary

The rider signed 2026-08-27 adds a third announcement to the family
`resident.designated` and `resident.released` belong to: an event on the
**orchestrator's** lane saying that some other lane has work and nobody to do it.
This puts it on the wire.

## What must be true of the payload, and it is the whole design

**It carries nothing answerable.** The orchestrator's loop dispatches what it
claims, so an event that named a thread and a turn would be answered by the
orchestrator itself — which is exactly what the rider signed 2026-08-25 removed
the lapse fallback to prevent: *"answering in the resident's place is not a
slower version of the same answer — it is a different agent, with none of the
conversation, writing in its name."*

So the payload names **the lane** and nothing else. No turn timestamp, no
document id, no author, no text. A settling agent that wanted to answer it would
have nothing to answer with, which is the property that makes the mistake
impossible rather than merely forbidden.

The lane is a thread id, so a reader can open the conversation — that is a
person's affordance and the orchestrator's launch argument, not content.

## Acceptance Criteria

- [ ] `lane.waiting` joins `CORE_QUEUE_EVENT_TYPES`
- [ ] Its payload schema carries the lane and **nothing else**, and its docblock
      says why that is load-bearing rather than minimal
- [ ] The type's description in the generated document explains that it is not
      the work and never becomes it
- [ ] `openapi.json` regenerates cleanly
- [ ] `queue.ts`'s docblock stops calling §7's Core event types sentence
      incomplete for `resident.released` — §7 has named it since the rider signed
      2026-08-25, and the note has been stale since

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/queue.ts` — the type and its prose
- a payload schema beside the other event payloads
- `packages/contract/openapi.json` — regenerated

### Key Implementation Details

Follow `ResidentDesignatedPayloadSchema`'s shape: a named schema, exported, built
by the contract rather than assembled by the server, so the two producers of
orchestrator-lane announcements cannot drift.

**Ordering in the enum matters** only in that `openapi.test.ts` pins it. Put it
beside the other two announcements rather than at the end: the list reads as
families, and `agent.done` is last for a stated reason.

### Edge Cases

- The lane is always a thread id here — the orchestrator's own lane never
  announces to itself, and the server must not be able to express that

## Testing Strategy

Schema round-trip, the enum's published order, and a test that the payload
refuses a turn timestamp — the field whose presence would make the event
answerable.

## E2E Verification Plan

`npm run generate -w packages/contract`, then read the type out of the document.

## E2E Verification Log

_Filled by the implementer._

## Completion Checklist (domain agent)

- [ ] Tests pass
- [ ] `openapi.json` regenerated
- [ ] Lint and typecheck clean
