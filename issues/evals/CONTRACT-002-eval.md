# Evaluation: CONTRACT-002

**Date**: 2026-07-26
**Sprint**: sprint-002
**Verdict**: PASS

Contract growth to the full §9.2 surface. Verified against the regenerated artifacts on
disk and a **real `OpenAPIHono` app mounting all 39 routes, bound to `127.0.0.1:8965`**,
driven by the **real generated client** imported from the built package entry points. No
supertest-style in-memory client anywhere in the E2E steps. Node v25.2.1;
`--experimental-eventsource` used where a real `EventSource` was required, and stated.

Scratch: `/tmp/eval-p2-contract/`. Repo tree verified clean before and after.

## E2E Proof-of-Work Audit

| Check                                   | Result | Notes                                                                                                                                                       |
| --------------------------------------- | ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Verification log present                | PASS   | Five numbered steps plus a post-merge `internal_error` addendum.                                                                                              |
| Commands are specific and concrete      | PASS   | Exact commands, real shasums, verbatim probe stdout with real values (`["unread-reply","stale"]`, `2026-07-19T10%3A05%3A00Z`, real tsc error codes/columns).   |
| Real E2E (not mocked)                   | PASS   | Real socket on `:8965`, real generated client out of `dist/`, real `EventSource`. `app.fetch()` explicitly confined to unit tests.                             |
| Scenarios cover acceptance criteria     | PASS   | Every acceptance criterion has a corresponding step; the two deliberate deviations (`AttachmentRef`, `DocSummarySchema`) are declared with reasoning.          |
| Application restarted after changes     | PASS   | Every step states it ran from a clean `npm run build`; the addendum re-ran generation, build, typecheck and the drift script after the union change.           |
| Actual model recorded (implemented on:) | PASS   | "**implemented on: opus**"; addendum separately marked "orchestrator-adjudicated micro-task, opus".                                                            |
| Reproduction logged before fix (bugs)   | N/A    | Feature issue.                                                                                                                                                |

Spot-checks of the log against observation: the log's step-1 hashes (`a90388a9…`) are stale
relative to HEAD (`f7f182c8…`) because the `internal_error` addendum regenerated afterwards
— the addendum records the newer pair, and the newer pair is what HEAD carries. Not a
discrepancy. Every other claim I re-ran reproduced.

## Criteria Results

| #   | Criterion                                                     | Result | Notes                                                                                                                                                                          |
| --- | ------------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Generation idempotent, committed artifacts current            | PASS   | Two runs → byte-identical `f7f182c8…` / `b71d25c1…`; `git status --porcelain packages/contract` empty after each.                                                                |
| 2   | Exactly the pinned endpoint inventory                         | PASS   | 39 method+path pairs. All 36 pinned pairs present (`MISSING: []`); extras are exactly `POST /api/docs/{id}/{move,archive,unarchive}`. Published `ENDPOINT_INVENTORY` ≡ document. |
| 3   | Static segments not shadowed by path params                   | PASS   | On the real app: `POST /api/locks/reap` → `reapLocks`, `POST /api/queue/reap-stale` → `reapStale`; `POST /api/locks/{docId}` → `acquireLock`. Order pinned in `ALL_CONTRACT_ROUTES`. |
| 4   | `GET /api/docs` grammar complete and typed                    | PASS   | 17 query params, all `required:false`. Enums exactly as pinned; `sort` default `-updated`; `type` an open string enumerating the six core values and naming plugins.             |
| 5   | Thread-only no-op + default-archived exclusion documented     | PASS   | Route description names all four thread-only filters; each param repeats it; `status` states the archived default and the explicit override.                                     |
| 6   | `sort=relevance` without `q` is a declared validation failure | PASS   | `safeParse({sort:"relevance"})` → false, issue path `["sort"]`, message names the constraint. Route declares `400`. No silent fallback (`{}` → `-updated`, relevance rejects).   |
| 7   | Rows carry structured snippets and attention reasons          | PASS   | Round-trip deep-equal. Empty arrays valid, `undefined` invalid for both. `attention:["me"]` rejected — value set is `needs` minus `me`. No HTML/markup field.                    |
| 8   | CONTRACT-001 shapes reused unchanged                          | PASS   | `QueueStatus` exactly six fields, response of status/halt/resume; `limit` 50/200, `offset` 0; `Health` has `uptimeSeconds`; `uptimeMs` → 0 hits in both artifacts.               |
| 9   | Folder default corrected to `inbox`                           | PASS   | `"defaults to the root"` → 0 hits. Description states `inbox` and accepts bare name or full prefix.                                                                              |
| 10  | `requestsAgent` tri-state everywhere                          | PASS   | No `default`, never `required`, in all four bodies. Omitted → key absent; `true`/`false` survive. "note only" prose present; all three `eventId` descriptions state the null rule. |
| 11  | Author attribution a uniform optional header                  | PASS   | 27 mutating operations, `MISSING: []`, `NON-CONFORMING: []`, no body author field. `required:false`, `default:"user"`, enum `["user","agent"]`.                                  |
| 12  | User-only routes declare rejection of the agent actor         | PASS   | All three declare `403` → `ForbiddenError` with prose naming `x-corpus-author: agent` and citing §6/§7.                                                                          |
| 13  | Deletion cascades documented and in the response shapes       | PASS   | `DeleteTurnResult` = the four pinned fields with the §6 cascade prose; `DeleteDocResult` = the two pinned fields with orphaning + git-history prose.                             |
| 14  | ISO-timestamp path parameter survives encoding                | PASS   | Over a real socket the server observed `/api/threads/th_x1y2z3/turns/2026-07-19T10%3A05%3A00Z`, status 200; the `ts` description tells clients to encode.                        |
| 15  | Long-poll `idle` declares both outcomes; 204 not an error     | PASS   | Real 204 → `data === undefined`, no throw, no `error` key. Declares 200 + 204; `timeout` max/default 480 with the clamp documented; halted-parks prose present.                  |
| 16  | Queue event mirrors the §7 file                               | PASS   | Core and plugin events both parse, nested payload preserved verbatim; `type` open string with the three core values in its description; `CoreQueueEventType` exported.           |
| 17  | Locks distinguish 409 from 423                                | PASS   | `POST /api/locks/{docId}`: 201 Lock + 409 carrying `lock`. 423 `LockedError` on all seven document-mutating routes. `Lock` = the four pinned fields. `DELETE` declares 403.      |
| 18  | Error union covers every code; routes declare only what they return | PASS | Discriminated union on `code`, 7 variants, all round-trip; unknown code rejected. `GET /api/health` declares only `200`. No read-only route declares 409. See adjudication note. |
| 19  | Multipart accepts attachment-only turns, rejects empty ones   | PASS   | (a)/(b) pass, (c) fails naming the constraint; route declares 400. Real `uploadTurn` against the `:8965` echo route delivered the field names + `Authorization` + `x-corpus-author`. |
| 20  | SSE documented as a stream, exposed as a typed helper         | PASS   | `text/event-stream`, 25 s heartbeat, pruning and `token` param all documented. Real `EventSource` (flag stated) yielded a typed TanStack query-key array. `/events` excluded from `FetchPaths` with an explanatory comment; `c.api.GET("/events", …)` is TS2345. |
| 21  | Attachments binary; plugin routes deliberately absent         | PASS   | `application/octet-stream` + `format: binary`; no hand-written wrapper. `info.description` carries both the plugin-route sentence and the `/api/openapi.json` exemption sentence. |
| 22  | The type system rejects what the contract prevents            | PASS   | `tsc --noEmit --strict --module nodenext`: TS2322 on `"nonsense"`, TS2322 on `"robot"`, TS2339 on `.attention`; the omit-the-header file compiles clean.                          |
| 23  | The drift check still blocks a stale contract                 | PASS   | Clean tree → exit 0. Mutated artifact → `✗ API contract is stale`, naming `npm run generate -w packages/contract`, exit 1. Restored → exit 0, `git status` empty.                 |
| 24  | The full contract mounts on a real Hono app                   | PASS   | 39 routes mounted, bound to `:8965`. `/doc` validates under a real validator (`@redocly/cli lint` → valid, 0 errors). Typed `GET /api/docs?needs=me&stale=stale&sort=-updated` over a real socket returned client-typed `attention`/`snippets`; scratch file typechecks with no cast. |

