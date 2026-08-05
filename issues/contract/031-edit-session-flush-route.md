# [CONTRACT-031] An explicit edit-session flush route

## Domain
contract

## Status
done

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
- [x] A route the reader can call to end an edit session immediately
- [x] Idempotent: no open session is `204`, not an error — the caller cannot know
- [x] Reachable from a page-unload path (`sendBeacon`/`keepalive` shaped), or an
      explicit note in the route's description that it is not, so UI-044 does not
      discover this at implementation time
- [x] Emits exactly one event, converging on the same `sessionId` as the idle
      path (CONTRACT-028's published invariant)
- [x] A flush for a document the workspace does not have is a `404`; that is the
      only 404
- [x] `openapi.json` and the typed client regenerated, never hand-edited
- [ ] §9.3 gains the route — **drafted below, held for user sign-off** (this
      package never edits SPEC.md). Note the section: every route in the API is
      listed in **§9.2**, and §9.3 is the contract-first *mechanism* that makes
      adding one a contract change. The bullet is drafted for §9.2.

## Technical Design
### Files to Create/Modify
- `packages/contract/src/routes/` + regenerated artifacts
- `apps/server` mounts it onto the existing `editSessions.flush(docId)` — no new
  server mechanism, only the door

## Testing Strategy
Contract tests for the shape and the idempotent no-op; the server side already
has `flush` under test from SERVER-052.

## Design Decisions (contract-dev, 2026-08-04)

**Status: todo → done.** The route is `packages/contract/src/routes/edit-session.ts`.

### 1. `POST /api/docs/{id}/edit-session/flush` → `204`, body-less both ways
SERVER-052's suggested shape, confirmed. **`POST` rather than `DELETE`**: the
session is server-owned state a client cannot address, observe or create — there
is no `GET /api/docs/{id}/edit-session` for a `DELETE` to be the counterpart of —
so this is a state transition, and the house spells those as a `POST` verb
(`/resolve`, `/reopen`, `/seen`, `/break`, `/reap`, `/rollback`). It is exactly
`POST /api/threads/{id}/seen` shaped. `POST` is also the only method
`sendBeacon` can issue, so choosing it costs nothing and forecloses nothing.

The static segment sits one below `/api/docs/{id}`, sharing that depth with
`move`, `archive` and `unarchive`, so nothing competes with `{id}`. It is
registered immediately after `getDocDiff`: §4's surface is those two routes — the
signal that ends a session and the read that explains it — and the registry order
is also the generated document's path order, so the pair is found together.

### 2. The `204` carries no body, and that is a decision, not an omission
A `200` reporting whether a session was actually ended was considered and
rejected, because such a field would be a lie twice over. It is a **race**: the
inactivity window may have elapsed a millisecond earlier and taken the session
out through the other door. And emission is **decided after the response**: the
server ends the session, then reads git, and a session whose path-scoped range
turns out empty (an edit and its undo in one sitting) or whose auto-commits were
all rejected or skipped (§14) correctly produces no event. So the route publishes
the **postcondition** — *this document has no open edit session* — and nothing
else. That is also the whole of what the caller needs.

### 3. Idempotence is expressed as a postcondition, not as a promise
The same move `sessionId` makes in CONTRACT-028 §4: state an identity rather than
a behaviour. The route asserts a postcondition rather than performing an action,
and asserting it twice is asserting it once — so `204` is unconditional and the
handler never asks whether a session was open. It is expressed in three places
that a client actually reads: the declared response set has no `409` and no
"nothing to flush" `404`; the `204`'s own description says the answer is the same
either way; and the prose says why a `404` there would make correct client code
impossible (the caller cannot know — sessions are opened by the server on the
first editor save that lands a commit, and ended by a timer the client cannot
observe).

The structural guarantee behind it is SERVER-052's, unchanged: `end()` removes
the session from the map *before* it emits, so whichever trigger arrives first is
the only one that can emit. A repeated flush, and a flush arriving behind the
idle sweep, both find nothing. **One event per `sessionId`** therefore holds
across the flush path for the same reason it holds across the idle path, and the
route's prose says so rather than leaving CONTRACT-028's invariant to be
rediscovered.

### 4. Unload-path reachability: `keepalive` **yes**, `sendBeacon` **no** — and the reason is the token
Decided and written into the route description, so UI-044 does not discover it at
implementation time.

- **`fetch(url, { method: "POST", keepalive: true })` works.** Nothing about this
  route obstructs it: the request is body-less, so the 64 KiB keepalive budget is
  never in question; the UI is served same-origin by this server, so no preflight
  has to survive the unload; and `keepalive` can carry arbitrary headers,
  including `Authorization`. The **generated client passes it through** —
  `openapi-fetch`'s `FetchOptions` is `RequestOptions & Omit<RequestInit, "body" |
  "headers">`, so `client.api.POST(…, { params, keepalive: true })` type-checks
  and reaches `fetch`. Verified over a real socket (E2E line 5) and pinned by a
  test asserting `Request.keepalive === true` at the transport.
- **`navigator.sendBeacon` cannot call it**, and *not* because of the method or
  the body — a beacon is a `POST` and may carry none, both of which suit this
  route exactly. It is the auth: a beacon sets **no request headers at all**, so
  it cannot send the workspace bearer token, and this route is not on §2.1's
  exception list. Proven rather than asserted: a headerless `POST` against the
  real socket answers `401` (E2E line 8).

Making it beacon-reachable would mean a second token-in-query surface beside
`/events`, which §9.2 already flags as acceptable *only* under the localhost
bind. `keepalive` is universally available in the browsers this UI targets, so
the trade buys nothing and widens the token's exposure. Not done.

### 5. No acting party, and therefore no `403`
The route declares **no `x-corpus-author`** and joins `POST /api/check` and `POST
/api/index/rebuild` in `openapi.test.ts`'s `UNATTRIBUTED_POSTS`. The header's
published meaning is "the git author of the auto-commit the server makes for the
mutation", and a flush makes none: the session's commits landed minutes earlier
on the editor's own save path, already authored by the user. Declaring it would
advertise a commit that never happens — the exact reason the other two are
exempt.

Making it user-only was considered and rejected. The header is self-declared and
defaults to `user`, so a `403` on `agent` would document a rule rather than
enforce one — and there is nothing to enforce: the event's actor is fixed by its
payload schema (`z.literal("user")`), so who calls this cannot change what the
event says, and a caller that is not the reader cannot manufacture an
acknowledgment, because with no session open there is nothing to end. §4's
"the loop cannot feed itself" is unaffected: an agent flush of an agent's own
edits emits nothing, since agent edits never open a session.

### 6. The `404` is the document, and only the document
Kept, against the pull of "make an unload-path call incapable of failing". A
permissive `204` for an unknown id would hide forever the one client bug worth
catching here — a stale id, a thread id, an `undefined` interpolated into the
path — and every other route on `/api/docs/{id}` answers `404` for it. The prose
closes the loop for UI-044: a `404` on an unload path is **not actionable** and
should be ignored, because a caller that receives one has nothing to flush
either way.

### 7. A now-false docblock corrected
`EditSessionEndReasonSchema`'s `close` bullet in `schemas/edit.ts` still said
that the flush *is* the edit-lock release and that no endpoint is declared "on
purpose". It now names this route and records why the lock is not the signal, so
the schema a consumer reads no longer contradicts the route beside it.

## SPEC amendment drafted — HELD for user sign-off

One bullet, for **§9.2** (where routes are listed — the acceptance criterion says
§9.3, which is the contract-first mechanism section, and no route is listed
there). It goes immediately after the `GET /api/docs/:id/diff` bullet CONTRACT-028
drafted, keeping §4's two routes adjacent in the spec as they are in the
contract:

> - `POST /api/docs/:id/edit-session/flush` — ends the user edit session open on
>   a document immediately: §4's `close` path, which the reader calls when it
>   closes. **Idempotent** — `204` whether or not a session was open, because the
>   caller cannot know, and a flush with nothing to flush is a no-op rather than
>   an error. No body in either direction: whether an acknowledgment follows is
>   decided after the response and is not the caller's business. The flush and
>   §4's inactivity window converge on one session, so a document still emits at
>   most one `doc.edited` per session however it ends. The `404` means the
>   document is unknown; there is no other. Reachable from a page-unload path
>   with `fetch(…, {keepalive: true})` — `sendBeacon` cannot, since it sends no
>   headers and therefore no bearer token. Writes no workspace file and makes no
>   commit, so it carries no acting party.

## E2E Verification Log

**Model: Opus 5 (1M context)** (`claude-opus-5[1m]`), 2026-08-04, branch
`phase-11-edit-ack`. Contract-only change: every file written is under
`packages/contract/` (plus this issue file). One other agent was live in
`apps/cli` (CLI-026); nothing there was touched.

**1. The route driving the real SERVER-052 tracker, over a real HTTP socket
(port 9413 — never 8765 or 5173).** A throwaway tsx script created a real git
repository in a temp directory, wired `createEditSessionTracker` from
`apps/server/src/edit/sessions.ts` to a real `createGit`, mounted
`contractRoutes.flushEditSession` on `@hono/node-server` behind a bearer guard,
and drove it with `createCorpusClient` from the **regenerated** client. Two
editor autosaves (the second amending the first, as §4's squash does) opened one
session:

```
1. flush with an open session: 204 [{"type":"doc.edited","payload":{"docId":"doc_a1b2c3",
   "sessionId":"es_cc144a421b055954","actor":"user","endedBy":"close",
   "from":"0ddb48a…6b20","to":"d0f9a37…be32","stats":{"commits":1,"insertions":2,"deletions":1}}}]
2. two more flushes: 204 204 — events now 1
3. flush a document nobody edited: 204 — events 1
4. flush an unknown document: 404 {"code":"not_found","message":"No document `doc_gone99`."}
5. keepalive flush of a new session: 204 — events 2
6. session ids: ["es_cc144a421b055954","es_2565e94c9e04e522"] distinct=2
8. sendBeacon-shaped POST (no Authorization): 401 {"code":"unauthorized",…}
```

Line 1 is §4's close path end to end — the flush produced a real `doc.edited`
with `endedBy: "close"` and a real git range whose `from` is the seed commit
(the amend correctly moved the session's base). Lines 2–3 are idempotence
against the real tracker: three flushes and a flush of an un-edited document,
all `204`, still **one** event. Line 6 is the `sessionId` invariant holding
across two sittings — two events, two distinct ids, never two for one id. Line 5
is `keepalive: true` surviving the generated client and reaching a real socket.
Line 8 is the reachability claim proven rather than asserted: the beacon shape
(a `POST` carrying no headers) is refused `401`, which is exactly why the route
description names `keepalive` and rules `sendBeacon` out.

The script also exercised the tracker's own `close()` on shutdown; no listener
was left on 9413 and the script was deleted.

**2. Generation idempotence.** `shasum` of both artifacts → `npm run generate -w
packages/contract` → `shasum` again: `diff` exit **0**.
`openapi.json` = `60203794c98c8928866c295c97b5e2f194d3c3e625c7780ca0ccde9ebd349eb9`,
`schema.generated.ts` = `bf0a2b2f8f94361c6624c4f97ff39ea06d7a6a511b1c75b29fd16f372e4f52e1`.

**3. Drift check fires.** Hand-edited the committed `openapi.json` (the flush
route's `summary` → `HAND EDITED - drift probe`) and ran `node --import tsx
scripts/check-generated-artifacts.ts` → **exit 1**:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add …
```

Regenerated; both hashes returned to the values above (`diff` exit 0). The same
run also reported `docs/cli.md` stale — that is CLI-026's in-flight work in the
other live agent's domain, not this change, and was left alone.

**4. Scoped gates.**
- `VITEST_MAX_THREADS=4 vitest run packages/contract` → **50 files, 1775 tests,
  all passing**. 24 are new: 13 in the new `routes/edit-session.test.ts`, 10 in
  `openapi.test.ts` (a `describe` of 9 plus one more case in the
  `UNATTRIBUTED_POSTS` sweep), 1 in `routes/index.test.ts`.
- `tsc --noEmit -p packages/contract/tsconfig.json` → clean.
- `eslint <7 touched files> --max-warnings 0` → no issues, no rule disabled.
- `prettier --check` on all nine touched/generated files → clean.
- `npm run build -w packages/contract` → clean, so downstream workspaces resolve
  the new route through `dist/`.

**5. Disclosure.** The E2E script ran `git` (init, add, commit, rev-parse)
**inside a `mkdtemp` directory only** — a throwaway repository created to give
the real tracker real history. No git command was run against this repository and
no repository state was changed.

## Notes for the consuming issues

- **UI-044** — call it on `pagehide` and on `visibilitychange → hidden` with
  `client.api.POST("/api/docs/{id}/edit-session/flush", { params: { path: { id } },
  keepalive: true })`. Fire it on **both**; duplicates are free by contract and a
  miss is not. Do **not** reach for `navigator.sendBeacon` — it sends no headers
  and so no bearer token (verified: `401`). Ignore a `404`: it means the id was
  wrong or the document is gone, and there is nothing to flush either way. Do not
  branch on the response beyond that — the `204` says only that the document has
  no open session, deliberately not whether an event was emitted. Keep the flush
  **separate from the lock release**: that is the whole point of this issue, and
  wiring it to `useUserLock`'s 10 s idle release would reintroduce the defect.
- **Server mount — no issue exists for it, and one is needed.** This declares the
  door; nothing serves it yet. `issues/PLAN.md` has UI-044 depending on
  SERVER-052 + CONTRACT-031, but neither of those registers a handler, so a
  UI-044 built today would `404` against the real server. The work is small and
  wholly server-side: `app.openapi(contractRoutes.flushEditSession, …)` beside
  the document routes, `404` when the projection has no such document, then
  `editSessions.flush(id)` and `c.body(null, 204)` — no new server mechanism.
  Left to the orchestrator to file rather than done here (domain boundary; a
  second agent was live in another app).

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
