# [SERVER-094] A window never outlives the server silently

## Domain

server

## Status

done

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

- [x] A clean stop closes the open window through SERVER-091's `closeWindow`,
      registered on the existing disposer chain (`app.ts`, `registerDisposer`).
      The last editing session's commit carries the editing-session subject rather
      than the last save's
- [x] The stop path **awaits** the close. A disposer that fires and returns before
      git finishes is the same as not having one
- [x] On boot, uncommitted changes under the workspace's document roots are
      committed as a single recovery commit whose subject says it is recovering
      changes left uncommitted by a previous run **and how many documents it
      holds**
- [x] The recovery commit carries **no acting party**: no `Corpus-Actor` trailer,
      and an author that is neither `user` nor `agent`. `git log --author=user`
      and `--author=agent` must both fail to match it. Assert both directions
- [x] It is **scoped to the workspace's own document roots** and never sweeps up
      unrelated files an operator left dirty. Prove it: leave a dirty file outside
      the roots, boot, confirm it is untouched and unstaged
- [x] A boot with nothing to recover **commits nothing and says nothing** — no
      empty commit, no log line, no cost. This is every ordinary boot
- [x] The recovery commit opens no window: the first save after boot makes a
      fresh commit rather than amending the recovery
- [x] A recovery that git itself refuses leaves the changes on disk and logs
      loudly (§14), exactly as a refused auto-commit does. It must not prevent the
      server from starting — a workspace that cannot commit is still a workspace
      you can read
- [x] The index is left clean on every path that does not land a commit, matching
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

**Model: opus** (claude-opus-5[1m]). All git writing done in a scratch workspace at
`/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/ws2`, port **8791** — never 8765
or 5173. Tool driven from the built CLI (`apps/cli/dist/bin/corpus.js`) after
`npm run build`.

### 1. `corpus init` then first boot — no recovery commit, no log line

```
$ corpus init --port 8791
$ corpus server start
corpus 0.4.0 listening on http://127.0.0.1:8791 (pid 42651)
$ git log --format='%h %an %s'
89cea2a user workspace: initialize corpus workspace by user
$ grep -ci recover .corpus/server.log
0
```

The tree is clean after `init`, so recovery answered `clean` off one `git status`
and said nothing. A fresh workspace's first boot is not marked by a recovery
commit.

### 2. Edit, clean stop — the editing-session subject, and the acknowledgment follows the rewrite

```
$ corpus doc create --type note --title "Recovery notes"   → doc_nowfbx2p
$ corpus doc edit doc_nowfbx2p --file …   (twice)
$ git log --format='%h %an %s' | head -1
4df3b0b user doc edit: Recovery notes (doc_nowfbx2p) by user      ← the window's last save
$ corpus server stop
$ git log --format='%h %an %s' | head -1
a1a9576 user editing session: 1 document by user                  ← relabelled by the clean stop
$ git log -1 --format=%B
editing session: 1 document by user

Corpus-Doc: doc_nowfbx2p
Corpus-Actor: user
$ cat .corpus/queue/pending/evt_*.json | grep '"to"'
    "to": "a1a957641830c1293851d8a2aa1cb45c9eb777e2"   ← the post-rewrite sha
```

**Pre-fix reproduction (first workspace, `ws-094`):** with the close registered
*only* as a disposer, the same sequence left `doc edit: Recovery notes …` as the
subject and enqueued `"to": "f73c6e1…"` — the pre-rewrite sha. Cause: `close()`
runs `editSessions.close()` before the disposers, and sealing a session calls
`endSquashSession`, which forgets the window; the disposer then had nothing left
to name. Fixed by calling the same close once at the top of `close()`, ahead of
the acknowledgments, so SERVER-093's `onWindowRewritten` → `observeRewrite` can
carry the session onto the new sha. The disposer is kept as the backstop for a
window opened by a request still in flight (it runs after the socket is shut).