### Post-sprint adjudication (`internal_error`), judged against the adjudicated reality

| Assertion                                             | Result | Evidence                                                                                    |
| ----------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| `internal_error` is in the exported `ERROR_CODES`      | PASS   | `["bad_request","unauthorized","forbidden","not_found","conflict","locked","internal_error"]` |
| `{code:"internal_error",message}` parses as `ApiError` | PASS   | `safeParse` → true                                                                            |
| No operation declares a `500`                          | PASS   | `500 declarers: []`; `500:` blocks in `schema.generated.ts`: 0                                |
| `InternalError` never reaches `components.schemas`     | PASS   | `false`; raw string hits in `openapi.json` 0, in `schema.generated.ts` 0                      |
| The 403 now carries `forbidden` (supersedes TEST-39)   | PASS   | `403` → `$ref ForbiddenError`, `code: "forbidden"`                                            |

## Failures

None.

## Observations (not failures; recorded for the orchestrator)

**OBS-1 — `/attachments/{path}` is still reachable through the typed fetch surface.**
`FetchPaths = Omit<paths, "/events">` excludes only `/events`. A call
`c.api.GET("/attachments/{path}", { params: { path: { path: "a/b/c.png" } } })` compiles
clean and types an `application/octet-stream` body as `string` — the same unusable
signature the `/events` exclusion comment cites as its own justification. TEST-21's wording
("no client fetch wrapper is generated") is satisfied; TEST-20's stricter wording ("exposes
**no** fetch method") would not be, were it applied to attachments. Asymmetric, worth a
decision when SERVER-010 lands.

**OBS-2 — `ApiErrorSchema` requires `issues` on `bad_request` and `lock` on `locked`.**
`ApiErrorSchema.safeParse({code:"bad_request", message:"x"})` → **false** (the `bad_request`
arm is `ValidationError`, which requires `issues`); likewise
`isApiError({code:"locked", message:"m"})` → false. Not in CONTRACT-002's test set and not a
defect in it, but it constrains every server that must satisfy Open Conflict 2: a `400`
emitted without an `issues` array will not validate against its own contract. SERVER-003
cannot reach a `400` today (its one mounted route takes no input, confirmed empirically),
so nothing is broken now — this is a live constraint for SERVER-005/006/011.

## Summary

**24 of 24 acceptance tests pass**, plus TEST-3 (registration order) and all five
post-sprint `internal_error` assertions. The contract is byte-deterministic, complete
against the pinned inventory, mounts and lints as valid OpenAPI 3.1 on a real Hono app, and
the generated client both types and rejects the right things over a real socket. The two
observations above are forward-looking, not defects in this issue.
