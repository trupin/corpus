# [SERVER-136] Folder acts: rename moves every document, archive flips every status, delete removes them

## Domain
server

## Status
done

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
- [x] `rename`: every document under `from` (recursively) moves to the same relative place under `to`; ids never change; threads under a moved parent move with it; the projection reflects the new paths before the response returns; one commit.
- [x] `archive`/`unarchive`: every document under the path changes status via the same code path `POST /api/docs/{id}/archive` uses, so skills and threads get the same treatment they get one at a time; one commit; result lists each id with its new status.
- [x] `delete`: every file under the path is removed, the folder is removed when empty, anchors and threads that hung off deleted documents go with them, orphaned links become broken refs as §5 says; one commit.
- [x] `404` for a folder that does not exist; `409` for rename onto an existing folder; `400` for a path outside `data/docs/` or containing `..`; `400` when `to` is inside `from`.
- [x] Every result carries `warnings` for effects beyond the folder named (a thread moved because its parent moved is *inside* the act and is listed as a document, not a warning).
- [x] A folder act appears in SSE as the per-document events it produced, so open readers update.

### Where the criteria and CONTRACT-075 disagreed, and which won

Three of the sentences above were written before the contract landed, and the
contract says something else. The contract won each time, because it is the
signed shape CLI-060 and UI-150 read. Recorded here so nobody has to rediscover
which text the code follows.

1. **An already-archived document is listed.** Criterion: "list only documents
   whose status changed; the already-archived one is absent from the result."
   `POST /api/folders/archive`'s contract: "A document already archived is left
   as it is and is still listed, because the act applied to it", and
   `FolderStatusChange.status` is "the document's status **after** the act". The
   result therefore names every document under the folder with the status it now
   has, and only the documents that actually changed are in the commit.
2. **A deleted document's threads survive.** Criterion: "threads that hung off
   deleted documents go with them." SPEC §9.2 and the contract both say the
   opposite — `DELETE /api/docs/{id}`'s threads "become orphaned records that
   still name it as `parent`", and the folder delete is that act over a set
   rather than a second rule. Deleting the conversations would be something no
   single-document delete does. `DeleteFolderResult` has no field to name them,
   so they are logged.
3. **A refused document is absent, not warned about.** Criterion: "a refused
   write is a warning, not a failure of the whole act." `WARNING_CODES` is a
   closed enum with no code for it, and adding one is a contract change. The act
   still applies to what it can (§10) — the document is simply absent from
   `documents`, which is the honest answer to "what did this act change", and the
   reason is logged. If a per-document refusal should reach the caller, that is a
   CONTRACT issue.

## Technical Design

### Files to Create/Modify
- `apps/server/src/folders/routes.ts` — the four handlers
- `apps/server/src/folders/acts.ts` — `renameFolder`, `archiveFolder`, `unarchiveFolder`, `deleteFolder`, each over the existing single-document primitives (`moveDocument`, `setArchived`, `deleteDocument`) inside one commit window
- `apps/server/src/folders/*.test.ts`