### 3. `kill -9`, out-of-band writes while down, restart — one recovery commit

```
$ corpus server start; corpus doc edit doc_nowfbx2p --file …
$ kill -9 46322
$ git status --porcelain     → (empty)
$ git log --format='%h %an %s' | head -1
6d8e940 user doc edit: Recovery notes (doc_nowfbx2p) by user
```

Confirms the issue's premise concretely: **an unclean stop stranded no work** —
the window's content was already in git, only its boundary and subject were lost.
Then, with the server down:

```
$ …write data/docs/inbox/written-while-down.md
$ …append to data/docs/inbox/recovery-notes.md
$ …write .claude/skills/scratch/{SKILL.md,helper.py}
$ …write OPERATOR-NOTES.txt                      (outside the roots)
$ corpus server start
$ git log --format='%h | %an <%ae> | %s' | head -1
4011d1e | recovery <recovery@corpus.local> | recovery: 3 documents left uncommitted by a previous run
$ git log -1 --format=%B
recovery: 3 documents left uncommitted by a previous run
                                                  ← no Corpus-Actor trailer
$ git show --name-only --format= HEAD
.claude/skills/scratch/SKILL.md
.claude/skills/scratch/helper.py
data/docs/inbox/recovery-notes.md
data/docs/inbox/written-while-down.md
$ git log --author=user  --format=%H | grep -c 4011d1e…   → 0
$ git log --author=agent --format=%H | grep -c 4011d1e…   → 0
$ grep recover .corpus/server.log
{"level":"info","msg":"recovered changes left uncommitted by a previous run",
 "sha":"4011d1e…","documents":3,"files":4}
```

Four files, **three documents** — `helper.py` is part of the skill folder and not
a document of its own. One commit, one log line, both parties' `--author` filters
miss it.

### 4. A dirty file outside the roots is untouched

```
$ git status --porcelain
?? OPERATOR-NOTES.txt          ← still unstaged, still uncommitted
```

### 5. Recovery opens no window; the next save is a fresh commit

```
$ corpus doc edit doc_nowfbx2p --file …
$ git log --format='%h | %an | %s' | head -3
0acddd6 | user     | doc edit: Recovery notes (doc_nowfbx2p) by user
4011d1e | recovery | recovery: 3 documents left uncommitted by a previous run
6d8e940 | user     | doc edit: Recovery notes (doc_nowfbx2p) by user
$ git diff --cached --name-only    → (empty)
```

### 6. Boot with a clean tree — nothing committed, nothing said

```
$ corpus server stop; git status --porcelain   → ?? OPERATOR-NOTES.txt   (outside the roots)
$ corpus server start
HEAD unchanged: YES
recovery log lines before=1 after=1
```

### 7. §14 — a refused recovery does not prevent the start

```
$ echo 'exit 1' > .git/hooks/pre-commit   (with a message on stderr)
$ …write data/docs/inbox/refused.md
$ corpus server start
$ curl -s -o /dev/null -w '%{http_code}' …/api/health   → 200
HEAD unchanged: YES        file still on disk: YES
$ git diff --cached --name-only   → (empty)          ← index clean
$ grep 'could not commit changes' .corpus/server.log
{"level":"error","msg":"could not commit changes left uncommitted by a previous run",
 "reason":"the recovery commit failed","output":"workspace policy: no"}
```

### 8. Detached HEAD — skipped, logged once, the server starts

```
$ git checkout --detach --quiet HEAD; corpus server start
HEAD unchanged: YES
{"level":"info","msg":"skipped recovering changes left uncommitted by a previous run",
 "reason":"HEAD is detached"}
```

### 9. `corpus workspace upgrade` — verified against the code, not the spec

`apps/cli/src/commands/workspace/upgrade.ts` commits what it wrote:
`commitUpgrade` → `commitPaths` (`apps/cli/src/commands/init/git.ts`), authored
via `identityFor(actor)`, and the only path that makes no commit is the one with
nothing staged (`staged.length === 0`). Exercised live with the server stopped:

