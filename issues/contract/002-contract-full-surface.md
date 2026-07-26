# [CONTRACT-002] Contract growth: full API surface (query, tree, capture, queue, locks, jobs, attachments, SSE)

## Domain
contract

## Status
todo

## Priority
P0

## Model
opus — the endpoint list is pinned by SPEC.md §9.2; the work is enumerating a pinned endpoint list into schemas, route definitions, and regenerated artifacts. No open architectural questions beyond the two pins recorded below.

## Dependencies
- Depends on: CONTRACT-001
- Blocks: SERVER-006, SERVER-008, SERVER-009, SERVER-010, UI-002

## Spec References
- SPEC.md §9.2 (HTTP API) — the authoritative endpoint list this issue must cover in full
- SPEC.md §7 (Event queue and agent loop) — queue contract, event object, document locks, job logs, read state
- SPEC.md §6 (Threads and anchors) — turn format, turn deletion + cascade, attachments
- SPEC.md §11 (UI — the board) — search filter surface, Attention (`needs=me`), console, SSE invalidation
- SPEC.md §5 (The document model) — doc types, staleness tiers, `[[refs]]`/`references:` filter
- CLAUDE.md — Architecture Decision 3 (contract-first via code), 4 (queue parking over HTTP), 5 (bearer auth)

## Summary
CONTRACT-001 bootstraps `packages/contract` with a deliberately small surface (docs CRUD + threads + queue basics) so that generation, the typed client, and the drift check can be proven end to end. This issue grows that package to the **complete** SPEC.md §9.2 surface: the full `GET /api/docs` query-parameter grammar with snippet highlights and Attention reasons, the folder tree, capture, the remaining thread verbs and user-only deletions, the full queue surface (long-poll idle, claim-all, complete/fail/abandon, reap-stale, halt/resume) with the event object schema, locks, jobs and their log stream, multipart attachments, and the SSE stream. Everything downstream — SERVER-006/008/009/010 and UI-002 — implements against these typed routes rather than inventing shapes, so server/client drift is a type error rather than a runtime surprise. No handlers are written here; this issue produces schemas, `createRoute` definitions, a regenerated `openapi.json`, and a regenerated typed client.

## Acceptance Criteria

- [ ] **Docs query.** `GET /api/docs` declares every parameter in §9.2 — `q`, `type`, `status`, `tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`, `stale`, `unread`, `needs`, `sort` — as typed Zod params, with `z.enum` wherever the spec enumerates values and prose descriptions everywhere else. Pagination params stay exactly as CONTRACT-001 defined them; this issue does not change them.
- [ ] **Result rows.** The `GET /api/docs` row schema carries structured search `snippets` and an `attention` reason array; both are typed enums/discriminated shapes, not free-form strings.
- [ ] **Tree.** `GET /api/tree` returns the `data/docs/` folder tree with names and doc counts.
- [ ] **Capture.** `POST /api/capture` (multipart: text + attachments) is defined and returns the created inbox doc id, its filing thread id, and the enqueued event id.
- [ ] **Doc mutations.** The §9.2 move and archive/unarchive routes are defined (path changes and `status` flips; the doc id never changes, and the route descriptions say so).
- [ ] **Thread verbs.** `POST /api/threads/:id/seen`, `/resolve`, `/reopen`, `DELETE /api/threads/:id/turns/:ts` and `DELETE /api/docs/:id` are defined; the two deletions are marked user-only and their **cascade semantics are documented in the route descriptions** and reflected in their response schemas.
- [ ] **Queue.** Long-poll `idle` (typed `timeout` param; `200` with events vs `204` on timeout), `claim-all` (batch), `complete`/`fail`, abandon, `reap-stale`, `halt`/`resume` (+ status read) are all defined, plus the `QueueEvent` schema (`id`, `type`, `created`, `source`, `payload`) with core types enumerated and plugin types left open.
- [ ] **Locks.** acquire / release / break / reap / list are defined over a `Lock` schema of `{docId, holder: "user" | "agent", acquired, ttl}`.
- [ ] **Jobs.** `GET /api/jobs?recent=`, `GET /api/jobs/:id/log`, `POST /api/jobs/:id/log` (described as localhost-only), retry and abandon are defined.
- [ ] **Attachments.** `POST /api/threads/:id/turns` has a multipart request schema (files + text + agent flag) alongside its JSON form, and `GET /attachments/{path}` is documented as a binary response.
- [ ] **SSE.** `GET /events` appears in `openapi.json` as a `text/event-stream` endpoint; the client exposes a **typed EventSource helper** (not a fetch call) whose `invalidate` payload is a query-key array.
- [ ] **Author attribution.** Every mutating route carries the acting party (`user` | `agent`) by the single mechanism pinned below, applied uniformly; user-only routes document rejection of `agent`.
- [ ] **Errors.** The typed error union covers `400` validation, `403` forbidden (user-only routes), `404`, `409` conflict, and `423` locked, with the locked variant carrying the `Lock` that blocks the write.
- [ ] **Generation.** `npm run generate -w packages/contract` regenerates `openapi.json` and the typed client; running it twice produces identical output; the pre-push drift check stays green on a clean tree.
- [ ] **Surface completeness test.** A test asserts the generated `openapi.json` contains exactly the pinned method+path inventory below — adding an endpoint to the spec without adding it to the contract fails a test.
- [ ] **Round-trips.** Vitest schema round-trip tests exist for each new resource (query params, doc row, tree node, queue event, lock, job, job log line, capture result, invalidate payload, each error variant).

