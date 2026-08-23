# [CONTRACT-075] Folder routes: rename, archive, unarchive, delete

## Domain
contract

## Status
done

## Priority
P1

## Model
opus

## Dependencies
- Depends on: SHARED-064 (rider 7 signed)
- Blocks: SERVER-136, CLI-060, UI-150

## Spec References
- SPEC.md §9.2 — "HTTP API" (folder acts; "a response's warnings also carry effects on documents the request never named")
- SPEC.md §10 — "UI — the board" (the explorer's folder menu)

## Summary
The explorer offers standard actions on directories, and the server has none: every write path today takes one document id. This issue defines four folder routes. Each takes a folder path in a JSON body (paths carry slashes, so they do not go in the URL), and each returns the documents it changed, because a folder act is a bulk act and §9.2 says an act names what it touched.

## Acceptance Criteria
- [x] `POST /api/folders/rename` `{ from: string, to: string }` → `{ documents: [{ id, path }], warnings }`.
- [x] `POST /api/folders/archive` `{ path }` and `POST /api/folders/unarchive` `{ path }` → `{ documents: [{ id, status }], warnings }`.
- [x] `POST /api/folders/delete` `{ path }` → `{ documents: [{ id }], warnings }`.
- [x] Paths are relative to `data/docs/`, no leading or trailing slash, no `..`; a malformed path is `400` with the reason; an unknown folder is `404`.
- [x] `rename` refuses `409` when `to` exists, and `400` when `to` is inside `from`.
- [x] Every route carries the `acting party` header semantics the document routes carry (§4 attribution), documented the same way.
- [x] `openapi.json` regenerated, drift check green, typed client exposes the four calls.

## Technical Design

### Files to Create/Modify
- `packages/contract/src/schemas/folders.ts` — `FolderPathSchema`, request and result schemas
- `packages/contract/src/routes/folders.ts` — the four route definitions
- `packages/contract/src/index.ts` — export
- `packages/contract/openapi.json` — regenerated

### Key Implementation Details
- `FolderPathSchema = z.string().min(1).regex(/^(?!\.\.)(?!.*\/\.\.)[^/].*[^/]$|^[^/]$/)` — or an explicit refine that splits on `/` and rejects `..`, empty and dot segments; write the refine, it reads better than the regex.
- Result rows are the minimum that lets a client update itself without a refetch: id plus the field that changed. A thread's `path` follows its parent (§6: threads inherit the parent's folder), so a rename lists threads too.
- Delete returns ids only; the client drops them.

### Decisions taken here (2026-08-22)

- **`FolderPathSchema` is a refinement, not a regex** — the issue's own
  preference, and it is what lets each refusal say what to fix rather than
  showing a pattern. The rules: non-empty, no leading or trailing slash, no
  empty segment, no backslash, no control character, and **no segment beginning
  with a dot**, which rules out `.` and `..` together with every root outside
  `data/docs/`.
- **The `data/docs/` prefix is refused rather than accepted**, unlike
  `POST /api/docs`'s `folder`. That field files a document *into* a root the
  server resolves; this one names a directory to act on, and the filter it
  matches (`GET /api/docs?folder=`) has always been relative. Accepting both
  would leave `data/docs/finance` ambiguous between the finance folder and a
  literal one nested under the root, and a rename that resolved that guess
  wrongly moves files. The refusal says to drop the prefix.
- **No `job` field, deliberately.** §9.2 lets any write name the job it serves,
  but the AC names exactly what each body carries (`{from,to}` / `{path}`), and
  declaring a `422 unknown_job` that SERVER-136 will not emit publishes a refusal
  the route cannot produce (CONTRACT-058's lesson). Adding it later is one
  additive field. **Flagged to the orchestrator** rather than decided silently.
- **`POST /api/folders/delete`, not `DELETE`** — the folder is named in the body
  because a folder path carries slashes, and a `DELETE` with a body is a request
  intermediaries are entitled to strip.
- **Archive and unarchive share one result component** (`FolderStatusResult`),
  because they are one shape mirrored. Rename and delete get their own, because a
  row carries the id plus the field that changed and nothing else.
- **`to` inside `from` is refused in the schema**, not in the server: it needs no
  state, and the two paths in front of the validator are the whole question. A
  sibling merely sharing a prefix (`fin` → `finance`) is not a descendant and
  passes.

### Edge Cases
- A folder that holds a skill (`.claude/skills/...`) is outside `data/docs/` and outside these routes: `400`, "skills are archived by document".
- Renaming to a different case on a case-insensitive filesystem is the server's problem (SERVER-136), but the contract documents that `to` is compared exactly.

## Testing Strategy
Schema tests for path validation; a route-definition test that mounts the four routes on a stub and round-trips one success and one refusal each.

## E2E Verification Plan
### Verification Steps
1. `npm run generate -w packages/contract` idempotent; typed client compiles against a stub server that returns the documented shapes.

## E2E Verification Log

**contract-dev, 2026-08-22, on opus** (model actually run: opus). Landed in one
pass with CONTRACT-074 and CONTRACT-076, since all three regenerate the same
`openapi.json` and the same client.

**1. Generation is idempotent and the drift check fires.** See CONTRACT-074's
log, item 1 and item 2 — one regeneration covers all three issues.

**2. The four routes are in the published document.**
`/api/folders/{rename,archive,unarchive,delete}`, each `POST`, each with
`requestBody.required: true` (an act on a folder has a subject, so no bare
`POST` shorthand), each declaring `200/400/401/404`. `409` on **rename alone**;
`403` on **delete alone**, whose description carries "the agent archives, never
deletes". New components: `RenameFolderRequest`, `FolderPathRequest`,
`MovedFolderDoc`, `RenameFolderResult`, `FolderStatusChange`,
`FolderStatusResult`, `DeletedFolderDoc`, `DeleteFolderResult`. Archive and
unarchive both `$ref` `FolderStatusResult`.

**3. The typed client reaches all four, against the real definitions.**
`client/index.test.ts` mounts `contractRoutes` on a Hono app and drives the
generated client: a rename reads back both moved documents **including the
thread** (`data/threads/th_x9y8.md`); archive and unarchive each report the
status after the act; a delete succeeds as `user` and is refused `403` as
`agent`, narrowed on `error.code === "forbidden"` so the compiler checks it.
A malformed path (`../etc`) and a rename into a descendant are each `400`
**before any handler runs** — the refusal is the contract's, not a server that
remembered to check.

**4. Schema tests.** `schemas/folders.test.ts`, 37 tests: 4 accepted spellings,
9 refused ones (empty, leading/trailing slash, empty segment, `.`, `..`,
mid-path and trailing traversal, backslash), the control-character case, the
`.claude/skills/...` case (whose message says "Skills are archived by document"),
both `data/docs/` prefix spellings, three rename-into-descendant cases plus the
shared-prefix sibling that must *not* be caught, strictness on both bodies, and
the three result shapes including an empty folder and a `commit_failed` warning.

**5. Checks.** eslint 0, prettier clean, `tsc --noEmit -p packages/contract` 0,
`vitest run packages/contract` **2827 passed / 67 files**, build 0.

**6. One openapi.test.ts sweep had to be narrowed, and was pinned instead of
weakened.** "keeps the acting party out of every request body" matches any body
property named `author`, `actor` or `from`. §9.2's own bullet names the rename's
fields (`{ from, to }`), and there `from` is a folder path paired with `to`. The
exemption is declared (`ACTOR_LOOKALIKES`) and a new test asserts the exempt
property is a plain string with no enum whose description names a folder — so
the exemption cannot become a place to park a field that really carries an
actor.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-075]` prefix
