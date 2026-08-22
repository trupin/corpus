# [SERVER-136] Folder acts: rename moves every document, archive flips every status, delete removes them

## Domain
server

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CONTRACT-075
- Blocks: CLI-060, UI-150

## Spec References
- SPEC.md §4 — "The workspace" (git auto-commit, attribution)
- SPEC.md §5 — status ladder (archived is resolved plus hidden)
- SPEC.md §6 — threads inherit the parent's folder
- SPEC.md §9.2 — folder routes (rider 7)

## Summary
Implements the four routes of CONTRACT-075 as bulk acts over `data/docs/<path>`: rename rewrites every document's path (threads follow their parents), archive and unarchive flip every document's status through the existing `setArchived`, delete removes every file. Each act is one commit attributed to the acting party, and each result names every document it changed.

## Acceptance Criteria
- [ ] `rename`: every document under `from` (recursively) moves to the same relative place under `to`; ids never change; threads under a moved parent move with it; the projection reflects the new paths before the response returns; one commit.
- [ ] `archive`/`unarchive`: every document under the path changes status via the same code path `POST /api/docs/{id}/archive` uses, so skills and threads get the same treatment they get one at a time; one commit; result lists each id with its new status.
- [ ] `delete`: every file under the path is removed, the folder is removed when empty, anchors and threads that hung off deleted documents go with them, orphaned links become broken refs as §5 says; one commit.
- [ ] `404` for a folder that does not exist; `409` for rename onto an existing folder; `400` for a path outside `data/docs/` or containing `..`; `400` when `to` is inside `from`.
- [ ] Every result carries `warnings` for effects beyond the folder named (a thread moved because its parent moved is *inside* the act and is listed as a document, not a warning).
- [ ] A folder act appears in SSE as the per-document events it produced, so open readers update.

## Technical Design

### Files to Create/Modify
- `apps/server/src/folders/routes.ts` — the four handlers
- `apps/server/src/folders/acts.ts` — `renameFolder`, `archiveFolder`, `unarchiveFolder`, `deleteFolder`, each over the existing single-document primitives (`moveDocument`, `setArchived`, `deleteDocument`) inside one commit window
- `apps/server/src/folders/*.test.ts`

### Key Implementation Details
- Enumerate from the projection (`documents.path LIKE 'path/%'`), then act file by file through the primitives; do not `fs.rename` the directory, because the primitives keep anchors, threads and the projection consistent and a directory move would skip all of it.
- Wrap the loop in the same "one act, one commit" window the bulk-mode save uses (§11's staged bulk change is the precedent).
- Case-only renames on a case-insensitive filesystem: rename through a temporary name.

### Edge Cases
- An empty folder (exists on disk, no documents): rename and delete still act on the directory; archive is a no-op with an empty result.
- A folder containing an archived document: rename moves it too; archive lists it unchanged? No — list only documents whose status changed; the already-archived one is absent from the result.
- A document locked by an agent edit window (§7): the act proceeds and the key rule applies per document; a refused write is a warning, not a failure of the whole act.

## Testing Strategy
Vitest over a real temp workspace: nested folders, a parent with threads, a skill folder refusal, each error code, commit count equals one per act.

## E2E Verification Plan
### Verification Steps
1. Real server; `corpus doc create --folder a/b` twice, comment on one to make a thread.
2. `POST /api/folders/rename {from:"a/b", to:"c"}` → files under `data/docs/c/`, thread moved, `git log -1` one commit, result lists three ids.
3. `POST /api/folders/archive {path:"c"}` → `GET /api/docs?folder=c` empty, `?includeArchived=true` lists them.
4. `POST /api/folders/delete {path:"c"}` → directory gone, one commit.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/audit` run (destructive path)
- [ ] Committed with `[SERVER-136]` prefix
