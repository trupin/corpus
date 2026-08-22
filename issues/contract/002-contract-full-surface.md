# [CONTRACT-002] Contract growth: full API surface (query, tree, capture, queue, locks, jobs, attachments, SSE)

## Domain
contract

## Status
done

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
- SPEC.md §10 (UI — the board) — search filter surface, Attention (`needs=me`), console, SSE invalidation
- SPEC.md §5 (The document model) — doc types, staleness tiers, `[[refs]]`/`references:` filter
- CLAUDE.md — Architecture Decision 3 (contract-first via code), 4 (queue parking over HTTP), 5 (bearer auth)

## Summary
CONTRACT-001 bootstraps `packages/contract` with a deliberately small surface (docs CRUD + threads + queue basics) so that generation, the typed client, and the drift check can be proven end to end. This issue grows that package to the **complete** SPEC.md §9.2 surface: the full `GET /api/docs` query-parameter grammar with snippet highlights and Attention reasons, the folder tree, capture, the remaining thread verbs and user-only deletions, the full queue surface (long-poll idle, claim-all, complete/fail/abandon, reap-stale, halt/resume) with the event object schema, locks, jobs and their log stream, multipart attachments, and the SSE stream. Everything downstream — SERVER-006/008/009/010 and UI-002 — implements against these typed routes rather than inventing shapes, so server/client drift is a type error rather than a runtime surprise. No handlers are written here; this issue produces schemas, `createRoute` definitions, a regenerated `openapi.json`, and a regenerated typed client.

## Acceptance Criteria

