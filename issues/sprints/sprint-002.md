# Sprint 002 — Phase 2 Opening Batch

**Issues**: CONTRACT-002, SERVER-003, CLI-001, SERVER-012
**Domains**: contract, server, cli
**Date**: 2026-07-26
**Plan phase**: Phase 2 — Server Backbone + CLI
**Branch**: `phase-2-server-cli`

---

## Verification Environment (read this first)

This sprint crosses a threshold: **SERVER-003 is the first running Corpus server**, so
for the first time "real application" can mean a real process on a real socket answering
real HTTP. It does not mean that for every issue in the batch. Calibrate per issue:

| Issue       | What counts as the "real application" in this sprint                                                                                                                                                                                                             |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| CONTRACT-002 | The generated artifacts on disk (`openapi.json`, `schema.generated.ts`), plus a **real Hono app** mounting the full contract with canned handlers, bound to a real port and driven by the real generated client. No supertest-style in-memory client for the E2E steps; `app.fetch()` is fine for unit tests only. |
| SERVER-003  | A **real `corpus` server process** (`npx tsx apps/server/src/main.ts`) against a **real workspace on real disk** (`mktemp -d` + real `.corpus/config.json`), driven by real `curl` and real signals (`kill -TERM`). Not `app.fetch()` — that is the unit-test path.  |
| CLI-001     | The **real built binary** (`npm run build -w apps/cli && npm link -w apps/cli` → `corpus`), never `tsx src/…`, in a real shell, with `echo $?` read for every exit code. Its server counterpart is either the real SERVER-003 process (integration path) or a real `node:http` stub on an ephemeral port (standalone path) — both are real sockets. |
| SERVER-012  | Real markdown files edited on real disk in a real `git init` scratch workspace, `git diff -U0` as the observation instrument, driven by real `tsx` scripts against **freshly built** sources — identical to sprint-001's SERVER-002 environment, which the SERVER-002 eval used for all three rounds. |

**Build before verifying.** `@corpus/*` imports resolve through each package's `exports`
map into `dist/`. Every verification step in this contract assumes `npm run build` ran
from a clean tree first. A probe that imports stale `dist/` is not evidence.

### Port allocation (three agents may run concurrently)

The default workspace port is 8765 and **two issues in this batch would otherwise both
claim it**. Ports are assigned; an agent that needs another one picks an unassigned
number and records it in its E2E log.

| Consumer                                | Port                                                                 |
| --------------------------------------- | -------------------------------------------------------------------- |
| SERVER-003 manual E2E server            | `8765` (its documented default — it owns this number)                |
| SERVER-003 automated tests              | `0` (ephemeral). Never hardcode 8765 in a test.                      |
| CLI-001 stub server + integration probes | `8865`, via `CORPUS_PORT=8865`                                       |
| CONTRACT-002 stub Hono app              | `8965`                                                               |
| Playwright / Vite dev server            | `CORPUS_UI_PORT=5273` — **5173 is held by an unrelated developer process on this machine**; do not assume it is free and do not "fix" the config's 5173 default. |

### Runtime gotchas that will otherwise be misread as bugs

- **Node is v25.2.1 locally; CI pins Node 22.** Global `EventSource` is behind a flag on
  this Node build. CONTRACT-002's `createEventStream` tests must use the existing
  injectable `EventSourceFactory` (already in `packages/contract/src/client/events.ts`)
  rather than depending on a global. An E2E step that needs a real EventSource must state
  the flag it ran with.
- **`diff-match-patch`'s `Diff_Timeout` is 1 s** and dominates large-body timings in the
  anchor engine. A 1 MB all-orphan case measuring ~1 s is the timeout degrading
  gracefully, not a SERVER-012 regression — the SERVER-002 eval established this in round
  1. Perf claims must A/B against the pre-fix engine, not against an absolute budget.
- **jsdom's `localStorage` quirk** on this Node build affects UI tests only; no issue in
  this batch touches `apps/ui`.

### Deferred verification is recorded, not skipped

Any test below that cannot be executed — because the issue it depends on has not landed
at the moment of verification — is marked `DEFERRED → <issue>` in the E2E Verification Log
with the reason and the substitute evidence supplied. Silent omission is a fail.

---

## Acceptance Tests

### CONTRACT-002: Contract growth — full API surface

TEST-1: Generation is idempotent and the committed artifacts are current
Given: A clean working tree with CONTRACT-002's route modules landed.
When: `npm run generate -w packages/contract` is run twice in a row.
Then: `git status --porcelain packages/contract` prints nothing after each run, and the
two runs produce byte-identical `openapi.json` and `src/client/schema.generated.ts`.

TEST-2: The generated document contains exactly the pinned endpoint inventory
Given: The regenerated `packages/contract/openapi.json`.
When: A test compares its `paths` × methods set against `src/routes/inventory.ts`.
Then: The two sets are equal, and the inventory contains at least these method+path
pairs (paths whose spelling §9.2 pins verbatim):

```
GET    /api/health                       GET    /api/tree
GET    /api/docs                         POST   /api/capture
GET    /api/docs/{id}                    GET    /api/threads/{id}
POST   /api/docs                         POST   /api/threads
PUT    /api/docs/{id}                    POST   /api/threads/{id}/turns
DELETE /api/docs/{id}                    POST   /api/threads/{id}/resolve
                                         POST   /api/threads/{id}/reopen
GET    /api/queue/idle                   POST   /api/threads/{id}/seen
POST   /api/queue/claim-all              DELETE /api/threads/{id}/turns/{ts}
POST   /api/queue/{id}/complete
POST   /api/queue/{id}/fail              GET    /api/locks
DELETE /api/queue/{id}                   POST   /api/locks/{docId}
POST   /api/queue/reap-stale             DELETE /api/locks/{docId}
POST   /api/queue/halt                   POST   /api/locks/{docId}/break
POST   /api/queue/resume                 POST   /api/locks/reap
GET    /api/queue/status
                                         GET    /events
GET    /api/jobs                         GET    /attachments/{path}
GET    /api/jobs/{id}/log
POST   /api/jobs/{id}/log
POST   /api/jobs/{id}/retry
POST   /api/jobs/{id}/abandon
```

plus exactly three document-mutation routes for **move**, **archive** and **unarchive**
(§9.2 does not spell their paths; CONTRACT-002 picks the spelling, and the inventory,
the route definitions and `openapi.json` must all agree on it). Adding a §9.2 endpoint to
the spec without adding it here fails this test.

TEST-3: Static route segments are not shadowed by path parameters
Given: A real Hono app mounting the full contract.
When: `POST /api/locks/reap` and `POST /api/queue/reap-stale` are called.
Then: Each reaches its own handler, not the `{docId}` / `{id}` route. (Registration order
is load-bearing here — a test, not a comment, must hold it.)