```
$ rm .claude/skills/orchestrate/SKILL.md
$ corpus workspace upgrade
  deleted .claude/skills/orchestrate/SKILL.md — pass --restore to reinstall it
  wrote 0 files in commit 23d241e…
$ corpus workspace upgrade --restore
  wrote 1 file in commit cb214b7…
$ git status --porcelain   → (empty)
$ git log --format='%h | %an | %s' | head -2
cb214b7 | user | workspace: upgrade template files 0.4.0 → 0.4.0 by user
23d241e | user | workspace: upgrade template files 0.4.0 → 0.4.0 by user
```

Everything the upgrade wrote landed in a single attributed commit, tree clean, so
recovery finds nothing after an upgrade. Recovery is **not** the upgrade's commit
mechanism. Two adjacent notes, neither a defect: (a) an *operator's* own deletion
of a template file is deliberately left uncommitted by the upgrade — recovery
commits it on the next boot, which is §5-correct and leaves `--restore` working;
(b) `upgrade.ts:539` has a documented path where the commit fails and the files
stay on disk — that is §14, source #1, exactly what recovery exists for.

### 10. CLI-037 ordering — checked, no collision

`apps/cli/src/commands/server/start.ts:104` **awaits** `maintainOrWarn` and
spawns the daemon only afterwards, with an explicit comment that maintenance "is
finished by the time the daemon is spawned". Boot recovery runs inside the
daemon, in a different process, strictly after. The two cannot overlap.
Empirically the maintenance never fired in this workspace (220 loose objects
against git's `gc.auto` default of 6700), so the ordering rests on the awaited
call rather than on an observed pack; a boot with 220 loose objects and a dirty
document still produced a clean single recovery commit (`aa9cc0c`).

### 11. Deviation from the design's boot ordering, and why it is safe

The design says recovery must run "before the watcher starts and before the first
request is served". The second half is met exactly: recovery is awaited inside
`start()`, ahead of `serve()`, so no socket exists while it runs. The first half
is **not** literally met — `lifecycle.ts` calls `attachWatcher(server)` before
`server.start()`, and moving recovery earlier would mean either putting it in
`lifecycle.ts` (against the issue's own "the boot call lives in `app.ts`") or
making `createServer` async (it is deliberately a pure, synchronous function of
its config).

It is safe, on three grounds checked against the code: (a) chokidar runs with
`ignoreInitial: true`, so it emits nothing for the files already on disk at boot
— which is every file recovery is about; (b) nothing in `watcher/` commits —
`grep` over `apps/server/src` finds `withGitLock`/`.commit(` only in
`locks/service.ts`, `docs/write.ts` and `skills/rollback.ts`, and the watcher's
only git use is the read `git show HEAD:<path>` in `watcher/git-head.ts`, which
does not touch `.git/index`; (c) when SERVER-090 lands and the watcher does
commit, it will do so through the same `AutoCommitter`, and recovery already runs
inside `withGitLock` — so the two serialize rather than interleave, and whichever
runs second finds nothing.

### Checks run

- `npm run build` — clean.
- `npx vitest run apps/server/src` — **182 files, 3778 tests, all passing**
  (`VITEST_MAX_THREADS=4`).
- `npx vitest run apps/server/src/git/recovery.test.ts` — 19 tests.
- `npx vitest run apps/server/src/window-lifecycle.test.ts` — 6 tests.
- `npm run typecheck -w apps/server` — clean.
- `eslint` + `prettier --check` on every touched file — clean. (One pre-existing
  `no-unused-vars` warning on `commit.ts:420` `onWindowRewritten` belongs to
  SERVER-093's in-flight work, not to this issue.)

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (writes to a user's git history unasked — qualifies)
- [ ] Committed with `[ISSUE-ID]` prefix