## Technical Design

### Files to Create/Modify

Layout follows CONTRACT-001 (`src/schemas/` + `src/routes/`, one file per resource, tests colocated next to source).

- `packages/contract/src/schemas/query.ts` — `DocsQuery` params, the filter enums (`DocType`, `DocStatus`, `AgentParticipation`, `StaleTier`, `NeedsReason`, `DocSort`), `Snippet`, `DocRow`
- `packages/contract/src/schemas/tree.ts` — `FolderNode`
- `packages/contract/src/schemas/queue.ts` — `QueueEvent`, `QueueEventType`, `ClaimBatch`, `QueueStatus`, `ReapResult`
- `packages/contract/src/schemas/lock.ts` — `Lock`, `AcquireLockRequest`
- `packages/contract/src/schemas/job.ts` — `Job`, `JobLogLine`, `AppendLogRequest`
- `packages/contract/src/schemas/attachment.ts` — `AttachmentRef`, multipart turn-append field schema
- `packages/contract/src/schemas/capture.ts` — `CaptureResult`
- `packages/contract/src/schemas/thread.ts` — extend with `SeenRequest`/`SeenResult`, `DeleteTurnResult`
- `packages/contract/src/schemas/doc.ts` — extend with `DeleteDocResult`
- `packages/contract/src/schemas/error.ts` — extend the error union (403/409/423 variants; `LockedError` carries `Lock`)
- `packages/contract/src/schemas/actor.ts` — the author-attribution header param, shared by every mutating route
- `packages/contract/src/schemas/sse.ts` — `QueryKey`, `InvalidatePayload`
- `packages/contract/src/routes/docs.ts`, `threads.ts`, `tree.ts`, `capture.ts`, `queue.ts`, `locks.ts`, `jobs.ts`, `attachments.ts`, `events.ts` — `createRoute` definitions (new files for new resources, extensions for existing ones)
- `packages/contract/src/client/events.ts` — typed EventSource helper (hand-written, exported from `@corpus/contract/client`)
- `packages/contract/src/client/upload.ts` — multipart helper for turn-append and capture (the CONTRACT-001 edge case, now made concrete)
- `packages/contract/src/routes/inventory.ts` — the pinned method+path inventory used by the completeness test
- `packages/contract/openapi.json` — regenerated (committed, `linguist-generated`)
- `packages/contract/src/client/` generated types — regenerated
- `packages/contract/src/**/*.test.ts` — round-trip, route-mount, inventory, and idempotency tests

