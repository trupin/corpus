# [SERVER-131] A claim batch is in `readdir` order, not the conversation's

## Domain

server

## Status

todo

## Priority

P0

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: AGENT-038 (which found it), SERVER-128

## Spec References

- SPEC.md **§7** — a resident works its conversation inline, one event at a time
- SPEC.md **§7** — *"Work each claimed event, in claim order"* is what the converse skill relied on

## Summary

Found by AGENT-038's drill on 2026-08-19, against a real server: three replies posted to a designated lane inside one second, one `corpus queue claim-all --thread <id>`, and the batch came back **Y, Z, X** — the first message last. Reproduced twice. Cause in source: `QueueStore.listIds` is a bare `readdir` of `pending/` (`apps/server/src/queue/store.ts:267`) and `QueueService.claimAll` iterates it with no sort (`apps/server/src/queue/service.ts:614`). The batch's order is the event id's — random against the conversation.

The converse skill said the batch was *"ordered by construction"*. It was not, and a resident obeying it answers the third message before the first — exactly the failure the user asked to prevent. AGENT-038 corrected the skill to *"in the order the conversation has them"*. This issue makes the server's batch actually carry that order, so the cheap reading is also the right one.

## Acceptance Criteria

- [ ] `claimAll` (and `idle`'s returned batch, which is the same code path) returns events ordered by their `created` timestamp ascending, ties broken by id, for **every** lane
- [ ] A test enqueues three events with ids that sort against their creation order and asserts the batch is in creation order — falsified by removing the sort
- [ ] `held` (the in-progress set) is ordered the same way, for the same reason
- [ ] No change to the wire shape

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/service.ts` — `claimAll` / `settledWork`
- `apps/server/src/queue/store.ts` — `listIds` or its caller
- tests beside each

### Key Implementation Details

Sort by the event's `created` field (the stored event carries it), not by filename. Two events created in the same millisecond are ordered by id, so the order is total and stable.

## Testing Strategy

Unit test on the service with a fixture of three events; falsify by removing the sort.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Post three replies to a designated thread quickly; `corpus queue claim-all --thread <id>`; the batch is in posting order
3. Stop the server, confirm the port is free

## E2E Verification Log

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-131]` prefix