TEST-4: The `GET /api/docs` parameter grammar is complete and typed
Given: The regenerated `openapi.json`.
When: The `GET /api/docs` parameter list is inspected.
Then: All fifteen §9.2 parameters are present as `in: query`, non-required: `q`, `type`,
`status`, `tag`, `folder`, `parent`, `references`, `agent`, `author`, `since`, `due`,
`stale`, `unread`, `needs`, `sort` — plus the CONTRACT-001 pagination params. `status` is
a strict enum `open|resolved|archived`; `agent` is `none|requested|engaged`; `author` is
`user|agent`; `stale` is `aging|stale|very-stale`; `needs` is
`me|unread-reply|form|due|stale|failed-job`; `sort` is
`updated|-updated|created|-created|due|title|relevance` with default `-updated`; `type` is
an open string whose description enumerates `note, thread, view, template, skill,
agent-def` and states that plugins define their own.

TEST-5: Thread-only filters and default-archived exclusion are documented
Given: The `GET /api/docs` route description and parameter descriptions.
When: They are read.
Then: `parent`, `agent`, `author` and `unread` each state that they no-op for non-thread
types rather than erroring, and the `status` description states that the default result
set excludes `status: archived` and that passing `status` explicitly overrides that.

TEST-6: `sort=relevance` without `q` is a declared validation failure
Given: The `DocsQuery` schema.
When: `{ sort: "relevance" }` is parsed with no `q`.
Then: Parsing fails with a validation issue naming the constraint; the route declares
`400` and the behavior is stated in the `sort` description. It does not silently fall back
to `-updated`.

TEST-7: Result rows carry structured snippets and attention reasons
Given: The `DocRow` schema.
When: A row with one title snippet (`segments: [{text,match:false},{text,match:true}]`),
one turn snippet carrying a `threadId`, and `attention: ["unread-reply","due"]` is parsed
and re-serialized.
Then: It round-trips unchanged; `snippets` and `attention` are required arrays (empty
arrays are valid, `undefined` is not); `attention`'s value set is the `needs` enum **minus
`me`**; and no snippet field is HTML or free-form markup.

TEST-8: CONTRACT-001's pinned shapes are reused unchanged
Given: CONTRACT-001's `HealthSchema`, `PaginationQuerySchema` and `QueueStatusSchema`.
When: They are compared before and after CONTRACT-002.
Then: All three are byte-identical in behavior. Specifically: `QueueStatus` still has
exactly the six fields `halted, pending, inProgress, processed, failed, abandoned` and is
the response of `GET /api/queue/status`, `POST /api/queue/halt` and `POST
/api/queue/resume`; `limit` still defaults to 50 with max 200 and `offset` to 0; `Health`
still carries `uptimeSeconds` (**not** `uptimeMs`). Widening any of these is out of scope.

TEST-9: The folder default is corrected to `inbox`
Given: `CreateDocRequestSchema.folder`'s description in the regenerated `openapi.json`.
When: It is read.
Then: It says the folder defaults to `inbox` (not "the root"), and states that both a bare
name (`finance`) and a full prefix (`data/docs/finance`) are accepted. The string
"defaults to the root" appears nowhere in the generated document.

TEST-10: `requestsAgent` remains a tri-state everywhere it appears
Given: `CreateThreadRequest`, `AppendTurnRequest`, the **multipart** turn-append body, and
the new `POST /api/capture` request.
When: Each is parsed with the field omitted, with `true`, and with `false`.
Then: The omitted case produces an object where the key is **absent** (no `.default()`
anywhere collapses it), `true` and `false` survive as themselves, and every field
description spells out all three cases including "note only" suppression in an engaged
thread. The corresponding `eventId` response descriptions state that an explicit `false`
always yields `null`.

TEST-11: Author attribution is a uniform optional header
Given: The regenerated `openapi.json`.
When: Every mutating route (every `POST`, `PUT`, `DELETE` in the inventory) is inspected.
Then: Each declares the `x-corpus-author` header parameter as `required: false` with a
documented default of `user` and the value set `user|agent`. No mutating route carries an
author field in its body instead. A wrong value (`robot`) is a compile error in the typed
client; absence is legal.

TEST-12: User-only routes declare rejection of the agent actor
Given: `DELETE /api/docs/{id}`, `DELETE /api/threads/{id}/turns/{ts}` and `POST
/api/locks/{docId}/break`.
When: Their responses and descriptions are inspected.
Then: Each declares `403` and states in prose that `x-corpus-author: agent` is rejected
(§7 — "the agent archives, never deletes").

