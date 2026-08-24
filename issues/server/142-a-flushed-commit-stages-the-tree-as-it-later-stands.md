# [SERVER-142] An out-of-band commit stages the tree as it later stands, not as it was observed

## Domain
server

## Status
done

## Priority
P1 (important)

## Model
fable

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- SPEC.md Section 4 — git auto-commit, and the audit trail carried by the commit
  author
- SPEC.md Section 7 — the agent's writes and what attributes them

## Summary

**Escalated by SERVER-140's implementer against the machinery its own test
protects, rather than against someone else's code.** Not fixed there on purpose:
the cheap patch is wrong in exactly the case that matters.

`collectDocument` records an out-of-band commit for **every** event it processes,
duplicates included, and `flush()` hands that commit to a promise chain. The
commit's `git add` therefore stages the working tree **as it stands when the
commit runs**, not as it stood when the flush observed it.

So if the server writes the same path while such a commit is waiting on the git
lock, the person's commit carries the **server's** bytes under the `user`
author. That is the mirror image of the rule SERVER-140's test exists to protect,
and §4's whole audit trail is the commit author.

`selfWrites.record` cannot prevent it. The observation predates the record.

## Why it is filed rather than fixed

The obvious cheap patch — skip the commit when the registry says the bytes are
the server's — is wrong when the **first** flush's commit is the stale one,
because skipping then loses the person's commit entirely. A lost commit is worse
than a misattributed one: one is a wrong label on a recorded change, the other is
an unrecorded change.

Closing this needs one of two designs, and choosing between them is a decision
about the watcher/committer boundary:

1. **Stage a snapshot of the observed bytes.** The commit records what the flush
   saw, whatever the tree says by the time the lock is free. Correct by
   construction, and it means the committer stops using the working tree as its
   own input.
2. **Share a lock between the watcher's commit chain and `applyOperations`.** The
   server cannot write a path while a person's commit over that path is
   outstanding. Simpler to state, and it puts a server write behind a lock held
   by a filesystem event, which is a latency question nobody has measured.

## Why it is not in v0.20.0

v0.20.0 is four sentences already — the tree, the reader's values, the reader's
width, and what the agent pays for the CLI. This is a fifth, it needs a design
decision rather than an implementation, and no user has reported it. Debt that
merely exists is not a reason to widen a release.

It is **P1 rather than P2** because the thing it corrupts is the audit trail, and
an audit trail is only worth what its worst entry is worth.

## Decided by the user, 2026-08-23 — snapshot the observed bytes

**Chosen: design 1.** The commit records what the flush observed, whatever the
working tree holds by the time the git lock frees.

**Why it won.** It is correct by construction rather than by timing, and it ends
the committer's use of the live working tree as its own input — which is the
actual defect, not a symptom of it. No ordering of writes can defeat it.

**Rejected: share a lock between the watcher's commit chain and
`applyOperations`.** Simpler to state and smaller to build, and it puts a server
write behind a lock held by a filesystem event. Nobody has measured what that
costs in latency, and the server is the sole writer for every surface in the
product — a lock there is felt everywhere.

**Rejected: leave it.** The user declined. What it corrupts is the audit trail,
and an audit trail is worth what its worst entry is worth.

**Do not reach for the cheap patch.** Skipping the commit when the registry says
the bytes are the server's loses the person's commit entirely when the first
flush's commit is the stale one. A lost commit is worse than a misattributed
one.

## Acceptance Criteria

- [x] A person's commit records the bytes the flush observed, whatever the tree
      holds when the commit runs.
- [x] A server write racing a person's outstanding commit changes neither the
      person's commit's contents nor its author.
- [x] No path through the fix can drop a person's commit. A reproduction covering
      the first-flush case exists and is asserted.
- [x] The chosen design is written down with the one rejected, and why it lost.

## Technical Design

