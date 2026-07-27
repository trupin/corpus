# [SERVER-005] Doc write paths + git auto-commit

## Domain

server

## Status

in_progress

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

- [ ] `POST /api/docs` creates a document: generated id, path from the requested folder (default `data/docs/inbox/`, §11), frontmatter stamped (`created`, `updated`, `status`, `anchors: {}`), and — when no body is supplied — body and starting frontmatter pre-filled from a `type: template` document whose `for:` matches the new document's type (§11).
- [ ] `PUT /api/docs/:id` edits body and/or frontmatter, runs `reconcileAnchors(oldBody, newBody, anchors)` and persists the updated anchors map **in the same write and the same commit** as the body change (§6); the response reports `{ remapped: [], orphaned: [] }`.
- [ ] Move changes a document's path while its `id` stays stable (path is presentation, §5); the commit records both paths.
- [ ] Archive flips `status` to `archived` (and back), and archiving a `type: skill` document additionally moves its folder from `.claude/skills/<name>/` to `.claude/skills-archived/<name>/` (§7); unarchiving reverses it.
- [ ] `DELETE /api/docs/:id` is **user-only**: an agent actor gets `403` (§7 — "the agent archives, never deletes"). Deleting a document leaves its threads in place as orphaned records; git retains the file's history.
- [ ] Every mutation auto-commits with the acting party as git author (`user` or `agent`) and a structured message; `git log --format='%an %s'` is a readable audit trail (§4).
- [ ] Repeated `PUT`s to the same document by the same actor within the idle window amend the previous auto-commit rather than creating a new one; the amend is refused whenever it would rewrite anything other than the immediately preceding, matching auto-commit.
- [ ] A failing git hook during auto-commit does **not** roll back the file mutation; the response carries a loud warning and the failure is logged (§14).
- [ ] Every mutation re-projects synchronously before responding (read-your-write, §9.1) — an immediately following `GET` reflects the change with no polling.
- [ ] Unit + integration tests cover each verb, the anchor-reconciliation path, the squash window (inside and outside it), the actor gate on delete, and the hook-failure path.

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

Steps: acquire the per-document mutex → `assertWritable(docId, actor)` (a seam that SERVER-006 fills with lock enforcement; a no-op until then) → read the current file fresh from disk (never from the projection — the file is the source of truth) → run `apply` → serialize with SERVER-001 → atomic write → `autoCommit` → synchronous re-projection (SERVER-004) → build the response. Any throw before the write leaves the workspace untouched; a throw after the write is reported as a warning, never a rollback.

**Atomic write.** Write to `<file>.<pid>.tmp` in the same directory, `fsync`, `rename` over the target, then `fsync` the directory. Renames within a directory are atomic on the platforms Corpus targets, so a crash never leaves a half-written document.

**Concurrency.** A per-document `Map<docId, Promise>` mutex serializes writes to one document; a single global mutex serializes **git** operations (the index is a shared resource — two concurrent `git add`/`commit` pairs would cross-contaminate commits). Both are in-process; there is exactly one writer process by Decision 2.

**Actor.** The contract carries the acting party (header `X-Corpus-Actor: user|agent`, validated by the route schema, default `user`). Mapping to git identity: `user` → `Corpus User <user@corpus.local>`, `agent` → `Corpus Agent <agent@corpus.local>`. Only the **author** is set from the actor; the committer stays the process identity, which is what makes `git log --format='%an'` a clean audit trail (§4).

**Create.** Allocate the id with SERVER-001's `newId` using a projection-backed `isTaken` predicate. Path: `body.folder ?? "data/docs/inbox"` (§11's quick-create default) + `slugifyTitle(title)`; on collision append `-2`, `-3`, … Threads always land flat at `data/threads/<id>.md`. Template pre-fill (§11): when no `body` is supplied, query the projection for `type = 'template'` documents, filter to those whose frontmatter `for` equals the new document's type, order by `path` for determinism, take the first, and use its body plus any frontmatter keys it defines that the request did not (core identity fields — `id`, `created`, `updated`, `type` — are always the server's). Stamp `created = updated = nowIso()`, `status = "open"`, `anchors = {}`.

**Update.** Load, apply the patch, reconcile, write:

