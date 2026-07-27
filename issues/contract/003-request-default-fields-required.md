# [CONTRACT-003] Request schemas with `.default()` render as required fields in the generated client

## Domain

contract

## Status

in_progress

## Priority

P1

## Model

opus — mechanical schema adjustment with a pinned convention; the only judgment (optional-in, defaulted-out) is adjudicated below.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: — (should land before SERVER-005 implements doc creation and UI-002 consumes `POST /api/docs`)

## Spec References

- SPEC.md §9.3 — contract-first; the generated client is the consumer surface
- `issues/contract/002-contract-full-surface.md` — escalation 2 in its final report (discovery record)

## Summary

Found during CONTRACT-002: CONTRACT-001's `CreateDocRequestSchema` uses `.default()` on `tags`/`status`/`due`/`evergreen`, and `openapi-typescript` renders defaulted fields as **required** in request types — so a typed `POST /api/docs` caller must send all four fields, defeating the point of a server-side default. The same hazard applies to any request schema written since (audit the full surface, not just this one). Response-side defaults are unaffected.

## Acceptance Criteria

- [x] Convention pinned in a schema-file comment and applied across every request schema: request-side optional fields are `.optional()` on the wire with the server-applied default stated in `.describe()` (optional-in); `.default()` is reserved for response/parse-side schemas where the parsed object should carry the value (defaulted-out). Zod-level defaults that must survive for server parsing move to server-side parse wrappers, not the shared request schema.
- [x] `CreateDocRequestSchema.tags/status/due/evergreen` become optional in the generated request type; a `tsc` probe proves `client.api.POST("/api/docs", { body: { title } })` compiles.
- [x] Full-surface audit: no other request schema renders a defaulted field as required (test iterating the generated types or the OpenAPI document's requestBody required arrays against schemas carrying defaults).
- [x] The tri-state `requestsAgent` adjudication is untouched (it is already defaultless by design — this issue must not reintroduce a default there).
- [x] Artifacts regenerated; drift check green; generation byte-deterministic.
- [x] Server semantics unchanged: SERVER-005+ applies the documented defaults server-side (record the handoff in the issue log; no server code changes here).

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/doc.ts` (and any other request schema the audit flags)
- `packages/contract/src/openapi.test.ts` — the no-required-defaulted-request-field invariant
- Regenerated `openapi.json` + `client/schema.generated.ts`

### Key Implementation Details

The invariant test is the durable part: for every operation with a requestBody, no property listed in `required` may carry a `default` in its schema. That catches the class, not the instance.

## Testing Strategy

Vitest in packages/contract: the invariant test, round-trips for changed schemas, a compile-time probe (type-level assertion) that the minimal create-doc body compiles.

## E2E Verification Plan

### Verification Steps

1. `tsc` probe: minimal `POST /api/docs` body compiles pre-fix fails / post-fix passes.
2. Regenerate twice — byte-identical; drift check green.

## E2E Verification Log

implemented on: opus. Worktree `.claude/worktrees/contract-003` (branch `wt-contract-003`, cut from `phase-2-server-cli`).

### Reproduction (bugs only)

**1. Full-surface audit of the published request surface (pre-fix).** A walk over every operation's `requestBody`, resolving `$ref`s, listing every property carrying a JSON Schema `default`:

```
POST /api/docs    [application/json] → CreateDocRequest.tags              default=[]     in required[]: no
POST /api/docs    [application/json] → CreateDocRequest.status            default="open" in required[]: no
POST /api/docs    [application/json] → CreateDocRequest.due               default=null   in required[]: no
POST /api/docs    [application/json] → CreateDocRequest.evergreen         default=false  in required[]: no
POST /api/threads [application/json] → CreateThreadRequest.parent         default=null   in required[]: no
POST /api/threads [application/json] → CreateThreadRequest.selector       default=null   in required[]: no
POST /api/threads [application/json] → CreateThreadRequest.selector.prefix default=""    in required[]: no
POST /api/threads [application/json] → CreateThreadRequest.selector.suffix default=""    in required[]: no
```

Note the third column: **no defaulted property was ever listed in a `required` array**. The invariant as originally worded ("no property in a requestBody's `required` may carry a `default`") passed pre-fix and would not have caught this bug — see the invariant note under Post-Implementation. The rest of the request surface (`UpdateDocRequest`, `MoveDocRequest`, `AppendTurnRequest`, `MultipartAppendTurnRequest`, `MarkSeenRequest`, `CaptureRequest`, `AcquireLockRequest`, `FailEventRequest`, `AppendLogRequest`) was already clean. Query/header parameters (`limit`, `offset`, `sort`, `timeout`, `recent`, `cursor`, `x-corpus-author`) carry defaults but are unaffected — `openapi-typescript` excludes parameters from the promotion and emits them optional.

**2. Pre-fix generated client type** (`src/client/schema.generated.ts`), showing the promotion to required despite `required: ["type","title"]` in the document:

```ts
CreateDocRequest: {
    type: string;
    title: string;
    body?: string;
    folder?: string;
    /** @default [] */
    tags: string[];              // ← required
    status: "open" | "resolved" | "archived";   // ← required
    due: string | null;          // ← required
    evergreen: boolean;          // ← required
};
```

**3. Pre-fix `tsc` probe** — `packages/contract/src/client/request-defaults.test.ts` added first, then `npx tsc --noEmit` in `packages/contract`:

```
src/client/request-defaults.test.ts(25,7): error TS2739: Type '{ type: string; title: string; }' is missing the
  following properties from type '{ type: string; title: string; body?: string; folder?: string; tags: string[];
  status: "open" | "resolved" | "archived"; due: string | null; evergreen: boolean; }': tags, status, due, evergreen
