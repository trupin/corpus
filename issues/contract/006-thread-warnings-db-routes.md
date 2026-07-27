# [CONTRACT-006] Thread-response warnings, appended honesty, db routes

## Domain

contract

## Status

done

## Priority

P0

## Model

opus — a ~5-line rider plus two small routes; every shape is pinned by shipped precedent.

## Dependencies

- Depends on: CONTRACT-005
- Blocks: SERVER-006 (warning serialization), SERVER-017/CLI-003 (db routes)

## Spec References

- SPEC.md §14 — warnings on API responses; §2.2 — `corpus db rebuild` / `db doctor`
- `issues/sprints/sprint-006.md` — Open Conflict 2 (rationale; the anchored-creation hook-rejection case)

## Summary

Sprint-006 rider, run first: (1) spread the shipped `warningsField` into `CreateThreadResponse`, `AppendTurnResponse`, `CaptureResult`, `DeleteTurnResult` — anchored thread creation writes the parent document's frontmatter, so a hook rejection currently leaves the commenter told nothing; (2) `JobLogAppendResponse.appended` becomes `boolean` (SERVER-009's 4 MiB cap refuses the line but must answer honestly — `appended: false`); (3) declare `POST /api/db/rebuild` and `GET /api/db/doctor` (shapes from SERVER-004's shipped `rebuild()`/`doctor()` returns), user-reachable, mounted by SERVER-017.

## Acceptance Criteria

- [x] The four thread/capture shapes carry the always-present `warnings` array (same `warningsField`, one definition).
- [x] `appended: boolean` with the cap-refusal semantics in the description; round-trip + a type-level probe that `false` is representable.
- [x] `POST /api/db/rebuild` (bodiless, required per the CONTRACT-004 rule = no body at all) and `GET /api/db/doctor` declared with response schemas matching SERVER-004's shipped return shapes; added to the pinned inventory; auth required.
- [x] All standing invariants hold; artifacts byte-deterministic; drift green; consumer typecheck clean (SERVER-009's `appended: true` literal is the one expected server-side adjustment — report it, one line).

## Technical Design

### Files to Create/Modify

- `packages/contract/src/schemas/{thread,capture,job}.ts`, `routes/{jobs,db}.ts` (new db file), inventory, tests, regenerated artifacts.

**Naming correction (as built):** the summary's `JobLogAppendResponse` is
`AppendLogResultSchema` in `schemas/job.ts` — the shape this issue widens. The new db
components are `RebuildResult`, `DoctorReport`, `DoctorStats`, `ProjectionDrift` and
`SkippedFile`, in a new `schemas/db.ts`; `openapi.ts` gains a `db` tag.

## E2E Verification Log

**implemented on: opus** (main tree, branch `phase-2-server-cli`, no worktree).

### Reproduction (bugs only)

_N/A — additive contract change, not a defect fix._

### Post-Implementation Verification

#### 1. Generation idempotence + byte determinism

`npm run generate -w packages/contract` run three times from the finished tree; both
artifacts are byte-identical every run:

```
8a0b491193c2fe16b458e3abdd2d48a863c90026373eaf19d667cfa63f0c8773  packages/contract/openapi.json
d7730aea63cba722cd676700ff809ef0f6eb93fcb12ebd492364b11dec7dab1c  packages/contract/src/client/schema.generated.ts
```

#### 2. Content-hash drift check

`node --import tsx scripts/check-generated-artifacts.ts` — the hash-across-regeneration
half is **green**: regeneration is a no-op, so the artifacts are current for the source.
Only the `diffAgainstHead` half reports stale, which is what an uncommitted change is
supposed to look like; the orchestrator's commit clears it.

Drift firing was proven positively — `openapi.json` was hand-edited
(`paths["/api/db/doctor"].get.summary = "HAND EDITED"`) and the check caught it:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add …
```

The check's own regeneration restored the file; `diff` against a pre-edit copy confirmed
`RESTORED-IDENTICAL` and the sha256 above is unchanged.

#### 3. Typed client against a mounted app, over a real socket

Throwaway `@hono/node-server` process on `127.0.0.1:8941` mounting the real
`contractRoutes` behind a bearer-token middleware, driven by `createCorpusClient` from the
**generated** client (script deleted after the run):

```
createThread warnings : [{"code":"commit_failed","detail":"pre-commit hook exited 1"}]
deleteTurn warnings   : [{"code":"commit_failed","detail":"pre-commit hook exited 1"}]
appendTurn warnings   : []
capture warnings      : [{"code":"commit_skipped","detail":"workspace is not a git repository"}]
job log normal        : 201 {"eventId":"evt_7c1d","appended":true}
job log at cap        : 201 {"eventId":"evt_full","appended":false}
db rebuild            : 200 {"path":"/w/.corpus/cache.db","documents":6,"threads":1,"turns":2,
                             "anchors":1,"links":0,"events":0,"jobs":0,"locks":0,"seen":1,
                             "durationMs":37,"skipped":[]}
db doctor             : 200 ok=false paths=["data/docs/gone.md",null]
db doctor, no token   : 401 {"code":"unauthorized","message":"no token"}
db rebuild, no token  : 401
db rebuild, bare POST : 200
```

`db rebuild, bare POST` is a `POST` with **no body and no content type** — the bodiless
call the CONTRACT-004 rule requires. `paths=[…,null]` is the `count_mismatch` drift, which
concerns no single file.

#### 4. Generated artifacts, inspected

- `AppendLogResult.appended` → `"type": "boolean"` in `openapi.json`; `appended: boolean`
  at `schema.generated.ts:3543`.
- `/api/db/rebuild` `post` → `requestBody?: never`, `header?.["x-corpus-author"]?`,
  responses `200 | 400 | 401`.
- `/api/db/doctor` `get` → `requestBody?: never`, no `parameters`, responses `200 | 401`.
- `ProjectionDrift.required` = `["kind","path","detail"]`; `RebuildResult.required` =
  `["path", …nine counts…, "durationMs", "skipped"]`.
- Tags: `… "jobs", "db", "events", "attachments"`.

#### 5. Gates

- `npx vitest run packages/contract` → **759 passed, 0 failed** (was 746 before).
- `npx vitest run` (whole repo) → **2803 passed / 682 suites, 0 failed**.
- `npm run typecheck` (all five workspaces, after `npm run build`) → **clean**, including
  `apps/server`. The `appended` widening is source-compatible: `true as const` is
  assignable to `boolean`, so `apps/server/src/jobs/routes.ts:46` still compiles.
- `npm run lint` → clean. `npm run format:check` → clean.

### Handoff notes for the consuming issues

- **SERVER-009 / SERVER-017 (one line, apps/server).** `apps/server/src/jobs/routes.ts:46`
  currently returns `{ eventId: id, appended: true as const }` while discarding
  `appendLine`'s `AppendOutcome`. It typechecks unchanged, but it now *lies* on the capped
  path. The honest form is:
  `const outcome = await jobs.appendLine(id, line, sourceOf(...)); return c.json({ eventId: id, appended: outcome.stored !== undefined }, 201);`
  — and the comment above it, plus `routes.test.ts:118`, want updating with it.
- **SERVER-017 (db routes).** `ProjectionDrift.path` is `nullable`, not `optional` — the
  contract's response-side convention (`schemas/query.ts`). The server's `Drift.path?:
  string` therefore needs `path: entry.path ?? null` when serializing. Everything else in
  `RebuildResult` / `DoctorReport` is a field-for-field mirror of `RebuildReport` /
  `DoctorReport`, so the handlers are `c.json(rebuild(config), 200)` modulo that map.
- **SERVER-006 (thread writes).** All four shapes now *require* `warnings`, so every
  thread handler must pass `runMutation`'s `MutationResult.warnings` through instead of
  discarding it. Nothing in `apps/server` mounts these routes yet, so there is no
  regression to fix — only the new requirement to satisfy.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with the issue-ID prefix