- `oldBody` is the body **as read from disk in this request**, not a client-supplied copy — so out-of-band edits are reconciled against reality.
- `reconcileAnchors(oldBody, newBody, frontmatter.anchors)` (SERVER-002); the returned map replaces `anchors` in the same serialization.
- `updated` is stamped on any body or frontmatter change. Exception: a patch that changes **only** `reviewed` is the "still current" act (§5) — it stamps `reviewed` and leaves `updated` alone, because staleness runs off `max(updated, reviewed)` and marking a document current is deliberately not an edit.
- Response: the updated document plus `anchors: { remapped: string[], orphaned: string[] }` (§9.2).
- Optional optimistic concurrency: the request may carry `baseHash` (the content hash the client last saw). If present and it does not match the file's current hash, respond `409` problem JSON with the current document in the detail. Absent `baseHash` is last-write-wins — but still anchor-correct, because reconciliation ran against the on-disk body.

**Move.** Validate the target path through SERVER-001's containment guard, reject a target that already exists, reject moving a thread out of `data/threads/` (threads are flat, §4). Perform the move as a real rename plus a projection update for both paths. The id never changes; `[[refs]]` need no rewriting because they are id-based (§5).

**Archive.** `status: archived` ⇄ `open` in frontmatter. For `type: skill` documents (§7), also move the containing folder: `.claude/skills/<name>/` → `.claude/skills-archived/<name>/` (whole folder, including any siblings of `SKILL.md`), and the reverse on unarchive. The document stays indexed either way — the archived root is a projection root (SERVER-004). If the destination folder already exists, fail with a `409` naming the conflict rather than merging directories.

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

> **Flagged for SHARED-001**: the exact squash semantics (window length, whether squashing spans actors, whether it also covers create→edit sequences) are a spec-level decision that SHARED-001's revision pins. This issue implements amend-within-idle-window as described and exposes the window as a constant so the revised spec can adjust it without redesign. Do not invent additional squash behaviour beyond what is written here.

**Hook failure (§4/§14).** The auto-commit runs through the workspace's own git hooks — deliberately, since that makes every mutation self-checking. If `git commit` exits non-zero: the file mutation **stands** (files are the source of truth), the failure is logged to stderr with the full hook output, and the response includes `warnings: [{ code: "commit_failed", detail: <first lines of hook output> }]`. Never `--no-verify`, never a rollback, never a silent swallow. The projection still runs, so the UI shows the change; the warning is what makes the uncommitted drift visible.

**Contract coupling.** Route shapes come from `@corpus/contract`. Where a needed shape is missing (the `warnings` field, `baseHash`, the move/archive routes, the actor header), do **not** hand-roll it in the server — escalate to the orchestrator for a CONTRACT issue and consume the regenerated client (CLAUDE.md: a change spanning contract + one consumer is two issues).

### Edge Cases

- **Workspace is not a git repository** (or git is missing from `PATH`): the mutation stands, the commit is skipped, and the response carries a `commit_skipped` warning naming the reason — the server must remain usable.
- **Detached HEAD, in-progress merge/rebase, or unborn branch**: never amend; plain commit (or, on an unborn branch, the first commit).
- **Nothing actually changed** (a `PUT` whose result serializes byte-identically): skip the write, skip the commit, skip re-projection, respond `200` with an empty anchors report — autosave will do this constantly.
- **Pre-commit hook rejects the document** (e.g. `doc check` failure from §14): handled by the hook-failure path above; the response is a success **with a warning**, not a 500.
- **Concurrent `PUT`s to the same document**: serialized by the per-document mutex; the second reads the first's result from disk, so reconciliation chains correctly.
- **Out-of-band edit between a client's read and its write**: reconciliation always uses the on-disk body; with `baseHash` supplied the write is refused with `409` instead.
- **Path traversal** in `folder`/`path` inputs (`../`, absolute paths, symlinks pointing outside the workspace) — rejected by the containment guard with `400`.
- **Filename collisions** on create and move — dedupe on create, `409` on move.
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

### Reproduction (bugs only)

_[Agent fills: exact commands, observed output, confirmation bug exists]_

### Post-Implementation Verification

_[Agent fills: application restarted, exact commands, observed output, confirmation fix/feature works]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[SERVER-005]` prefix
