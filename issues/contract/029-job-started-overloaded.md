# [CONTRACT-029] `Job.started` means two different instants

## Domain
contract

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md §7 (queue and jobs), §8 (the honest pending indicator)

## Summary
Found by UI-058 (2026-08-04), which had to work around it.

`Job.started` carries the event's `created` instant **until the job writes its
first log line**, after which the server records the log's timestamp. So the
field silently changes meaning partway through a job's life: it is "when this was
enqueued" while queued, and "when the agent started talking" afterwards.

The consequence is visible. UI-058 shows how long an agent request has been
outstanding, measured from `started`. A job that sat in the queue for ten minutes
and then began emitting logs would have its elapsed clock **reset** at the moment
the agent started work — the wait did not restart, and a display that says it did
is exactly the dishonesty §8's indicator exists to avoid.

UI-058 bounds the value with the thread's newest turn (a requesting turn can
never be newer than the request), which is correct but is a heuristic standing in
for a field that should just exist.

## Acceptance Criteria
- [ ] A job exposes its **enqueue** instant as its own field, distinct from
      whenever work began
- [ ] Existing consumers of `started` keep working, or are updated in the same
      change — decide whether `started` is redefined or joined by a sibling, and
      say why
- [ ] `apps/ui/src/thread/outstandingAgentRequest.ts` drops its bounding
      heuristic and reads the real field, with the workaround comment removed
- [ ] The generated client and `openapi.json` are regenerated, not hand-edited
- [ ] The console's job list still shows whatever it means to show — check
      whether it was relying on the post-log meaning

## Technical Design
### Files to Create/Modify
- `packages/contract/src/schemas/` (the Job schema), regenerated artifacts
- `apps/server/src/` job projection / log-timestamp write path
- `apps/ui/src/thread/outstandingAgentRequest.ts` (drop the workaround)

## Testing Strategy
Contract test pinning both instants; a server test where a job is enqueued,
sits, then logs — asserting the enqueue instant does not move.

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
