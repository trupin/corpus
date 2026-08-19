# [CONTRACT-069] A release reaches the wire as an event

## Domain

contract

## Status

done

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

- [x] `resident.released` is in `CORE_QUEUE_EVENT_TYPES`, placed beside `resident.designated`, with the docblock above extended to say why it is core and where it lands
- [x] A payload schema exists beside the designated payload's, with `reason` as the enum above and each value's meaning in its description
- [x] The queue-event docs that enumerate core payloads name the new one
- [x] `openapi.json` and `schema.generated.ts` regenerated, never hand-edited, and `openapi.test.ts` pins the type appears in the generated enum
- [x] No event storm argument lives here — that is SERVER-128's — but the description says one release produces exactly one event

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

**Implemented on: fable** (CONTRACT-069 recommended opus; run on fable as part of a three-issue batch).

**What changed** (all under `packages/contract/`):

- `src/schemas/queue.ts` — `"resident.released"` added to `CORE_QUEUE_EVENT_TYPES` directly after `"resident.designated"`; the enum docblock extended with why it is core and where it lands (the orchestrator's lane, same carve-out, a lapse is not a release); `QueueEvent.payload`'s description now enumerates the core payloads including `resident.designated` `{threadId, resident}` and `resident.released` `{threadId, resident, reason}` and states one release → exactly one event, a lapse → none. The docblock records that §7's "Core event types" sentence does not yet name `resident.released` (pending amendment, orchestrator's to take to the user).
- `src/schemas/agents.ts` — `RESIDENT_DESIGNATED_EVENT_TYPE`, `RESIDENT_RELEASED_EVENT_TYPE`, `ResidentDesignatedPayloadSchema` (the designated payload was previously hand-built in `apps/server/src/threads/resident.ts` with no contract schema; now declared here so the release payload has something to sit beside), `RESIDENT_RELEASE_REASONS = ["released","resolved","replaced"]`, `ResidentReleaseReasonSchema` (each value's meaning in its description, lapse explicitly excluded), `ResidentReleasedPayloadSchema`, `parseResidentReleasedPayload`, `parseResidentDesignatedPayload`. `ResidentSchema` is referenced unmodified inside both payloads (CONTRACT-037 rule).
- `src/routes/thread-resident.ts` — `DELETE …/resident` description now says a release that releases somebody enqueues `resident.released` on the orchestrator's lane with `reason: "released"`; the `POST` description says a replacement enqueues `reason: "replaced"` beside the newcomer's `resident.designated`.
- Tests: `src/schemas/queue.test.ts` (six-member tuple pin, type-spelling agreement), `src/schemas/agents.test.ts` (payload round-trips, reason enum closed at three with no `lapsed`, parse helpers), `src/openapi.test.ts` (pin against the generated document: `resident.designated, resident.released` appears in `QueueEvent.type`, `InProgressEvent.type`, `Job.type` descriptions, and the payload description names the release payload).
- `openapi.json` and `src/client/schema.generated.ts` regenerated with `npm run generate -w packages/contract`, never hand-edited.

**Evidence**

1. `npm run build -w packages/contract` → exit 0. `npm run generate -w packages/contract` → exit 0. `/usr/bin/grep -c "resident.released" packages/contract/openapi.json` → `4` (and `4` in `schema.generated.ts`).
2. Generation idempotent: regenerated twice, `shasum` identical both runs (`openapi.json` 95fd49c7…, `schema.generated.ts` e77d5abe…).
3. **Falsification**: replaced the `"resident.released",` line in `CORE_QUEUE_EVENT_TYPES` with a comment, ran `vitest run packages/contract/src/openapi.test.ts -t "publishes .resident.released"` alone → exit 1, `AssertionError: QueueEvent: expected 'Event type. Core values: comment.crea…' to contain 'resident.designated, resident.released'` (Received: `…doc.edited, resident.designated, agent.done…`). Restored the line; `grep -c '"resident.released",'` → 1; the pin green again.
4. Scoped tests: `VITEST_MAX_THREADS=4 vitest run packages/contract` → 66 files, 2658 tests, all passed. `tsc --noEmit` in `packages/contract` (raw binary) → exit 0. `eslint packages/contract/src` → exit 0. Prettier check on the package → clean.

**Not done here, by design**: SPEC.md §7's core-type sentence is not amended (this package never edits SPEC.md); the server does not emit the event yet (SERVER-128).

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-069]` prefix
