# [CONTRACT-058] `GET /api/queue/idle` does not declare the 422 it now returns

## Domain

contract

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-118 (which added the refusal)
- Related: CONTRACT-052, CONTRACT-055 (the same drift, in descriptions)

## Spec References

- SPEC.md **§9.2** — the HTTP API

## Summary

`SERVER-118` made `GET /api/queue/idle` refuse a `scope` that names no lane,
with a `422`. **`contractRoutes.idleQueue` declares `200/204/400/401` and no
`422`.**

Nothing breaks — the body stays inside the published `ApiError` union — but the
OpenAPI document and the generated client are one refusal behind the server. A
consumer generating handlers from the contract has no branch for a response the
server will now send.

This is the same drift `CONTRACT-052` and `CONTRACT-055` each spent a pass
cleaning up, arriving a third way: not a stale description this time, but a
**missing** one.

## A second question to settle while there

The refusal reuses the published `unknown_recipient` error code, because its
carried field is described as "the value that named no lane" without naming a
parameter — so it fits. But the **code is spelled `recipient`** and this refusal
is about `scope`.

Decide deliberately: either the code's name is general enough and its
description should say so plainly, or a `scope` refusal deserves its own code.
Reusing a name that says `recipient` for a `scope` failure is the kind of thing
that reads fine to whoever wrote it and confusingly to everyone else.

## Acceptance Criteria