TEST-13: Deletion cascades are documented and reflected in the response shapes
Given: The two deletion routes.
When: Their response schemas are parsed.
Then: `DELETE /api/threads/{id}/turns/{ts}` returns
`{deletedTurn, deletedThread, removedAnchor, parentId}` and its description states the §6
cascade (deleting the last turn deletes the thread; deleting a thread removes its anchor
from the parent's frontmatter); `DELETE /api/docs/{id}` returns
`{deletedId, orphanedThreadIds}` and its description states that the doc's threads become
orphaned records and git preserves history.

TEST-14: The ISO-timestamp path parameter survives encoding
Given: `DELETE /api/threads/{id}/turns/{ts}` with `ts = 2026-07-19T10:05:00Z`.
When: The typed client issues the call with the parameter URL-encoded.
Then: The request path contains `2026-07-19T10%3A05%3A00Z`, the route matches, and the
parameter description tells clients to encode it.

TEST-15: Long-poll `idle` declares both outcomes and the `204` is not an error
Given: A real stub app on `127.0.0.1:8965` where `GET /api/queue/idle` returns `204` with
no body.
When: The generated client calls it.
Then: The call resolves with `data: undefined` and **no thrown error and no `error`
field**; the route declares both `200` (`{events: QueueEvent[]}`) and `204`; `timeout`
defaults to `480` with a documented server-side maximum; and the description states that
while halted, `idle` parks for the full window and never returns events.

TEST-16: The queue event object mirrors the §7 file
Given: `QueueEventSchema`.
When: A core event (`type: "comment.created"`) and a plugin event
(`type: "todos.completed"` with an arbitrary nested payload) are parsed.
Then: Both pass; `type` is an open string with the three core types enumerated in its
description; `payload` accepts any record; and `CoreQueueEventType` is exported for
consumers that only handle core types.

TEST-17: Locks distinguish 409 from 423
Given: The lock routes and the document-mutating routes.
When: Their declared responses are inspected.
Then: `POST /api/locks/{docId}` declares `201` (the `Lock`) and `409` (conflict carrying
the existing `Lock`); `PUT /api/docs/{id}` and the other document-mutating routes declare
`423` carrying the blocking `Lock`; `Lock` is `{docId, holder: "user"|"agent", acquired,
ttl}`; and `DELETE /api/locks/{docId}` declares `403` for a non-holder.

TEST-18: The error union covers every code and routes declare only what they return
Given: The extended error union.
When: Each variant is round-tripped and each route's `responses` map is inspected.
Then: `400` validation (with field issues), `403` forbidden, `404`, `409` conflict and
`423` locked all parse and discriminate on `code`; and **no route declares a code it
cannot return** — spot-check that `GET /api/health` declares neither `401` nor `423`, and
that a read-only route declares no `409`.

TEST-19: Multipart turn-append accepts attachment-only turns and rejects empty ones
Given: The multipart request schema for `POST /api/threads/{id}/turns`.
When: Three requests are validated: text with zero files; one file with no text; neither
text nor files.
Then: The first two pass; the third fails validation with a `400` naming the constraint.
The upload helper in `src/client/upload.ts` builds a `FormData` carrying the expected
field names plus the `Authorization` and `x-corpus-author` headers — verified against a
real stub route on `:8965` that echoes back the parsed parts.

TEST-20: SSE is documented as a stream and exposed as a typed helper, not a fetch call
Given: The regenerated `openapi.json` and the client surface.
When: `GET /events` is inspected and the helper is driven against a real stub SSE route on
`:8965` emitting one `invalidate` frame.
Then: The document declares `text/event-stream` and describes the 25 s heartbeat, dead
subscriber pruning, and the `token` query parameter; the client exposes
`createEventStream` (injectable `EventSourceFactory` — see the Node 25 gotcha) and yields
a typed `{keys: QueryKey[]}` where `QueryKey` is a TanStack-shaped array; and the client
exposes **no** fetch method for `/events`. If `openapi-typescript` emits an unusable
signature for it, the exclusion is deliberate and carries an explanatory comment.

TEST-21: Attachments are declared as binary, plugin routes as deliberately absent
Given: The regenerated document.
When: `GET /attachments/{path}` and the top-level description are read.
Then: The attachment route declares a binary `200` response and no client fetch wrapper is
generated for it; and the document's description states that plugin routes
(`/api/x/<plugin>/…`) are discovered at runtime and deliberately not declared, so the
omission does not read as a gap.

TEST-22: The type system rejects what the contract exists to prevent
Given: A scratch TypeScript file importing the regenerated client.
When: `tsc --noEmit` is run over it with each of: `sort: "nonsense"`;
`x-corpus-author: "robot"`; reading `.attention` off a non-doc response.
Then: Each is a compile error, and omitting `x-corpus-author` entirely is **not**.

TEST-23: The drift check still blocks a stale contract
Given: A clean tree with the contract landed.
When: A parameter is hand-added to a route definition and `git push` is attempted without
regenerating.
Then: The pre-push contract-drift step fails naming
`npm run generate -w packages/contract`; regenerating makes the push proceed. The change
is reverted afterwards.

TEST-24: The full contract mounts on a real Hono app
Given: Every route module.
When: They are registered on a real `OpenAPIHono` instance bound to `127.0.0.1:8965` with
canned handlers.
Then: The app starts, `/doc` serves a document that validates as OpenAPI 3.1, and a typed
`GET /api/docs?needs=me&stale=stale&sort=-updated` call over a real socket returns rows
whose `attention` and `snippets` are typed on the client side.

### SERVER-003: Server bootstrap — Hono app, config, auth, static UI

**Scope pin.** SERVER-003 depends on CONTRACT-001 only. It must **not** wait for
CONTRACT-002 and must **not** grow handlers for CONTRACT-002's routes. Its mounted surface
is exactly one contract route.

TEST-25: A real server process boots against a real workspace
Given: `WS=$(mktemp -d)` with `mkdir -p $WS/.corpus $WS/data/docs $WS/data/threads` and a
real `$WS/.corpus/config.json` containing a 32+ character token and `"port": 8765`.
When: `CORPUS_WORKSPACE=$WS npx tsx apps/server/src/main.ts` is started in the background.
Then: It logs a line naming the bound URL `http://127.0.0.1:8765`, and the process stays
alive.

TEST-26: Health is reachable without a token and matches the contract shape
Given: The running server.
When: `curl -s -i http://127.0.0.1:8765/api/health` with **no** `Authorization` header.
Then: `200`, `content-type: application/json`, and the body parses against
`@corpus/contract`'s `HealthSchema` — `{status:"ok", version, uptimeSeconds, workspace}`
with `workspace` equal to the absolute workspace path. The field is `uptimeSeconds`; a
body carrying `uptimeMs` fails this test.

TEST-27: Guarded paths reject a missing token
Given: The running server.
When: A guarded path under `/api/` is fetched with no `Authorization` header.
Then: `401`, header `WWW-Authenticate: Bearer`, and a body that parses as the contract's
`ApiError` with `code: "unauthorized"` (see Open Conflict 2 for the body-shape ruling). The
server log line records the path and **never** the presented token.

TEST-28: Guarded paths reject a wrong token, in constant time
Given: The running server.
When: The same path is fetched with `Authorization: Bearer wrong`, with `Bearer` and no
value, with `Basic abc`, and with an empty/whitespace header.
Then: All four return `401` and none throws or 500s. A unit test asserts the comparison
routes through `crypto.timingSafeEqual` and that a length mismatch short-circuits to
failure without throwing.

TEST-29: An unregistered API path is a problem-JSON 404, not the SPA shell
Given: The running server with a correct token.
When: `GET /api/definitely-not-a-route` is fetched.
Then: `404` with a contract `ApiError` body (`code: "not_found"`) — not HTML, not
`index.html`, no stack trace.

TEST-30: Exactly one contract route is mounted, and the rest 404 honestly
Given: The running server with a correct token.
When: Every CONTRACT-001 path other than `GET /api/health` is fetched
(`/api/docs`, `/api/docs/{id}`, `/api/threads/{id}`, `/api/queue/status`,
`/api/queue/claim-all`, …).
Then: Each returns `404` problem JSON. None returns `501`, none returns an empty `200`,
and none returns an HTML page. Handlers for these belong to SERVER-004 onward.

TEST-31: The live OpenAPI document is served and is valid 3.1
Given: The running server.
When: The introspection endpoint (see Open Conflict 4 for its final path) is fetched
without a token, then with a correct token.
Then: `401` problem JSON first; `200` second, and `jq .openapi` prints `3.1.0`.

TEST-32: A missing UI build degrades to a clear 503 without breaking the API
Given: The running server with **no** UI dist directory resolvable.
When: `curl -s -i http://127.0.0.1:8765/` is run, then `GET /api/health`.
Then: `/` returns `503` whose body names the fix
(`npm run build -w apps/ui` / reinstall the corpus package), and `/api/health` still
returns `200`. A missing UI never degrades the API.

TEST-33: A present UI build serves assets and falls back for SPA routes only
Given: A fixture dist directory containing `index.html` and `assets/app.<hash>.js`,
pointed at with `CORPUS_UI_DIST`, and the server restarted.
When: `/`, `/assets/app.<hash>.js`, `/some/deep/route`, `/api/nope`, `/attachments/x` and
`/events` are fetched.
Then: `/` and `/some/deep/route` serve `index.html` with `200` and `cache-control:
no-cache`; the hashed asset serves with an immutable cache header; `/api/nope` returns
problem JSON; and neither `/attachments/x` nor `/events` receives the SPA fallback.

TEST-34: Config failures name the file and the problem
Given: Four fixture workspaces: one with no `.corpus/config.json`; one whose config is
malformed JSON; one whose config is valid JSON but fails the schema (e.g. a 5-character
token); one whose `host` is a non-loopback address.
When: The server is started against each.
Then: Each exits non-zero with a distinct, actionable message naming
`.corpus/config.json`; the malformed-JSON case names the parse position; the schema case
names the failing field; the non-loopback case states that v1 binds loopback only. None
prints a raw stack trace.

TEST-35: Workspace resolution follows the pinned precedence
Given: A real workspace at `$WS` and a nested subdirectory `$WS/a/b/c`.
When: The server is started (a) with an explicit workspace argument pointing elsewhere,
(b) with `CORPUS_WORKSPACE=$WS` from `/tmp`, (c) with cwd `$WS/a/b/c` and no env, and (d)
from `/tmp` with neither.
Then: (a) the explicit argument wins over the env; (b) and (c) both resolve to `$WS`;
(d) fails with "not a Corpus workspace; run `corpus init`" and a non-zero exit.

TEST-36: `createServer` is pure with respect to ambient state
Given: The exported `createServer(config)`.
When: It is called in a test with an explicit config while `CORPUS_WORKSPACE`,
`CORPUS_PORT` and `CORPUS_LOG_LEVEL` are set to conflicting values.
Then: The returned app uses only the passed config, and `createServer` never calls
`process.exit`. Environment reading lives in `loadServerConfig`/`main.ts` only.

TEST-37: A port collision produces the documented message
Given: One server already listening on 8765 for a workspace.
When: A second server is started against the same config.
Then: It exits non-zero with the message "port 8765 already in use — another corpus server
may be running (corpus server status)" — not a raw `EADDRINUSE` trace.

TEST-38: Shutdown is graceful, ordered and idempotent
Given: A running server with two disposers registered via `registerDisposer`.
When: `kill -TERM <pid>` is sent, and then sent a second time.
Then: A shutdown log line is emitted, disposers run in **reverse** registration order, the
process exits `0`, a subsequent `curl` is connection-refused, and the second signal causes
no error or double-dispose. A separate test asserts a hanging disposer is force-exited by
the 5 s backstop.

TEST-39: `localhostOnly` exists, works and is not yet mounted
Given: The exported `localhostOnly` middleware.
When: It is unit-tested with peer addresses `127.0.0.1`, `::1`, `::ffff:127.0.0.1` and
`10.0.0.5`, and separately every mounted route is exercised from a non-loopback-simulated
peer.
Then: The first three are allowed, the fourth gets `403` problem JSON,
`X-Forwarded-For` is ignored, and no route in this issue is guarded by it (it lands on
`POST /api/jobs/:id/log` in SERVER-009).

TEST-40: The `?token=` exception is scoped to the SSE path and nothing else
Given: The running server.
When: `GET /api/health?token=<correct>`, a guarded `/api/…` path with `?token=<correct>`
and no header, and `GET /events?token=<correct>` are all fetched; then `GET /events` with
no credential at all.
Then: The guarded `/api/…` path still returns `401` (the query parameter is **not**
accepted there); `/events` accepts the query parameter and does not return `401`; and
`/events` with no credential returns `401`. (Whether `/events` yields a stream or a 404
after auth is SERVER-007's business — this test asserts the guard, not the handler. See
Open Conflict 5.)

TEST-41: The development entry point works as documented
Given: A real workspace.
When: `CORPUS_WORKSPACE=$WS npm run dev -w apps/server` is run.
Then: The server starts via `tsx` and logs the bound URL; the script points at the real
process entry point, and `npm run build` from the repo root still succeeds afterwards.

### CLI-001: CLI scaffold — bin, registry, workspace resolution, typed client

**Two verification paths.** The **standalone path** (TEST-42…TEST-56, no Corpus server
required) is **required for done**. The **integration path** (TEST-57/58, real SERVER-003
process) is required for done **if SERVER-003 has landed** when CLI-001 is verified;
otherwise it is `DEFERRED → CLI-002` in the log and is re-run as sprint-level cross-issue
TEST-71. The standalone path uses a real `node:http` server on `127.0.0.1:8865` — a real
socket, following sprint-001's stub-origin precedent — never a mocking library.

TEST-42: The real binary runs outside a workspace
Given: `npm run build -w apps/cli && npm link -w apps/cli`, and cwd `/tmp` (not a
workspace).
When: `corpus --help` and `corpus --version` are run, and then `corpus` with no arguments.
Then: All three print human-readable text and exit `0`. `--version` prints the package
version. Bare `corpus` prints top-level help and is **not** an error.

TEST-43: Help renders at three levels, entirely from the registry
Given: The built binary.
When: `corpus --help`, `corpus <topic> --help`, `corpus <topic> <verb> --help` are run.
Then: The first lists topics with one-line summaries; the second lists that topic's verbs;
the third shows the verb's positional arguments, its flags (topic flags **and** the merged
globals), and at least one runnable example. Every string shown traces to a registry field
— no hand-written help text exists in the source.

