# [SERVER-094] A window never outlives the server silently

## Domain

server

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: SERVER-091
- Blocks: —
- Related: SERVER-090 (the other producer of uncommitted files this recovers),
  CLI-037 (git maintenance in real workspaces — same "what runs against a user's
  repository unasked" territory, read its ruling before writing to a real one)

## Spec References

- SPEC.md **§4** — "A window never outlives the server silently"
- SPEC.md **§5** — files on disk are the source of truth, so an unclean stop
  loses the boundary and not the work
- SPEC.md **§7** — "Every change leaves a visible trace … with the acting party
  as git author". **The recovery commit is the one deliberate exception**, signed
  by the user 2026-08-09 (SHARED-040 Decision 2)
- SPEC.md **§2.2** rule 4 — bootstrap-class operations (`corpus init`,
  `corpus workspace upgrade`) write directly with the server stopped
- SPEC.md **§14** — a commit git refuses discards no work

## Summary

Two ends of the server's life. A **clean stop** closes the open window, so the
last editing session gets its subject and nothing is left half-named. An
**unclean stop** cannot, and the next start commits what it finds as a **recovery
commit**: one that says it is recovering changes left by a previous run and how
many documents it holds, so no reader mistakes it for an ordinary one.

The recovery commit **claims no party**. Which party's window was open is
precisely what the unclean stop destroyed, and `git log --author=user` must not
gain a commit no person made. §4 names this as §7's single exception, decided by
the user rather than inferred here.

## What recovery actually finds

Under SERVER-091's amend mechanism a window's content is in git at every instant,
so an unclean stop does **not** strand a window's work. That is the design and it
is deliberate. Recovery therefore exists for the changes the commit path never
saw, and there are three real sources:

1. **A commit git refused** (§14) — a workspace hook, a full disk, a mid-rebase
   repository. The mutation stood and stayed on disk.
2. **Out-of-band edits** — today, uncommitted indefinitely (SERVER-090). That
   defect is being fixed separately; until it is, recovery is what catches them,
   and after it is fixed recovery still catches ones made while the server was
   down.
3. **Bootstrap-class writes** — `corpus init` and `corpus workspace upgrade`
   write with the server stopped (§2.2 rule 4). See the edge case below: these
   are the ones recovery must **not** surprise.

Do not write the issue's tests as though recovery is catching a lost window. It
is not, and a test that pretends otherwise will be built on a fake.

## Acceptance Criteria

- [ ] A clean stop closes the open window through SERVER-091's `closeWindow`,
      registered on the existing disposer chain (`app.ts`, `registerDisposer`).
      The last editing session's commit carries the editing-session subject rather
      than the last save's
- [ ] The stop path **awaits** the close. A disposer that fires and returns before
      git finishes is the same as not having one
- [ ] On boot, uncommitted changes under the workspace's document roots are
      committed as a single recovery commit whose subject says it is recovering
      changes left uncommitted by a previous run **and how many documents it
      holds**
- [ ] The recovery commit carries **no acting party**: no `Corpus-Actor` trailer,
      and an author that is neither `user` nor `agent`. `git log --author=user`
      and `--author=agent` must both fail to match it. Assert both directions
- [ ] It is **scoped to the workspace's own document roots** and never sweeps up
      unrelated files an operator left dirty. Prove it: leave a dirty file outside
      the roots, boot, confirm it is untouched and unstaged
- [ ] A boot with nothing to recover **commits nothing and says nothing** — no
      empty commit, no log line, no cost. This is every ordinary boot
- [ ] The recovery commit opens no window: the first save after boot makes a
      fresh commit rather than amending the recovery
- [ ] A recovery that git itself refuses leaves the changes on disk and logs
      loudly (§14), exactly as a refused auto-commit does. It must not prevent the
      server from starting — a workspace that cannot commit is still a workspace
      you can read
- [ ] The index is left clean on every path that does not land a commit, matching
      the invariant `commit.ts` already documents ("no attempt ever leaves the
      index dirty")

## Technical Design

### Files to Create/Modify

- `apps/server/src/app.ts` — the disposer, and the boot call
- `apps/server/src/git/` — a new module for recovery; it is its own concern and
  does not belong inside `commit.ts`, which is about windows
- `apps/server/src/core/paths.ts` — `DOCS_ROOT` is `data/docs`; establish the
  full root set rather than assuming it is the only one

### Key Implementation Details

**The roots.** `DOCS_ROOT` (`data/docs`) is not the whole workspace's document
surface — skills live outside it (`skills/rollback.ts`, `skills/create.ts` and
the archive's `.claude/skills-archived/` move prove it). Enumerate the roots
deliberately and name them in one place; a recovery that misses skills is a
recovery that quietly does not cover the tree that `corpus skill rollback` reads.
`.corpus/` is gitignored and is not a root.

**The author.** There is no `Actor` value for "no party" and there must not be
one — `Actor` is a two-member union across the whole contract and widening it to
carry a git-authorship concept would leak into the API. Give the recovery path
its own identity constant beside `FALLBACK_COMMITTER` in `commit.ts`, and reach
git directly rather than through `AutoCommitter.commit`, whose `CommitRequest`
requires an `actor` for good reasons. Reuse `withGitLock`.

**Ordering at boot.** Recovery must run before the watcher starts and before the
first request is served: a chokidar event or an early mutation racing recovery
turns a clean recovery commit into a half of one. It must also run *after* the
git repository is known to exist — a non-repository workspace skips recovery
silently, as every other git path does.

**Counting documents.** The subject names how many documents, so count documents
and not files: a skill folder is several files and one document. `git status
--porcelain` over the roots gives paths; map them the way the projection does.

### Edge Cases

- **`corpus init`.** The bootstrap commit already exists and the tree is clean,
  so recovery finds nothing. Verify rather than assume — a first boot that makes
  a recovery commit on a freshly initialised workspace is a bad first impression
  and would be reported as a bug.
- **`corpus workspace upgrade`** (§2.2 rule 4) writes files deliberately with the
  server stopped, and the rider's contradiction sweep asked whether recovery
  would surprise it. **It does not, and the spec already says why**: §2.4 line 35
  and §2.4 line 86 both require that everything the upgrade wrote "lands as a
  single attributed git commit", so the tree is clean by the time the server
  boots and recovery finds nothing. **Verify that against the code rather than
  the spec** — if the upgrade does not in fact commit today, recovery will
  silently paper over it under no author, which is worse than the gap. File a CLI
  issue in that case; do not fix it here and do not let recovery become the
  upgrade's commit mechanism.
- **An operator's own dirty file inside the roots** — a hand-written markdown
  file dropped into `data/docs/` while the server was down. Recovery commits it.
  That is correct: it is a document in the workspace and §5 says the file is the
  truth. Note it in the log so the reviewer sees it was considered.
- **A boot where HEAD is detached or the repository is mid-rebase.** Skip
  recovery entirely, log once, start normally. Same ruling `commit.ts` already
  makes for every other commit.
- **Two servers booting against one workspace.** Out of scope — single-user,
  single-server is the product's shape — but the git lock must not deadlock, and
  a second server finding nothing to recover is the natural outcome.

## Testing Strategy

1. Clean stop: open a window, dispose the server, assert the commit's subject is
   the editing-session form and the disposer awaited the git call.
2. Boot with a dirty tracked file under the roots → one recovery commit, subject
   names the count, no `Corpus-Actor` trailer, author matches neither party.
3. Boot with a dirty file **outside** the roots → untouched, unstaged, no commit.
4. Boot with a clean tree → zero git commits, zero log lines. Assert against the
   fake git's call log that no commit was even attempted.
5. Boot where the commit is refused → server starts, changes still on disk, error
   logged, index clean.
6. Recovery then a save → two commits; the save did not amend the recovery.
7. `git log --author=user` and `--author=agent` over a history containing a
   recovery commit → neither matches it.

## E2E Verification Plan

Real workspace, real server, free port (**never 8765 or 5173** — the user's live
server and an ssh tunnel hold them). This issue writes to a repository's history:
do all of it in a scratch workspace under
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp`, never against the repo you are
working in.

### Verification Steps

1. `corpus init` a scratch workspace, start the server, confirm no recovery
   commit appeared on first boot.
2. Edit a document, stop the server cleanly. `git log -1` shows the
   editing-session subject.
3. Start, edit, then `kill -9` the server. Write a file directly into
   `data/docs/` while it is down. Start again: one recovery commit, its subject
   naming the count, `git log -1 --format='%an <%ae>'` showing neither party, and
   `git log -1 --format=%B` carrying no `Corpus-Actor`.
4. Leave a dirty file at the workspace root, boot: untouched, and `git status`
   still shows it as unstaged.
5. Boot once more with a clean tree: no new commit.

## E2E Verification Log

_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (writes to a user's git history unasked — qualifies)
- [ ] Committed with `[ISSUE-ID]` prefix