### Key Implementation Details
- Enumerate from the projection (`documents.path LIKE 'path/%'`), then act file by file through the primitives; do not `fs.rename` the directory, because the primitives keep anchors, threads and the projection consistent and a directory move would skip all of it.
- Wrap the loop in the same "one act, one commit" window the bulk-mode save uses (§10's staged bulk change is the precedent).
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

server-dev, 2026-08-22, on **opus**.

Real workspaces created with `corpus init`, real server started with
`corpus server start` (port 8766, watcher running), every act driven with `curl`
against the running process. Three workspaces were used: the first found two
defects, the second confirmed the fixes, the third is the clean end-to-end pass
recorded below.

### The clean pass (workspace 3)

Seed: `POST /api/docs` × 2 into `a/b` and `a/b/deep`, `POST /api/threads` on the
first. Then, waiting past the commit window before each act:

1. **`POST /api/folders/rename {from:"a/b", to:"c"}` → `200`.** The result lists
   three ids — both documents at their new paths and the thread at
   `data/threads/th_25awbeg7.md`, which is where a thread's file always is (§4)
   while its folder is its parent's (§6). On disk: `data/docs/c/mortgage.md`,
   `data/docs/c/deep/rates.md`. `git show --name-status HEAD` reads
   `R100 data/docs/a/b/deep/rates.md → data/docs/c/deep/rates.md` and
   `R100 data/docs/a/b/mortgage.md → data/docs/c/mortgage.md`, in **one** commit
   subject `folder rename: data/docs/a/b → data/docs/c (2 documents) by user`.
   `corpus db doctor`: clean, 12 documents from 12 files.
2. **`POST /api/folders/archive {path:"c"}` → `200`**, three rows all
   `archived`. `GET /api/docs?folder=c` → `[]`; `?includeArchived=true` lists all
   three. Files unmoved. One commit. `db doctor` clean.
3. **`POST /api/folders/unarchive {path:"c"}` → `200`**, three rows all
   `resolved` — §5's ladder, since archiving already implied resolved. One
   commit. `db doctor` clean.
4. **`POST /api/folders/delete {path:"c"}` → `200`**, two ids. `data/docs/c` is
   gone; `data/threads/th_25awbeg7.md` survives as the orphaned record §9.2
   requires; `git show HEAD~1:data/docs/c/mortgage.md` still reads the file. One
   commit. `db doctor` clean, 10 documents from 10 files.

`git log --format=%s` after the four acts, newest first:

```
folder delete: data/docs/c (2 documents) by user
folder unarchive: data/docs/c (3 documents) by user
folder archive: data/docs/c (3 documents) by user
folder rename: data/docs/a/b → data/docs/c (2 documents) by user
editing session: 3 documents by user
workspace: initialize corpus workspace by user
```

### Refusals, against the running server

`403` for `x-corpus-author: agent` on delete (message
`deletion is user-only; the agent archives, never deletes`), for an existing
folder and for one that does not exist alike · `404` for an unknown folder, and
for `FINANCE` when the workspace holds `finance` · `409` for a rename onto an
existing folder · `400` for `../etc`, for `data/docs/a`, for a trailing slash,
for `.claude/skills` and for `to` inside `from`. No commit was made by any of
them.

### SSE

One frame for the archive, read off a live `GET /events`:

```
event: invalidate
data: {"keys":[["docs"],["docs","doc_w2ik5rqf"],["docs","doc_bqa4lh4q"],["docs","th_zuwnqn3m"],["threads","th_zuwnqn3m"],["tree"]]}
```

### Two defects the first workspace found, both fixed

**1. `git commit --only` cannot record a case-only rename.** After
`{from:"Finance", to:"finance"}` the files were recased on disk and the
projection was right, but `git status` was empty and `git ls-files` still said
`data/docs/Finance/deed.md`: the commit recorded nothing. The cause is not
staging — measured on git 2.x/macOS APFS, no combination of `git add -A`,
`core.ignorecase` or pathspec makes it work, because `--only` builds its tree
from `HEAD` plus the **working tree**, and the kernel answers "present,
unchanged" for every path under the old spelling. `git rm --cached` + an
index-based commit is the only thing that records it, which is also git's own
answer (`git mv`). Fixed with `CommitRequest.forget`: the commit is made from a
**scratch index** built as `HEAD` minus the forgotten paths plus the working tree
of the staged ones, which reaches the tree `--only` would have reached and keeps
`--only`'s promise. Verified on the running server: one commit,
`R100 data/docs/Finance/deed.md → data/docs/finance/deed.md`, `git status`
clean, no scratch index left in `.git`, and an operator's unrelated `git add`ed
file untouched.

**2. chokidar keeps watching the old spelling, for the life of the process.**
After the case-only rename `db doctor` reported `orphan_row` for the old path and
`duplicate_id` for the new one, and it came back on **every later write** to
those files. Probed directly: a case-only directory rename makes chokidar 4 on
macOS emit `change <old>/deed.md` **and** `add <new>/deed.md`, and every
subsequent write to the file then arrives twice, once under each spelling. Fixed
in `watcher.ts` with `caseCanonicalPath`, which resolves an event's path with
`realpathSync.native` and takes the answer only when the two workspace-relative
paths are the same path modulo case. It is reachable with no Corpus verb at all
— `mv Finance finance` in a shell does it — so the fix belongs to the watcher
rather than to the rename. Re-verified end to end: rows carry the new spelling,
`db doctor` clean, one invalidation frame.

### Known and deliberate

- A rename leaves the **emptied source parent** behind (`data/docs/a` after
  `a/b → c`). It holds no document, so it appears in no tree and no query; the
  issue asks the delete to prune, not the rename.
- A folder **delete leaves orphaned threads**, per §9.2, and
  `DeleteFolderResult` has no field to name them, so they are logged rather than
  reported.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] `/audit` run (destructive path)
- [ ] Committed with `[SERVER-136]` prefix