### Files to Create/Modify
- `apps/server/src/watcher/` — `collectDocument`, `flush`, and the committer
- `apps/server/src/git/commit.ts` — if design 1 is chosen, the staging path
- the tests beside each

### Key Implementation Details

Read SERVER-140's issue file first. Its "The finding" section carries the
reasoning that produced this issue, and its test is the one that must keep
passing.

`selfWrites.record` is not the mechanism here and cannot be made into one. Do not
reach for it.

### Edge Cases
- The first flush's commit being the stale one — the case that rules out the
  cheap patch.
- Several out-of-band commits queued over the same path.
- A commit whose observed bytes no longer exist on disk at all.

## Testing Strategy

A test that writes a path from the server while a person's commit over the same
path is outstanding, and asserts both the contents and the author of the
resulting commit. It must be able to fail: remove the fix and watch the server's
bytes land under `user`.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Start a real server on a scratch workspace
2. Edit a document out of band and hold the git lock
3. Have the server write the same path before the lock frees
4. Expected: the person's commit carries the person's bytes
5. Actual: it carries the server's, under the `user` author

### Verification Steps
1. Repeat with the fix, and inspect the commit with `git show`
2. Repeat the first-flush case and confirm no commit is lost

## E2E Verification Log

**Model: Opus 5 (1M context).**

### Reproduction (bugs only)

Two reproductions, both before any source change.

**1. Integration, deterministic** — `commit-out-of-band.test.ts`, real chokidar,
real git, the server's real `AutoCommitter` and the real watcher. The
interleaving is **decided, not timed**: `heldOutOfBandCommitter` holds the batch
at the committer's entry, which is exactly where a commit waiting on the git lock
sits. Three new tests, all three red:

```
× keeps the person's bytes and author when the server writes the path first   569ms
    AssertionError: expected '…Rate is 6.1%.\n\nIts.\n' to contain 'Mine.'
    → the commit is authored `user` and holds the *server's* paragraph
× keeps the person's bytes when the racing commit folds into an open window   1034ms
    same, on the amend path
× commits observed bytes that are no longer on disk when the commit runs       539ms
    fatal: path 'data/docs/mortgage.md' does not exist in 'HEAD'
    → the person's edit became a deletion carrying the subject `doc edit:`
```

**2. Real server, real workspace** — `corpus init` at
`scratchpad/ws142`, `corpus server start` on port 8791, two notes. The window is
widened with a one-shot `pre-commit` hook that sleeps 3 s (SPEC §11 honors
hooks), so the watcher's *first* out-of-band commit holds the git lock and the
second — over the document the server is about to write — is queued behind it
with its bytes already observed. Then `PUT /api/docs/{id}` with
`x-corpus-author: agent`.

```
--- git log ---
cee6bf8 agent | doc edit: Mortgage (doc_ccogoxhj) by agent
500d1aa user  | editing session: 1 document by user      ← holds document A only
75a5859 agent | editing session: 1 document by agent

--- every revision of the document since ---
cee6bf87 agent | ['Server B PREFIX4.']
75a58590 agent | []

--- "Person B PREFIX4." searched for in every commit in the repository ---
(nothing)
```

**The person's paragraph is in no commit anywhere.** The watcher had observed and
projected it — the `PUT`'s §7 key was read after that edit and was accepted — and
then its commit staged the working tree, which by then held the server's bytes,
so git reported nothing to commit. That is the worse of the two faces the issue
names: not a wrong label on a recorded change, an unrecorded change.

### The change

**Design 1, as signed: the commit stages a snapshot of the observed bytes.**

- `git/git.ts` — `GitExecOptions.stdin`, so `git hash-object` can be handed
  bytes. An `error` listener on the stream, because git can exit before reading
  it and an unhandled `EPIPE` would take the process down over a refused commit.
