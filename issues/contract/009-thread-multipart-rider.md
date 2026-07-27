# [CONTRACT-009] Multipart `createThread` + declared 413 (attachments rider)

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — mirrors the multipart shape Capture already declares.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: UI-008

## Spec References

- SPEC.md §6 — attachments; §8 — Ask with attachments
- `issues/server/010-attachments.md` — E2E Verification Log (adjudications 5b and AC-2 strike)

## Summary

SERVER-010 discovered `POST /api/threads` is JSON-only in the contract, so *Ask*-with-attachments has no wire path — only Capture (which already declares multipart) ships attachment ingest today. This rider: (1) adds the multipart variant to `createThread`, mirroring Capture's declared shape; (2) declares **413** for over-cap uploads on both multipart routes (SERVER-010 ships the adjudicated interim 400 because 413 was undeclared — the server flips to 413 when this lands).

Reference format UI-008 must resolve (byte string pinned by SERVER-010's E2E): `![shot.png](attachments/th_x/2026-07-27T16%3A14%3A46Z/shot.png)` — each path segment percent-encoded (colons), display text human-readable.

## Acceptance Criteria

- [x] `createThread` accepts the multipart variant with the same file-part shape as Capture; JSON-only requests unchanged.
- [x] 413 declared on both multipart routes; the ApiError union extended if needed; server flip noted for a small SERVER follow-up.
- [x] All standing invariants; artifacts regenerated; round-trips.

## Technical Design

- **`POST /api/threads` becomes dual-media**, following the turn-append precedent exactly.
  `packages/contract/src/routes/thread-create.ts` holds the route and its mounting helper;
  the mechanism both dual-media routes share was extracted to `routes/dual-media.ts`
  (`mountDualMedia`, the content-type predicates, `missingBodyError`) so there is one
  implementation rather than two copies. `turn-append.ts` now delegates to it and keeps every
  export it published.
- **`MultipartCreateThreadRequest`** mirrors `CaptureRequest` part for part: `text` for the prose,
  the same string-boolean `requestsAgent`, and the **same repeated `files` part** (`FILES_FIELD`),
  published byte-identically as `{type:"array", items:{type:"string", format:"binary"}}`. It adds
  `parent`, `title`, and `selector` **as one JSON-encoded part** — every multipart part is text, and
  flattening the selector into three parts would invent a second wire spelling of a shape the JSON
  branch already defines, which would then drift.
- **The JSON branch is untouched.** `CreateThreadRequestSchema` is unchanged, the body stays
  `required: true`, and 201/400/401/404/423 all still apply to both branches.
- **413 reuses `bad_request`** (Open Conflict 4's recommendation). An over-cap upload is a
  request-shape problem; `ValidationError`'s `{code, message, issues[]}` already carries the
  field-level detail. Adding an eighth member to a union discriminated on `code` would touch every
  narrowing site — the CLI's error renderer, `UploadError`, eight schemas — for one status. The
  status code carries the distinction, which is what status codes are for. `ERROR_CODES` is
  unchanged and asserted unchanged.
- **`uploadCreateThread` / `buildThreadFormData`** join `uploadTurn` and `uploadCapture` in
  `client/upload.ts`, since `openapi-fetch` serialises JSON only.

## E2E Verification Log

**implemented on: opus** (worktree `.claude/worktrees/contract-riders`, sprint-008, ports 8910–8919
allocated; no port was bound — see *What was not verified here* below).

### Post-Implementation Verification

**UI-008's reference format, restated verbatim rather than re-derived** (TEST-51 — the type system
will not catch a rename of this string, it is `Record<string, unknown>`-grade):

```
![shot.png](attachments/th_x/2026-07-27T16%3A14%3A46Z/shot.png)
```

Each path segment percent-encoded (the colons in the ISO instant), display text human-readable.

**The dual-media body, over real HTTP against the mounted route** (`src/routes/thread-create.test.ts`,
`src/routes/index.test.ts`, `src/client/upload.test.ts` — the route mounted with
`mountCreateThread`, the way `apps/server` must mount it):

- JSON `{"body":"Why 6.1%?"}` → **201**, validator saw the JSON form (`json body=Why 6.1%?`).
- JSON anchored `{body, parent:"doc_a1b2c3", selector:{exact:"a 30-year fixed at 6.1%"}}` → **201**,
  `anchorId: "anc_k4f7"`. **The JSON branch is semantically unchanged.**
- multipart with `files` and no `text` (attachment-only first turn) → **201**,
  `multipart text= files=shot.png`.
- multipart with two `files` parts → `files=a.png|b.png` — the same repeated part capture takes.
- multipart with `selector` as one JSON part → **201**, decoded into the same shape the JSON branch
  carries, `anchorId: "anc_k4f7"`.
- multipart with neither `text` nor `files` → **400**; `selector` that is not JSON, is not an object,
  has no quote, or has an empty quote → **400** (four cases).
- no body and no content-type → **400** `MISSING_THREAD_BODY_ERROR`; `text/plain` body → **400**;
  `APPLICATION/JSON; charset=utf-8` → **201** (casing and charset tolerated).

**The generated document** (`openapi.json`, after regeneration):

```
/api/threads   post  content:   ['application/json', 'multipart/form-data']   (order significant)
/api/threads   post  responses: ['201','400','401','404','413','423']
/api/capture   post  responses: ['201','400','401','413']
/api/threads/{id}/turns post   responses: ['201','400','401','404','413']
```

`MultipartCreateThreadRequest` publishes with **no `required` array** (all parts optional, the
either-text-or-files rule enforced by a refine, exactly as `MultipartAppendTurnRequest` does) and its
`files` property is byte-identical to capture's:

```json
"files": { "type": "array", "items": { "type": "string", "format": "binary" } }
```

**The typed client sees it.** `paths["/api/threads"]["post"]["requestBody"]` is **not** `undefined`-able
— pinned by a compile-time assertion (`ThreadBodyIsMandatory`), so a body going optional to satisfy
the library would fail `tsc --noEmit` rather than a test run.

**Standing invariants — extended, not loosened:**

| Invariant | Outcome |
| --- | --- |
| "offers both a JSON and a multipart body on turn-append" | untouched; a **new** sibling assertion added for thread creation, same key order |
| "types the attached files as an array of binaries" | now covers `MultipartCreateThreadRequest` alongside `MultipartAppendTurnRequest` and `CaptureRequest` |
| "declares capture as multipart only" | unchanged |
| "treats a multipart body as a body" | list grew to `[POST /api/capture, POST /api/threads, POST /api/threads/{id}/turns]` |
| request-body count | **12** — unchanged by this issue: a media type is not a new body |
| mandatory/omittable partition | `POST /api/threads` still `true`; the multipart branch demands text-or-files exactly as turn-append does |
| `RULE_EXEMPTIONS === {}` | still empty — the turn-append precedent removed the need for one |
| "declares neither 409 nor 423 on the read-only route" / per-route 423 list | `POST /api/threads` keeps its `423` **and** its `404`; the multipart branch can return everything the JSON branch can |
| error union closed | `ERROR_CODES` asserted unchanged (7 members); no `PayloadTooLargeError` component |
| **new**: 413 declared on exactly the routes that accept `multipart/form-data` | asserted from both sides — a future file-taking route that forgets it, and a `413` on a route that cannot return one, both fail |

**Generation is idempotent — three consecutive runs at the final state**
(`npm run generate -w packages/contract`, hashing between each):

```
6c7bb8bfffbc04abb2d7b8b6facec58a  openapi.json                    (run n, n+1, n+2 — identical)
e2f840a55bde3eee6df2e2d177ed5faf  src/client/schema.generated.ts  (run n, n+1, n+2 — identical)
```

**`node --import tsx scripts/check-generated-artifacts.ts`, twice** — byte-identical output both
times, and it reports:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add …
 packages/contract/openapi.json                   | 297 ++++++++++++++++++++++-
 packages/contract/src/client/schema.generated.ts | 176 +++++++++++++-
✓ CLI reference is up to date (docs/cli.md).
```

That `✗` is **the working-tree-vs-HEAD diff, not an idempotence failure**: the script compares the
artifacts against the ones committed at HEAD, and this agent may not commit. It goes green the moment
the orchestrator commits the regenerated artifacts. The idempotence half is the hash evidence above.
**`docs/cli.md` is byte-unchanged** (TEST-67 ✓) — no CLI help text changes in this issue.

**Contract suite and checks, in isolation** — every exit code read from the tool itself, not from a
pipe:

```
vitest run packages/contract                  → 33 files / 881 tests passed
tsc --noEmit -p packages/contract/tsconfig.json → TSC_NOEMIT_EXIT=0
tsc -p packages/contract/tsconfig.build.json    → BUILD_EXIT=0
eslint packages/contract                        → ESLINT_EXIT=0   (no rule disabled anywhere)
prettier --check packages/contract/**           → PRETTIER_EXIT=0
```

**A correction worth recording, because it nearly shipped.** An earlier pass of this work extracted a
**generic** `mountDualMedia<R extends RouteConfig, E>` into `routes/dual-media.ts`. It does not
typecheck: `@hono/zod-openapi`'s handler type is a conditional over the route's `responses`, and over
an unresolved `R` neither `c.json(error, 400)` nor `c.req.valid(target)` can be typed — four errors at
`dual-media.ts:89,100,105`. **Vitest did not catch it** (it does not typecheck), and the `tsc` runs
that were supposed to catch it had been invoked as `timeout 240 tsc … | tail` — the `timeout` killed
the run before it finished and the recorded exit code was `tail`'s, always `0`. The fix keeps the
extraction non-generic (media types, content-type predicates, `missingBodyError`, `dualMediaSource`)
and gives each route its own twelve-line `mount*` helper with a **resolved** route type, which is what
`turn-append.ts` always had. Lesson for this package: **read `tsc`'s own exit code, never a pipeline's.**

### The runtime hazard SERVER-023 must not miss

`app.openapi(contractRoutes.createThread, handler)` **still compiles** after this change and **fails
at runtime**: a `required: true` dual-media body makes `@hono/zod-openapi@1.5.1` push both
validators into the chain, so a JSON request must also satisfy the multipart schema and is rejected
with `400`. This is not a prediction — it was **observed**: `src/client/request-defaults.test.ts`
failed with `expected { success: false, … } to be undefined` on "accepts a standalone thread with
neither parent nor selector" the moment the media type landed, and went green when the stub switched
to `mountCreateThread`. **`apps/server/src/threads/routes.ts:41` has exactly that call site.** The
type system will not catch it; only a request will.

### What was not verified here, and why

- **TEST-49** (a genuinely over-cap upload returns `413` with the declared body on both the pre-parse
  `Content-Length` path and the post-parse path, against a real server on 8915) — `DEFERRED →
  SERVER-023`. `apps/server/src/attachments/limits.ts` still ships the adjudicated interim **400**,
  and `packages/contract` may not flip it (§9.3). No server was started: `apps/server` does not
  compile against this contract until SERVER-023 lands, so a "real server on 8915" is not
  constructible from this worktree. Substitute evidence: the declaration itself, asserted present on
  all three file-accepting routes and absent everywhere else. A declared-but-not-yet-returned 413 is
  honest forward compatibility; an undeclared returned 413 would not be.
- **TEST-50** (retire `limits.ts`'s comment promising "413 follows in the CONTRACT rider") — that
  comment is in `apps/server`. Named for SERVER-023 below; not edited here.
- **TEST-72** (the server flip is a filed issue, not a code comment) — **SERVER-023 exists and is the
  owner**, per the orchestrator's adjudication of Open Conflicts 5/7. Recording it in
  `issues/PLAN.md` is the orchestrator's step, not this agent's.
- **TEST-67** (`docs/cli.md`) — **not touched by this issue**: no CLI help text or output description
  changes here. It does change for CONTRACT-007's resolve/reopen rider, and CLI-008 owns the
  regeneration.

### Blast radius — the exact downstream break list for SERVER-023 / CLI-008

**Measured**, not derived: `packages/contract` built (`BUILD_EXIT=0`), then `tsc --noEmit` run in
each consuming workspace with its own exit code read directly.

```
apps/server   → SERVER_TSC_EXIT=2, exactly 5 errors
apps/cli      → CLI_TSC_EXIT=0
packages/kit  → KIT_TSC_EXIT=0
apps/ui       → UI_TSC_EXIT=0
```

**All five errors, verbatim locations:**

| # | Site | What breaks | Fix |
| --- | --- | --- | --- |
| 1 | `apps/server/src/queue/routes.ts:34` | TS2345 — the handler returns `{reaped}` where `ReapStaleResult` now requires `failed`: *"Property 'failed' is missing in type '{ reaped: string[]; }'"*. | Destructure `failed` from `queue.reapStale()` (it already computes it) and return it. |
| 2 | `apps/server/src/threads/routes.ts:76` (`resolveThread`) | TS2345 — `c.json(thread, 200)` no longer matches `ThreadMutationResponse {thread, warnings}`. | `c.json({ thread, warnings: serializeWarnings(result) }, 200)`. `reportWarnings(...)` already runs two lines above; `result` may be `null`, which is the empty-array case. |
| 3 | `apps/server/src/threads/routes.ts:84` (`reopenThread`) | TS2345 — identical to #2. | identical to #2. |
| 4 | `apps/server/src/jobs/project.ts:85` (`toJob`) | TS2741 — *"Property 'originTitle' is missing … but required in type"*. | Populate it (the current title of whatever `originId` names), or return `null` as the honest interim. `resolveOriginId()` returns an id only, so the title lookup is new work (SERVER-016 or a follow-up); `null` unblocks the branch immediately and is a legal value. |
| 5 | `apps/server/src/threads/routes.ts:47` | TS2345 — `c.req.valid("json")` is now the **union** of the two media types, and the multipart half has no `body`, so it is not assignable to `createThread(...)`'s parameter. | Narrow with `isMultipartThreadCreate(body)` from `@corpus/contract` before handing it to `createThread`. |

**And one break the type system does NOT catch — read this before closing SERVER-023.**
`apps/server/src/threads/routes.ts:41` still mounts with `app.openapi(contractRoutes.createThread, …)`.
Fixing error #5 alone leaves that line compiling and **every JSON `POST /api/threads` returning 400 at
runtime**, because a `required: true` dual-media body makes the library push both validators into the
chain. It must become `mountCreateThread(app, handler)`, exactly as `mountAppendTurn` is already used
at `:53`. This is not a prediction: `src/client/request-defaults.test.ts` went red with a real `400`
on *"accepts a standalone thread with neither parent nor selector"* the moment the media type landed,
and green when its stub switched to `mountCreateThread`.

**Two behavioural follow-ups, no compile error:**

| Site | Change |
| --- | --- |
| `apps/server/src/attachments/limits.ts` | Flip the adjudicated interim **400** for over-cap uploads to **413**, now declared on all three multipart routes; retire the comment promising *"413 follows in the CONTRACT rider"* (TEST-50). |
| `apps/cli/src/commands/thread/status.ts:33` | **`apps/cli` compiles clean** (`CLI_TSC_EXIT=0`), so nothing forces this — but `corpus thread resolve/reopen --json` now emits `{thread, warnings}` instead of the bare summary, and the verb's help (*"One JSON value: the thread summary"*) is now wrong. CLI-008's call (Open Conflict 6); `docs/cli.md` must be regenerated with the corrected description. |

**Nothing else breaks.** `apps/cli`, `packages/kit` and `apps/ui` all typecheck clean against the new
contract.

## Completion Checklist (domain agent)

- [x] Tests written and passing (33 files / 881 tests green in `packages/contract`)
- [x] `/lint` passes — eslint exit 0, prettier clean, `tsc --noEmit` exit 0 **for `packages/contract`**
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
