# [SERVER-130] The server answers what a scope holds

## Domain

server

## Status

done

## Priority

P0

## Model

opus

## Dependencies

- Depends on: CONTRACT-068
- Blocks: UI-125, CLI-054
- Related: SERVER-111 (the enqueue-time walk)

## Spec References

- SPEC.md **§7** — scope: the thread, its subthreads, every artifact whose provenance walks back to it; membership computed, never stored
- SPEC.md **§9.2** — the HTTP API

## Summary

CONTRACT-068 defines the route that answers *given a designated thread, what is in its scope*. This issue mounts it. The answer is derived by the **same walk** the queue routes with — `@corpus/contract`'s `walkScope`, which `apps/server/src/queue/scope.ts` already uses to climb from one artifact to its lane. Listing a scope is the inverse: every thread and document in the projection whose walk lands on this lane.

**Decided by the orchestrator, 2026-08-19** (CONTRACT-068 decisions 1–3):

- **A query, not a projection table.** Computed per request from the projection's existing `origin`/`parent` columns, so §7's *"computed, never stored"* stays literally true. The cost is a pass over the threads and documents the projection holds, each walked with `walkScope`; memoise the walk per request so a deep graph is not re-climbed per node. Measure it on a workspace of a few thousand artifacts and state the number in the log.
- **One frugal line per hit** — id, type, title, status, and how it got in (`origin` or `parent`), never a body.
- **Bounded** — the contract states a page size and a `truncated` flag. The server returns the first page in a stated order (the thread itself first, then by created time) and sets `truncated` honestly. No cursor in this release: the bound is there so a very large scope cannot become an enumeration, not to make paging a feature.

## Acceptance Criteria

- [x] The route is mounted and answers for a designated thread
- [x] A thread with no resident is a `404`/`409` per the contract's stated rule — the orchestrator's lane is not a scope
- [x] Parity test: over a derived fixture, every artifact the **enqueue-time** walk routes to lane L appears in L's listing, and nothing else does — one walk, two directions, proven equal
- [x] Bound honoured and `truncated` set
- [x] An archived document in scope is listed, with its status
- [x] Falsified: replace `walkScope` with `origin ?? parent` and the parity test goes red

## Technical Design

### Files to Create/Modify

- `apps/server/src/queue/scope.ts` — reuse, and possibly an exported inverse helper beside the existing climb
- `apps/server/src/agents/` or `apps/server/src/threads/` — the route handler, wherever CONTRACT-068 files it
- `apps/server/src/app.ts` (or the routes index) — mount
- a parity test in the shape of `scripts/mention-offer-parity.test.ts`

### Key Implementation Details

Read `queue/scope.ts`'s docblock and `packages/kit/src/recipient/scopeWalk.ts`'s. Those two are one walk with one seam. The inverse must call the same function, never re-implement the edge order.

### Edge Cases

- An artifact reachable by both `origin` and `parent` to different lanes (SHARED-044) — list it where `walkScope` puts it, which is what the queue would do
- A scope containing an archived document
- The thread itself — always first

## Testing Strategy

Route tests on the real app with a temp workspace, plus the parity test.

## E2E Verification Plan

### Verification Steps

1. Throwaway workspace, real server, port not 8765 / not 5173
2. Designate a resident; create a subthread and a document whose `origin` is the thread; create an unrelated document
3. `GET` the scope: the thread, the subthread and the document are listed; the unrelated document is not
4. Stop the server, confirm the port is free

## E2E Verification Log

**Implemented on: opus.** 2026-08-19.

### What was built

- `apps/server/src/queue/scope.ts` — additive: `listScopeMembers(db, root)` beside the
  existing climb. One scan of `documents LEFT JOIN threads` ordered `updated DESC, id ASC`,
  a `Map` of nodes built from that scan, and **the same `walkScope`** run per candidate
  with the lookup and every verdict memoised for the length of the call. `via` is read off
  the walk (`parent` when climbing from the member's parent lands on this lane, `origin`
  otherwise), never off the row's columns.
- `apps/server/src/threads/scope-route.ts` — the mount. `404` when the id names no thread,
  `409` when the thread holds no resident (predicate: the shared `isDesignatedRoot`),
  otherwise the listing.
- `apps/server/src/app.ts` + `threads/index.ts` — mounted inside the projection block,
  after the thread surface.

### Falsification (acceptance criterion 6)

`listScopeMembers`'s `laneOf` was temporarily replaced by the pre-SERVER-117
`origin ?? parent` chain (the enqueue side left untouched), and
`apps/server/src/queue/scope-parity.test.ts` was run alone:

```
× lane A's listing > is exactly the set the enqueue walk routes to it
× lane B's listing > is exactly the set the enqueue walk routes to it
× the two listings together > partition the corpus with the orchestrator's remainder
  Tests  3 failed | 8 passed (11)
```

