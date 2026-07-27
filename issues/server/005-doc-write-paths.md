# [SERVER-005] Doc write paths + git auto-commit

## Domain

server

## Status

done

## Priority

P0

## Model

opus — mechanics are pinned by the spec; the one genuinely open question (squash semantics) is flagged for SHARED-001 rather than decided here.

## Dependencies

- Depends on: SERVER-002, SERVER-004
- Blocks: SERVER-006, CLI-003

## Spec References

- SPEC.md §4 — "Repository layout" (auto-commit with structured message and acting party as git author; git log is the audit trail)
- SPEC.md §5 — "The document model" (frontmatter, `reviewed`, staleness)
- SPEC.md §7 — "Agent stewardship" (archive-not-delete; archiving a skill moves it to `.claude/skills-archived/`)
- SPEC.md §9.2 — "HTTP API" (`POST /api/docs`, `PUT /api/docs/:id`, `DELETE /api/docs/:id`)
- SPEC.md §11 — "Templates are documents" (`type: template` with `for: <doc-type>`; quick-create lands in `data/docs/inbox/`)
- SPEC.md §14 — hook failure during auto-commit surfaces loudly; the mutation still stands
- CLAUDE.md — Architecture Decision 2 (the server is the sole writer; the CLI performs no file writes)

## Summary

Implement the document mutation surface: create, edit, move, archive, and delete, as handlers registered against `@corpus/contract`'s route definitions on SERVER-003's app. Every mutation follows one pipeline — serialize through SERVER-001's core library, write atomically to disk, git auto-commit with a structured message and the acting party (`user` or `agent`) as the git author, then re-project synchronously via SERVER-004 before responding. Editing runs SERVER-002's `reconcileAnchors` so threads stay attached through edits, and the response reports which anchors were remapped and which were orphaned. Autosave produces a lot of small writes, so repeated edits to the same document by the same author within an idle window amend the previous auto-commit instead of piling up noise. This is the issue that makes "files are the source of truth, and the server is the only thing that touches them" real.

## Acceptance Criteria

- [x] `POST /api/docs` creates a document: generated id, path from the requested folder (default `data/docs/inbox/`, §11), frontmatter stamped (`created`, `updated`, `status`, `anchors: {}`), and — when no body is supplied — body and starting frontmatter pre-filled from a `type: template` document whose `for:` matches the new document's type (§11).
- [x] `PUT /api/docs/:id` edits body and/or frontmatter, runs `reconcileAnchors(oldBody, newBody, anchors)` and persists the updated anchors map **in the same write and the same commit** as the body change (§6); the response reports `{ remapped: [], orphaned: [] }`.
- [x] Move changes a document's path while its `id` stays stable (path is presentation, §5); the commit records both paths.
- [x] Archive flips `status` to `archived` (and back), and archiving a `type: skill` document additionally moves its folder from `.claude/skills/<name>/` to `.claude/skills-archived/<name>/` (§7); unarchiving reverses it.
- [x] `DELETE /api/docs/:id` is **user-only**: an agent actor gets `403` (§7 — "the agent archives, never deletes"). Deleting a document leaves its threads in place as orphaned records; git retains the file's history.
- [x] Every mutation auto-commits with the acting party as git author (`user` or `agent`) and a structured message; `git log --format='%an %s'` is a readable audit trail (§4).
- [x] Repeated `PUT`s to the same document by the same actor within the idle window amend the previous auto-commit rather than creating a new one; the amend is refused whenever it would rewrite anything other than the immediately preceding, matching auto-commit.
- [x] A failing git hook during auto-commit does **not** roll back the file mutation; the response carries a loud warning and the failure is logged (§14).
- [x] Every mutation re-projects synchronously before responding (read-your-write, §9.1) — an immediately following `GET` reflects the change with no polling.
- [x] Unit + integration tests cover each verb, the anchor-reconciliation path, the squash window (inside and outside it), the actor gate on delete, and the hook-failure path.

## Sprint-005 Adjudications (binding, 2026-07-27)

Orchestrator decisions — implement exactly these; full reasoning in `issues/sprints/sprint-005.md`:

1. **Warnings field**: CONTRACT-005 adds the §14 response-side `warnings` carrier (rider) — CONTRACT-005 hard-blocks this issue's warning ACs; build against its shape (coordinate via the sprint contract, not by inventing).
2. **Squash residuals pinned**: idle window **30 s**; create→edit within the window **folds** (amend), per SPEC §4's amend-within-idle-window.
3. **Header is `x-corpus-author`** (shipped contract), never `X-Corpus-Actor`; **`baseHash` ACs are struck** (no such contract field — do not defer, delete); move/archive collisions are **400 with `issues`** (no 409 is declared on those routes).
4. **Git hygiene**: the server is now a git writer — duplicate `sanitizeGitEnv` (strip `GIT_*` by prefix, case-insensitive) as a server-local util with a cross-reference comment to apps/cli's, use it on EVERY git child spawn, retrofit the existing unsanitized `readHeadVersion` in the watcher's git-head.ts, and port the hostile-env regression test.
5. **Self-writes register** with the watcher's registry so no double-projection; mutation sequence per Domain Knowledge (validate → write atomically → reconcile → auto-commit → re-project synchronously → broadcast).

## Technical Design

### Files to Create/Modify

- `apps/server/src/docs/routes.ts` — handler registration against the contract's doc routes
- `apps/server/src/docs/create.ts` — id allocation, path selection, template pre-fill
- `apps/server/src/docs/update.ts` — frontmatter/body patch + anchor reconciliation
- `apps/server/src/docs/move.ts` — path change, id-stable
- `apps/server/src/docs/archive.ts` — status flip + skill folder relocation (§7)
- `apps/server/src/docs/delete.ts` — user-only deletion
- `apps/server/src/docs/templates.ts` — template lookup by `for: <type>`
- `apps/server/src/docs/write.ts` — the shared mutation pipeline (`mutateDocument`), atomic file write, per-document mutex
- `apps/server/src/docs/actor.ts` — request → `Actor` (`user` | `agent`) and git identity mapping
- `apps/server/src/git/commit.ts` — `autoCommit`, message construction, amend/squash policy, hook-failure handling
- `apps/server/src/git/git.ts` — thin `execFile`-based git wrapper (no shell)
- `apps/server/src/docs/*.test.ts`, `apps/server/src/git/*.test.ts` — colocated Vitest suites
- `apps/server/src/app.ts` — register the doc routes (touch only)

### Key Implementation Details

- **ValidationError requires `issues`** _(evaluator, sprint-002, 2026-07-26)_: `ApiErrorSchema`'s `bad_request` variant makes `issues` required — every server-generated 400 (not just zod-hook ones) must carry a non-absent `issues` array or the body fails its own contract parse.


**The pipeline.** Every verb funnels through one function so the invariants live in exactly one place:

```ts
mutateDocument(ctx, {
  docId?,            // absent for create
  actor,             // "user" | "agent"
  apply,             // (current: ParsedDocument | null) => { path, next: ParsedDocument | null, commit: CommitInfo }
}): MutationResult
```