### Key Implementation Details

**Two design pins.** SPEC.md leaves two mechanisms unstated that this contract must decide once and apply everywhere. Both are recorded here so downstream issues inherit them rather than re-deciding:

1. **Author attribution is a request header, not a body field.** Every mutating route declares an **optional** `X-Corpus-Author: user | agent` header parameter (shared schema in `actor.ts`) whose documented default is `user` when absent, so browser clients need no ceremony. _(Adjudicated 2026-07-26: CONTRACT-001 flagged that "required" and "defaulting when absent" are mutually exclusive in OpenAPI and implemented optional-with-documented-default; that reading stands — do not make the header required.)_ A header is used because several mutating routes are `multipart/form-data` or bodiless (`DELETE`, `POST .../resolve`), where a body field would be inconsistent or impossible; the server maps this to the git author for the auto-commit (§7 "acting party as git author"). The typed client factory injects it from a per-call option.
2. **`agent` in the turn-append payload means "requests the agent", not "authored by the agent".** §9.2's "agent flag" and §8's composer toggle are the *enqueue* signal; authorship comes from the header above. The field is therefore named `requestsAgent` in every request schema (turn-append, thread create, capture), and its description states plainly that it controls whether a `comment.created` event is enqueued.

**`GET /api/docs` parameter grammar.**

- `q` — free-text FTS across titles, bodies and turn bodies.
- `type`, `status`, `tag` — comma-separated lists; values OR within a parameter, AND across parameters. `type` is `z.string()` (core values enumerated in the description — `note`, `thread`, `view`, `template`, `skill`, `agent-def` — but open, because plugins define their own types per §5); `status` is a strict enum `open | resolved | archived`. Document that the default result set **excludes `status: archived`** (§11 "Default state excludes `status: archived`") and that passing `status` explicitly overrides that default.
- `folder` — path prefix relative to `data/docs/`.
- `parent` — document id; thread-only filter.
- `references` — document id; matches documents whose body contains `[[<id>]]` (the `links` table, §9.1).
- `agent` — `none | requested | engaged` (§6 frontmatter); thread-only.
- `author` — `user | agent`; matches the thread's last-turn author; thread-only.
- `since` — ISO 8601 datetime; `updated` strictly after it.
- `due` — either an ISO date (due on or before that date) or one of `overdue | today | week`.
- `stale` — staleness tier from §5, `aging | stale | very-stale`, selecting documents at or beyond that tier (`evergreen: true` documents never match).
- `unread` — boolean; thread-only.
- `needs` — the Attention filter: `me` (the union) plus the individual reasons `unread-reply | form | due | stale | failed-job`, so the UI can build both the Attention column and per-reason chips from one endpoint.
- `sort` — `updated | -updated | created | -created | due | title | relevance`; default `-updated`.
- Thread-specific filters (`parent`, `agent`, `author`, `unread`) **no-op** for non-thread types rather than erroring (§9.2); say so in each description.

**Snippets are structured, not HTML.** `Snippet = { field: "title" | "body" | "turn", threadId?: string, segments: Array<{ text: string, match: boolean }> }`. FTS5's `snippet()` output is converted server-side into alternating matched/unmatched segments so the UI renders highlights without `dangerouslySetInnerHTML` and without a markup-escaping contract between server and client. A row's `snippets` array is empty when the query carried no `q`.

**Attention reasons on rows.** `DocRow.attention: NeedsReason[]` — the same enum as the `needs` parameter, minus `me`. Populated on every response (not only when `needs` is set) so any list can render reason chips; empty array when nothing applies.

**`GET /api/tree`.** Returns `{ folders: FolderNode[] }` where `FolderNode = { path, name, count, totalCount, children: FolderNode[] }` — `count` is documents directly in the folder, `totalCount` includes descendants. Powers folder pickers and filter chips (§9.2).

