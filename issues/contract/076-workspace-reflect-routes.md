# [CONTRACT-076] `workspace.reflect`: the event, the ask route, and the status route

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-064 (rider 9 signed)
- Blocks: SERVER-137, CLI-060, UI-153

## Spec References
- SPEC.md §7 — "Event queue and agent loop" (rider 9: reflection)
- SPEC.md §9.2 — "HTTP API"

## Summary
Reflection is one event with one field and two routes: ask for one, and read the clock. This issue defines them so the server, the CLI and the UI agree on the shape.

## Acceptance Criteria
- [ ] Event type `workspace.reflect` is in the core event-type list with payload `{ since: string (ISO) | null }` — `null` for a corpus never reflected on.
- [ ] `POST /api/workspace/reflect` → `202 { eventId, since }`; `409 { pending: eventId }` when a reflection is pending or in progress (the UI shows the pending state instead of asking twice).
- [ ] `GET /api/workspace/reflect` → `{ reflected: string | null, pending: eventId | null, changed: number, lastDigest: threadId | null, quiet: number }` — `changed` is the count of documents with `updated > reflected` (archived excluded), `quiet` the configured window in minutes.
- [ ] `openapi.json` regenerated, drift check green, typed client exposes both.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/events.ts` — the type and payload
- `packages/contract/src/schemas/reflect.ts`, `routes/reflect.ts` — the two routes
- `packages/contract/openapi.json`

### Key Implementation Details
- `changed` counts the same set the UI marks; it is in the status route so the board bar's count is one request, not a list.
- `lastDigest` is the id of the most recent reflection thread, so the UI can link "reflected 2h ago" to it; the server finds it by the thread's `origin` (§9.2) pointing at the reflection job.

### Edge Cases
- `since: null` means "everything": the agent's gather has no `--since`.

## Testing Strategy
Schema round trips; route definitions mounted on a stub.

## E2E Verification Plan
### Verification Steps
1. `npm run generate -w packages/contract` idempotent; typed client compiles.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-076]` prefix
