# [SERVER-057] Mount the edit-session flush route

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-031, SERVER-052
- Blocks: UI-044

## Spec References
- SPEC.md §4 "Edit acknowledgment"; §9.2 `POST /api/docs/:id/edit-session/flush`

## Summary
Caught by CONTRACT-031: **the plan had a hole.** `PLAN.md` had UI-044 depending
on SERVER-052 and CONTRACT-031, but neither of those registers a handler —
SERVER-052 built `editSessions.flush(docId)` and exposed it on `CorpusServer`,
CONTRACT-031 declared the route, and nothing connects them. A UI-044 built today
would `404` against a real server.

The work is small and wholly server-side: mount the contract route onto the
tracker that already exists.

```
app.openapi(contractRoutes.flushEditSession, …)
  → 404 when the projection has no such document
  → editSessions.flush(id)
  → c.body(null, 204)
```

## Acceptance Criteria
- [ ] The route is mounted and answers `204`
- [ ] **Idempotent, as the contract publishes it**: `204` whether or not a session
      was open. No `409`, and no `404` for "nothing to flush" — the caller cannot
      know, and an error there makes correct client code impossible to write
- [ ] The only `404` is a document the projection does not have
- [ ] A flush emits exactly one `doc.edited`, converging on the same `sessionId`
      as the idle path — SERVER-052's `end()` already guarantees this
      structurally (it deletes before it emits); add the test that proves the
      route inherits it
- [ ] A flush that ends a session with an empty path-scoped range, or whose
      commits were all rejected under §14, correctly emits **nothing** — and
      still answers `204`, because emission is decided after the response
- [ ] No acting party: the route is in the unattributed set, makes no commit, and
      declares no `x-corpus-author`
- [ ] Reachable with `fetch(…, {keepalive: true})` from a real browser unload
      path — verify against the running server rather than assuming, since UI-044
      depends on it

## Technical Design
### Files to Create/Modify
- `apps/server/src/` route registration + tests

### Notes
- `editSessions.flush()` is already implemented and tested by SERVER-052; this is
  the door, not the mechanism. Resist adding logic here — anything that belongs
  to session lifecycle belongs in the tracker.

## Testing Strategy
Route tests for the three cases (open session, no session, unknown document) plus
the one-event assertion; an E2E flush against a real server.

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