**`POST /api/capture`.** `multipart/form-data`: `text` (required), `files` (repeated, optional). Creates the inbox document plus its agent-requested whole-document filing thread (§11 Capture) and returns `{ docId, threadId, eventId }` — `eventId` is the enqueued `comment.created` event, so the UI can immediately show the pending-agent indicator and the console can link the job back.

**Thread verbs.**

- `POST /api/threads/:id/seen` — body `{ lastSeenTs?: string }`, defaulting to the thread's last turn timestamp; returns `{ threadId, lastSeenTs, unread: false }`. Read state per §7.
- `POST /api/threads/:id/resolve` and `/reopen` — bodiless; return the updated thread summary. Resolving stops later turns from re-triggering the agent (§8) — note that in the description.
- `DELETE /api/threads/:id/turns/:ts` — **user-only**. Description states the §6 cascade: deleting a thread's last turn deletes the thread itself, and deleting a thread removes its anchor entry from the parent's frontmatter. Response `{ deletedTurn: true, deletedThread: boolean, removedAnchor: string | null, parentId: string | null }` so the client knows which caches to drop.
- `DELETE /api/docs/:id` — **user-only**. Description states the §9.2 cascade: the document's threads become orphaned records (they keep their `parent` id, their anchors no longer resolve), git preserves history, and nothing is hard-deleted from history. Response `{ deletedId, orphanedThreadIds: string[] }`.
- Both deletions respond `403` when `X-Corpus-Author: agent` (§7 "the agent archives, never deletes").

**Queue.**

- `QueueEvent = { id, type, created, source, payload }` mirroring the §7 JSON file exactly. `type` is `z.string()` with the core types enumerated in the description (`comment.created`, `form.respond`, `agent.done`) and plugin-defined types explicitly allowed; `payload` is `z.record(z.unknown())` because plugins own their payload shapes. Export a `CoreQueueEventType` enum for consumers that only handle core types.
- `GET /api/queue/idle?timeout=<seconds>` — long-poll replacing the spec's `fs.watch` (Architecture Decision 4). `timeout` defaults to 480 (the ~8 min rearm window) with a documented maximum; responds `200` with `{ events: QueueEvent[] }` the instant pending work exists, or `204` with no body when the window expires so the skill loop re-invokes. Both outcomes are declared responses. Description notes that while halted, `idle` parks for the full window and never returns events.
- `POST /api/queue/claim-all` — atomically moves all `pending/*` to `in-progress/` and returns `{ events: QueueEvent[] }` (empty array while halted).
- `POST /api/queue/:id/complete` — bodiless; `POST /api/queue/:id/fail` — body `{ reason?: string }`; `DELETE /api/queue/:id` — abandon (the §9.2 spelling).
- `POST /api/queue/reap-stale` — returns `{ reaped: string[] }` (in-progress events recovered to pending).
- `POST /api/queue/halt` and `/resume` — toggle the `.corpus/HALT` sentinel; both return `QueueStatus`. `GET /api/queue/status` returns the same `QueueStatus = { halted, pending, inProgress, failed }` — needed because the console strip reads the halted dot and queue depth on load, while SSE only signals invalidation.

**Locks** (§7). `Lock = { docId, holder: "user" | "agent", acquired, ttl }`.

- `POST /api/locks/:docId` — acquire, body `{ ttl?: number }` (seconds); `201` with the `Lock`, or `409` when another party already holds it (the conflict error carries the existing `Lock`).
- `DELETE /api/locks/:docId` — release; only the holder may release (else `403`).
- `POST /api/locks/:docId/break` — force unlock, the human escape hatch; **user-only** (`403` for `agent`), and the description records that breaks are written into the audit trail commit message.
- `POST /api/locks/reap` — clears expired locks, returning `{ reaped: string[] }`.
- `GET /api/locks` — list active locks, for banner hydration on load.
- Distinguish the two failure codes deliberately: **`409`** means "your lock request conflicts with an existing holder"; **`423`** means "this *write* is refused because the document is locked by someone else" and is added to the responses of `PUT /api/docs/:id` and the other document-mutating routes, carrying the blocking `Lock`.