TEST-44: Unknown topics and verbs produce a usage error, exit 2
Given: The built binary in a workspace.
When: `corpus nosuchtopic`, `corpus <topic> nosuchverb`, and a near-miss within edit
distance 2 of a real name are run.
Then: Each prints a usage error listing the valid alternatives, the near-miss additionally
prints a "did you mean" suggestion, and `echo $?` prints `2` in all three cases.

TEST-45: Flag and argument parsing is registry-driven
Given: A command declaring a boolean, a string, a number and a repeated flag, plus one
required positional.
When: Each flag form is passed, then an unknown flag, then the command with its required
positional missing.
Then: Values parse to their declared types with declared defaults applied; the unknown
flag and the missing positional each produce a usage error with exit `2`; and a topic flag
that shadows a global name fails registry validation at load (TEST-49).

TEST-46: Workspace resolution walks up and picks the nearest ancestor
Given: A hand-created workspace `$WS` (`mkdir -p $WS/.corpus` plus a real
`.corpus/config.json`) with a nested `$WS/a/b/c`, and a second workspace nested inside it
at `$WS/a/inner`.
When: A workspace-requiring command is run from `$WS/a/b/c`, from `$WS/a/inner/deep`, from
`/tmp`, and with `--workspace $WS` from `/tmp`; then again from a workspace whose
`.corpus/config.json` is malformed JSON, and one whose config violates the schema.
Then: `$WS/a/b/c` resolves to `$WS`; `$WS/a/inner/deep` resolves to the **inner**
workspace with no config merging; `/tmp` fails with "not inside a Corpus workspace — run
`corpus init` here or pass --workspace" and exit `3`; `--workspace` succeeds; and both
invalid configs exit `3` with "workspace config is invalid: …", not a stack trace.

TEST-47: A down server produces the actionable message, exit 4
Given: A valid workspace whose configured port has nothing listening on it.
When: A workspace-requiring command is run.
Then: stderr reads "server not running for this workspace — run `corpus server start`",
no raw `ECONNREFUSED` text appears, and `echo $?` prints `4`.

TEST-48: Server errors map to their exit codes and rendered forms
Given: A real `node:http` server on `127.0.0.1:8865` answering the probe path, configured
in turn to return `401`, a contract-shaped typed problem with `404`, a `500`, and to close
the socket mid-response.
When: The built binary runs the probe against each.
Then: `401` → token-mismatch guidance, exit `5`; the typed problem → rendered as
`<status> <code>: <message>` followed by its details, exit `5`; `500` → the same rendering
path, exit `5`; the closed socket → transport classification, exit `4`. An unexpected
internal exception (forced) exits `1` and prints a stack **only** under `--verbose`.

