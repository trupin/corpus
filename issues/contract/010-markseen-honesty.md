# [CONTRACT-010] `MarkSeenResult.unread` honesty + client attachment-path exclusion

## Domain

contract

## Status

done

## Priority

P1

## Model

opus — same honesty class as CONTRACT-006's `appended` fix; the pattern is established.

## Dependencies

- Depends on: CONTRACT-006
- Blocks: — (PR #9 merge blocker: pr-reviewer MAJOR finding 5; MINOR finding 20 rides along)

## Spec References

- SPEC.md §5 — read state
- PR #9 review, findings 5 and 20

## Summary

`MarkSeenResult.unread` is `z.literal(false)` ("Always false") while `MarkSeenRequestSchema` supports partial marks (`lastSeenTs` before the last turn) — after which the thread is by the contract's own definition still unread. A client trusting the mutation response clears the badge that the next `GET /api/docs` re-raises. Same defect class as the `appended: true as const` literal CONTRACT-006 fixed. The CONTRACT-002 AC pinned this shape; that pin is adjudicated defective (orchestrator, 2026-07-27).

Rider (finding 20): `FetchPaths` excludes `/events` but keeps `GET /attachments/{path}`, whose `application/octet-stream` response `openapi-fetch` JSON-parses by default — exclude it with the same don't-call-this-that-way rationale.

## Acceptance Criteria

- [x] `MarkSeenResult.unread` becomes a plain boolean whose description states the partial-mark semantics; ~~server handler updated to compute it~~ **deferred to SERVER-021 by orchestrator instruction** — this session touches `packages/contract` only. `apps/server/src/threads/seen.ts` returns `unread: false` at both return sites, which stays assignable to `boolean`, so nothing breaks in the interim; SERVER-021 makes it honest.
- [x] `GET /attachments/{path}` excluded from `FetchPaths` alongside `/events`.
- [x] All standing invariants; artifacts regenerated; round-trips; the CONTRACT-002 AC pin is annotated as superseded in that issue file.

## Technical Design

Mirror the CONTRACT-006 `appended` change mechanically.

## E2E Verification Log

implemented on: opus

Not a bug against running behaviour but a contract-honesty defect, so there is no pre-fix runtime reproduction; the reproduction is type-level and is recorded below as the "before" state.

### Pre-Implementation State

- `packages/contract/src/schemas/thread.ts` declared `unread: z.literal(false)` with the description "Always false: the mark is at or beyond the last turn the caller has seen." — directly contradicted by `MarkSeenRequestSchema.lastSeenTs`, whose own description says it exists "to record a partial read".
- The generated artifacts carried the lie outward: `openapi.json` emitted `"enum": [false]` and `schema.generated.ts` emitted `unread: false`, so no consumer could even express a still-unread thread.
- `FetchPaths` was `Omit<paths, "/events">`, leaving `GET /attachments/{path}` — declared `application/octet-stream` — on the fetch surface, where `openapi-fetch` JSON-parses response bodies by default.

### Post-Implementation Verification

**1. Generation idempotence** — `npm run generate -w packages/contract` twice; artifacts byte-identical (sha256 compared across runs):

```
2604a85389b6438151499180b4530c1155ebf58457ffa37817ee1838f6aade62  packages/contract/openapi.json
d5bf058997a15b7040737415465eb718d1a7b00e7a2a62d0cad3cbaf3dd3796a  packages/contract/src/client/schema.generated.ts
[ok] Files are identical
```

**2. The artifacts actually changed** — `openapi.json` `components.schemas.MarkSeenResult.unread` lost its `"enum": [false]` and is now `"type": "boolean"` with the partial-mark description; `schema.generated.ts` went `unread: false` → `unread: boolean`:

```
-             * @enum {boolean}
-            unread: false;
+            unread: boolean;
```

**3. Drift check fires** — `node --import tsx scripts/check-generated-artifacts.ts` (the same script `.githooks/pre-push` and CI's `generated artifacts drift` step run) exits 1 while the regenerated artifacts are uncommitted, naming exactly the two files:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add ...
```

It compares a fresh generation against `HEAD`, so this is the expected pre-commit state and proves the guard is live; it goes green once the orchestrator commits the artifacts. (The same run also reports `docs/cli.md` stale — that is the concurrent `apps/cli` session's artifact, not this issue's.)

**4. Typed client against a mounted app** — real `createCorpusClient` over a real `OpenAPIHono` app mounting `contractRoutes.markThreadSeen` with an honest handler (no mocked client), driven through `POST /api/threads/{id}/seen`:

```
partial mark  -> {"threadId":"th_x9y8","lastSeenTs":"2026-07-19T10:05:00Z","unread":true} status 200
full mark     -> {"threadId":"th_x9y8","lastSeenTs":"2026-07-19T10:07:12Z","unread":false} status 200
typed as boolean, value = true
OK: typed client round-trips both marks
```

`unread: true` now survives request validation, the response validator, and the generated types end to end — under the old `literal(false)` the partial-mark response was unrepresentable.

**5. Attachment exclusion enforced by the compiler** — `tsc --noEmit` on a probe calling the excluded path:

```
.scratch-attach-probe.ts(4,17): error TS2345: Argument of type '"/attachments/{path}"'
  is not assignable to parameter of type 'PathsWithMethod<FetchPaths, "get">'.
```

Control, same compiler invocation, a path that is still on the fetch surface — `c.api.GET("/api/docs", { params: { query: {} } })` — exits 0, so the rejection is specific to the excluded path and not a broken probe. Both scratch files were deleted afterwards; `git status --porcelain` shows no stray files.

**6. Full gate** — `./node_modules/.bin/vitest run packages/contract`: **763 passed / 31 files**, including `generation/artifacts.test.ts` (the committed-artifact invariants) and `openapi.test.ts` (102 document invariants). `npm run build`, `npm run lint`, `npm run typecheck`, `npm run format:check` all clean across every workspace.

### Tests added

- `schemas/thread.test.ts` — replaced the now-wrong "cannot report the thread as still unread" assertion with a partial-mark round-trip, a type-level probe (`const partial: MarkSeenResult = { …, unread: true }`, which fails to compile if `unread` narrows back to `false`), and a non-boolean rejection. Mirrors `job.test.ts`'s `appended` trio.
- `routes/index.test.ts` — the stub `markThreadSeen` handler now computes `unread` from the mark instead of hardcoding `false as const`, plus a route-level test asserting a partial mark answers `200 unread: true` and a bare `POST` answers `unread: false`.
- `client/index.test.ts` — a compile-time pair mirroring the `/events` block: `/attachments/{path}` stays in `paths` but is absent from `FetchPaths`.

### Notes for downstream

- **SERVER-021** owns making the handler honest: `apps/server/src/threads/seen.ts` has two `return` sites, both hardcoding `unread: false`. The interesting one is line ~112, where `requested` may sit before the thread's last turn; the early return at ~93 (a mark that does not move forward) also needs the real comparison.
- No consumer used the typed client for attachments (`grep` across `apps`, `packages`, `plugins`), so the `FetchPaths` narrowing breaks nothing — the server serves the route, and the UI uses the URL directly in `<img src>` per the route's own note.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified (server half explicitly deferred to SERVER-021, see above)

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