**Jobs** (§7 job logs).

- `Job = { eventId, status, started, updated, lastLine, originId }` — `originId` is the originating document/thread id so the console detail header can link through (§11 console).
- `GET /api/jobs?recent=<n>` — console rows, most recent first.
- `GET /api/jobs/:id/log` — the full log as `{ lines: JobLogLine[] }` with `JobLogLine = { ts, line }`, parsed from `.corpus/jobs/<eventId>.jsonl`.
- `POST /api/jobs/:id/log` — body `{ line: string }`. Description states it is **localhost-only** (the Claude Code `PostToolUse` hook ingest path) and appends to the same file `corpus job log` writes.
- `POST /api/jobs/:id/retry` and `POST /api/jobs/:id/abandon` — the failed-job actions in the console detail header.

**Attachments** (§6).

- `POST /api/threads/:id/turns` gains a `multipart/form-data` request body alongside its JSON body: `text` (optional), `requestsAgent` (optional boolean), `files` (repeated binary). A turn may be **attachment-only**, so the schema must not require `text` — but it must reject a request with neither `text` nor `files` (validation `400`).
- `GET /attachments/{path}` is documented with a `path`-style parameter and a binary `200` response (`application/octet-stream`, actual content type varies). No client fetch wrapper — attachment URLs are used directly in `<img src>` / download links.
- `src/client/upload.ts` exposes a small helper that builds the `FormData` and injects auth + the author header, since `openapi-fetch` handles multipart awkwardly (the edge case CONTRACT-001 flagged).

**SSE** (§9.1, §11). `GET /events` is declared in the OpenAPI document with a `text/event-stream` response and a description covering the 25 s heartbeat and dead-subscriber pruning. Per CONTRACT-001's stated approach the client does **not** expose it as a fetch call: `src/client/events.ts` exports a typed helper (e.g. `createEventStream({ baseUrl, token })`) wrapping `EventSource` and yielding parsed, typed events. `InvalidatePayload = { keys: QueryKey[] }` where `QueryKey = Array<string | number | Record<string, unknown>>` — TanStack Query key arrays, so UI-002 maps an `invalidate` event straight onto `queryClient.invalidateQueries`. Because `EventSource` cannot set an `Authorization` header, the helper passes the bearer token as a `token` query parameter; document that on the route and note that it is acceptable under the localhost-bind model (Architecture Decision 5).

**Errors.** Extend CONTRACT-001's union with `ValidationError` (400, carrying field-level issues), `ForbiddenError` (403, used by every user-only route), `NotFoundError` (404), `ConflictError` (409), and `LockedError` (423, carrying the blocking `Lock`). Each route declares only the codes it can actually return — a blanket "all errors on every route" defeats the point of a typed union.

**Generation and drift.** No changes to `scripts/generate.ts` beyond it picking up the new route modules (keep route registration table-driven so adding a file does not mean editing the generator). Generation must stay idempotent and the pre-push drift check must stay green.

### Edge Cases

- `sort=relevance` without `q` is meaningless — declare it as a `400` validation error rather than silently falling back, and document that.
- `needs=me` composed with other filters intersects rather than replaces (e.g. `needs=me&folder=finance` = Attention within that folder).
- `since` and `due` both accept dates; `since` is a datetime (compared against `updated`), `due` accepts a date **or** a keyword — keep them distinct types so the client cannot pass `overdue` to `since`.
- Comma-separated list params must handle values containing commas (tags) — pin that tags are comma-free by validation and say so in the description, rather than inventing an escaping scheme.
- `204` on `idle` timeout means the generated client returns `data: undefined` with no error; the client helper must not treat that as a failure. Cover it in a test.
- Multipart with zero files must still be a valid turn-append when `text` is present; multipart with files and no text must also be valid; both empty is a `400`.
- `DELETE /api/threads/:id/turns/:ts` — the `ts` path parameter is an ISO timestamp containing `:` characters; declare it as a plain string parameter and note that clients must URL-encode it. Include an encoded-timestamp round-trip in the tests.
- Plugin routes (`/api/x/<plugin>/...`) are explicitly **out of scope** — they are discovered at runtime, not declared in this contract. Note that in the OpenAPI description so the omission does not read as a gap.
- `GET /events` in `openapi.json` must not cause the typed-client generator to emit a broken fetch signature; if `openapi-typescript` produces something unusable for the stream response, keep the path documented and exclude it from the client surface deliberately (with a comment explaining why), rather than reshaping the route to suit the generator.

