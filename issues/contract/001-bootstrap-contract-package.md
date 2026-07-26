# [CONTRACT-001] Bootstrap @corpus/contract: zod-openapi routes, spec generation, typed client

## Domain
contract

## Status
done

## Priority
P0

## Model
opus — the API surface is pinned by the revised spec; implementation is well-specified scaffolding + generation wiring.

## Dependencies
- Depends on: SHARED-001, INFRA-007 (build/exports wiring — `@corpus/contract` must resolve from consumers)
- Blocks: server scaffold, CLI scaffold, UI data layer (Phase 1 issues, to be filed by /decompose)

## Spec References
- SPEC.md §9.2 (HTTP API) — as revised by SHARED-001
- CLAUDE.md — Architecture Decision 3 (contract-first via code)

## Summary
Create `packages/contract` as the single source of truth for the HTTP API: Zod schemas + `@hono/zod-openapi` route definitions, a generation script that emits a committed `openapi.json`, and a generated typed client (`openapi-typescript` + `openapi-fetch`) exported for the CLI and UI. Include the drift check (regenerate + diff) wired into pre-push.

## Acceptance Criteria
- [x] `packages/contract/src/schemas/` holds Zod schemas for the core resources (doc frontmatter, thread, turn, queue event, lock, job) per revised SPEC.md.
- [x] Route definitions built with `createRoute` from `@hono/zod-openapi`, importable by the server to register handlers.
- [x] `npm run generate -w packages/contract` emits `packages/contract/openapi.json` (committed) and regenerates the typed client.
- [x] Package exports: `@corpus/contract` (schemas + routes) and `@corpus/contract/client` (typed client factory taking base URL + bearer token).
- [x] Pre-push drift check fails when `openapi.json` or the generated client is stale relative to route definitions.
- [x] Unit tests: schema round-trips for each core resource; a route definition compiles into a Hono app and serves `/doc` (the OpenAPI endpoint) in a smoke test.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/*.ts` — Zod resource schemas
- `packages/contract/src/routes/*.ts` — zod-openapi route definitions grouped by resource
- `packages/contract/scripts/generate.ts` — emit openapi.json + run openapi-typescript
- `packages/contract/src/client/` — generated types + thin openapi-fetch wrapper (hand-written factory, generated types)
- `.githooks/pre-push` — add drift check step
- `packages/contract/package.json` — exports map, generate script

### Key Implementation Details
Start with a deliberately small surface (docs CRUD + threads + queue) matching the revised spec's endpoint list; grow per-issue afterward. Generated files are committed and marked `linguist-generated` in `.gitattributes`. The client wrapper injects `Authorization: Bearer <token>` and surfaces a typed error union.

### Edge Cases
- Multipart endpoints (attachments) — openapi-fetch handles them awkwardly; the wrapper may expose a dedicated upload helper.
- SSE endpoint is documented in the OpenAPI doc but the client exposes it as an EventSource helper, not a fetch call.

## Testing Strategy
Vitest in `packages/contract`: schema parse/serialize round-trips, route smoke test (mount on Hono, hit `/doc`), generation script produces stable output (run twice → identical).

## E2E Verification Plan

### Verification Steps
1. `npm run generate -w packages/contract` from a clean tree → no diff (generation is idempotent).
2. Hand-edit a route (add a field), regenerate → `openapi.json` and client types change; `git push` without regenerating is blocked by the drift check.
3. Node REPL/script: import `@corpus/contract/client`, point it at a stub Hono app mounting the contract routes, make a typed call, observe a typed response.

## E2E Verification Log

implemented on: opus

### Reproduction (bugs only)
N/A — not a bug.

### Post-Implementation Verification

**1. Generation is idempotent (verification step 1).**

```
$ shasum packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
21540e7af7df1ae2b7aa695942cea0e58927c0bb  packages/contract/openapi.json
bc8c5299e65519a5483263662c3b33e762d64786  packages/contract/src/client/schema.generated.ts
$ npm run generate -w packages/contract
> tsx scripts/generate.ts
generated ./openapi.json
generated ./src/client/schema.generated.ts
$ npm run generate -w packages/contract   # second run
$ shasum packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
21540e7af7df1ae2b7aa695942cea0e58927c0bb  packages/contract/openapi.json
bc8c5299e65519a5483263662c3b33e762d64786  packages/contract/src/client/schema.generated.ts
```

Byte-identical across three runs. `src/generation/artifacts.test.ts` asserts the same property in
the unit suite (build twice, compare strings) and additionally compares the committed bytes against
a fresh build, so CI fails on drift as well (SPEC.md §9.3 asks for the check in pre-push *and* CI).

**2. Drift check fires (verification step 2).** Verified by running the hook directly rather than
attempting a push. Case A — a hand-edited `openapi.json` (`info.title` changed, `/api/queue/status`
deleted):

```
$ bash .githooks/pre-push
pre-push ▶ build
pre-push ▶ contract drift
  The committed API contract is stale relative to packages/contract/src.
  Fix: npm run generate -w packages/contract && git add packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
pre-push ✗ contract drift failed.
...
pre-push: blocked.
```

Case B — a route changed without regenerating (`sort` query parameter added to `listDocs`): the same
step failed, and regeneration then showed both artifacts changing
(`openapi.json` 21540e7 → 3658f25, `schema.generated.ts` bc8c529 → e7b0f11) with
`sort?: "updated" | "created"` appearing in the generated client types. Case C — route reverted while
the artifacts still carried `sort`: the unit suite caught it independently of git:

```
$ npx vitest run packages/contract/src/generation
AssertionError: openapi.json is stale — run: npm run generate -w packages/contract
AssertionError: src/client/schema.generated.ts is stale — run: npm run generate -w packages/contract
Tests  5 passed | 2 failed
```

Case D — clean tree: `bash .githooks/pre-push` → `pre-push ✓ all checks passed`. All experiments
were reverted; `diff -q` confirmed `openapi.json` and `routes/docs.ts` returned byte-identical.

**3. Typed client against a real server (verification step 3).** A throwaway harness (deleted after
the run) started a real `node:http` server delegating to an `OpenAPIHono` app that mounts the
contract's own route definitions, with real bearer-token middleware, and drove it through
`createCorpusClient` imported from `@corpus/contract/client` — i.e. resolved through the package
exports map into `dist/`, not from source:

```
server listening on http://127.0.0.1:54639

1. GET /api/health -> 200 {"status":"ok","version":"0.1.0","uptimeSeconds":1,"workspace":"/tmp/ws"}
2. GET /api/docs?q=mortgage -> 200 page: {"total":1,"limit":50,"offset":0} titles: ["Mortgage options"]
3. raw GET /api/docs without a token -> 401 {"code":"unauthorized","message":"Missing bearer token."}
4. GET /api/docs/doc_missing1 -> 404 data: undefined error.code: not_found
5. PUT /api/docs/doc_a1b2c3 -> "saved by agent" | per-call override: "saved by user" | reconciliation: {"remapped":["anc_k4f7"],"orphaned":[]}
6. GET /api/docs/not-an-id -> 400
7. GET /events -> http://127.0.0.1:54639/events?token=<token>
   invalidate payload: {"keys":[["docs"],["threads","th_x9y8"]]}

all checks completed
```

Line 2 shows the contract's pagination defaults applied server-side; line 3 confirms the client's
`Authorization` injection is what makes the same call succeed; line 4 shows the typed error union on
a declared 404; line 5 shows actor attribution from the factory and per-call `params.header`
override; line 6 shows contract-level path-parameter validation; line 7 shows the SSE EventSource
helper parsing a real `invalidate` frame off a real stream (run under
`node --experimental-eventsource`, using the runtime's global `EventSource`).

**4. The contract turns client mistakes into compile errors.** `tsc --noEmit` on a scratch file
consuming `@corpus/contract/client`:

```
error TS2554: Expected 2 arguments, but got 1.                      # GET("/api/nope")
error TS2353: 'sort' does not exist in type '{ limit?: ...; q?: ...; status?: ... }'
error TS2322: Type '"robot"' is not assignable to type '"user" | "agent" | undefined'
error TS2339: Property 'attention' does not exist on type '{ frontmatter: {...}; body: string; ... }'
```

**5. Full gate.**

```
$ npm run build       # ok
$ npm run lint        # eslint: 0 problems
$ npm run format:check# All matched files use Prettier code style!
$ npm run typecheck   # all workspaces clean
$ npm run test:coverage
 Test Files  23 passed (23)
      Tests  218 passed (218)
All files          |     100 |      100 |     100 |     100 |
$ bash .githooks/pre-push
pre-push ✓ all checks passed
```

### Addendum — pr-reviewer fixes on PR #7 (implemented on: opus)

Two MAJOR findings from the review of commit `bbf8f5b`, both fixed and re-verified.

**FINDING 2 — undeclared 400 responses.** `getDoc`, `getThread`, `claimAll`, `completeEvent` and
`streamEvents` validate path params, the actor header or query params but declared no `400`, so their
typed error unions could not represent a response they really return. All five now declare
`400: VALIDATION_RESPONSE`. Two invariant tests in `src/openapi.test.ts` pin the rule in both
directions — every operation with `parameters` or a `requestBody` declares 400, and no input-less
operation declares it. Post-fix inventory from the regenerated `openapi.json`:

```
GET   /api/health                  input=no  400=no
GET   /api/docs                    input=yes 400=yes
POST  /api/docs                    input=yes 400=yes
GET   /api/docs/{id}               input=yes 400=yes
PUT   /api/docs/{id}               input=yes 400=yes
GET   /api/threads/{id}            input=yes 400=yes
POST  /api/threads                 input=yes 400=yes
POST  /api/threads/{id}/turns      input=yes 400=yes
GET   /api/queue/status            input=no  400=no
POST  /api/queue/claim-all         input=yes 400=yes
POST  /api/queue/{id}/complete     input=yes 400=yes
POST  /api/queue/{id}/fail         input=yes 400=yes
GET   /events                      input=yes 400=yes
```

The invariant test is a real guard, not decoration — deleting the new 400 from `getDoc` fails it by name:

```
$ npx vitest run packages/contract/src/openapi.test.ts
1. generated OpenAPI document declares 400 on every operation that validates request input
   AssertionError: expected [ 'get /api/docs/{id}' ] to deeply equal []
```

Driven through the typed client against a real HTTP server mounting the contract (temporary harness,
deleted after the run; the app used a `defaultHook` rendering the contract's `ValidationError` shape):

```
F2. GET /api/docs/not-an-id -> 400
    narrowed error.code: bad_request | issues: [{"path":"id","message":"Invalid string: must match pattern /^(doc|th)_[A-Za-z0-9]+$/"}]
    GET /api/docs/doc_a1b2c3 -> 200 title: Mortgage options
```

`tsc --noEmit` on a scratch consumer confirms the union is genuinely narrowed rather than widened:

```
error TS2339: Property 'issues' does not exist on type ... '{ code: "unauthorized"; message: string; }'   # unnarrowed access
error TS2367: types '"bad_request" | "unauthorized" | "not_found" | undefined' and '"locked"' have no overlap
```

The second message is the proof: `bad_request` is now in `getDoc`'s union, and only the codes that
route can actually return are.

**FINDING 3 — §8's "note only" was unexpressible.** `requestsAgent` is now a genuine tri-state,
`z.boolean().optional()` with no default, on both `AppendTurnRequestSchema` and
`CreateThreadRequestSchema`; each field description states all three cases, and both `eventId`
response descriptions were rewritten to match (explicit `false` always yields `null`).
`src/schemas/thread.test.ts` gains a table-driven block over both schemas asserting explicit-`false`
survives as `false`, explicit-`true` as `true`, omission stays `undefined`, the two remain
distinguishable, and a non-boolean is rejected rather than coerced. End to end against an *engaged*
thread, with the stub server applying `body.requestsAgent ?? engaged`:

```
F3. requestsAgent omitted            -> server saw requestsAgent=undefined present=false | eventId="evt_7c1d"
F3. requestsAgent true               -> server saw requestsAgent=true      present=true  | eventId="evt_7c1d"
F3. requestsAgent false (note only)  -> server saw requestsAgent=false     present=true  | eventId=null
```

The third line is the behaviour that was impossible before: a user posting into an engaged thread and
suppressing the re-trigger. CONTRACT-002's design pin 2 was amended to record the tri-state so the
remaining request schemas (capture, multipart turn-append) inherit it.

**Gate after the fixes.**

```
$ npm run build          # ok
$ npm run lint           # 0 problems
$ npm run format:check   # All matched files use Prettier code style!
$ npm run typecheck      # all workspaces clean
$ npm run test:coverage
 Test Files  23 passed (23)
      Tests  230 passed (230)
All files          |     100 |      100 |     100 |     100 |
```

Drift: regeneration is a no-op against the working tree
(`shasum` identical before/after: `2600420304ba1ecb49b620d6ed74fb042cd9c711`), so the hook's
content guard is green. Its second guard (`git diff HEAD`) reports the regenerated artifacts as
differing from `bbf8f5b` — correct, since these fixes are deliberately left uncommitted; it clears
once they are committed.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (P0, cross-domain surface)
- [ ] `/evaluate` passes
- [ ] Committed with `[CONTRACT-001]` prefix
