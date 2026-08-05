# [CONTRACT-031] An explicit edit-session flush route

## Domain
contract

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-028, SERVER-052
- Blocks: UI-044

## Spec References
- SPEC.md §4 "Edit acknowledgment" (the signed rider), §9.3 (mutating routes)

## Summary
CONTRACT-028 declared no flush route, reasoning that §7's edit-lock release
(`DELETE /api/locks/{docId}`) is already the reader-close signal. **SERVER-052
measured that premise against the shipped UI and it is false.**

`apps/ui/src/editor/useUserLock.ts` releases the lock on blur *or idle*:

```ts
export const LOCK_IDLE_RELEASE_MS = 10_000;
```

Binding the session's close path to lock release therefore breaks the rider in
two ways:

1. **§4's window becomes unreachable.** The lock's own idle release fires at 10 s,
   the session's at 180 s. The lock always wins, so the "distinct and longer
   window" the spec explicitly calls out would be dead code in every session.
2. **One sitting fragments into an event per typing burst.** Every alt-tab
   releases the lock, so the agent receives a stream of partial ranges instead of
   one acknowledgment of the edit.

SERVER-052 shipped `flush(docId)` implemented, tested and exposed on
`CorpusServer.editSessions` — today it is reached only by shutdown. UI-044 needs
a way to call it when the reader closes.

**Suggested shape** (SERVER-052's, and it looks right): body-less
`POST /api/docs/{id}/edit-session/flush` → `204`, **idempotent** — flushing a
document with no open session is a no-op, not a `404`. Idempotence matters
because the UI will call this on an unload path, where a duplicate is far more
likely than a missed one.

## Acceptance Criteria
- [ ] A route the reader can call to end an edit session immediately
- [ ] Idempotent: no open session is `204`, not an error — the caller cannot know
- [ ] Reachable from a page-unload path (`sendBeacon`/`keepalive` shaped), or an
      explicit note in the route's description that it is not, so UI-044 does not
      discover this at implementation time
- [ ] Emits exactly one event, converging on the same `sessionId` as the idle
      path (CONTRACT-028's published invariant)
- [ ] A flush for a document the workspace does not have is a `404`; that is the
      only 404
- [ ] `openapi.json` and the typed client regenerated, never hand-edited
- [ ] §9.3 gains the route

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/` + regenerated artifacts
- `apps/server` mounts it onto the existing `editSessions.flush(docId)` — no new
  server mechanism, only the door

## Testing Strategy
Contract tests for the shape and the idempotent no-op; the server side already
has `flush` under test from SERVER-052.

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