src/client/request-defaults.test.ts(40,7): error TS2739: Type '{ body: string; }' is missing the following
  properties from type '{ parent: string | null; selector: {...} | null; title?: string; body: string;
  requestsAgent?: boolean; }': parent, selector
src/client/request-defaults.test.ts(45,3): error TS2739: Type '{ exact: string; }' is missing the following
  properties from type '{ exact: string; prefix: string; suffix: string; }': prefix, suffix
EXIT=2
```

The third error is the widest consequence: a caller anchoring a comment had to invent `prefix` and `suffix` around its quote.

### Post-Implementation Verification

**Schemas changed** (all in `packages/contract/src/schemas/`):

| Schema | Change |
| --- | --- |
| `CreateDocRequestSchema` (`doc.ts`) | `tags`/`status`/`due`/`evergreen`: `.default(x)` → `.optional().describe("Defaults to …")` |
| `CreateThreadRequestSchema` (`thread.ts`) | `parent`/`selector`: `.nullable().default(null)` → `.nullable().optional()`, descriptions now say "Omitted or null …" |
| `TextQuoteSelectorRequestSchema` (`anchor.ts`, **new**) | Wire twin of `TextQuoteSelectorSchema` with `prefix`/`suffix` `.optional()`. Deliberately unregistered as an OpenAPI component, so it inlines exactly where the nullable selector already inlined — the published component list is unchanged (55 components before and after) |
| `TextQuoteSelectorSchema` (`anchor.ts`) | **Unchanged semantics** — keeps `.default("")` on `prefix`/`suffix`. It is the parse-side schema (frontmatter reads, `ResolvedAnchor`, `Doc`), which is exactly the defaulted-out half of the convention |
| `AttachmentFilesSchema` (`attachment.ts`) | No behavioural change; comment added explaining why its `.default([])` is not a violation (the hand-pinned `.openapi()` shape replaces the derived schema, so no `default` reaches the document and `files` stays `files?: string[]`) |

Convention pinned as the module doc comment on `packages/contract/src/schemas/index.ts`, naming the mechanical reason (`openapi-typescript` promotes defaulted properties to required members, ignoring `required`) and the split-rather-than-compromise rule.

**Post-fix generated client type:**

```ts
CreateDocRequest: {
    type: string;  title: string;  body?: string;  folder?: string;
    /** @description Defaults to no tags. */                tags?: string[];
    /** @description Defaults to `open`. */                 status?: "open" | "resolved" | "archived";
    /** @description Optional deadline. Defaults to `null` — no deadline. */   due?: string | null;
    /** @description True opts the document out of staleness entirely. Defaults to `false`. */  evergreen?: boolean;
};
CreateThreadRequest: {
    parent?: string | null;
    selector?: { exact: string; prefix?: string; suffix?: string } | null;
    title?: string;
    body: string;
    requestsAgent?: boolean;      // ← tri-state, untouched: still optional, still no default
};
```

`TextQuoteSelector` (the response component) is byte-identical to before: `exact`/`prefix`/`suffix` all required, both defaults intact.

**Post-fix `tsc` probe:** `npx tsc --noEmit` in `packages/contract` → `EXIT=0`. The four probe bodies that failed to compile pre-fix — minimal create-doc, full create-doc, standalone create-thread, and a selector carrying only `exact` — now compile and are also exercised at runtime through the real `@hono/zod-openapi` route definitions mounted on an `OpenAPIHono` app, so the types and the validator agree.

**The invariant test** (`packages/contract/src/openapi.test.ts`, 2 cases):

- `declares no server-applied default anywhere in a request body` — walks every operation's `requestBody`, dereferencing components with a cycle guard and descending through `properties`/`items`/`allOf`/`anyOf`/`oneOf`, and asserts no reachable property carries a `default` (using `Object.hasOwn`, since `default: null` is a default).
- `lists no defaulted property in a request body's `required` array` — the literal wording from the acceptance criteria, kept as a second, cheaper guard.

