# [SERVER-057] Mount the edit-session flush route

## Domain
server

## Status
done

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
- [x] The route is mounted and answers `204`
- [x] **Idempotent, as the contract publishes it**: `204` whether or not a session
      was open. No `409`, and no `404` for "nothing to flush" — the caller cannot
      know, and an error there makes correct client code impossible to write
- [x] The only `404` is a document the projection does not have
- [x] A flush emits exactly one `doc.edited`, converging on the same `sessionId`
      as the idle path — SERVER-052's `end()` already guarantees this
      structurally (it deletes before it emits); add the test that proves the
      route inherits it
- [x] A flush that ends a session with an empty path-scoped range, or whose
      commits were all rejected under §14, correctly emits **nothing** — and
      still answers `204`, because emission is decided after the response
- [x] No acting party: the route is in the unattributed set, makes no commit, and
      declares no `x-corpus-author`
- [x] Reachable with `fetch(…, {keepalive: true})` from a real browser unload
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

**Model: Opus 5 (1M context)**, server-dev agent, 2026-08-04.

Real `corpus init` workspace at `/tmp/s057-ws`, real server started with
`corpus server start` (`corpus 0.3.0 listening on http://127.0.0.1:8766, pid 86367`),
driven with `curl` and Node `fetch`. The observable throughout is the file-backed
queue (`.corpus/queue/pending/`), which is the source of truth per §7.

**One flush, exactly one event.** Created `doc_2cth4d4l` and edited it as `user`
(`PUT /api/docs/doc_2cth4d4l` → `200`). `pending/` empty — no acknowledgment yet,
as expected three minutes before the window.

```
$ curl -i -X POST -H "Authorization: Bearer $TOKEN" \
    http://127.0.0.1:8766/api/docs/doc_2cth4d4l/edit-session/flush
HTTP/1.1 204 No Content
```

One file appeared in `pending/`:

```json
{
  "id": "evt_ioagkyfpszng",
  "type": "doc.edited",
  "source": "edit",
  "payload": {
    "docId": "doc_2cth4d4l",
    "sessionId": "es_d391744366dba519",
    "actor": "user",
    "endedBy": "close",
    "from": "e1a9f6ee9b99725b6d5eaae2d854dfb9655fb994",
    "to": "300bcbdb1199de65fcd6a540d7b562701e0306e3",
    "stats": { "commits": 1, "insertions": 16, "deletions": 0 }
  }
}
```

`to` is `HEAD` (`git log`: `300bcbd user doc edit: Mortgage options (doc_2cth4d4l) by user`).

**Idempotence, and one event per `sessionId`.** Two further flushes of the same
document: `204`, `204`. `pending/` still held **exactly one** file. The route
inherits `end()`'s delete-before-emit structurally — the second and third calls
found nothing to end.

**The three cases.**

| case | request | result |
| --- | --- | --- |
| open session | `POST …/doc_2cth4d4l/edit-session/flush` | `204`, empty body, one `doc.edited` |
| no session | `POST …/doc_fra5w2jy/edit-session/flush` (created, never edited) | `204`; `pending/` unchanged after 1 s |
| unknown document | `POST …/doc_zzzzzzzz/edit-session/flush` | `404` `{"code":"not_found","message":"no document with id doc_zzzzzzzz"}` |

No token → `401`, like every other route.

**No acting party.** No `x-corpus-author` was sent on any of the calls above and
none was required; `git log` gained no commit across all five flushes (`HEAD`
stayed at `300bcbd`).

**`keepalive` reachability.** Sent as a real browser unload path sends it — a
body-less `POST` with `keepalive: true` carrying only `Authorization`:

```
$ node -e "fetch('…/edit-session/flush',{method:'POST',keepalive:true,headers:{Authorization:'Bearer '+token}})"
  status 204 content-length null
```

`204` with no `content-length`, so nothing is waiting on a body a dying page
would never read. (The `pagehide`/`visibilitychange` wiring itself is UI-044's to
prove in a browser; what is verified here is that the server accepts exactly this
request shape.)

Unit/integration: 7 new tests in `apps/server/src/edit/acknowledgment.test.ts`
(`POST /api/docs/{id}/edit-session/flush`); `apps/server` suite green.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
