# [CONTRACT-004] Mandatory request bodies are typed optional in the generated client

## Domain

contract

## Status

done

## Priority

P1

## Model

opus — mechanical `required: true` sweep with a pinned invariant; the only judgment (which bodies are genuinely mandatory) is enumerable from the routes.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: — (should land before UI-002 consumes the mutating client surface broadly)

## Spec References

- SPEC.md §9.3 — the generated client is the consumer surface; compile-time honesty is the point
- `issues/contract/002-contract-full-surface.md` — halt-addendum E2E note (discovery record)

## Summary

Found during the halt-reason addendum: OpenAPI treats an omitted `requestBody.required` as `false`, so every route body ships optional and `openapi-typescript` emits `requestBody?:` — `client.api.POST("/api/docs")` with no body compiles and then 400s at runtime. The two genuinely-omittable bodies (`halt`, `fail`) now declare `required: false` explicitly; the ~9 mandatory ones must declare `required: true` so omission is a compile error.

## Acceptance Criteria

- [x] Every route with a request body declares `required` explicitly — per the pinned rule below, not the (wrong) `halt`/`fail` enumeration; no route relies on OpenAPI's implicit default.
- [x] Invariant test: walk the document; any operation with a requestBody must carry an explicit `required` key (catches the class). Also asserts the value against the schemas, and that the one exemption stays earned.
- [x] Compile-time probes: `POST /api/docs` (and four more mandatory-body routes) without a body is a `tsc` error post-fix (reproduced compiling pre-fix first); the bare-callable list still compiles bare and with a body.
- [x] Consumers still typecheck: repo-wide typecheck green; there are **no** mutating client call sites in `apps/cli`/`apps/ui`/`apps/server`/`packages/kit`/`plugins`, so nothing broke and nothing was worked around.
- [x] **Rider (evaluator doc nit, sprint-003 round 2)**: `haltQueue`'s route description names only two of three outcomes — a bare re-halt also **clears** a previously recorded reason. Corrected to "replace, add, or clear" and pinned by a test; behavior unchanged.
- [x] Artifacts regenerated, byte-deterministic (three identical runs). Drift check: regeneration half green; its `diffAgainstHead` half reports the intended uncommitted change, which the orchestrator's commit closes.
- [ ] **Escalated**: `POST /api/threads/{id}/turns` cannot declare `required: true` — `@hono/zod-openapi@1.5.1` registers every media type's validator unconditionally when it does, breaking both forms of the route. Shipped as an explicit, tested exemption; needs an orchestrator decision (see the E2E log).

## Sprint-004 Adjudication (binding, 2026-07-27)

The "exactly halt and fail" enumeration in this issue is factually wrong (seen, acquire-lock, and `PUT /api/docs/{id}` are also wholly optional). **Pinned rule instead of a list**: a request body is `required: false` iff every field in its schema is optional (a bare invocation is meaningful); any body with at least one required field declares `required: true`. The invariant test asserts the rule against the schemas, not a hand-list; sprint-004 TEST-71's enumeration derives from applying the rule.

## Technical Design

### Files to Create/Modify

- `packages/contract/src/routes/*.ts` — explicit `required` on every body
- `packages/contract/src/openapi.test.ts` — the explicit-required invariant
- Regenerated artifacts

## Testing Strategy

The invariant test plus the compile probes; existing route/client tests must stay green.

## E2E Verification Plan

### Verification Steps

1. Pre-fix: scratch `tsc` file calling `POST /api/docs` with no body compiles (log it).
2. Post-fix: same file fails to compile; bare `halt`/`fail` still compile; drift green twice.

## E2E Verification Log

**implemented on: opus.** Worktree `.claude/worktrees/contract-004` (branch `wt-contract-004`).
Scratch prefix `/tmp/corpus-c004-pXdLmy` (from `mktemp -d /tmp/corpus-c004-XXXXXX`). No port
bound anywhere in this issue's verification.

### Reproduction (bugs only) — TEST-69

Probe files under the scratch prefix, resolving `@corpus/contract/client` through the
worktree's own `node_modules` (symlinked into the scratch dir), compiled with the worktree's
`tsc` against the **pre-fix** `npm run build` output:

```ts
// probe-docs.ts
const client = createCorpusClient({ baseUrl: "http://127.0.0.1:9", token: "t" });
export const r = await client.api.POST("/api/docs");     // no second argument at all
// probe-threads.ts — same, POST("/api/threads")
```

```
$ npx tsc --noEmit -p /tmp/corpus-c004-pXdLmy/tsconfig.json
EXIT=0
```

**Both compiled clean** — the gap reproduces. `openapi.json` before the fix carried
`requestBody.required` on only two of eleven bodies (`halt`, `fail`); the other nine relied on
OpenAPI's implicit `false`, and `openapi-typescript` emitted `requestBody?:` for each.