Steps: acquire the per-document mutex → `assertWritable(docId, actor)` (a seam **SERVER-009** fills with lock enforcement; a no-op until then) → read the current file fresh from disk (never from the projection — the file is the source of truth) → run `apply` → serialize with SERVER-001 → atomic write → `autoCommit` → synchronous re-projection (SERVER-004) → build the response. Any throw before the write leaves the workspace untouched; a throw after the write is reported as a warning, never a rollback.

**Atomic write.** Write to `<file>.<pid>.tmp` in the same directory, `fsync`, `rename` over the target, then `fsync` the directory. Renames within a directory are atomic on the platforms Corpus targets, so a crash never leaves a half-written document.

**Concurrency.** A per-document `Map<docId, Promise>` mutex serializes writes to one document; a single global mutex serializes **git** operations (the index is a shared resource — two concurrent `git add`/`commit` pairs would cross-contaminate commits). Both are in-process; there is exactly one writer process by Decision 2.

**Actor.** The contract carries the acting party (header **`x-corpus-author: user|agent`** — `ACTOR_HEADER`, validated by `ActorHeaderSchema`, default `user`). Mapping to git identity: `user` → `Corpus User <user@corpus.local>`, `agent` → `Corpus Agent <agent@corpus.local>`. Only the **author** is set from the actor; the committer stays the process identity, which is what makes `git log --format='%an'` a clean audit trail (§4).

**Create.** Allocate the id with SERVER-001's `newId` using a projection-backed `isTaken` predicate. Path: `body.folder ?? "data/docs/inbox"` (§11's quick-create default) + `slugifyTitle(title)`; on collision append `-2`, `-3`, … Threads always land flat at `data/threads/<id>.md`. Template pre-fill (§11): when no `body` is supplied, query the projection for `type = 'template'` documents, filter to those whose frontmatter `for` equals the new document's type, order by `path` for determinism, take the first, and use its body plus any frontmatter keys it defines that the request did not (core identity fields — `id`, `created`, `updated`, `type` — are always the server's). Stamp `created = updated = nowIso()`, `status = "open"`, `anchors = {}`.

**Update.** Load, apply the patch, reconcile, write:

- `oldBody` is the body **as read from disk in this request**, not a client-supplied copy — so out-of-band edits are reconciled against reality.
- `reconcileAnchors(oldBody, newBody, frontmatter.anchors)` (SERVER-002); the returned map replaces `anchors` in the same serialization.
- `updated` is stamped on any body or frontmatter change. Exception: a patch that changes **only** `reviewed` is the "still current" act (§5) — it stamps `reviewed` and leaves `updated` alone, because staleness runs off `max(updated, reviewed)` and marking a document current is deliberately not an edit.
- Response: the updated document plus `anchors: { remapped: string[], orphaned: string[] }` (§9.2).
- **`baseHash` is struck** (Sprint-005 Adjudication 3 / Open Conflict 3): no such field exists in `UpdateDocRequestSchema` and the route declares no `409`. Semantics are last-write-wins — and still anchor-correct, because reconciliation always runs against the on-disk body.

**Move.** Validate the target path through SERVER-001's containment guard, reject a target that already exists, reject moving a thread out of `data/threads/` (threads are flat, §4). Perform the move as a real rename plus a projection update for both paths. The id never changes; `[[refs]]` need no rewriting because they are id-based (§5).

**Archive.** `status: archived` ⇄ `open` in frontmatter. For `type: skill` documents (§7), also move the containing folder: `.claude/skills/<name>/` → `.claude/skills-archived/<name>/` (whole folder, including any siblings of `SKILL.md`), and the reverse on unarchive. The document stays indexed either way — the archived root is a projection root (SERVER-004). If the destination folder already exists, fail with **400 + `issues`** naming the conflict rather than merging directories (Adjudication 3).

**Delete.** Reject when `actor === "agent"` with `403` and the detail "deletion is user-only; the agent archives, never deletes" (§7). Otherwise remove the file, remove its rows from the projection, and **leave its threads untouched** — they become orphaned records whose `parent` names a missing document (§9.2); the projection already represents that state. Git retains the deleted content in history.

**Auto-commit (`git/commit.ts`).** Run git through `execFile` (never a shell) in the workspace root:

```
git -c user.name="<actor name>" -c user.email="<actor email>" add -- <paths…>
git -c … commit -m "<subject>" -m "<body>"
```