- [x] `idleQueue` declares the `422`, with a description saying what makes a
      scope invalid and how to recover — the server's message already names the
      recovery ("omit `scope`… designate a resident… or pick a lane from
      `GET /api/agents`") and the contract should not say less
- [x] The `unknown_recipient` naming question is answered, with reasoning, and
      whichever way it goes the description matches the name
- [x] `openapi.json` regenerated and **swept structurally** per CONTRACT-052's
      discipline — while there, check whether any *other* route returns a status
      it does not declare. This one was found by an implementer noticing, which
      is not a search, and the sweep is the only thing that makes "no others"
      mean anything — **the sweep found one other**, `PUT /api/docs/{id}`'s
      `403`, reported below and left for its own issue
- [x] No behavioural change

## Testing Strategy

Generation and drift check. If the declared-status sweep is expressible as a
test comparing declared responses against the server's handlers, say where it
would have to live — `packages/contract` cannot import `apps/server`, and
CONTRACT-055 already established that a cross-check of that kind belongs in the
consumer that owns the emitter.

## E2E Verification Log

Implemented by **contract-dev on Opus 5 (1M context)**, 2026-08-17.

### What was declared

`GET /api/queue/idle` now declares `422` → `UnknownRecipientError`
(`UNKNOWN_SCOPE_RESPONSE` in `routes/responses.ts`). Its response description
carries all three recoveries the server's own message names — omit `scope`,
designate a resident on that thread first, pick a lane from `GET /api/agents` —
plus "nothing was parked and no work was claimed" and both senses in which a
scope is invalid (§7's "no such thread" / "no resident"). The operation
description gained a paragraph saying *why* a park is refused where a claim is
not: parking is presence, so an admitted park on a non-lane reports an agent
listening on a lane the roster does not list, whereas refusing `claim-all` would
strand a lapsed lane's already-stamped events.

### The naming decision: keep `unknown_recipient`, publish the reason

**Decision: one code, keep the spelling, and say so in the published document.**

- The test that decides whether two refusals share a code in this repo is
  *sameness of remedy*, not sameness of parameter — that is exactly why
  `unknown_job` and `unknown_recipient` are two codes (a bad job costs the write
  its provenance, a bad lane costs it its routing; different calls fix them).
  A bad `recipient` and a bad `scope` have **one** remedy between them: name a
  lane that exists, or name none. A second code would hand a client two branches
  for one recovery.
- `ERROR_CODES` is a published discriminant. Renaming to `unknown_lane` touches
  the CLI renderer, `packages/kit`'s composer recovery
  (`useComposerRecipient.ts`, `createCorpusClient.ts`), the UI's fixtures
  (`compose/`, `testing/readerFixture.ts`, `e2e/stubCorpus.ts`) and four server
  test files — a four-domain breaking change to fix a name that one sentence of
  prose fixes instead. The precedent is `PAYLOAD_TOO_LARGE_RESPONSE`, which
  reuses `bad_request` for `413` rather than minting an eighth code and explains
  itself in prose.
- **So the description had to move, and it did.** `UnknownRecipientError` now
  carries a component-level `description` (it had none) stating the fact
  parameter-neutrally — "The value you named is not a lane" — naming *both*
  parameters that reach it and the one-refusal-one-remedy rule that justifies
  one code. The `recipient` property description now says "whichever parameter
  carried it" and that the field is spelled `recipient` because the code is.
  Both are in `openapi.json`, which is where the reader who is confused by the
  name actually is. `unknown_lane` with a `lane` field is recorded in the
  docblock as the shape to take if a breaking window opens for another reason.

### The structural sweep: what it enumerated, how, and what it found

The generated document publishes **55 operations over 50 paths** (107 component
schemas). The sweep compared, for every one of them, the statuses **declared**
against the statuses the server can **emit**.

*Declared* side — mechanical, from the generated document:

```js
for (const [p, item] of Object.entries(doc.paths))
  for (const [m, op] of Object.entries(item)) print(`${m} ${p}`, Object.keys(op.responses));
```

*Emitted* side — every HTTP-status emission site in `apps/server/src`, then each
site traced to the routes that reach it. The emission sites are closed and
enumerable, which is what makes the sweep a search rather than an impression:

- **11 `HttpError` factories** in `errors.ts` (`badRequest` 400,
  `payloadTooLarge` 413, `unauthorized` 401, `forbidden` 403, `notFound` 404,
  `conflict` 409, `staleKey` 409, `unknownJob` 422, `unknownRecipient` 422,
  `unknownLaneScope` 422, `internalError` 500), plus 4 call sites constructing
  `HttpError` directly (`reattachConflict` 409, `patchConflict` 409,
  `destinationOccupied` 400, `fromHttpException` passthrough).
- **`grep 'throw '` over all non-test server sources**, filtered to the
  HTTP-bearing throws: 47 sites.
- **Indirection resolved by hand** where a thrower sits behind a helper —
  `stampedOrigin` / `assertJobResolvable` (422), `assertRecipientResolvable` /
  `assertScopeIsLane` (422), `requireStandalone` (409),
  `transition`/`requeue`'s `onlyFrom` (409), `requireKey` (409),
  `loadThread`/`readDoc` (404), `assertWithinLimits` (413).
- **Middleware** read separately: `createBearerAuth` (401, with
  `UNAUTHENTICATED_ROUTES` = exactly `GET /api/health` and
  `POST /api/jobs/{id}/log`), `defaultHook` (400), `localhostOnly` /
  `noBrowserOrigin` (403), `createUploadSizeGuard` (413),
  `createRawAttachmentPathGuard` (404).
- **Success codes** extracted per mount from the `app.openapi(contractRoutes.X, …)`
  handler bodies (brace-matched, `c.json`/`c.body`/`c.text` status literals) and
  compared with the declared 2xx.
- **Mount coverage** cross-checked: the 55 contract route keys against every
  `contractRoutes.<key>` reference in the server.

Findings:

1. **`GET /api/queue/idle` → 422** — this issue. Fixed.
2. **`PUT /api/docs/{id}` → 403, undeclared.** `docs/update.ts`'s `changedFields`
   throws `forbidden(…)` when a non-user actor sends `origin: null` (detach is
   user-only, §9.2 / CONTRACT-050). `apps/server/src/docs/provenance.test.ts`
   ("refuses an agent with a 403, the same doctrine as delete") exercises it. The
   route declares `200/400/401/404/409/422`. The `originDetachField` description
   already *says* "it is **user-only**, refused for an agent actor" — so the
   contract documents the refusal in prose and does not declare the response,
   which is the same gap in a different register. `openapi.test.ts`'s existing
   "declares 403 on the user-only route" case lists only the three routes that
   predate the detach field, so nothing caught it.
   **Not fixed here** — it is a second route's contract change and belongs in its
   own issue/commit under this repo's one-issue-one-commit rule. The fix is two
   lines: `403: FORBIDDEN_RESPONSE` on `updateDoc` (route prose already needs the
   `x-corpus-author: agent` phrasing the existing test asserts), plus adding
   `["/api/docs/{id}", "put"]` to that `it.each`. Recommend filing it.
3. **`GET /api/upgrade/check` and `POST /api/upgrade` are declared and not
   mounted** — no `contractRoutes.checkUpgrade` / `startUpgrade` reference exists
   anywhere in `apps/server`. The declared-vs-emitted question is vacuous for
   them (including the `409` `POST /api/upgrade` declares). Known state from
   CONTRACT-027; recorded so "53 of 55 operations were actually compared" is on
   the record rather than implied.

Checked and deliberately **not** reported as gaps:

- **`createUploadSizeGuard` can 413 any `POST /api/*`** that arrives as
  `multipart/form-data` over the cap, including routes declaring no `413`
  (e.g. `POST /api/skills`). It is a pre-routing boundary refusal on a request
  that route would reject anyway; no request the route would otherwise accept can
  produce it. Same class as 401.
- **No route declares a `500`**, and the two `internalError` sites
  (`docs/read.ts`, `threads/turns.ts`) are reachable — that asymmetry is
  `InternalErrorSchema`'s stated invariant, not drift.
- Every other unusual status lines up: 409 on `defer` only among the queue verbs
  (`onlyFrom` is set there and nowhere else); 409 on designate and not on release
  (`requireStandalone` has two call sites, both in `designateResident`); 413 on
  exactly the three multipart routes; 401 absent on exactly the two exempt
  routes; 422 on exactly the nine writes that take a `job` or a `recipient`.

### On a declared-status-versus-handler cross-check as a test

**It cannot live in `packages/contract`, and I did not pretend otherwise.** The
package cannot import `apps/server`, and nothing inside the contract can know
which statuses a handler reaches. What *does* live here now is the half that is
expressible: a sweep asserting every declared `422` in the generated document
carries a member of the `ApiError` union (10 operations inspected, non-vacuity
pinned) — that catches a new `422` with an off-union body, not an undeclared one.

The real cross-check belongs in **`apps/server`**, per CONTRACT-055's precedent,
and it has an unusually good home: **`apps/server/src/docs/write-fixture.ts`** is
the single seam every server integration test makes requests through
(`request` / `post` / `put` / `del`, all funnelling into `server.app.request`).
Wrapping that seam so every response's status is checked against the declared
responses of the matching contract operation — resolving path→operation with the
server's own `createContractPathMatcher` (`middleware/route-path.ts`) over
`ALL_CONTRACT_ROUTES` — turns the **entire existing server suite** into the
cross-check, at the cost of one wrapper. It would have caught both gaps this
sweep found: `roster.test.ts` asserts the `422` on `idle`, and
`provenance.test.ts` asserts the `403` on `PUT /api/docs/{id}`. Recommend a
`SERVER-*` issue for it; per-route assertions would not scale and would not have
found either.

### Commands

```
$ npm run generate -w packages/contract                        → exit 0
$ npm run generate -w packages/contract   (second run)         → exit 0, byte-identical
    b60b492906739ce77508c9d461ba529e585203ecf345fbb08eaa42c6a9813aac  openapi.json
    db5d12f24b7499b3ceae0f881620e6b2214ad7b6db1537da2c5288858b14f067  src/client/schema.generated.ts

$ node --import tsx scripts/check-generated-artifacts.ts       → exit 1 — fires, as it must
    ✗ API contract is stale: packages/contract/openapi.json, .../schema.generated.ts
     openapi.json                   | 17 +++++++++++---
     src/client/schema.generated.ts | 14 ++++++++++-
    (stale only against HEAD, which has neither the source change nor the
     regenerated output; the two generated files are the whole diff)

$ npm run build -w packages/contract                           → exit 0
$ npx tsc --noEmit -p packages/contract                        → exit 0
$ npx tsc --noEmit -p apps/cli                                 → exit 0
$ npx tsc --noEmit -p apps/server                              → exit 0
$ npx eslint <4 touched files>                                 → exit 0
$ npx prettier --check <touched + generated>                   → clean
$ vitest run packages/contract                                 → 64 files, 2551 tests, 0 failed
$ vitest run apps/server/src/agents/roster.test.ts \
      -t "scope that names no lane"                            → 6 passed
```

The last one is the E2E that matters most: the **real server**, through the real
app, answering a park on an undesignated thread with the body the contract now
declares (`{code: "unknown_recipient", recipient: <id>}`, message containing
"omit \`scope\`").

### That the shape moved by exactly one response

Prose-stripped fingerprint (every `description`, `summary`, `example`, `title`
removed, keys sorted), CONTRACT-052's script verbatim:

| | sha256 | bytes |
|---|---|---|
| before | `a9427541ae4a34f31b46274c89b42f2c8e376d0c246fb80b9ccafe5d30c305ba` | 80 828 |
| after | `daceaa073d18e442b92a00c10f9a13d25339aaa4bd523a15434653870fc80381` | 80 932 |

The **before** value is byte-identical to the fingerprint CONTRACT-052 and
CONTRACT-055 both recorded, so the baseline is the same document those issues
signed off. The structural diff between the two is a single hunk:

```
>      "422": {
>       "content": { "application/json": { "schema": {
>          "$ref": "#/components/schemas/UnknownRecipientError" } } }
```

and a programmatic comparison of every operation's declared status set reports
exactly one changed operation and no added or removed operations:

```
ops changed: {'GET /api/queue/idle': (['200','204','400','401'],
                                      ['200','204','400','401','422'])}
same key set: True
```

Everything else in the diff is prose. No `z.` call changed, no component
registration changed, no request schema changed; the one component that changed
at all (`UnknownRecipientError`) gained a `description` and its `recipient`
property gained words — both stripped by the fingerprint, both asserted by test.

### Tests

`openapi.test.ts` — two new describes, 12 assertions, against the **generated**
document:

- the `422` is declared and refs `UnknownRecipientError`;
- its description names all three recoveries and "nothing was parked and no work
  was claimed";
- it states both senses in which a scope is invalid;
- the operation says *why* a park is refused and that omitting `scope` is fine;
- `claim-all` declares no `422`, and `idle`'s prose says why — pinned so a later
  "make the two verbs consistent" pass has to read the reason first;
- `ERROR_CODES` still has 9 members and contains neither `unknown_lane` nor
  `unknown_scope` (the decision, as an assertion);
- the component and field descriptions carry the naming rationale;
- **sweep**: every declared `422` in the document is inside the `ApiError` union,
  over 10 inspected operations, with the count and `GET /api/queue/idle`
  membership pinned so the sweep cannot go vacuous.

`routes/queue.test.ts` (new) — 6 assertions driving the contract's own route
definition on a real `OpenAPIHono` through the generated typed client: the
refusal comes back as a typed `error` a consumer can **narrow on `code`**, its
body parses as both `UnknownRecipientErrorSchema` and `ApiErrorSchema`, the
message carries all three recoveries, and the three values that must never be
refused (omitted `scope`, `orchestrator`, a designated thread) are admitted.

**Non-vacuity, checked directly.** All 13 pinned strings are absent from the
pre-change `openapi.json` and present in the new one. With
`422: UNKNOWN_SCOPE_RESPONSE` removed and the document regenerated:

```
$ npx tsc --noEmit -p packages/contract   → exit 2
  routes/queue.test.ts(81,9):  TS2367 comparison unintentional — types
      '"bad_request" | "unauthorized" | undefined' and '"unknown_recipient"'
  routes/queue.test.ts(82,18): TS2339 'recipient' does not exist on type 'never'
$ vitest run openapi.test.ts routes/queue.test.ts → 4 failed
```

That TS2367 is the gap this issue closes, stated in the compiler's own words: a
consumer could not type the branch for a response the server sends. The
declaration was then restored and both generated artifacts verified
byte-identical to the values above.

## Completion Checklist (orchestrator)

- [ ] Committed with `[CONTRACT-058]` prefix