Runtime half (`DEFERRED → SERVER-005`: `POST /api/docs` has no server handler yet, so the
substitute is the **real contract route definition** mounted on a real `OpenAPIHono` and
exercised through `app.request()` — no port bound, per this sprint's port table):

```
$ npx tsx /tmp/corpus-c004-pXdLmy/runtime-400.ts
no body at all:    400 {"success":false,"error":{"name":"ZodError", … "path":["type"] …
empty JSON body:   400 {"success":false,"error":{"name":"ZodError", … "path":["type"] …
```

Compile-clean, runtime-400: exactly the mismatch this issue exists to close.

### Post-Implementation Verification

#### The partition the rule produces (TEST-73)

Applying the adjudicated rule — `required: false` iff every field in the body's schema is
optional — to all **eleven** bodies in the surface, read back out of the regenerated
`openapi.json`:

| Route | Schema(s) | Schema `required` | Declared |
| ----- | --------- | ----------------- | -------- |
| `POST /api/docs` | `CreateDocRequest` | `["type","title"]` | **true** |
| `POST /api/docs/{id}/move` | `MoveDocRequest` | `["folder"]` | **true** |
| `POST /api/capture` | `CaptureRequest` (multipart) | `["text"]` | **true** |
| `POST /api/threads` | `CreateThreadRequest` | `["body"]` | **true** |
| `POST /api/jobs/{id}/log` | `AppendLogRequest` | `["line"]` | **true** |
| `PUT /api/docs/{id}` | `UpdateDocRequest` | `[]` | **false** |
| `POST /api/threads/{id}/seen` | `MarkSeenRequest` | `[]` | **false** |
| `POST /api/locks/{docId}` | `AcquireLockRequest` | `[]` | **false** |
| `POST /api/queue/halt` | `HaltQueueRequest` | `[]` | **false** |
| `POST /api/queue/{id}/fail` | `FailEventRequest` | `[]` | **false** |
| `POST /api/threads/{id}/turns` | `AppendTurnRequest` `["body"]` + `MultipartAppendTurnRequest` `[]` | mixed | **false** — exemption, below |

Two divergences from sprint-004's prose, both stated rather than smuggled:

1. **`PUT /api/docs/{id}` is `required: false`**, not `true`. Sprint Open Conflict 6's
   *recommendation* wanted it mandatory "despite its all-optional schema"; the issue's later
   **Sprint-004 Adjudication (binding, 2026-07-27)** replaced that with the RULE, and the rule
   says false. The route description now states the consequence: an omitted body is exactly a
   `{}` body — a save that names no change.
2. **`POST /api/threads/{id}/turns` is `required: false`** — the one exemption from the rule,
   forced by an upstream defect and **escalated**. See below.

#### The one exemption, and why it is not a choice (escalation)

`@hono/zod-openapi@1.5.1` conflates the document's `required` with validator registration.
From `node_modules/@hono/zod-openapi/dist/index.mjs`, inside the per-media-type loop:

```js
if (isJSONContentType(mediaType)) {
  const validator = zValidator("json", schema, effectiveHook);
  if (route.request?.body?.required) validators.push(validator);   // ← unconditional
  else { /* content-type-aware middleware */ }
}
if (isFormContentType(mediaType)) { /* the same shape */ }
```

With `required: true` and **two** media types, *both* hard validators are registered, so the
route rejects both of its own forms. Measured on an isolated fixture (a two-media-type route,
run three ways):

| `required` | JSON request | multipart request |
| ---------- | ------------ | ----------------- |
| `true` | 201 | **400** (JSON validator's content-type check) |
| `false` | 201 | 201 |
| `true`, single media type | 201, and **400** when bare | — |

On the real route it is worse: with `required: true`, a JSON turn-append also 400s, because
the form validator then runs `parseBody()` on the JSON request and `MultipartAppendTurnRequest`'s
`text`-or-`files` refinement rejects the resulting `{}`. Setting `required: true` on this one
route turned **7 shipped tests red** (`routes/index.test.ts` ×2, `client/upload.test.ts` ×4,
`client/index.test.ts` ×1) — every turn append, JSON and multipart alike.

The rule's letter admits the `false` reading here (the multipart schema *is* wholly optional at
the JSON-Schema level — its constraint lives in a `.refine`), so the shipped state is coherent,
but the loss is real: `client.api.POST("/api/threads/{id}/turns")` still compiles bare. It is
recorded as an explicit, tested exemption (`RULE_EXEMPTIONS` in `openapi.test.ts`, with a test
that fails if the exemption ever stops being necessary) rather than as a silent gap.
**Escalated to the orchestrator** — see the report for the two candidate resolutions.

#### Compile probes (TEST-70 / TEST-71), post-fix, against a rebuilt `packages/contract`

`npm run build` first, then `npx tsc --noEmit` per probe file:

```
=== probe-with-body (POST /api/docs + /api/threads, valid bodies) ===
(clean)
=== probe-mandatory-bare ===
probe-mandatory-bare.ts(4,35):  error TS2554: Expected 2 arguments, but got 1.        # POST /api/docs
probe-mandatory-bare.ts(5,63):  error TS2345: Property 'body' is missing in type
                                '{ params: { path: { id: string; }; }; }' but required
                                in type '{ body: { folder: string; } & {}; }'.        # POST /api/docs/{id}/move
probe-mandatory-bare.ts(8,35):  error TS2554: Expected 2 arguments, but got 1.        # POST /api/threads
probe-mandatory-bare.ts(9,62):  error TS2345: Property 'body' is missing … '{ line: string; }'  # POST /api/jobs/{id}/log
=== probe-capture-bare ===
probe-capture-bare.ts(4,37):    error TS2554: Expected 2 arguments, but got 1.        # POST /api/capture
=== probe-bare-ok (halt, fail, seen, acquire-lock, PUT docs, turn-append — all bare) ===
(clean)
=== probe-bare-with-body (the same six, each with a body) ===
(clean)
```

All five mandatory bodies now fail to compile when omitted, each error naming the missing body
argument; adding a valid body makes them compile again (probe-with-body), so the probes are not
passing on an unrelated type error. The bare-callable list compiles **both** bare and with a
body.

**The adjudicated bare-POST list, verbatim as shipped:** `POST /api/queue/halt`,
`POST /api/queue/{id}/fail`, `POST /api/threads/{id}/seen`, `POST /api/locks/{docId}`,
`PUT /api/docs/{id}` — plus `POST /api/threads/{id}/turns` as the escalated exemption.

#### The class invariant (TEST-72 / TEST-74)

`packages/contract/src/openapi.test.ts` walks every path × method, resolves each request body's
schema (`$ref` and `allOf` flattened), and asserts: every body carries an explicit `required`
key; the value equals the rule computed from the schemas; the exemption set is exactly one entry
and is still earned; no body uses `anyOf`/`oneOf`, which would make "every field is optional"
branch-relative; the count is pinned at eleven; multipart bodies are treated identically to JSON
ones; and every genuinely bare-callable body says so in its description.

Negative control — deleting `required: true` from `POST /api/docs` and regenerating:

```
Tests  3 failed | 81 passed (84)
  ✗ declares `required` explicitly on every one of them
  ✗ declares `required` exactly as the schemas dictate
  ✗ partitions the surface into the mandatory and the omittable sets
```

Restored, regenerated, green again (84/84).

A second, complementary probe lives at `packages/contract/src/client/request-body-required.test.ts`:
`satisfies` assertions over the generated `paths` types, so the same table is enforced by `tsc`
on the surface the CLI and the UI actually write against.

#### Artifacts (TEST-75)

Generated three times in a row; both artifacts byte-identical every time:

```
openapi.json:  0f927b4f15b29177301798cce6eb4605  (×3)
schema.gen.ts: a0f57b6b419b00451d231814bb231c7f  (×3)
```

`scripts/check-generated-artifacts.ts`, run twice: its **regeneration half is green** (the
hash is unchanged across a regeneration ⇒ the committed bytes are the generated bytes) and its
`diffAgainstHead` half reports the nine added `required` keys, which is the intended, still
**uncommitted** change of this issue — domain agents do not commit. It goes green the moment the
orchestrator commits the artifacts alongside the route edits. `docs/cli.md` is untouched and its
check is green.

The `openapi.json` diff is nine added `required` keys plus the description edits; `halt` and
`fail` already declared `required: false` and are unchanged.

#### Consumers (TEST-76)

```
$ npm run build && npm run typecheck        # every workspace
> tsc --noEmit  ×5   → green
```

**No consumer call site breaks.** There are no `.POST(` / `.PUT(` / `.DELETE(` call sites in
`apps/cli`, `apps/ui`, `apps/server`, `packages/kit` or `plugins/` — the only `createCorpusClient`
consumers are `apps/ui/src/app/apiClient.ts` and `apps/cli/src/client.ts`, both of which
construct the client without yet issuing a mutating call. Nothing to report as a latent 400,
and nothing escalated on that axis.

#### Gate

```
npm run build       → green
npm run lint        → green (eslint, no warnings)
npm run format:check→ green
npm run typecheck   → green (5 workspaces)
npm run test:coverage → 115 files, 2127 tests passed
                        coverage 99.22 % lines / 95.90 % branches / 99.63 % functions
```

Contract package alone: 27 files, 606 tests passed (up from 599 — 6 invariant tests + 1 client
type probe).

#### Rider

`haltQueue`'s description now reads "a second call may replace, add, or clear the reason: a bare
re-halt rewrites the sentinel without one", pinned by a test. Behaviour unchanged.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (one escalated, see above)

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CONTRACT-004]` prefix
