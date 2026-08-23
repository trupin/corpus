# [CONTRACT-075] Folder routes: rename, archive, unarchive, delete

## Domain
contract

## Status
todo

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
- [ ] `POST /api/folders/rename` `{ from: string, to: string }` → `{ documents: [{ id, path }], warnings }`.
- [ ] `POST /api/folders/archive` `{ path }` and `POST /api/folders/unarchive` `{ path }` → `{ documents: [{ id, status }], warnings }`.
- [ ] `POST /api/folders/delete` `{ path }` → `{ documents: [{ id }], warnings }`.
- [ ] Paths are relative to `data/docs/`, no leading or trailing slash, no `..`; a malformed path is `400` with the reason; an unknown folder is `404`.
- [ ] `rename` refuses `409` when `to` exists, and `400` when `to` is inside `from`.
- [ ] Every route carries the `acting party` header semantics the document routes carry (§4 attribution), documented the same way.
- [ ] `openapi.json` regenerated, drift check green, typed client exposes the four calls.

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

### Edge Cases
- A folder that holds a skill (`.claude/skills/...`) is outside `data/docs/` and outside these routes: `400`, "skills are archived by document".
- Renaming to a different case on a case-insensitive filesystem is the server's problem (SERVER-136), but the contract documents that `to` is compared exactly.

## Testing Strategy
Schema tests for path validation; a route-definition test that mounts the four routes on a stub and round-trips one success and one refusal each.

## E2E Verification Plan
### Verification Steps
1. `npm run generate -w packages/contract` idempotent; typed client compiles against a stub server that returns the documented shapes.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[CONTRACT-075]` prefix