The diff named the artifacts, e.g. `th_pthlaneAothplain` (parent → lane A, origin →
the undesignated thread) appearing in a listing the enqueue walk does not route there.
Restored, 11/11 green. Note the `via` test stayed green under the falsification — it is
consistent with whatever `laneOf` says — so the membership comparison is the load-bearing
one.

### Cost (a projection of a few thousand artifacts)

Measured with a scratch script over a real projection seeded with three-link chains
(document → thread on it → document written from that thread), median of 10 warm runs:

| corpus | scope | median | min–max |
| --- | --- | --- | --- |
| 3,001 artifacts | 10 members (every artifact walked, no early exit) | **3.9 ms** | 3.4–4.5 ms |
| 6,001 artifacts | truncated at 200 | 5.6 ms | 5.4–6.4 ms |
| 9,001 artifacts | truncated at 200 | 9.0 ms | 8.8–10.9 ms |

Roughly 1 ms per 1,000 artifacts, dominated by the scan rather than by the walks — the
loop's early exit at the page size saves the walks and not the read. One enqueue climb on
the same projection is under 0.05 ms, i.e. this read costs about what a hundred of them do.

### E2E, real server on a throwaway workspace

Port **8892**, workspace `…/scratchpad/ws-server-b`, `corpus init` from inside it, server
started through the CLI (which runs `apps/server/src/main.ts` from source, so these are the
bytes under review). The dev repo, 8765 and 5173 were never touched.

1. `POST /api/threads` `{"body":"Please take this on @agent"}` → `th_2aninur5`, event
   `evt_yyu4tpxvar6y`.
2. `GET /api/threads/th_2aninur5/scope` **before** designating → `409`:
   `{"code":"conflict","message":"th_2aninur5 has no resident, so it has no scope: SPEC.md §7 …
   Designate a resident on this thread, or read \`GET /api/agents\` for the lanes that exist."}`
3. `POST /api/threads/th_2aninur5/resident` `{}` → `resident {name: None, docId: None, weight: None}`;
   `GET /api/agents` lists `['orchestrator', 'th_2aninur5']`.
4. `POST /api/docs` with `job: evt_yyu4tpxvar6y` → `doc_aefyz2pg`, `origin: th_2aninur5`.
   `POST /api/threads` `{parent: doc_aefyz2pg}` → `th_sx5z7cnm`; `{parent: th_2aninur5}` →
   `th_wupkpufe`; an unrelated `POST /api/docs` → `doc_z4rx4nzg`, `origin: null`.
5. `POST /api/docs/doc_aefyz2pg/archive` → `200`, and the member is still listed:
   `{'id': 'doc_aefyz2pg', 'kind': 'doc', 'title': 'Findings', 'status': 'archived', 'via': 'origin'}`.
6. `GET /api/threads/th_2aninur5/scope` → `200`, `truncated: false`, 5 members, root first
   as `self`, the two subthreads as `parent`, the job's documents as `origin`, and
   `doc_z4rx4nzg` absent (`unrelated listed: False`). Full body:

```json
{"thread":"th_2aninur5","members":[{"id":"th_2aninur5","kind":"thread","title":"Please take this on @agent","status":"open","via":"self"},{"id":"doc_aefyz2pg","kind":"doc","title":"Findings","status":"archived","via":"origin"},{"id":"th_sx5z7cnm","kind":"thread","title":"Re: Findings","status":"open","via":"parent"},{"id":"doc_xn3pfdya","kind":"doc","title":"Findings","status":"open","via":"origin"},{"id":"th_wupkpufe","kind":"thread","title":"Re: Please take this on @agent","status":"open","via":"parent"}],"truncated":false}
```

7. Refusals over the wire: `GET …/th_nosuch/scope` → `404`
   `{"code":"not_found","message":"no thread with id th_nosuch"}`; `…/doc_aefyz2pg/scope` →
   `400` (the contract's path param); `…/th_sx5z7cnm/scope` (an undesignated subthread) →
   `409`. Request time on this workspace: `0.0005 s`.
8. `corpus server stop` → `stopped (pid 1099)`; `lsof -nP -iTCP:8892 -sTCP:LISTEN` → free.

### Checks

- `VITEST_MAX_THREADS=4 vitest run apps/server/src/threads/scope-route.test.ts
  apps/server/src/queue/scope-parity.test.ts apps/server/src/queue/scope.test.ts` → 69 passed.
- `vitest run apps/server/src/app.test.ts apps/server/src/json-body.test.ts apps/server/src/agents`
  → 99 passed (nothing the mount could have disturbed).
- `eslint` and `prettier --check` clean on every touched file; `tsc --noEmit` in `apps/server`
  reports nothing outside `threads/resident.ts`, which is SERVER-129's concurrent work.

### Not done, deliberately

No cursor and no `total` — the contract says so, and a count is the enumeration the bound
exists to prevent. No projection table and no cache: §7's *computed, never stored* is
taken literally, which the measurement above says is affordable.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[SERVER-130]` prefix