The first is the one that catches the class. **Falsification check:** temporarily reintroducing the bug on a schema this issue never touched — `AcquireLockRequestSchema.ttl`, `.optional()` → `.default(DEFAULT_LOCK_TTL_SECONDS)` — made it fail with the exact location, while the `required`-array test still passed:

```
FAIL packages/contract/src/openapi.test.ts > generated OpenAPI document
     > declares no server-applied default anywhere in a request body
AssertionError: expected [ Array(1) ] to deeply equal []
+ [ "POST /api/locks/{docId} [application/json] → AcquireLockRequest.ttl" ]
```

`lock.ts` reverted afterwards (`git diff -- packages/contract/src/schemas/lock.ts` → empty).

**Artifacts and determinism:** `npm run generate -w packages/contract` run twice; both artifacts byte-identical across runs:

```
27570fb526a53732c01c752e95477ea7da25a1995ed23c045c507bf69085d274  packages/contract/openapi.json
3d089665b56c33b791eaa50d18b6a2fc56d097ef5e5f480f7174eb7d5a6c4db8  packages/contract/src/client/schema.generated.ts
```

`node --import tsx scripts/check-generated-artifacts.ts`: the **content-hash guard passed** — regeneration changed nothing, which is the authoritative check in an uncommitted tree. The script then reports stale on its second guard, `diffAgainstHead`, because the regenerated artifacts differ from `HEAD` — which is the intended change, not drift, and clears when the orchestrator commits. (The diff summary is only printed from the `diffAgainstHead` branch; the hash branch exits before it.) The artifact diff is confined to this issue: `openapi.json` +12/−22 lines and `schema.generated.ts` +13/−29 lines, all of them `default` removals and description rewrites on the two request schemas. No endpoint, component name, or response shape moved. `CLI reference is up to date (docs/cli.md)`.

**Gate, run in the worktree after `npm install` + `npm run build`:**

| Check | Result |
| --- | --- |
| `npm run build` | pass (contract → kit → cli → server/ui) |
| `npm run lint` | pass, 0 errors, 0 warnings |
| `npm run format:check` | pass (`openapi.test.ts` reformatted with `prettier --write`, then clean) |
| `npm run typecheck` | pass in all 5 workspaces: `@corpus/cli`, `@corpus/server`, `@corpus/ui`, `@corpus/contract`, `@corpus/kit` |
| `npm run test:coverage` | 86 test files, **1726 tests passed**, 0 failed. Coverage 99.56% lines / 96.27% branches / 100% functions — above the 90% gate. `packages/contract/src/schemas` at 100% on all four metrics |

**Consumer typecheck: no breakage.** The repo-wide `npm run typecheck` passes against the regenerated client. `apps/server` consumes `TextQuoteSelector` (the parse-side schema, unchanged) in `core/frontmatter.ts`, `anchors/reconcile.ts`, `anchors/types.ts` and `core/check.ts`; none of them touch the request-side schemas, which have no server handler yet. `apps/cli` and `apps/ui` reference neither `CreateDocRequest` nor `CreateThreadRequest` yet.

**Handoff to SERVER-005+** (no server code changed here). The server now owns these defaults, since the wire no longer carries them. On `POST /api/docs`: `tags ?? []`, `status ?? "open"`, `due ?? null`, `evergreen ?? false`, `folder ?? "inbox"` (the folder default was already server-side). On `POST /api/threads`: `parent ?? null`, `selector ?? null`, and within a supplied selector `prefix ?? ""` / `suffix ?? ""` before writing the anchor entry — `TextQuoteSelectorSchema.parse(request.selector)` does exactly that and is the intended path, keeping the frontmatter shape three-field as `apps/server/src/anchors` already expects. `requestsAgent` stays tri-state: `undefined`, `true` and `false` remain three distinct instructions and must not be collapsed with `??`.

**Not changed, deliberately.** Query and header parameters keep their `.default()` (`limit`, `offset`, `sort`, `timeout`, `recent`, `cursor`, `x-corpus-author`): `openapi-typescript` does not promote parameter defaults, they already emit optional, and the published `default` is what documents the server's behaviour to a client reading the OpenAPI document.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CONTRACT-003]` prefix
