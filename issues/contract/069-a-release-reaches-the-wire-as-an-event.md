# [CONTRACT-069] A release reaches the wire as an event

## Domain

contract

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: SERVER-128
- Related: CONTRACT-067, AGENT-039

## Spec References

- SPEC.md **§7** — `resident.designated` as an enqueued event; designation, release, the lapse fallback
- SPEC.md **§9.3** — contract-first: the OpenAPI document is generated

## Summary

SERVER-128 makes a release observable. The observation travels as a queue event, and the queue's core event vocabulary is the contract's (`CORE_QUEUE_EVENT_TYPES`, `packages/contract/src/schemas/queue.ts`). This issue is the wire half: the event type, its payload shape, and the docblock that says why it lands where it lands.

**Decided by the orchestrator, 2026-08-19** (SERVER-128 decision 1 and 3):

- The type is **`resident.released`**. It lands on the **orchestrator's** lane, like `resident.designated` and for the same reason — a released resident does not announce its own end to itself, and the orchestrator is what has to learn that a lane returned to it.
- The payload is `{ threadId, resident, reason }`. `resident` is the `Resident` that was released (name and docId, so the orchestrator can log who left). `reason` is an enum of **three** values: `"released"` (a person released it), `"resolved"` (resolution released it, §7), `"replaced"` (a new designation displaced it — §7's one lane with two occupants). A lapse is **not** a release and never produces this event (§7's fallback is unchanged).

## Acceptance Criteria

- [ ] `resident.released` is in `CORE_QUEUE_EVENT_TYPES`, placed beside `resident.designated`, with the docblock above extended to say why it is core and where it lands
- [ ] A payload schema exists beside the designated payload's, with `reason` as the enum above and each value's meaning in its description
- [ ] The queue-event docs that enumerate core payloads name the new one
- [ ] `openapi.json` and `schema.generated.ts` regenerated, never hand-edited, and `openapi.test.ts` pins the type appears in the generated enum
- [ ] No event storm argument lives here — that is SERVER-128's — but the description says one release produces exactly one event

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/queue.ts` — type enum, docblock
- `packages/contract/src/schemas/lane.ts` or wherever the designated payload lives — the released payload
- `packages/contract/src/openapi.test.ts`, regenerated artifacts

### Key Implementation Details

Read how `resident.designated`'s payload is declared and described, and mirror it. One wording for the lane rule, shared with the designated docblock rather than restated.

## Testing Strategy

Schema test for the payload, and the openapi pin. Falsify by removing the enum member and running the pin alone.

## E2E Verification Plan

### Verification Steps

1. `npm run build -w packages/contract`, regenerate, `git diff` shows only generated changes beside the source
2. `grep resident.released packages/contract/openapi.json` finds it

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-069]` prefix