TEST-49: The registry validates itself
Given: Fixture registries.
When: One with duplicate command names, one with a command missing a summary, one with a
command carrying zero examples, and one whose topic flag shadows `--json` are loaded.
Then: Each fails validation at load with a message naming the offending command, and the
real registry passes.

TEST-50: `--json` writes exactly one JSON value to stdout and nothing else
Given: The built binary.
When: A successful command runs with `--json`, with stdout captured separately from
stderr.
Then: stdout parses in full as exactly one JSON value with `jq .` and contains no log
line, banner, spinner or trailing prose; stderr is empty.

TEST-51: `--json` failures are JSON on stderr with the exit code unchanged
Given: The stub server returning a typed problem.
When: The command runs with `--json`.
Then: stdout is empty; stderr parses as `{"error":{"code","message","details"}}`; and the
exit code is identical to the same failure without `--json`.

TEST-52: Without `--json`, success is quiet
Given: The built binary against a working server.
When: A successful command runs without `--json`.
Then: Output is at most a human-readable one-liner — no JSON dump, no banner.

TEST-53: `--json` combined with `--help` still prints human help
Given: The built binary.
When: `corpus <topic> <verb> --help --json` is run.
Then: Help renders as human text, exit `0`, and `docs/cli.md` documents this deliberate
exception.

TEST-54: Non-TTY output carries no color or progress
Given: The built binary with stdout piped (not a TTY).
When: Any command runs.
Then: The output contains no ANSI escape sequences and no spinner frames; `--no-color` is
implied.

TEST-55: `docs/cli.md` is generated, committed, complete and idempotent
Given: The landed registry.
When: `npm run docs:cli -w apps/cli` is run twice and `git diff --exit-code docs/cli.md`
is checked.
Then: The two runs are byte-identical, the diff is clean, the file carries the
"Generated by …— do not edit by hand" header, contains a section for **every** registry
command with its arguments, flags and at least one example, contains the exit-code
appendix (0 success · 1 internal · 2 usage · 3 not in a workspace · 4 server unreachable ·
5 server error · 6 check failed), and is marked `linguist-generated` in `.gitattributes`.

TEST-56: A stale `docs/cli.md` is blocked before it lands
Given: A clean tree.
When: A flag is added to a registry command and `git push` is attempted without
regenerating; then the same state is pushed through CI.
Then: The pre-push hook fails naming `npm run docs:cli -w apps/cli`, and the CI validate
job fails the same way (see Open Conflict 7). Regenerating clears both. The change is
reverted afterwards.

TEST-57 _(integration path)_: The real CLI reaches the real server end to end
Given: A real SERVER-003 process started against a real workspace on port 8865
(`CORPUS_PORT=8865`), and the built `corpus` binary run from a directory three levels
below that workspace root.
When: The probe command runs with the workspace's real token.
Then: It succeeds with exit `0`, and its `--json` output parses as the contract's
`Health` shape. Every hop is real: real binary → real typed client → real socket → real
server → real workspace on disk.

TEST-58 _(integration path)_: The real CLI's error surface matches the real server's
Given: The same running server.
When: The probe is run (a) after the server is stopped, and (b) against a guarded path
with `CORPUS_TOKEN=wrong`.
Then: (a) yields the "run `corpus server start`" message with exit `4`; (b) yields token
guidance with exit `5`, and the rendered message is derived from the server's actual
`ApiError` body — not from a CLI-side guess. If the guarded-path probe does not exist in
CLI-001's verb set, (b) is satisfied by TEST-48's real stub and the real-server half is
`DEFERRED → CLI-002`.

### SERVER-012: Anchor engine — truncated selectors on the `partial` path

**Reproduction is mandatory.** This is a bug issue: the pre-fix reproduction log is a
gate, not a formality. The evaluator's round-3 record gives the scenario *shape* but no
literal fixture (no body text, no anchor ids, no report JSON) — the implementing agent
constructs the minimal fixture from the shape and logs it verbatim.