- [x] **Docs query.** `GET /api/docs` declares every parameter in §9.2 — `q`, `type`, `status`, `tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`, `stale`, `unread`, `needs`, `sort` — as typed Zod params, with `z.enum` wherever the spec enumerates values and prose descriptions everywhere else. Pagination params stay exactly as CONTRACT-001 defined them; this issue does not change them.
- [x] **Result rows.** The `GET /api/docs` row schema carries structured search `snippets` and an `attention` reason array; both are typed enums/discriminated shapes, not free-form strings.
- [x] **Tree.** `GET /api/tree` returns the `data/docs/` folder tree with names and doc counts.
- [x] **Capture.** `POST /api/capture` (multipart: text + attachments) is defined and returns the created inbox doc id, its filing thread id, and the enqueued event id.
- [x] **Doc mutations.** The §9.2 move and archive/unarchive routes are defined (path changes and `status` flips; the doc id never changes, and the route descriptions say so).
- [x] **Folder-default correction.** `CreateDocRequestSchema.folder`'s description is corrected from "defaults to the root" to "defaults to `inbox`" — SERVER-001's `documentPathFor` implements the inbox default (adjudicated 2026-07-26: the SERVER-001 issue and sprint-001 TEST-14 agree against CONTRACT-001's description; capture semantics also land unfiled docs in `data/docs/inbox/`). The server accepts `folder` as either a bare name (`finance`) or a full prefix (`data/docs/finance`); say so in the description.
- [x] **Thread verbs.** `POST /api/threads/:id/seen`, `/resolve`, `/reopen`, `DELETE /api/threads/:id/turns/:ts` and `DELETE /api/docs/:id` are defined; the two deletions are marked user-only and their **cascade semantics are documented in the route descriptions** and reflected in their response schemas.
- [x] **Queue.** Long-poll `idle` (typed `timeout` param; `200` with events vs `204` on timeout), `claim-all` (batch), `complete`/`fail`, abandon, `reap-stale`, `halt`/`resume` (+ status read) are all defined, plus the `QueueEvent` schema (`id`, `type`, `created`, `source`, `payload`) with core types enumerated and plugin types left open.
- [x] **Locks.** acquire / release / break / reap / list are defined over a `Lock` schema of `{docId, holder: "user" | "agent", acquired, ttl}`.
- [x] **Jobs.** `GET /api/jobs?recent=`, `GET /api/jobs/:id/log`, `POST /api/jobs/:id/log` (described as localhost-only), retry and abandon are defined.
- [x] **Attachments.** `POST /api/threads/:id/turns` has a multipart request schema (files + text + agent flag) alongside its JSON form, and `GET /attachments/{path}` is documented as a binary response.
- [x] **SSE.** `GET /events` appears in `openapi.json` as a `text/event-stream` endpoint; the client exposes a **typed EventSource helper** (not a fetch call) whose `invalidate` payload is a query-key array.
- [x] **Author attribution.** Every mutating route carries the acting party (`user` | `agent`) by the single mechanism pinned below, applied uniformly; user-only routes document rejection of `agent`.
- [x] **Errors.** The typed error union covers `400` validation, `403` forbidden (user-only routes), `404`, `409` conflict, and `423` locked, with the locked variant carrying the `Lock` that blocks the write.
- [x] **Generation.** `npm run generate -w packages/contract` regenerates `openapi.json` and the typed client; running it twice produces identical output; the pre-push drift check stays green on a clean tree.
- [x] **Surface completeness test.** A test asserts the generated `openapi.json` contains exactly the pinned method+path inventory below — adding an endpoint to the spec without adding it to the contract fails a test.
- [x] **Round-trips.** Vitest schema round-trip tests exist for each new resource (query params, doc row, tree node, queue event, lock, job, job log line, capture result, invalidate payload, each error variant).

## Sprint-002 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-002 Open Conflicts affecting this issue — implement exactly these; full rationale in `issues/sprints/sprint-002.md` §Open Conflicts:

1. **`/api/openapi.json` exemption**: the inventory/completeness test asserts over contract-declared paths only; the OpenAPI description gains one sentence naming `/api/openapi.json` as server-local introspection outside the contract (no typed-client method).
2. **Route registration order**: static-before-parameter is pinned in `ALL_CONTRACT_ROUTES` (`reap`/`claim-all`/`halt`/`resume`/`reap-stale` before `{id}`/`{docId}` peers) and held by a test — a `docId` of `reap` must be unambiguous.
3. **Corrections**: queue idle is `GET /api/queue/idle?timeout=` (the issue's E2E step 4 saying POST is wrong); `schemas/actor.ts`, `lock.ts`, `job.ts`, `queue.ts`, `sse.ts` are EXTENSIONS of shipped CONTRACT-001 files, not creations — the existing `ActorHeaderSchema` (optional-with-default, adjudicated) is reused, never rewritten.

## Sprint-002 Adjudications (binding, 2026-07-26)

Orchestrator decisions on the sprint-002 Open Conflicts affecting this issue — implement exactly these; full rationale in `issues/sprints/sprint-002.md` §Open Conflicts:

1. **`/api/openapi.json` exemption**: the inventory/completeness test asserts over contract-declared paths only; the OpenAPI description gains one sentence naming `/api/openapi.json` as server-local introspection outside the contract (no typed-client method).
2. **Route registration order**: static-before-parameter is pinned in `ALL_CONTRACT_ROUTES` (`reap`/`claim-all`/`halt`/`resume`/`reap-stale` before `{id}`/`{docId}` peers) and held by a test — a `docId` of `reap` must be unambiguous.
3. **Corrections**: queue idle is `GET /api/queue/idle?timeout=` (the issue's E2E step 4 saying POST is wrong); `schemas/actor.ts`, `lock.ts`, `job.ts`, `queue.ts`, `sse.ts` are EXTENSIONS of shipped CONTRACT-001 files, not creations — the existing `ActorHeaderSchema` (optional-with-default, adjudicated) is reused, never rewritten.

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

   **It is a tri-state: `z.boolean().optional()` with NO default.** _(Adjudicated 2026-07-26 on CONTRACT-001's pr-reviewer finding 3; CONTRACT-001 implements this for turn-append and thread create, and this issue must carry it to `POST /api/capture` and to the multipart turn-append body.)_ A `.default(false)` collapses "omitted" and "explicitly false" at parse time, which makes §8's **"note only"** toggle unexpressible: a user replying in an `engaged` thread could no longer suppress the re-trigger. The three states, which every field description must state:
   - **omitted** → server default behavior. Thread create/capture: enqueue only on an explicit `@agent` / `@<subagent>` mention or `/<skill>` invocation. Turn append: enqueue when the thread is already `engaged`, otherwise only on such a mention or invocation.
   - **`true`** → request the agent.
   - **`false`** → "note only": suppress the enqueue **even when the thread is engaged**.

   The corresponding `eventId` response fields describe the same three cases and state that an explicit `false` always yields `null`.

**`GET /api/docs` parameter grammar.**

- `q` — free-text FTS across titles, bodies and turn bodies.
- `type`, `status`, `tag` — comma-separated lists; values OR within a parameter, AND across parameters. `type` is `z.string()` (core values enumerated in the description — `note`, `thread`, `view`, `template`, `skill`, `agent-def` — but open, because plugins define their own types per §5); `status` is a strict enum `open | resolved | archived`. Document that the default result set **excludes `status: archived`** (§10 "Default state excludes `status: archived`") and that passing `status` explicitly overrides that default.
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

**`POST /api/capture`.** `multipart/form-data`: `text` (required), `files` (repeated, optional). Creates the inbox document plus its agent-requested whole-document filing thread (§10 Capture) and returns `{ docId, threadId, eventId }` — `eventId` is the enqueued `comment.created` event, so the UI can immediately show the pending-agent indicator and the console can link the job back.

**Thread verbs.**

- `POST /api/threads/:id/seen` — body `{ lastSeenTs?: string }`, defaulting to the thread's last turn timestamp; returns ~~`{ threadId, lastSeenTs, unread: false }`~~ `{ threadId, lastSeenTs, unread: boolean }`. Read state per §7.
  - **Superseded by [CONTRACT-010] (2026-07-27).** The `unread: false` pin above is adjudicated defective and no longer binding. It contradicts this same bullet's optional `lastSeenTs`: a mark placed before the thread's last turn is a partial read, after which later turns are unseen and the thread is — by §7's own definition — still unread. A `literal(false)` had the mutation response assert a cleared badge that the next `GET /api/docs` immediately re-raises. `MarkSeenResult.unread` is now a plain boolean reporting the state the mark actually leaves behind (same honesty class as the `appended` literal fixed by CONTRACT-006). Verifying CONTRACT-002 against this line must use the boolean, not the literal.
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
- `POST /api/queue/halt` and `/resume` — toggle the `.corpus/HALT` sentinel; both return `QueueStatus`. `GET /api/queue/status` returns the same `QueueStatus` — which CONTRACT-001 already shipped as `{ halted, pending, inProgress, processed, failed, abandoned }` (the superset §9.2's "per-status counts" requires); reuse it unchanged — needed because the console strip reads the halted dot and queue depth on load, while SSE only signals invalidation.

**Locks** (§7). `Lock = { docId, holder: "user" | "agent", acquired, ttl }`.

- `POST /api/locks/:docId` — acquire, body `{ ttl?: number }` (seconds); `201` with the `Lock`, or `409` when another party already holds it (the conflict error carries the existing `Lock`).
- `DELETE /api/locks/:docId` — release; only the holder may release (else `403`).
- `POST /api/locks/:docId/break` — force unlock, the human escape hatch; **user-only** (`403` for `agent`), and the description records that breaks are written into the audit trail commit message.
- `POST /api/locks/reap` — clears expired locks, returning `{ reaped: string[] }`.
- `GET /api/locks` — list active locks, for banner hydration on load.
- Distinguish the two failure codes deliberately: **`409`** means "your lock request conflicts with an existing holder"; **`423`** means "this *write* is refused because the document is locked by someone else" and is added to the responses of `PUT /api/docs/:id` and the other document-mutating routes, carrying the blocking `Lock`.

**Jobs** (§7 job logs).

- `Job = { eventId, status, started, updated, lastLine, originId }` — `originId` is the originating document/thread id so the console detail header can link through (§10 console).
- `GET /api/jobs?recent=<n>` — console rows, most recent first.
- `GET /api/jobs/:id/log` — the full log as `{ lines: JobLogLine[] }` with `JobLogLine = { ts, line }`, parsed from `.corpus/jobs/<eventId>.jsonl`.
- `POST /api/jobs/:id/log` — body `{ line: string }`. Description states it is **localhost-only** (the Claude Code `PostToolUse` hook ingest path) and appends to the same file `corpus job log` writes.
- `POST /api/jobs/:id/retry` and `POST /api/jobs/:id/abandon` — the failed-job actions in the console detail header.

**Attachments** (§6).

- `POST /api/threads/:id/turns` gains a `multipart/form-data` request body alongside its JSON body: `text` (optional), `requestsAgent` (optional boolean), `files` (repeated binary). A turn may be **attachment-only**, so the schema must not require `text` — but it must reject a request with neither `text` nor `files` (validation `400`).
- `GET /attachments/{path}` is documented with a `path`-style parameter and a binary `200` response (`application/octet-stream`, actual content type varies). No client fetch wrapper — attachment URLs are used directly in `<img src>` / download links.
- `src/client/upload.ts` exposes a small helper that builds the `FormData` and injects auth + the author header, since `openapi-fetch` handles multipart awkwardly (the edge case CONTRACT-001 flagged).

**SSE** (§9.1, §10). `GET /events` is declared in the OpenAPI document with a `text/event-stream` response and a description covering the 25 s heartbeat and dead-subscriber pruning. Per CONTRACT-001's stated approach the client does **not** expose it as a fetch call: `src/client/events.ts` exports a typed helper (e.g. `createEventStream({ baseUrl, token })`) wrapping `EventSource` and yielding parsed, typed events. `InvalidatePayload = { keys: QueryKey[] }` where `QueryKey = Array<string | number | Record<string, unknown>>` — TanStack Query key arrays, so UI-002 maps an `invalidate` event straight onto `queryClient.invalidateQueries`. Because `EventSource` cannot set an `Authorization` header, the helper passes the bearer token as a `token` query parameter; document that on the route and note that it is acceptable under the localhost-bind model (Architecture Decision 5).

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

**implemented on: opus**

Environment, per `issues/sprints/sprint-002.md` § Verification Environment: the generated
artifacts on disk, plus a **real `OpenAPIHono` app mounting the contract, bound to a real
socket on `127.0.0.1:8965`**, driven by the **real generated client** imported through the
published `@corpus/contract` / `@corpus/contract/client` entry points (i.e. out of `dist/`,
after `npm run build`). No supertest-style in-memory client is used for any step below;
`app.fetch()` appears only in the unit tests. Node v25.2.1, npm workspaces.

### Reproduction (bugs only)
N/A — CONTRACT-002 is a feature issue, not a bug. No pre-fix reproduction applies.

### Post-Implementation Verification

**Step 1 — generation is idempotent and byte-deterministic (TEST-1).**

```
$ npm run generate -w packages/contract   # run 1
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ shasum packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
a90388a92c641c24c4bef4091563b329d30379f8  packages/contract/openapi.json
ff2642bc8f3a7f69701c2091c62a0d265ee918a2  packages/contract/src/client/schema.generated.ts
                                          # runs 2 and 3 → identical hashes, verbatim
```

Three consecutive runs produced byte-identical artifacts. `git status --porcelain
packages/contract` lists the issue's own (uncommitted) source changes and the two
regenerated artifacts; re-running the generator adds nothing to that list. PASS.

**Step 2 — the document declares exactly the pinned inventory (TEST-2).**

```
$ node -e "…enumerate paths × methods of packages/contract/openapi.json…"
count 39
GET /api/health · GET|POST /api/docs · GET|PUT|DELETE /api/docs/{id} ·
POST /api/docs/{id}/move · POST /api/docs/{id}/archive · POST /api/docs/{id}/unarchive ·
GET /api/tree · POST /api/capture · POST /api/threads · GET /api/threads/{id} ·
POST /api/threads/{id}/turns · DELETE /api/threads/{id}/turns/{ts} ·
POST /api/threads/{id}/{resolve,reopen,seen} · GET /api/queue/{status,idle} ·
POST /api/queue/{claim-all,reap-stale,halt,resume} · POST /api/queue/{id}/{complete,fail} ·
DELETE /api/queue/{id} · GET /api/locks · POST /api/locks/reap ·
POST|DELETE /api/locks/{docId} · POST /api/locks/{docId}/break · GET /api/jobs ·
GET|POST /api/jobs/{id}/log · POST /api/jobs/{id}/{retry,abandon} ·
GET /events · GET /attachments/{path}
```

39 endpoints — the sprint's pinned list plus the three chosen document-mutation spellings
(`/move`, `/archive`, `/unarchive`), which the inventory, the route definitions and
`openapi.json` all agree on. `GET /events` carries `content: {"text/event-stream": …}` and
`GET /attachments/{path}` carries `content: {"application/octet-stream": {schema:
{type:"string", format:"binary"}}}`. `src/routes/inventory.test.ts` re-asserts this against
the **committed** file on every run. PASS.

**Step 3 — the drift check still blocks a stale contract (TEST-23).**

The pre-push hook's `contract_drift()` first guard (regenerate, compare before/after hashes)
was extracted verbatim to `/tmp/drift-check.sh` and run against the tree. A `driftProbe`
query parameter was then hand-added to the `GET /api/docs` route definition without
regenerating:

```
$ bash /tmp/drift-check.sh          # clean tree
contract drift: clean               exit=0

# after hand-adding `driftProbe` to src/routes/docs.ts:
$ bash /tmp/drift-check.sh
  The committed API contract is stale relative to packages/contract/src.
  Fix: npm run generate -w packages/contract && git add packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
                                    exit=1
$ bash /tmp/drift-check.sh          # the guard's own regenerate cleared it
contract drift: clean               exit=0
$ node -e "…" → driftProbe now in doc: true
```

The probe edit was then reverted and the artifacts regenerated; the hashes returned to
`a90388a9…` / `ff2642bc…` exactly, and `driftProbe gone: true`. The hook's *second* guard
(`git diff --exit-code HEAD -- <artifacts>`) is inert in an uncommitted worktree by
construction — it compares against `HEAD`, and every file in this issue is still
uncommitted — so it will exercise on the orchestrator's commit, not here. PASS.

**Step 4 — real socket, real generated client (TEST-15, TEST-19, TEST-20, TEST-24).**

A probe mounted the contract's route definitions on a real `OpenAPIHono`, served it over
`node:http` on `127.0.0.1:8965` (port assigned by the sprint contract), and drove it with
`createCorpusClient` from the built `@corpus/contract/client`. Run with
`node --experimental-eventsource --import tsx` (the flag is required: global `EventSource`
is behind it on Node v25.2.1). Verbatim output:

```
[probe] real Hono app listening on http://127.0.0.1:8965
[1] status          : 200
[1] excerpt echo    : needs=me stale=stale sort=-updated
[1] typed attention : ["unread-reply","stale"]
[1] typed snippets  : [{"field":"title","segments":[{"text":"Mortgage ","match":false},{"text":"options","match":true}]}]
[2] status          : 204
[2] data            : undefined
[2] error           : undefined
[3] parsed parts    : {"text":"look at this","requestsAgent":false,"files":["shot.png","notes.txt"],"auth":"Bearer e2e-workspace-token-0123456789","actor":"agent"}
[3] eventId         : null
[4] stream url      : http://127.0.0.1:8965/events?token=e2e-workspace-token-0123456789
[4] typed query keys: [["docs",{"folder":"finance"}],["queue",1]]
```

- `[1]` `GET /api/docs?needs=me&stale=stale&sort=-updated` over a real socket; the client
  types `attention` as `NeedsReason[]` and `snippets[].segments[].match` as `boolean`.
- `[2]` the long-poll timeout resolves as `data: undefined` with **no thrown error and no
  `error` field** — a `204` is a normal outcome, not a failure.
- `[3]` `client.uploadTurn(...)` built the multipart body; the route's own validator parsed
  `text`, an explicit `requestsAgent: false` (surviving as `false`, not collapsed) and two
  repeated `files` parts, and the helper attached `Authorization: Bearer …` plus
  `x-corpus-author: agent`. The explicit `false` produced `eventId: null`.
- `[4]` `client.connectEvents(...)` opened a **real `EventSource`** against the stub
  `/events` route and parsed one `invalidate` frame into a typed TanStack query-key array.

PASS on all four.

**Step 5 — the type system rejects what the contract exists to prevent (TEST-22).**

Two scratch files were compiled with `tsc --noEmit --strict --exactOptionalPropertyTypes
--module nodenext` against the regenerated client.

Must compile (`scratch-types-ok.ts`) — omits `x-corpus-author` entirely, uses a declared
`sort`, reads `.attention` / `.snippets[].segments[].match` off a doc row, sends an explicit
`x-corpus-author: "user"`:

```
ok-exit=0
```

Must not compile (`scratch-types-bad.ts`):

```
scratch-types-bad.ts(8,22):  error TS2322: Type '"nonsense"' is not assignable to type
  '"updated" | "-updated" | "created" | "-created" | "due" | "title" | "relevance" | undefined'.
scratch-types-bad.ts(13,51): error TS2322: Type '"robot"' is not assignable to type
  '"agent" | "user" | undefined'.
scratch-types-bad.ts(18,37): error TS2339: Property 'attention' does not exist on type
  '{ status: "ok"; version: string; uptimeSeconds: number; workspace: string; }'.
bad-exit=2
```

Exactly the three intended errors, and omitting the actor header is legal. PASS. All three
scratch files were deleted after the run; nothing outside `packages/contract/**` and this
issue file was touched.

**Repo-wide gate (from a clean build).**

```
npm run build          → 0   (contract → kit → cli → server/ui)
npm run lint           → 0   (eslint, no suppressions added)
npm run format:check   → 0   ("All matched files use Prettier code style!")
npm run typecheck      → 0   (every workspace, incl. apps/cli + apps/ui against the
                              regenerated client — no cast, no adapter shim)
npm run test:coverage  → 0   61 files, 1160 tests passed
                             All files 99.83% lines / 95.77% branches / 100% functions
                             every packages/contract/src file at 100/100/100/100
```

### Deviations and notes for the orchestrator

- **`AttachmentRef` was deliberately not created.** The issue's file list names it, but no
  §9.2 endpoint can produce one: the projection's `turns` table carries only `body_md`
  (§9.1) and §6 says attachments live in the committed markdown as relative links. A schema
  with no producer would be dead contract surface, so `schemas/attachment.ts` ships the
  multipart file-part primitives and the attachment path parameter instead, with the
  reasoning recorded in the module comment.
- **`DocSummarySchema` was replaced by `DocRowSchema`.** The row now carries `snippets` and
  `attention`, and a base row schema with neither had no remaining consumer. No workspace
  outside `packages/contract` referenced it (verified by grep), so no consumer smoke test
  needed updating. `DocsQuerySchema`/`DocListSchema` moved from `schemas/doc.ts` to the new
  `schemas/query.ts`; both are still re-exported from the package root, so consumer imports
  are unchanged.
- **Pre-existing wart, out of scope:** CONTRACT-001's `CreateDocRequestSchema` uses
  `.default()` on `tags`/`status`/`due`/`evergreen`, which `openapi-typescript` renders as
  *required* request-body fields, so a typed `POST /api/docs` must send all four. Not
  touched here (it is CONTRACT-001 surface and changing it changes server semantics), but
  worth a follow-up issue.

### Addendum — 2026-07-26, `internal_error` (orchestrator-adjudicated micro-task, opus)

SERVER-003 found that the union had no code for an unexpected `500`, so a last-resort error
handler could not emit a body conforming to `ApiErrorSchema` without mislabelling a crash as
`bad_request` or `conflict`. Added `internal_error` to `ERROR_CODES` and an
`InternalErrorSchema` (`{ code: "internal_error", message }`) variant to `ApiErrorSchema`.

**Invariant, recorded in the schema's `description` and pinned by a test:** the code exists so
the body type-checks; **no route declares a `500` response**, by design — a documented `500`
would advertise an unexpected failure as a designed outcome. New test in `src/openapi.test.ts`
asserts no operation carries a `500` and that `InternalError` never reaches
`components.schemas`.

```
shasum -a 256 (before regeneration)
  f7f182c8…5b6411  packages/contract/openapi.json
  b71d25c1…4cb594  packages/contract/src/client/schema.generated.ts
npm run generate -w packages/contract   → 0
shasum -a 256 (after regeneration)
  f7f182c8…5b6411  packages/contract/openapi.json          ← byte-identical
  b71d25c1…4cb594  packages/contract/src/client/schema.generated.ts  ← byte-identical

npx vitest run packages/contract        → 0   557 tests passed (was 554; +3 for the new variant
                                              through the describe.each, +1 500-invariant test)
npm run build                           → 0
npm run typecheck -w packages/contract  → 0
npx eslint <touched files>              → 0   "No issues found"
npx prettier --check <touched files>    → 0   "All files formatted correctly"
node --import tsx scripts/check-generated-artifacts.ts → 0
  ✓ API contract is up to date (openapi.json, schema.generated.ts)
```

The artifacts are unchanged because `ApiError` is not itself a referenced component — the
document registers only the per-code variants that routes actually declare, and `InternalError`
is declared by none. That is the invariant holding, visible in the byte hashes.

### Addendum — 2026-07-26, optional halt body (orchestrator-adjudicated micro-task, opus)

SERVER-008 found that `POST /api/queue/halt` declared no body, so a halt reason could not cross
the wire even though `QueueService.halt(reason)` accepts one and the server writes
`{reason?, at}` into the `.corpus/HALT` sentinel. Added `HaltQueueRequestSchema`
(`{ reason?: string, min 1 }`, `.openapi("HaltQueueRequest")`) and attached it to the route as
an **optional** `application/json` body.

Invariants honoured:

- **Bare POST stays valid.** The body declares `required: false`, and every property is
  optional, so Hono's json validator (which leaves the value `{}` when no `Content-Type` is
  sent) parses a bodiless request cleanly. `openapi-typescript` renders it `requestBody?:`, so
  `client.api.POST("/api/queue/halt")` compiles with no second argument — pinned by a
  compile-time probe (`undefined extends …["requestBody"]`) plus a runtime call.
- **400 declaration.** Halt already carried the optional actor header, so it already declared
  `400`; a named test now pins that specifically, since the body is what makes the
  "validates-input ⇒ declares 400" invariant load-bearing here.
- **No defaults in request bodies (CONTRACT-003).** `reason` is a plain `.optional()`, no
  `.default()`. The document-wide `requestBodyDefaults()` invariant stays green.
- **Named components.** `HaltQueueRequest` is a plain, non-nullable, undefaulted object, so the
  named-component invariant is unaffected.

One consistency fix rode along: `POST /api/queue/{id}/fail` also accepts an omittable body but
inherited its optionality from OpenAPI's implicit `required: false`. It now states the flag
explicitly, matching halt. Generated TypeScript is unchanged for it (`requestBody?:` either way)
— only the document is more honest.

```
shasum -a 256 (after regeneration, run twice)
  d079454565…ebdc1b2  packages/contract/openapi.json                    ← identical both runs
  17642ed370…5ea95d   packages/contract/src/client/schema.generated.ts  ← identical both runs

npx vitest run packages/contract              → 0   596 tests, 26 files, all passed
npx vitest run packages/contract -t halt      → 0   18 matching tests passed
npm run typecheck -w packages/contract        → 0
npx eslint packages/contract --max-warnings 0 → 0   "No issues found"
npx prettier --check packages/contract/**     → 0   "All matched files use Prettier code style!"
```

Drift guard verified to **fire**, not merely to pass: hand-editing `openapi.json` to
`requestBody.required: true` made `src/generation/artifacts.test.ts` fail with
`openapi.json is stale — run: npm run generate -w packages/contract`; the file was restored to
the generated bytes afterwards (hash re-verified above). `scripts/check-generated-artifacts.ts`
clears its content-hash arm (regeneration is a no-op) and then reports the expected
`git diff HEAD` against the still-uncommitted artifacts — it goes green once the orchestrator
commits `openapi.json` and `schema.generated.ts` with this change.

**Escalation for the orchestrator (pre-existing, not touched).** Every *other* request body in
the document also lacks `required`, so OpenAPI reads them all as optional and
`openapi-typescript` emits `requestBody?:` even for genuinely mandatory bodies — e.g.
`client.api.POST("/api/docs")` with no body compiles and then 400s at runtime. Fixing it means
declaring `required: true` on ~9 operations, which tightens types that `apps/cli` and `apps/ui`
consume; deliberately left for its own issue rather than done mid-sprint.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface — every downstream domain consumes this)
- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-002]` prefix