Subject formats (§4's `comment: reply on th_a1b2 by agent` is the model):

- `doc create: <title> (<id>) by <actor>`
- `doc edit: <title> (<id>) by <actor>`
- `doc move: <oldPath> → <newPath> (<id>) by <actor>`
- `doc archive: <title> (<id>) by <actor>` / `doc unarchive: …`
- `doc delete: <title> (<id>) by user`

The commit body carries machine-readable trailers used by the squash logic and by future auditing:

```
Corpus-Doc: <id>
Corpus-Actor: <user|agent>
Corpus-Anchors: remapped=<n> orphaned=<n>      # only when non-zero
```

**Squash-on-idle (autosave).** §11 requires "auto-commits squashed on idle so git history stays meaningful". This issue implements the **amend-within-idle-window** strategy: keep an in-memory record of the last auto-commit per `(docId, actor)` — its SHA and timestamp. On the next commit for the same pair, amend instead of creating a new commit when **all** of these hold:

1. Less than `SQUASH_IDLE_MS = 30_000` has elapsed since that commit (exported constant).
2. `git rev-parse HEAD` still equals the recorded SHA (nothing has been committed since).
3. `HEAD`'s trailers match the same `Corpus-Doc` and `Corpus-Actor`.
4. The repository is on a branch, has no in-progress merge/rebase/cherry-pick, and `HEAD` is not an ancestor of any upstream ref (never rewrite published history).

The amend is `git commit --amend --no-edit --date=<original author date>` after staging, preserving the original author timestamp so the commit's "when did this editing session start" stays honest. If any condition fails, fall back to a fresh commit — the fallback is always safe.

> **Settled, not open** (Adjudication 2 / Open Conflict 5): SHARED-001 landed §4's revised text and it is binding. Amend-within-idle-window is pinned behaviour. The two residuals are pinned here: the window is **30 s** (`SQUASH_IDLE_MS`, exported), and a **create→edit inside the window folds** into the create commit.

**Hook failure (§4/§14).** The auto-commit runs through the workspace's own git hooks — deliberately, since that makes every mutation self-checking. If `git commit` exits non-zero: the file mutation **stands** (files are the source of truth), the failure is logged to stderr with the full hook output, and the response includes `warnings: [{ code: "commit_failed", detail: <first lines of hook output> }]`. Never `--no-verify`, never a rollback, never a silent swallow. The projection still runs, so the UI shows the change; the warning is what makes the uncommitted drift visible.

**Contract coupling.** Route shapes come from `@corpus/contract`. Where a needed shape is missing (the `warnings` field), do **not** hand-roll it in the server — escalate to the orchestrator for a CONTRACT issue and consume the regenerated client (CLAUDE.md: a change spanning contract + one consumer is two issues).

### Edge Cases

- **Workspace is not a git repository** (or git is missing from `PATH`): the mutation stands, the commit is skipped, and the response carries a `commit_skipped` warning naming the reason — the server must remain usable.
- **Detached HEAD, in-progress merge/rebase, or unborn branch**: never amend; plain commit (or, on an unborn branch, the first commit).
- **Nothing actually changed** (a `PUT` whose result serializes byte-identically): skip the write, skip the commit, skip re-projection, respond `200` with an empty anchors report — autosave will do this constantly.
- **Pre-commit hook rejects the document** (e.g. `doc check` failure from §14): handled by the hook-failure path above; the response is a success **with a warning**, not a 500.
- **Concurrent `PUT`s to the same document**: serialized by the per-document mutex; the second reads the first's result from disk, so reconciliation chains correctly.
- **Out-of-band edit between a client's read and its write**: reconciliation always uses the on-disk body, so the out-of-band change survives and the anchors describe reality.
- **Path traversal** in `folder`/`path` inputs (`../`, absolute paths, symlinks pointing outside the workspace) — rejected by the containment guard with `400`.
- **Filename collisions** on create and move — dedupe on create, **400 with `issues`** on move (Adjudication 3).
- **A template that is itself archived**, or a template whose `for:` names `template` — skipped, to avoid a self-referential pre-fill loop.
- **Unicode / very long titles** — slug truncation must not produce empty or colliding filenames.
- **Archiving a skill whose folder contains extra files** (references, scripts) — the whole folder moves.
- **Deleting a document that is some thread's `parent`** — allowed; threads stay and are orphaned records, never cascade-deleted.
- **Large body writes** — atomic write plus a single commit; no partial state visible to a concurrent reader.

## Testing Strategy

Vitest, colocated `*.test.ts`, against **real** temp workspaces with **real** `git init` repositories — git behaviour (authors, amends, hooks) is the substance of this issue and cannot be mocked meaningfully.

- **Per-verb integration**: drive the real Hono app via `app.fetch` against a temp workspace; after each call assert three surfaces — the file on disk (parsed with SERVER-001), the projection row, and `git log`.
- **Create**: default inbox folder; explicit folder; template pre-fill (fixture template document present vs. absent); slug collision dedupe; id uniqueness against the projection.
- **Update + anchors**: fixture document with anchors; edits before / inside / after the anchored range; assert the on-disk `anchors` block and the response's `remapped`/`orphaned` arrays agree with SERVER-002's semantics; assert a `reviewed`-only patch leaves `updated` unchanged.
- **Squash**: two `PUT`s 100 ms apart → one commit whose content reflects both; two `PUT`s with the clock advanced past `SQUASH_IDLE_MS` → two commits; an unrelated commit interleaved → no amend; different actors → no amend.
- **Author attribution**: `git log --format='%an|%s'` shows the right author and message per verb.
- **Delete**: agent actor → 403 and the file still present; user actor → file gone, `git log -- <path>` still shows history, the thread row remains with a dangling `parent`.
- **Archive**: status flip round-trip; a real fixture skill folder moves to `.claude/skills-archived/` and back, and stays indexed in both states.
- **Hook failure**: install a real `.git/hooks/pre-commit` that exits 1 in the fixture repo; assert the file changed on disk, the response carries the `commit_failed` warning, and no rollback occurred.
- **Read-your-write**: `POST` then immediately `GET` in the same test without any wait — the document is present.
- **Concurrency**: fire ten `PUT`s in parallel at one document; assert the final file is well-formed, all ten commits (or their squashed equivalent) are accounted for, and no `.tmp` files remain.

## E2E Verification Plan

### Reproduction Steps (bugs only)

N/A — this is a feature, not a bug.

### Verification Steps

1. Create a real workspace: `mktemp -d`, `git init`, initial commit, `.corpus/config.json` with a token, `data/docs/inbox/` and `data/threads/` present, plus a real `data/docs/templates/note.md` with `type: template` and `for: note`.
2. Start the real server (`CORPUS_WORKSPACE=<ws> npx tsx apps/server/src/main.ts`) and export `TOKEN` for curl.
3. **Create**: `curl -X POST …/api/docs -H "Authorization: Bearer $TOKEN" -H "X-Corpus-Actor: user" -d '{"type":"note","title":"Mortgage options"}'`. Expected: `201` with an id; `ls data/docs/inbox/` shows `mortgage-options.md`; `cat` shows valid frontmatter **and the template's body text**; `git log -1 --format='%an|%s'` shows `Corpus User|doc create: Mortgage options (doc_…) by user`; `GET /api/docs/<id>` immediately returns it (read-your-write).
4. **Anchors**: hand-add an `anchors:` entry to that file quoting a sentence in its body, and create a matching thread file, then `PUT /api/docs/<id>` inserting a paragraph **above** the quoted sentence. Expected: `200`, response `anchors.remapped` includes the anchor (context refreshed), and `cat` shows the updated `prefix`/`suffix` in the same commit as the body change (`git show --stat HEAD`).
5. `PUT` again editing **inside** the quoted sentence → expected `remapped`, on-disk `exact` now matches the edited text. `PUT` again deleting the paragraph → expected `orphaned`, selector byte-identical to before.
6. **Squash**: issue two `PUT`s within a couple of seconds; `git log --oneline` shows **one** new commit and `git show HEAD` contains both edits. Wait past the idle window, `PUT` again → a second commit appears.
7. **Agent attribution**: repeat a `PUT` with `-H "X-Corpus-Actor: agent"`; `git log -1 --format='%an'` → `Corpus Agent`.
8. **Move**: `curl` the move route to `data/docs/finance/`. Expected: file present at the new path, absent at the old, id unchanged in `GET /api/docs/<id>`, commit message showing both paths.
9. **Archive a skill**: copy a real `SKILL.md` folder into `<ws>/.claude/skills/demo/`, project it, then call archive on its document id. Expected: `.claude/skills-archived/demo/SKILL.md` exists, `.claude/skills/demo/` is gone, and `GET /api/docs?type=skill` still lists it with `status: archived`. Unarchive and confirm the reverse.
10. **Delete gate**: `curl -X DELETE …/api/docs/<id> -H "X-Corpus-Actor: agent"` → `403`, file still present. Repeat with `user` → `200`, file gone, `git log --diff-filter=D -- <path>` shows the deletion and history retained; the thread that pointed at it still appears in `GET /api/docs?type=thread`.
11. **Hook failure**: write a real `.git/hooks/pre-commit` that `exit 1`s, `chmod +x`, then `PUT` a document. Expected: `200` with a `commit_failed` warning in the body, the file **changed on disk**, `git status` showing the uncommitted change, and a loud server log line. Remove the hook and confirm normal behaviour resumes.
12. **Out-of-band edit**: modify a document with a plain editor (`printf >>`), then `PUT` an edit through the API. Expected: the API's write reconciles against the on-disk content (no lost out-of-band paragraph in the anchor context) — record the observed before/after.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. Must be from real E2E testing — no mocks, no test clients. Real application, real requests, real interfaces. Include specific commands run, actual outputs observed, and pass/fail conclusions. State which model the implementing agent ran on ("implemented on: opus | fable")._

**Implemented on: opus.**

### Reproduction (bugs only)

N/A — feature, not a bug.

### Post-Implementation Verification

**Environment.** Real `corpus init` workspace at `/tmp/corpus-s005-e2e-VJYFeZ` (sprint prefix),
real git repository, real server process on **port 8855** started **directly** with
`node --import tsx apps/server/src/main.ts` (not via `corpus server start`, so nothing sanitized
the environment for it — TEST-38's requirement). Baseline after `corpus init`: **1 commit**
(`ecd4a25 workspace: initialize corpus workspace by user`), 6 seeded markdown documents
(1 template, 3 views, 2 skills). Every count below is relative to that. Server stopped by pid,
`curl -N` stopped by pid, both scratch trees deleted; `lsof -nP -iTCP:8855` and `:8765` both empty
afterwards. `git status` in the worktree shows only `apps/server/**`.

**Constants recorded** (sprint Done Criteria): `SQUASH_IDLE_MS = 30_000` (30 s), exported from
`apps/server/src/git/commit.ts`.

**Create + template pre-fill + author + read-your-write.**

```
curl -X POST …/api/docs -H 'x-corpus-author: user' -d '{"type":"note","title":"Mortgage options"}'
→ HTTP 201  doc_vsvhds7g | data/docs/inbox/mortgage-options.md
cat data/docs/inbox/mortgage-options.md
→ id/type/title/created==updated/tags: []/status: open/anchors: {}/due: null/reviewed: null
  body: "## Context / ## Notes / ## Open questions"   ← the seeded note template, verbatim
git log -1 --format='%an|%ae|%cn|%s'
→ Corpus User|user@corpus.local|Theophane Rupin|doc create: Mortgage options (doc_vsvhds7g) by user
git log -1 --format='%b' → Corpus-Doc: doc_vsvhds7g / Corpus-Actor: user
curl …/api/docs/doc_vsvhds7g   (next command, no sleep) → 200, same id/path
sqlite3 .corpus/cache.db → doc_vsvhds7g|note|data/docs/inbox/mortgage-options.md|open
```

The author is the acting party and the **committer is the process identity** — `%an` alone is the
audit column. ~~`evergreen: true` was carried from the template's own frontmatter (a key the request
did not name), which is the §11 carry-over rule working.~~ **Struck — this was the bug, and the
"§11 carry-over rule" it cited does not exist. See "Correction: template pre-fill is body-only"
below.**

**TEST-38 — hostile environment, directly-started server.** The server was launched with
`GIT_DIR`, `GIT_WORK_TREE`, `GIT_INDEX_FILE`, `GIT_AUTHOR_NAME=Hook Leak`,
`GIT_AUTHOR_EMAIL/GIT_COMMITTER_EMAIL=leak@hook.invalid`,
`GIT_CONFIG_COUNT/KEY_0/VALUE_0=user.email=leak@hook.invalid` and lowercase `git_work_tree` all
pointing at a **second, foreign** repository (`/tmp/corpus-s005-foreign-SsabvE`). After the create
and every later mutation:

```
git -C $FOREIGN log --oneline   → 6f3abbe foreign baseline     (unchanged)
git -C $FOREIGN status --porcelain → []                        (untouched)
git -C $WS   log -1 --format='%an' → Corpus User               (not "Hook Leak")
```

`watcher/git-head.ts`'s `readHeadVersion` was retrofitted with the same `sanitizeGitEnv()` in the
same pass, and `apps/server/src/git/env.test.ts` mirrors `apps/cli/src/git-env.test.ts`.

**Anchors, in the same write and the same commit.** An `anc_e2e00001` selector and its thread
`th_e2e00001` were written by hand and committed, then:

```
PUT (paragraph inserted ABOVE the quote) → 200 {"remapped":["anc_e2e00001"],"orphaned":[]}
  on disk: exact unchanged, prefix/suffix refreshed to the new surroundings
  git log: ONE new commit; git show --stat HEAD → data/docs/inbox/mortgage-options.md | 16 ++++----
PUT (edit INSIDE the quote)              → 200 {"remapped":["anc_e2e00001"],"orphaned":[]}
  on disk: exact: The rate is fixed for seven whole years.
PUT (paragraph DELETED)                  → 200 {"remapped":[],"orphaned":["anc_e2e00001"]}
  selector byte-identical: YES  (diffed the anchors block before/after)
```

**Squash-on-idle.** The two edits ~1 s apart produced **one** commit (`1c5cbd6`), and its dates
prove the session semantics:

```
git log -1 --format='%aI|%cI'
→ 2026-07-26T23:02:53-07:00 | 2026-07-26T23:03:00-07:00
  author date = the first save (session start); committer date = the last save
git log -1 --format='%b' → Corpus-Doc / Corpus-Actor / Corpus-Anchors: remapped=1 orphaned=0
```

After `sleep 31` (past the 30 s window) the next `PUT` created a **second** commit (`e6242e8`).
The interleaved-commit rule was also observed in passing: the manual `git commit` seeding the
anchor prevented the create→edit fold, so `doc create` and the first `doc edit` are separate.

**TEST-43 — create→edit adjudication, stated.** Implemented as **fold** (amend), per sprint-005
Open Conflict 5's recommendation: a create followed by an edit inside the idle window by the same
actor amends the create commit, so the commit's subject stays `doc create: …` and its content holds
both. "Create the document, type into it" is one editing session by §4's own framing. Asserted at
the HTTP level in `docs/update.test.ts` → "folds two rapid saves into one commit and starts a fresh
one past the window", and the amend's safety conditions are asserted in `git/commit.test.ts`.

**Agent attribution / move / archive-a-real-skill / delete.**

```
PUT -H 'x-corpus-author: agent' → git log -1 %an|%s → Corpus Agent|doc edit: … by agent
POST …/move {"folder":"finance"} → 200, path data/docs/finance/mortgage-options.md, id unchanged
  git log -1 %s → doc move: data/docs/inbox/… → data/docs/finance/… (doc_vsvhds7g) by user
  git show --stat → data/docs/{inbox => finance}/mortgage-options.md   (a rename, nothing else)
POST …/doc_skillcomment/archive → 200 status archived, path .claude/skills-archived/comment/SKILL.md
  ls .claude/skills/ → orchestrate/   (comment/ gone, whole folder moved)
  GET /api/docs?type=skill&status=archived → doc_skillcomment archived .claude/skills-archived/…
  git show --stat → .claude/{skills => skills-archived}/comment/SKILL.md
POST …/unarchive → 200 status open, .claude/skills/comment/ back, skills-archived/ empty
DELETE -H 'x-corpus-author: agent' → 403 {"code":"forbidden","message":"deletion is user-only;
  the agent archives, never deletes"}, file still present
DELETE (default actor) → 200 {"deletedId":"doc_vsvhds7g","orphanedThreadIds":["th_e2e00001"]}
  git log --diff-filter=D → Corpus User|doc delete: Mortgage options (doc_vsvhds7g) by user
  sqlite3 threads → th_e2e00001|doc_vsvhds7g   (orphaned record, never cascade-deleted)
```

**Hook failure (§14).** A real executable `.git/hooks/pre-commit` printing to stderr and exiting 1:

```
PUT → HTTP 200, body is the declared UpdateDocResponse shape
tail data/docs/inbox/hooked-doc.md → "after the hook refused"     ← the mutation stands
git status --porcelain → M data/docs/inbox/hooked-doc.md          ← uncommitted, visible
server log → 1× "auto-commit failed" carrying the hook's own line
             "doc check failed: anchor anc_x does not resolve"
```

Removing the hook restored normal commits. **`--no-verify` is never used and there is no rollback.**

**Out-of-band edit.** `printf >>` appended a paragraph directly to the file; the next `PUT` (title
only) kept it and reconciled against the on-disk body — the appended paragraph is still in the file
after the API write. Reconciliation never uses a client-supplied `oldBody`.

**SSE.** A real `curl -N /events` client captured 7 `invalidate` frames across the run, e.g.
`{"keys":[["docs"],["docs","doc_vsvhds7g"],["tree"]]}`. **Every payload's only field is `keys`** —
`grep '^data:' | grep -v '"keys"'` returned nothing. Structural mutations (create, move, delete)
carry `["tree"]`; edits and archives do not.

**TEST-53 — measured write-path latency (the deliverable is the numbers).** 10 `PUT`s per size,
end-to-end over real HTTP including reconciliation, git and re-projection:

| body   | bytes     | p50    | p95    | max    |
| ------ | --------- | ------ | ------ | ------ |
| ~1 KB  | 1 057     | 90.8ms | 92.7ms | 93.6ms |
| ~100KB | 102 431   | 99.8ms | 104.7ms| 105.4ms|
| ~1 MB  | 1 048 667 | 198.0ms| 274.7ms| 295.8ms|

Each document carried **3 anchors**. Reconciliation share, isolated by repeating the 1 MB case with
**zero** anchors: p50 **121.8 ms** / p95 127.9 ms → reconciliation costs ~**76 ms p50 (~38 %)** at
1 MB and is negligible at 1 KB. (`diff-match-patch`'s 1 s `Diff_Timeout` was never reached.)

**TEST-54 — `rebuild && doctor` after the whole verb surface**: `rebuild: 8 docs, 1 threads,
skipped 0` then `doctor ok: true | drift: []` — no `count_mismatch` from the queue `.gitkeep`s, the
archived skill folder, the deleted document, or the anchor write-backs.

**TEST-55 — the generated typed client drives the write surface.** `createCorpusClient` issued
create / update / move / archive / delete with the actor header through its typed `params.header`;
all five succeeded at runtime against the real server and the responses narrowed without a cast
(`created.data.frontmatter.title` is `string`, `updated.data.anchors` is the reconciliation report).
A scratch probe compiled clean under `tsc --strict --module nodenext`.

**~~DEFERRED → CONTRACT-005 (TEST-45)~~ — CLEARED 2026-07-27 (opus).** CONTRACT-005 landed
`warningsField` on `DocMutationResponse`, `UpdateDocResponse` and `DeleteDocResult`, so the
deferral above is closed: **§14's "a warning on the API response" is now met on every mutation
verb**, alongside the log line (which stays — it is the half that names the document and survives
a client that ignores the field).

Wiring, all of it in `apps/server`:

- `validateBeforeWrite` now **returns** the §14 validation warnings it already computed instead of
  only logging them: the checker's `anchor-unresolved` → `orphaned_anchor`, `ref-unresolved` →
  `unresolved_ref`. No second pass, no recomputation.
- That required one seam: `CheckOptions.documentExists`, mirroring the existing `resolveAnchor`
  injection. A save hands the checker exactly **one** file, so without it every cross-document
  `[[ref]]` in the saved document would have warned purely because its target was not in the set.
  It is backed by the projection — the corpus the server already indexes.
- `runMutation` takes those warnings in and returns `[...validation, ...commit]`; the commit half
  (`commit_failed` / `commit_skipped`) is unchanged.
- `deleteDocument` puts `mutation.warnings` on the `DeleteDocResult` it returns; the five other
  handlers serialize `{doc, warnings}` / `{doc, anchors, warnings}`.

**E2E (real `tsx src/main.ts` on 127.0.0.1:8765, real git workspace, curl):**

1. **Clean create** — `POST /api/docs` → `201`, `"warnings": []`. TEST-45's clean half: the field
   is present and empty, never absent.
2. **`orphaned_anchor` + `unresolved_ref` through a real `PUT`** — an out-of-band anchored document
   (`doc_e2eanch1`, thread `th_e2e00001` on `anc_e2e00001`) edited to delete the anchored sentence
   and add `[[doc_nowhere1]]` → `200`, `anchors: {"remapped":[],"orphaned":["anc_e2e00001"]}` and

   ```json
   "warnings": [
     {"code":"orphaned_anchor","detail":"anchor `anc_e2e00001` no longer resolves in the body; its thread is orphaned"},
     {"code":"unresolved_ref","detail":"reference `[[doc_nowhere1]]` does not resolve to a document in the corpus"}
   ]
   ```

3. **A ref that resolves warns nothing** — the same `PUT` carrying `[[doc_ymllpolf]]` (a document
   created in step 1) → `warnings: []`. This is the case the `documentExists` seam exists for; it
   warns without it.
4. **TEST-45's rider, on the wire** — a `.git/hooks/pre-commit` that exits 1 → `PUT` still `200`,
   `warnings: [{"code":"commit_failed","detail":"git commit failed: doc check: refusing this commit"}]`,
   `doc.body` is the new text, the file on disk holds it, `HEAD` is unchanged and
   `git status --porcelain` shows `M data/docs/inbox/mortgage-options.md`. The write stands; only
   the commit did not happen.
5. **`DELETE` under the same hook** → `200` with
   `{"deletedId":"doc_e2eanch1","orphanedThreadIds":["th_e2e00001"],"warnings":[{"code":"commit_failed",…}]}`.
6. **Log half still fires** — 4 × `mutation completed with a warning` in the server log, each
   naming its `docId`.

**Observed, not a regression:** in step 3 the `PUT` response's `anchors.orphaned` still lists
`anc_e2e00001` while `warnings` is empty — reconciliation never re-attaches an anchor that was
already orphaned in `oldBody`, but the selector was preserved byte-for-byte and the text came back,
so it resolves again. `GET /api/docs/doc_e2eanch1` confirms `orphaned: false, range {18,51}`, i.e.
the **warning** is the accurate view and the reconciliation report is the stale one. Pre-existing
SERVER-002/013 behaviour, untouched here.

**ESCALATION (new, unresolved): `DocFrontmatter.created`/`updated` are still non-nullable.**
CONTRACT-005 made the *row* timestamps nullable (sprint-005 Open Conflict 11) and deleted
`UNDATED_INSTANT`; `docs/query.ts` passes `null` through. `DocFrontmatterSchema` was deliberately
left non-nullable ("only the row is nullable … a document the server writes is always stamped"),
but `GET /api/docs/{id}` also serves documents the server did **not** write — a hand-written
`SKILL.md` has no timestamps at all. So `docs/read.ts` still has to produce a string and now
defines the epoch sentinel locally (with that reasoning in a comment). **Consequence: the same
skill file reads `created: null` from `GET /api/docs` and `created: "1970-01-01T00:00:00Z"` from
`GET /api/docs/{id}`.** Closing it means making `DocFrontmatterSchema.created`/`updated` nullable,
which is a contract change and outside this issue.

**DEFERRED → SERVER-009.** The write path's `423` responses. SERVER-005 ships the
`assertWritable(docId, actor)` seam with a no-op default and a test proving it is called exactly
once per write verb, before anything is read or written (`docs/write.test.ts` → "calls the lock
guard once for every write verb"), plus a test that a refusing guard leaves the file and `HEAD`
untouched.

**Gates.** `npm run build` ✔ · `npm run lint` ✔ · `npm run format:check` ✔ · `npm run typecheck`
(every workspace) ✔ · `npm test` → **140 files, all passing** · `npx vitest run --coverage` →
**lines 98.83 %, statements 98.83 %, functions 99.31 %, branches 94.99 %** (gate 90 %, exit 0).

**Gates, re-run after the warnings wiring (2026-07-27, opus).** `npm run build` ✔ · `npm run lint`
✔ (0 errors, 0 warnings) · `npm run format:check` ✔ · `npm run typecheck` (every workspace) ✔ ·
`npm run test:coverage` → **144 files / 2 568 tests, all passing**, **statements 98.89 %, branches
95.09 %, functions 99.34 %, lines 98.89 %** (gate 90 %, exit 0).

**Amendment during the SERVER-009 harvest reconciliation (2026-07-27, opus): git author
spelling.** The canonical identity is CLI-002's shipped `user <user@corpus.local>` /
`agent <agent@corpus.local>` — the git **name is the actor string itself**, not `Corpus User` /
`Corpus Agent`. `corpus init` already writes the workspace's first commit that way, and
`git log --format='%an'` has to read as one uniform column from that commit onward. So
`ACTOR_IDENTITIES` in `git/commit.ts` and six assertions in `docs/{move,update,delete}.test.ts`
and `git/commit.test.ts` were changed accordingly. **Superseded by this: the Technical Design's
"`user` → `Corpus User <user@corpus.local>`, `agent` → `Corpus Agent <agent@corpus.local>`"
mapping, and every `Corpus User|…` / `Corpus Agent|…` line in the E2E log above** — the behaviour
those lines recorded is unchanged, only the name half of the identity is. `FALLBACK_COMMITTER`
(`Corpus <corpus@corpus.local>`, used only when the workspace configures no `user.email`) is not
an actor identity and is untouched. Also mounted in that reconciliation: the `assertWritable`
seam deferred above now carries SERVER-009's real guard — see
`issues/server/009-locks-jobs.md` → "Harvest Reconciliation over SERVER-005".

### Correction: template pre-fill is body-only (bug fix, 2026-07-27, opus)

Found incidentally during the CONTRACT-005 timestamps E2E and logged in
`issues/contract/005-board-contract-growth.md`'s addendum. **This entry corrects the E2E log above**
(the struck sentence under "Create + template pre-fill") and the Technical Design's Create paragraph
("…plus any frontmatter keys it defines that the request did not").

**The claimed rule does not exist.** SERVER-005's escalation 4 called the frontmatter carry-over
"the §11 carry-over rule working". SPEC.md §9.2 (line ~311) is the operative sentence and it says
**body**, nothing else: "body pre-filled from the type's `template` document when one exists and no
body is given". `CreateDocRequestSchema` independently documents the server default for every
frontmatter field a request may omit (`tags` → no tags, `status` → `open`, `due` → `null`,
`evergreen` → `false`). A template's own frontmatter is the *template document's* housekeeping.

**Reproduction (real server, real workspace, before any code change).** `corpus init` at
`/tmp/corpus-tmpl-repro` (real git repo, the seeded `data/docs/templates/note.md` which carries
`evergreen: true`, because a seed document never goes stale — AGENT-001), real server started with
`CORPUS_WORKSPACE=… node --import tsx apps/server/src/main.ts` on 127.0.0.1:8765:

```
curl -X POST …/api/docs -H 'x-corpus-author: user' -d '{"type":"note","title":"Repro Wire"}'
→ 201 {"doc":{"frontmatter":{…,"evergreen":true},…}}          ← request never named `evergreen`
cat data/docs/inbox/repro-wire.md → evergreen: true            ← and on disk
```

**Blast radius.** `evergreen: true` opts a document out of §5's staleness ramp entirely, so **every
note created from the seeded template was permanently invisible to the stale tiers** — no age rail,
no age chip, and never a row in Attention's stale-for-review lane. Demonstrated on the post-fix
server with two hand-written, long-untouched twins (`updated: 2025-01-01`) differing only in
`evergreen`: `GET /api/docs?stale=stale&type=note` returned **only** the `evergreen: false` one
(`stale: "very-stale"`, `attention: ["stale"]`); the `evergreen: true` twin was absent.

**Fix.** `docs/templates.ts` — `TemplatePrefill` is now `{ path, body }`. The frontmatter channel is
gone, along with `TEMPLATE_RESERVED_KEYS` (which existed only to police it) and its `docs/index.ts`
re-export. `docs/create.ts` — the `extras` merge and its `asStringArray`/`asStatus` coercers are
deleted; every frontmatter value is now the request's or the documented server default.

**Audit of the other fields templates.ts copied** (directive: same rule, body only). It copied
**every** non-reserved key, so all of these are removed: `tags`, `status`, `due` and `evergreen`
(each of which had a coercer and shadowed a documented default), plus arbitrary extra keys such as a
plugin's `column` hint. Only `id`/`type`/`title`/`created`/`updated`/`anchors`/`for` had been
excluded before. Nothing else in the repo consumed the frontmatter channel — `findTemplate`'s only
caller is `createDocument`.

**Tests.** New dedicated `docs/templates.test.ts` (the suite SERVER-005's report flagged as missing;
`templates.ts` had been covered only incidentally through `create.test.ts`), 8 cases: body-and-only-
body from a deliberately hostile template that sets every inheritable field against its default;
no template for the type; the `for: template` self-referential refusal; archived skipped and
first-match-by-path; a template corrupted out-of-band after projection (the only way the parse-error
skip is actually reachable — projection never holds a row for a file it could not parse); pre-fill
only when `body` is omitted (`""` is a supplied body, not a request for a surprise); a no-template
type creating empty-bodied; the request's own non-default values still winning; and the evergreen
regression asserted on all three surfaces (wire, file, `documents.evergreen` row). `create.test.ts`'s
"pre-fills the body and extra frontmatter" case was renamed and inverted — `column: research` must
**not** ride along.

**E2E, post-fix** (fresh `corpus init` at `/tmp/corpus-tmpl-e2e`, real server on 8765, real curl):

```
POST {"type":"note","title":"Repro Evergreen"}   → 201, wire "evergreen":false
  file  data/docs/inbox/repro-evergreen.md       → evergreen: false
  body  "## Context / ## Notes / ## Open questions"   ← the template's body, still pre-filled
  row   sqlite3 → doc_zfiamehc|note|Repro Evergreen|0
  GET /api/docs/doc_zfiamehc (next command, no sleep) → evergreen:false   (read-your-write)
POST {…,"evergreen":true,"tags":["x"],"status":"resolved","due":"2027-03-04"}
  → 201, all four honoured verbatim; row evergreen=1
POST {…,"body":"Only my words."}                 → template body absent, request body present
POST {"type":"view","title":"No Template"}       → 201, body "" (no view template; §11's "none → empty")
git log --format='%an|%s' -4 → four `user|doc create: …` lines, unchanged
sqlite3 → doc_seedtemplatenote|template|Note template|1   ← the template keeps its OWN evergreen
```

Scratch trees `/tmp/corpus-tmpl-repro` and `/tmp/corpus-tmpl-e2e` removed, server stopped by pid,
`lsof -nP -iTCP:8765` empty afterwards.

**Gates.** `npm run build` ✔ · `npm run lint` ✔ (0 errors, 0 warnings) · `npm run format:check` ✔ ·
`npm run typecheck` (every workspace) ✔ · `npm run test:coverage` → **155 files / 2 725 tests, all
passing**, **statements 98.81 %, branches 95.06 %, functions 99.39 %, lines 98.81 %** (gate 90 %).

**Flagged for the orchestrator, not decided here:** SPEC.md §11 line 376 reads "provides the starting
**frontmatter/body** for new documents of that type", which is in tension with §9.2's body-only
sentence. Implemented per §9.2 and the orchestrator's directive; if §11's phrasing is meant to
license a *scoped* carry-over (plugin-declared keys only, never the fields with documented server
defaults), that is a spec clarification plus a follow-up issue, not a silent re-widening.

### Amendment — fix loop round 1: FAIL-1, the amend that would empty the create commit (2026-07-27)

**Fixed on: opus.** Addresses `issues/evals/SERVER-005-eval.md` FAIL-1 (TEST-31, TEST-36, TEST-67)
and the evaluator's "Notes for the record" item 1 (a folded commit's subject naming the first verb).
The rebase-interrupted non-durability note (item 2) is accepted as-is and untouched.

#### Pre-fix reproduction (real server, real workspace, before any code change)

Fresh `corpus init` workspace at `/tmp/corpus-s005f-repro`, real server on **port 8765**
(`corpus server start --workspace /tmp/corpus-s005f-repro`, pid 40020), real `curl`, real git.

```
$ git log -1 --format='%h %s'
  3f53f2a workspace: initialize corpus workspace by user

$ curl -X POST …/api/docs -d '{"type":"note","title":"Repro CD3"}'      → 201 doc_e2isbjz7
$ git log -1 --format='%h %s'
  e4ce75c doc create: Repro CD3 (doc_e2isbjz7) by user

$ curl -X DELETE …/api/docs/doc_e2isbjz7        (same actor, <30 s)     → HTTP 200
  {"deletedId":"doc_e2isbjz7","orphanedThreadIds":[],
   "warnings":[{"code":"commit_failed",
     "detail":"git commit --amend failed: On branch main\nNo changes\nYou asked to amend the most
               recent commit, but doing so would make\nit empty. You can repeat your command with
               --allow-empty, or you can\nremove the commit entirely with \"git reset HEAD^\"."}]}

$ ls data/docs/inbox/repro-cd3.md            → No such file or directory   (file gone)
$ git log -1 --format='%h %s'                → e4ce75c doc create: …       ← HEAD UNMOVED
$ git ls-tree -r --name-only HEAD | grep -c repro-cd3   → 1                ← still in HEAD's tree
$ git log --diff-filter=D -- data/docs/inbox/repro-cd3.md → (empty)        ← deletion never recorded
$ git status --porcelain                     → D  data/docs/inbox/repro-cd3.md   ← STAGED LEAK
```

Contamination, same workspace, immediately after:

```
$ printf 'x\n' > UNRELATED.md && git add UNRELATED.md
$ git commit -m "an unrelated user commit"
$ git show --stat --format='%s' HEAD
  an unrelated user commit
   UNRELATED.md                 |  1 +
   data/docs/inbox/repro-cd3.md | 19 -------------------      ← the user shipped our deletion
   2 files changed, 1 insertion(+), 19 deletions(-)
$ git status --porcelain                     → (clean)        ← the leak is now someone else's commit
```

Secondary (evaluator note 1), same server, same window:

```
$ POST /api/docs {"title":"Verb Fold"}  → doc_mqbuikoo
$ PUT  /api/docs/doc_mqbuikoo {"body":"edited body\n"}
$ POST /api/docs/doc_mqbuikoo/archive   → 200, status archived
$ git log -1 --format='%h %s'
  7697da8 doc create: Verb Fold (doc_mqbuikoo) by user        ← subject names the FIRST verb
```

#### The fix (`apps/server/src/git/commit.ts` only)

1. **`amendWouldEmptyHead(paths)` — ask before committing, not after.** git refuses an amend that
   would empty the commit, and the refusal arrives at the worst possible moment: the mutation is
   already on disk and already staged. The question is answered from plumbing, not from git's
   (translatable) prose. `HEAD`'s own contribution is `git diff --name-only HEAD^ HEAD`
   (`diff-tree --root -r` for a root commit); if any path in it lies outside this save's paths, the
   amended commit still says something and is safe. When everything `HEAD` carries is ours,
   `git diff --cached --quiet HEAD^ -- <paths>` exits 0 exactly when the staged content restates the
   parent — the amend would be empty. In that case the amend target is dropped and the save becomes
   an **ordinary fresh commit**, which is what history should have recorded anyway. (Root commit:
   the tree is empty iff `git ls-files -- <paths>` lists nothing.) The primitives were checked
   against real git before the code was written — the exit codes above, and `git reset -q HEAD --
   <path>` exiting 0 even for a pathspec git has never heard of.

2. **The staged-state invariant.** `unstage(paths, head)` restores the index to `HEAD` for exactly
   the paths an attempt staged, and it now runs on **every** outcome that is not a landed commit:
   staging failure, `nothing to commit`, `commit produced no HEAD`, and git refusing the commit
   (hook rejection included). The working tree is never touched — the mutation stands (SPEC §14), it
   is simply no longer in the shared index, so it cannot ride along on the next commit made by
   anything at all. `git reset --quiet HEAD -- <paths>` where there is a `HEAD`,
   `git rm --cached -r -q --ignore-unmatch` on an unborn branch. The property is stated in the
   module header alongside the other three the file carries.

3. **Subject honesty on a fold.** The amended commit's subject is now the *latest* verb's
   (`request.subject`) rather than the one frozen at the session's first save, so
   `create → edit → move → archive → unarchive` inside the window reads `doc unarchive: …` instead
   of `doc create: …` describing content that has since moved and changed status. The folding itself
   is unchanged (SPEC §4 squash-on-idle, Adjudication 2); only the label is corrected, and the
   trailers were already truthful. `amendTarget` no longer reads `%s` at all — one fewer git call
   per fold, and it now returns the author date alone.

#### Post-fix verification

Fresh `corpus init` workspace at `/tmp/corpus-s005f-verify`, real server on **port 8765**
(`corpus server start`, pid 165), real `curl`, real git, real hooks.

**A — create → DELETE inside the window (FAIL-1's exact reproduction):**

```
POST /api/docs {"type":"note","title":"Fix CD"}  → 201 doc_xvkx5dra
  HEAD eaa8246 doc create: Fix CD (doc_xvkx5dra) by user
DELETE /api/docs/doc_xvkx5dra                    → HTTP 200  {"warnings":[]}   ← was commit_failed
  HEAD                → fbbfcd4 doc delete: Fix CD (doc_xvkx5dra) by user      ← HEAD ADVANCED
  ls-tree -r HEAD     → 0 matches for fix-cd                                   ← gone from the tree
  --diff-filter=D     → fbbfcd4 doc delete: Fix CD (doc_xvkx5dra) by user      ← deletion RECORDED
  git status          → (empty)                                                ← NO staged leak
  merge-base --is-ancestor eaa8246 HEAD → yes; git show eaa8246:<path> → the file   (history kept)
```

**B — the contamination is gone:**

```
printf 'x\n' > UNRELATED.md; git add UNRELATED.md; git commit -m "an unrelated user commit"
git show --stat --format='%s' HEAD
  an unrelated user commit
   UNRELATED.md | 1 +
   1 file changed, 1 insertion(+)          ← the user's file ALONE
git status --porcelain → (empty)
```

**C — the whole verb chain inside one window (the evaluator's "this is how I first hit it"):**

```
create → edit → move(finance) → archive → unarchive → DELETE, all inside 30 s
DELETE → HTTP 200 {"warnings":[]}
commits since the chain started:
  f504d65 doc delete: Chain (doc_lyf4mam4) by user     ← the fresh fallback commit
  f51fea3 doc unarchive: Chain (doc_lyf4mam4) by user  ← the folded session commit, labelled by
                                                         the LAST verb folded in (was "doc create:")
git status → (empty)   ls-tree → 0 matches   --diff-filter=D → f504d65
```

**D — a refused commit leaves nothing staged:**

```
.git/hooks/pre-commit → echo "doc check: refusing" >&2; exit 1
PUT /api/docs/<id> → 200, warnings [{"code":"commit_failed",
                                    "detail":"git commit --amend failed: doc check: refusing"}]
HEAD                       → 4fb3e01, unmoved
git status --porcelain -uall →  M data/docs/inbox/hooked.md     ← unstaged (was "M ")
git diff --cached --name-only → (empty)                          ← the invariant
file on disk               → holds the edit (SPEC §14: the mutation stands)
then, hook removed: the operator's own commit carries UNRELATED2.md ALONE
                    the next PUT commits normally → 9c43f26 doc edit: Hooked (doc_d23s6s5v) by user,
                    git status → (empty)
```

**E — the non-amending delete path is unchanged:**

```
create → wait 31 s (past SQUASH_IDLE_MS) → DELETE → 200 {"warnings":[]}
commits since the create: 6d548da doc delete: Late CD (doc_givnyrpr) by user   (so 2 in total)
--diff-filter=D → 6d548da       git status → (empty)
```

**F — SERVER-009's force-break audit commit is empty again (TEST-67):**

```
POST /api/locks/doc_qdblllts        (x-corpus-author: agent) → holder agent
POST /api/locks/doc_qdblllts/break  (user)                   → released true
HEAD                          → eb7b3de lock: force-break on doc_qdblllts (was agent) by user
git show --stat --format= HEAD → (empty)      ← nothing swept in
git status --porcelain         → (empty)
```

**G — squash-on-idle still folds, author timestamp still preserved (TEST-39/40):**

```
create, then two PUTs inside the window → 1 commit since the create
HEAD  → 5f7c6b6 doc edit: Squash (doc_afcdrurn) by user
%aI|%cI → 2026-07-27T01:09:53-07:00|2026-07-27T01:09:54-07:00   (author = session start)
git show HEAD:<path> | grep -c 'EDIT [AB] marker' → 2     git status → (empty)
```

Server stopped by pid (`corpus server stop` → "stopped (pid 165)"), both scratch trees
(`/tmp/corpus-s005f-repro`, `/tmp/corpus-s005f-verify`) removed, `lsof -nP -iTCP:8765` empty
afterwards. `git status` in the repo worktree shows only `apps/server/**` and this issue file.

_Not re-run here_: `db rebuild` / `db doctor` are not yet exposed as CLI verbs or HTTP routes in this
tree, so TEST-54/TEST-125 could not be re-measured from outside. Nothing in this change touches the
projection, the watcher or SSE — the diff is confined to `git/commit.ts`'s index handling and amend
decision — and the repo-wide suite (which drives projection and drift through the real app) is green.

#### Tests

`apps/server/src/git/commit.test.ts` grows seven cases, three of them named regressions for FAIL-1:

- _"falls back to a fresh commit when amending would empty the previous one"_ — create-then-delete
  inside the window: `committed` (not `failed`), the deletion appears in `--diff-filter=D`, the
  create commit survives as `HEAD~1` and still holds the file.
- _"leaves nothing staged after a delete inside the window, so the next commit is uncontaminated"_ —
  the evaluator's contamination scenario as a regression test: after the delete, the operator's own
  commit is made and its `--stat` lists their file **only**.
- _"leaves nothing staged when git refuses the commit, so the next commit is uncontaminated"_ — the
  same invariant on the path where no commit happens at all (a hook rejects a delete): status is
  `D <path>` (working tree), `git diff --cached` is empty, and the operator's next commit is clean.
- _"falls back to a fresh commit when the root commit itself would be emptied"_ — the parentless
  branch of the emptiness check, on an unborn-branch repository.
- _"unstages on an unborn branch too, when the very first commit is refused"_ — the `git rm
  --cached` half of `unstage`.
- _"still amends when the previous commit says more than this save touches"_ — the guard rail: a
  session commit that also carries a second path is still amendable when our path reverts.
- _"amends under the latest verb's subject, so a folded commit never mislabels itself"_ — create →
  edit → archive folds to one commit subjected `doc archive: …`.

Updated: the hook-failure case now also asserts the empty index (and reads status with `-uall`,
since an unstaged never-committed file is `?? ` rather than `A `); `docs/update.test.ts`'s
squash-through-the-API case asserts the folded subject names the latest verb. `"stages a removal and
skips a path git has never heard of"` keeps its >30 s spacing — that is the non-amending delete
path, deliberately unchanged.

#### Gates

`npm run build` ✔ · `npm run lint` ✔ (0 errors, 0 warnings) · `npm run format:check` ✔ ·
`npm run typecheck` (every workspace) ✔ · `npm run test:coverage` → **155 files / 2 732 tests, all
passing**, statements **98.74 %**, branches **95.01 %**, functions **99.40 %**, lines **98.74 %**
(gate 90 %); `git/commit.ts` itself 94.07 % lines / 88.50 % branches.

The evaluator's "Notes for the record" item 2 (a save during an interrupted rebase lands on the
throwaway rebase HEAD and is unreachable after `--abort`) is **accepted as-is and untouched** here.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-005]` prefix