TEST-59: The bug reproduces on disk before any fix
Given: A real `git init` scratch workspace holding one document with two **near-identical**
paragraphs, each carrying its own anchor, on the **pre-fix** engine.
When: A single write deletes one paragraph and **edits** the other (the sibling is edited,
not deleted), and the reconcile result plus the resulting frontmatter are observed with
`git diff -U0`.
Then: At least one anchor's emitted `exact` is a **truncation** of the range it claims
(the eval's illustrative form: `exact: "Paragraph one now"`) and/or one anchor has been
handed the other's text. The exact fixture body, the edit applied, the anchor ids, the
`report` JSON and the `git diff` are all pasted into the issue's Reproduction log.

TEST-60: The reproduced scenario is clean after the fix
Given: The same fixture and the same write, on the fixed engine.
When: Reconciliation runs and the frontmatter is written back.
Then: Neither anchor carries a truncated `exact`; neither anchor carries text that
belonged to the other; each anchor is either **remapped** to the full text of its range or
**orphaned with its selector preserved byte-for-byte** (`git diff` shows no change to that
anchor's frontmatter block). No third outcome is acceptable.

TEST-61: Selector integrity is a general invariant, not a fixture
Given: The seeded reconcile property sweep (all shapes, all seeds).
When: Every emitted selector from every sweep case is checked.
Then: For every **remapped** anchor, `newBody.slice(start, end) === selector.exact`
exactly — never a prefix, never a superset, never another range's text. A single violation
fails the sweep and names the seed. This invariant must be asserted inside the sweep, not
only in the one reproduction fixture.

TEST-62: The failure path falls through the adjudicated ladder, in order
Given: A `partial`-classified anchor whose mapped slice fails the TEST-61 invariant.
When: Reconciliation runs.
Then: The anchor is **not** accepted from the mapper. It takes the deleted-claim
verification path — **exact-only resolution plus insertion-overlap**, no fuzzy — and if
that also fails, it orphans with the selector preserved byte-for-byte. The order stays:
mapper first, exact-only verification second, orphan last, **fuzzy never** on
deletion-shaped claims (SERVER-002 rounds 2 and 3 adjudications; do not re-open them).

TEST-63: Legitimate shrinking edits still remap
Given: An anchored passage genuinely edited down to a few words.
When: Reconciliation runs.
Then: It is reported `remapped` with the shortened `exact` equal to the new range's full
text. The invariant is "the slice equals what the selector claims", not "the slice is
long" — a fix that orphans real shrink edits fails this test.

TEST-64: Both siblings deleted → both orphan, no cross-contamination
Given: The TEST-59 fixture with **both** near-identical paragraphs deleted in one write.
When: Reconciliation runs.
Then: Both anchors are reported `orphaned`, both selectors are preserved byte-for-byte,
and neither has acquired any text from the other.

TEST-65: The M1 disk matrix stays green
Given: The fixed engine and a real `git init` workspace.
When: The M1 matrix — **sprint-001's** TEST-22 through TEST-26, not this sprint's — is
re-run **on disk** with `git diff` as the instrument.
Then: All five rows reproduce their round-3 outcomes exactly — sprint-001 TEST-22
`unchanged` (frontmatter untouched); TEST-23 `unchanged` (same offsets, no anchor line
touched); TEST-24 `remapped` (`exact` quotes the edited sentence verbatim); TEST-25
`orphaned` (selector byte-identical, `git diff` shows only the deleted body lines);
TEST-26 `remapped` (`exact` unchanged, `prefix`/`suffix` refreshed to the new
surroundings, each ≤ 32 chars).

TEST-66: The four deletion scenarios still orphan with selectors preserved
Given: The fixed engine.
When: Each of the four SERVER-002 round-3 deletion scenarios is re-run on disk: delete the
middle of three near-identical paragraphs; delete the middle bullet of a three-bullet
list; delete the Q2 row of a three-row table; delete anchored text that has a verbatim
copy elsewhere in the document.
Then: All four report `orphaned` with the selector preserved byte-for-byte, and
`frontmatter rewritten: false` for the anchor block in each.

TEST-67: Cut-and-paste still re-attaches
Given: The fixed engine.
When: An anchored sentence is (a) moved down past the tail, (b) moved up above the lead,
and (c) moved far with extra paragraphs inserted between.
Then: All three report `remapped` and resolve to the moved text — the thread follows its
text, per §6's intent. These paths resolve through `equal`/`partial` and were byte-identical
to pre-fix in round 3; a change here is a regression.

TEST-68: Doppelgänger and plain deletion still orphan
Given: The fixed engine.
When: (a) the anchored text is deleted while a twin pre-existed in untouched text
(`classify: deleted`, exact hit, `touchesInsertion: false`), and (b) the anchored text is
deleted with no twin anywhere (`classify: deleted`, no exact hit).
Then: Both report `orphaned` with the selector preserved. The distinguishing principle is
unchanged: identical classification and identical exact-hit, opposite verdicts, decided
solely by whether the surviving text is text **this edit produced**. The separate
"delete here + identical text inserted in an unrelated section → `remapped`" case remains
acceptable and must not be "fixed".

TEST-69: The escalating-context sequence stays all-remapped
Given: The fixed engine.
When: The four rows are re-run: one word before changed; one word before and one after;
the preceding sentence fully rewritten; **both** neighbouring sentences fully rewritten.
Then: All four report `remapped` with refreshed context — including the fourth, which was
round 1's bug and round 2's fix.

TEST-70: Determinism, purity and perf are unchanged
Given: The fixed engine.
When: A mixed-outcome fixture and a 1 MB body are each reconciled 100 times; the engine's
imports are grepped; and the sibling scenario is run at 1 MB scale, A/B'd against the
pre-fix engine.
Then: Each input yields a single distinct serialized result across all runs; the engine
imports no `node:fs`, `node:child_process`, `better-sqlite3` or `core/` module (the grep
sanctioned by **sprint-001's** TEST-28, the purity test); inputs are not mutated; and the 1 MB timing is within the same order of
magnitude as pre-fix. A ~1 s measurement attributable to `diff-match-patch`'s configured
1 s `Diff_Timeout` is not a regression — say so with the A/B numbers rather than chasing
it.

### Cross-issue integration

TEST-71: The CLI reaches the real server through the generated client, end to end
Given: CONTRACT-002 regenerated, SERVER-003 running on port 8865 against a real workspace,
and the CLI built and linked.
When: The probe command is run from inside that workspace.
Then: It exits `0` and prints the server's real health payload. No hop in the chain is
stubbed: real binary → registry dispatch → `createClient()` over the **generated** client
→ real socket → real Hono app → real `.corpus/config.json` on disk. This is the test that
proves the three issues compose.

TEST-72: The regenerated client still typechecks against the server's mounted handler
Given: CONTRACT-002's regenerated route definitions and SERVER-003's health handler
registered via `app.openapi(contractRoutes.getHealth, handler)`.
When: `npm run typecheck` runs across all workspaces.
Then: It passes with no cast, no `as`, and no adapter shim in the server. A CONTRACT-002
change that would force one is a contract defect, not a server workaround.

TEST-73: The regenerated client still typechecks against the CLI's client wiring
Given: CONTRACT-002's regenerated `schema.generated.ts` and CLI-001's `createClient()` +
`request()` helper.
When: `npm run typecheck -w apps/cli` runs.
Then: It passes. `createCorpusClient` is consumed as published — the CLI does not
re-declare paths, re-wrap `fetch`, or hand-construct requests anywhere (verified by
grepping `apps/cli/src` for `fetch(` outside `client.ts`: zero hits).

TEST-74: The server's error bodies are the contract's error bodies, and the CLI renders them
Given: The running server and the built CLI.
When: The server's `401` and `404` responses are captured with `curl` and each body is
validated against `@corpus/contract`'s `ApiErrorSchema`; then the CLI is pointed at the
same responses.
Then: Both bodies parse as `ApiError` (`code` + `message`, discriminating cleanly), and
the CLI's rendered message is derived from those fields rather than from CLI-side
guesswork. A server body of `{type,title,status,detail,instance}` fails this test — see
Open Conflict 2.

TEST-75: One config file, two readers, no disagreement
Given: A single real `.corpus/config.json` written once (see Open Conflict 3 for the
pinned shape).
When: SERVER-003's `loadServerConfig` and CLI-001's workspace resolver both read it.
Then: Both succeed, and both derive the same port and token. A file that one accepts and
the other rejects fails this test regardless of which one is "stricter".

TEST-76: The pinned inventory and the mounted surface agree about what exists
Given: CONTRACT-002's inventory and SERVER-003's mounted routes.
When: Every path in the inventory is fetched against the running server with a valid
token.
Then: `GET /api/health` returns `200`; every other inventory path returns `404` problem
JSON. No inventory path returns HTML, `501`, or an empty `200`. This is the honest
statement of "the contract declares 39 endpoints and the server implements one" — the
remaining handlers are SERVER-004 onward.

TEST-77: The repo-wide gates stay green
Given: All four issues landed.
When: `npm run build`, `npm run lint`, `npm run format:check`, `npm run typecheck`,
`npm test` are run from a clean tree, followed by `npm run e2e` with
`CORPUS_UI_PORT=5273`.
Then: All pass with no regression against the pre-sprint baseline, combined coverage stays
at or above the 90% gate, and the pre-push hook (build → contract drift → eslint →
prettier → typecheck → unit tests) passes end to end.

---

## Out of Scope

Nothing below belongs to this sprint. An agent building one of these has drifted; an
evaluator failing an issue for lacking one is wrong.

**Contract**

- Any **handler**. CONTRACT-002 produces schemas, route definitions, regenerated artifacts
  and two hand-written client helpers — no behavior.
- Plugin routes (`/api/x/<plugin>/…`) — runtime-discovered, deliberately undeclared.
- Changing `Health`, `PaginationQuery`, `QueueStatus` or the actor header mechanism.
  These are pinned by CONTRACT-001 and reused unchanged (TEST-8, TEST-11).
- Re-opening the two adjudicated pins: the optional `x-corpus-author` header with a
  documented `user` default, and `requestsAgent` as a defaultless tri-state. Both were
  decided on 2026-07-26; an implementation that makes the header required or adds
  `.default(false)` to `requestsAgent` fails this sprint.

**Server**

- Every route handler except `GET /api/health` — SERVER-004 (projection), SERVER-005/006
  (write paths), SERVER-007 (watcher + SSE), SERVER-008 (queue), SERVER-009 (locks + job
  logs), SERVER-010 (attachments), SERVER-011 (collection query).
- SQLite, `better-sqlite3`, FTS, `db rebuild`/`db doctor` — SERVER-004.
- Git auto-commit, author attribution to git, autosave squashing — SERVER-005.
- The chokidar watcher and the SSE stream body — SERVER-007. SERVER-003 owns only the
  **auth guard** on `/events`, not a handler for it.
- Mounting `localhostOnly` on any route — SERVER-009.
- Serving a real UI build as part of the tool's packaging — INFRA packaging issue.

**CLI**

- Every product verb: `corpus init`, `server start|stop|status|logs` (CLI-002),
  `doc`/`thread` verbs (CLI-003), `queue`/`lock`/`job` verbs (CLI-004), plugin verbs
  (PLUGINS-001). CLI-001 ships the frame plus the single probe verb pinned in Open
  Conflict 6 — nothing else.
- Any filesystem write. CLI-001 reads `.corpus/config.json` and reads input the user
  points it at; it writes nothing. `corpus init`'s bootstrap-class exception is CLI-002's.
- Long-poll parking, spinners, progress, colors.

**Anchors**

- Re-opening SERVER-002's round-2/round-3 adjudications: the diff is advisory; in-place
  edit evidence outranks a verbatim duplicate elsewhere; deleted-claim verification is
  exact-only plus insertion-overlap; fuzzy never runs on deletion-shaped claims.
- Any filesystem, git or database access from the anchor engine — permanently out of
  scope for that module.
- Reworking the `deleted` classification path. SERVER-012 guards the **quality of the
  slice** the `partial` path trusts, and nothing else.

**Everywhere**

- UI work of any kind — no issue in this batch touches `apps/ui` or `packages/kit`.
- Performance work beyond the order-of-magnitude A/B in TEST-70 and the ~250 ms
  round-trip target, which nothing in this batch can yet measure end to end.

---

## Integration Points

**CONTRACT-002 → SERVER-003 — one mounted route, everything else declared.**
The contract declares the full surface; SERVER-003 registers exactly
`contractRoutes.getHealth` via `app.openapi(route, handler)` and lets every other declared
path fall through to problem-JSON 404. The composition claim is narrow and testable:
regenerating the contract must not break the server's typecheck (TEST-72), and the
server's one implemented shape must satisfy `HealthSchema` byte-for-byte (TEST-26).
SERVER-003 must not be blocked on CONTRACT-002 landing, and CONTRACT-002 must not
introduce a change to `HealthSchema` that would force SERVER-003 to rework.

**CONTRACT-002 → CLI-001 — the generated client is consumed, never re-declared.**
CLI-001's `createClient()` wraps `createCorpusClient` from `@corpus/contract/client` and
adds exactly two things: transport-failure classification and typed-problem rendering.
It does not re-declare paths, re-wrap `fetch`, or hand-build requests (TEST-73). The
contract owns the wire shapes; the CLI owns the exit-code mapping. The one shape they
must agree on is the error body — pinned as `ApiError`, not RFC 9457 (Open Conflict 2).

**SERVER-003 ↔ CLI-001 — one config file, two readers.**
`.corpus/config.json` is written by `corpus init` (CLI-002, not in this sprint) and read
by both the server and the CLI in this one. The two Zod schemas must accept the same file
(TEST-75). Neither may require a field the other's writer will not produce; the pinned
canonical shape is in Open Conflict 3.

**SERVER-003 ↔ CLI-001 — the health probe is the composition seam.**
`GET /api/health` is the only endpoint both sides implement in this sprint, which makes it
the sprint's end-to-end proof (TEST-71). It is unauthenticated by spec (§2.1), so it
cannot also prove the 401 mapping — that half is proven against a real `node:http` stub
(TEST-48) and re-proven against a real guarded route in CLI-002.

**SERVER-012 ↔ everything else — none.**
SERVER-012 touches `apps/server/src/anchors/reconcile.ts` and its tests only. It shares a
workspace with SERVER-003 but no files: SERVER-003 creates `app.ts`, `config.ts`,
`middleware/`, `errors.ts`, `static-ui.ts`, `routes/health.ts`, `main.ts` and edits
`apps/server/package.json`; SERVER-012 touches neither `package.json` nor anything under
`src/anchors/` that SERVER-003 reads. They can run in parallel without worktree isolation,
provided SERVER-012 does not edit `apps/server/package.json`.

**CLI-001 → infra surfaces — a cross-domain edit, coordinated.**
CLI-001's acceptance criteria require edits to `.githooks/pre-push`, `.gitattributes` and
`.github/workflows/ci.yml` — infra-domain files. The pre-push hook already has a
generated-artifact drift pattern (`CONTRACT_ARTIFACTS`); `docs/cli.md` extends it rather
than adding a parallel mechanism. See Open Conflict 7 for the CI half, which does not
exist yet for either artifact.

---

## Open Conflicts — orchestrator decision required before implementation

Nine conflicts between the issue files, in rough order of blast radius. Each carries a
recommendation; the orchestrator adjudicates before the domain agents start, and the
adjudication is recorded in the issue files so it does not get re-litigated.

**1. Health payload: `uptimeMs` vs `uptimeSeconds`.** SERVER-003's Key Implementation
Details specify `GET /api/health` → `{status, version, workspace, uptimeMs}`, but
CONTRACT-001 already shipped `HealthSchema` as `{status, version, uptimeSeconds,
workspace}` — and UI-001's sprint-001 stub origin already conformed to it.
**Recommendation: the contract wins.** SERVER-003 emits `uptimeSeconds`. Fix the field
name in SERVER-003's issue file rather than widening the schema; a server that emits a
shape its own contract does not declare defeats §9.3.

**2. Error body shape: RFC 9457 vs the contract's `ApiError`.** SERVER-003 specifies
`application/problem+json` bodies of `{type, title, status, detail, instance}`. But every
CONTRACT-001 route declares its error responses as `ApiErrorSchema` — a flat
`{code, message, …}` discriminated on `code` — and CLI-001's renderer expects exactly that
(`<status> <code>: <message>` plus details). Three components, two incompatible error
shapes. **Recommendation: the contract wins.** SERVER-003 emits `ApiError` bodies. It may
keep `content-type: application/problem+json` and may add the RFC 9457 fields as *extra*
keys, but `code` and `message` must be present and authoritative. Note the knock-on:
CONTRACT-001's `ERROR_CODES` are only `bad_request | unauthorized | not_found | locked`,
so **SERVER-003 may only use those four** — `forbidden` and `conflict` arrive with
CONTRACT-002 and SERVER-003 must not anticipate them.

**3. `.corpus/config.json` has three different schemas.** SPEC §4 says the file holds
`version, port, token, dataDir`. SERVER-003's schema is
`{version, port, host, token: min(32)}` — no `dataDir`, plus `host`. CLI-001's schema is
`{version: 1, port, token, dataDir}` — no `host`. Worse, CLI-001's own E2E step 4
hand-writes `"token":"t"`, a one-character token that SERVER-003's schema rejects: the two
components would disagree about whether the same file is valid.
**Recommendation: pin one canonical shape** —
`{version: 1, port: number, host?: string (loopback-only, default "127.0.0.1"),
token: string, dataDir?: string (default "data")}` — with **both** readers parsing it
non-strictly (unknown keys pass through, absent optional keys default). Move the 32+
character token requirement to `corpus init`'s **generator** (CLI-002), not to the
readers, so a hand-made test workspace is not rejected by one component and accepted by
the other; the server may still warn on a short token. CLI-001's E2E fixture is updated to
use a 32+ character token regardless, so its workspace is one a real server would accept.

**4. `GET /api/openapi.json` is served but never declared.** SERVER-003 serves the live
document at `/api/openapi.json` via `app.doc()`, but that path is in neither CONTRACT-001's
route set nor CONTRACT-002's pinned inventory — and §9.3 says the server "cannot serve a
shape the contract doesn't declare", while CONTRACT-002's completeness test asserts the
inventory is exhaustive. **Recommendation: declare the exemption explicitly rather than
adding the route to the contract.** It is server-local introspection, not a client-facing
API: no typed client method should exist for it. CONTRACT-002's inventory test asserts
over *contract-declared* paths, and CONTRACT-002's OpenAPI description gains one sentence
naming `/api/openapi.json` as a server-local introspection endpoint outside the contract
— so the omission is documented, not accidental. It stays behind the bearer guard.

**5. The `?token=` exception is unreachable as specified.** SERVER-003 mounts the bearer
guard on `/api/*` and `/attachments/*`, and separately says the `?token=` form is accepted
"only for `GET /events`". But `/events` is under neither prefix, so as written the SSE
path is guarded by nothing at all and the exception can never fire — while SPEC §2.1
requires the SSE stream to authenticate via the token parameter.
**Recommendation: SERVER-003 mounts the guard on `/events` too**, accepting the token from
either the header or `?token=` on that path only. The route *handler* remains SERVER-007's;
in this sprint an authenticated request to `/events` gets a problem-JSON 404, which is the
honest answer. TEST-40 asserts exactly this.

**6. CLI-001 ships "zero product verbs" but its E2E requires a probe command.** Steps 3–7
of CLI-001's verification plan all run "a workspace-requiring probe command" that the
issue's own scope statement forbids it from shipping. **Recommendation: authorize exactly
one built-in, non-product verb — `corpus health`** — whose handler calls
`GET /api/health` through the typed client. It is the minimum that proves registry →
dispatch → workspace resolution → client → socket end to end; it is in the CONTRACT-001
surface so it works against SERVER-003 on day one; and it does not preempt CLI-002's
`corpus server start|stop|status|logs`. Note the consequence the issue file does not
acknowledge: because health is deliberately unauthenticated, `corpus health` **cannot**
demonstrate the 401 mapping against a real server — that is proven against the real
`node:http` stub in TEST-48 and re-proven against a real guarded route in CLI-002. If the
orchestrator prefers no new verb at all, the alternative is a hidden `--probe` diagnostic
flag, but a registry-visible verb is more honest and self-documents in `docs/cli.md`.

**7. CI has no generated-artifact drift check at all.** CLI-001 requires "pre-push **and**
CI fail when `docs/cli.md` is stale", but `.github/workflows/ci.yml` currently runs build,
lint, format, typecheck, coverage and e2e — and no drift check, not even for
`openapi.json`, which has only a pre-push guard. Adding a CI step for `docs/cli.md` while
`openapi.json` still has none would be a strange asymmetry.
**Recommendation: add a single `generated artifacts drift` step to `CI / validate`
covering both artifacts** (regenerate, `git diff --exit-code`), placed right after
`npm run build`. This is infra-domain work landing inside a CLI issue — the orchestrator
should either bless cli-dev making the edit or hand that one step to infra-dev. Whoever
makes it, the pre-push hook and the CI step must share one list, not two drifting copies.

**8. `POST /api/locks/reap` is shadowed by `POST /api/locks/{docId}`.** CONTRACT-002's
lock surface has a static segment and a path parameter competing for the same position;
the same pattern appears on the queue (`reap-stale`, `claim-all`, `halt`, `resume` vs
`{id}`). **Recommendation: pin static-before-parameter registration order** in
`ALL_CONTRACT_ROUTES` (which already exists to make `openapi.json` byte-stable) and hold
it with TEST-3. This is a real routing hazard, not a style question — a `docId` of `reap`
would otherwise be indistinguishable, and the failure mode is silent.

**9. Two smaller inconsistencies inside CONTRACT-002's own issue file.** (a) The Key
Implementation Details specify `GET /api/queue/idle?timeout=`, but E2E step 4 writes
"`POST /api/queue/idle`-style long-poll" — **`GET` is correct** (it is a read that parks;
§9.2 calls it a long-poll idle endpoint). (b) The issue lists `packages/contract/src/
schemas/actor.ts` as a file to create, but CONTRACT-001 already shipped it along with
`schemas/lock.ts`, `schemas/job.ts`, `schemas/queue.ts` and `schemas/sse.ts` — these are
**extensions**, not creations, and the existing `ActorHeaderSchema` already implements the
adjudicated optional-with-default form and must be reused, not rewritten. Neither needs a
decision, only correction in the issue file before implementation.

---

## Done Criteria

This sprint is complete when:

- **Every acceptance test above PASSes in the evaluator's verdict** — TEST-1 … TEST-77,
  with any test that could not be executed explicitly marked `DEFERRED → <issue>` in the
  relevant E2E Verification Log, with its reason and its substitute evidence.
- **The nine Open Conflicts are adjudicated** by the orchestrator before implementation
  starts, and each adjudication is written back into the affected issue file(s) so the
  next agent inherits the decision rather than re-deriving it.
- **SERVER-012's Reproduction log is filled in with pre-fix evidence** — fixture body,
  edit, anchor ids, `report` JSON and `git diff` — before its fix is reviewed. A bug issue
  with an empty reproduction log is not done regardless of test results.
- **Each issue's E2E Verification Log carries concrete evidence from the environment
  pinned above** — exact commands, actual output, and the model the implementing agent ran
  on ("implemented on: opus | fable").
- `/test` passes with no regressions and combined coverage stays at or above the 90% gate.
- `/lint` passes (eslint, prettier, tsc across all workspaces).
- `npm run build` succeeds from a clean tree and the pre-push hook passes end to end.
- **The composition is proven, not assumed**: TEST-71 shows the real CLI binary reaching
  the real server process through the regenerated typed client, end to end, with no stub
  in the chain.