## Testing Strategy

Vitest in `packages/contract`:

- **Schema round-trips** for every new resource: `DocsQuery` (including each enum's full value set and the comma-list parser), `DocRow` with snippets + attention reasons, `FolderNode` (nested), `QueueEvent` (core type and a plugin-defined type with an arbitrary payload), `QueueStatus`, `Lock`, `Job`, `JobLogLine`, `CaptureResult`, `DeleteTurnResult`, `DeleteDocResult`, `InvalidatePayload`, and each error variant.
- **Rejection tests**: `sort=relevance` without `q`; multipart turn-append with neither text nor files; an unknown `status` value; a `due` keyword passed to `since`.
- **Route mount smoke test**: register every route module on a stub Hono app; assert `/doc` serves and validates as OpenAPI 3.1.
- **Surface completeness**: assert the generated `openapi.json` `paths` set equals the pinned inventory in `src/routes/inventory.ts`, which must in turn list exactly the §9.2 endpoints (plus the queue/lock/job verbs §7 requires). This is the test that fails when the spec grows and the contract does not.
- **Generation idempotency**: run the generator twice into a temp dir; assert byte-identical output.
- **Client helpers**: `createEventStream` parses an `invalidate` frame into a typed `QueryKey[]`; the upload helper builds `FormData` with the expected fields and headers; a `204` response from `idle` surfaces as "no events", not an error.

## E2E Verification Plan

### Verification Steps

1. From a clean tree, run `npm run generate -w packages/contract` → `git status` shows no diff (generation is idempotent and the committed artifacts are current).
2. Inspect `packages/contract/openapi.json` and confirm every §9.2 endpoint is present with the expected method, including `GET /events` (as `text/event-stream`) and `GET /attachments/{path}` (binary).
3. Hand-add a parameter to the `GET /api/docs` route, attempt `git push` without regenerating → the pre-push drift check blocks it; regenerate → push proceeds. Revert.
4. Stand up a stub Hono app mounting the full contract (no real handlers — canned responses), then from a script: make a typed `GET /api/docs?needs=me&stale=stale&sort=-updated` call and observe typed `attention` and `snippets` on the rows; call `POST /api/queue/idle`-style long-poll and observe the `204` path returning no events without throwing; post a multipart turn via the upload helper against a stub route and observe the parsed fields; open the EventSource helper against a stub `/events` route emitting one `invalidate` frame and observe a typed query-key array.
5. Confirm TypeScript rejects the mistakes the contract exists to prevent: `sort: "nonsense"`, an invalid actor value (`X-Corpus-Author: "robot"` — the header is optional, so absence is legal, but a wrong value is a compile error), and reading `.attention` off a non-doc response — each must be a compile error, verified with `tsc` on a scratch file.

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work. Must be from real E2E
testing — no mocks, no test clients. Real application, real requests, real
interfaces. Include specific commands run, actual outputs observed, and pass/fail
conclusions. State which model the implementing agent ran on ("implemented on:
opus | fable")._

### Reproduction (bugs only)
_[Agent fills: N/A — not a bug]_

### Post-Implementation Verification
_[Agent fills: exact commands, observed output, confirmation feature works]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface — every downstream domain consumes this)
- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-002]` prefix