- `git/commit.ts` — `CommitRequest.snapshot`, a `path → Buffer | null` map. A
  request that carries one is staged with `hash-object` + `update-index` into a
  **scratch index** seeded from `HEAD`, and committed from it: `--only` rebuilds
  its tree from the working tree, which is the one input this refuses to use.
  Modes are read back from that seeded index, so a tracked executable stays
  executable. Afterwards the operator's real index is reset to the commit just
  made, and the working tree is never touched.
- Folding is **kept**, and the `forget` path's "a scratch commit never folds" was
  narrowed to it. §4 makes an out-of-band edit an ordinary save, and a `mv`
  reaching git as `R100` depends on the add folding into the unlink's commit.
- `watcher/reconcile-out-of-band.ts` returns the text it wrote;
  `watcher/watcher.ts` snapshots **that**, so the remapped `anchors` block and
  the person's own edit still land as the one change they are.
- `OutOfBandChange.snapshot` is **required**, so no path through the watcher can
  hand git a change without the bytes it is a change to.

`selfWrites` was not touched. It cannot help here and was not asked to.

### The accepted consequence, said out loud

Where the server's own commit for the path lands *between* the observation and
the person's commit, the person's commit records the observation and therefore
sits **after** it in the log, with the newer bytes left on disk as an ordinary
unstaged change. Measured on the real server, and it converges: the next write to
that document commits them, `git status` goes clean, `db doctor` reports clean.
That is what "the commit records what the flush observed, whatever the working
tree holds by the time the git lock frees" means, and it is the alternative to
losing the commit.

### Post-Implementation Verification

**Same real-server race, same script, after restarting the server:**

```
--- git log ---
817875b user  | doc edit: Mortgage (doc_ccogoxhj) by user     ← the person's bytes
588ef4b agent | editing session: 1 document by agent           ← the server's bytes
315fcb5 user  | editing session: 1 document by user

817875b5 user  | ['Person B POSTFIX1.']
588ef4b8 agent | ['Server B POSTFIX1.']
--- worktree --- Server B POSTFIX1.      --- status --- M data/docs/inbox/mortgage.md
```

Both changes recorded, each under its own author. Convergence, one ordinary
`PUT` later: `git status -- data` empty, `db doctor` → `projection is clean —
14 documents from 14 files (3ms)`.

**The ordinary out-of-band paths, on the same real server, hook removed:**

```
two edits + a rename, one window:
  b7e7c30 user | doc edit: Ledger (doc_hve5bkng) by user
  git show --name-status -M HEAD →  R100  ledger.md → ledger-renamed.md
                                    M     mortgage.md
  git show HEAD:…/mortgage.md → "Plain out-of-band edit, twice."
  git status --porcelain -- data → (empty)

deletion, after the window aged out:
  979b916 user | doc delete: Ledger (doc_hve5bkng) by user
  git show HEAD~1:…/ledger-renamed.md → recoverable
  db doctor → projection is clean — 13 documents from 13 files (7ms)
```

Folding, rename detection as `R100`, deletion recoverability and a clean index
all survive the change.

### Falsification — every new test broken on purpose, each restored after

| mutation | result |
| --- | --- |
| `snapshot: change.snapshot` dropped from `createOutOfBandCommitter` | 4 red — the three integration tests + the request-shape assertion |
| snapshot staging skipped, `git add -A` used instead | 4 red of the 8 unit tests |
| mode hardcoded to `100644` | `keeps the mode a tracked file already had` red |
| `snapshotStaging`'s "described only" filter dropped | `leaves a path the snapshot does not describe entirely alone` red |
| the commit run against the operator's index instead of the scratch one | `never swallows the operator's staged work` red |
| `applySnapshot`'s refusal ignored | `reports a refused staging as a failure` red |

All eleven new tests are falsifiable. None could not be made to fail.

### Suite

```
VITEST_MAX_THREADS=4 vitest run apps/server --reporter=verbose
  Test Files  202 passed (202)
       Tests  4577 passed (4577)          exit 0
```

SERVER-140's `never lets a later mutation carry the person's bytes under its own
author` is in that run, green and untouched.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
