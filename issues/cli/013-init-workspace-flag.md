# [CLI-013] `corpus init` silently ignores `--workspace`; guard misses repo-like directories

## Domain

cli

## Status

done

## Priority

P1

## Model

opus — a flag-plumbing fix plus a sharpened guard, with a destructive-failure reproduction.

## Dependencies

- Depends on: CLI-002
- Blocks: —

## Spec References

- SPEC.md §2 — `corpus init`
- issues/plugins/002-todos-plugin.md — incident root cause (2026-07-29)

## Summary

Found the hard way during PLUGINS-002 (the incident scaffolded a workspace into a development git
worktree, overwrote `.gitignore`/`README.md`, and flipped the parent repo's `core.bare`): `corpus
init` takes a positional path and **silently ignores the global `--workspace` flag**, defaulting
to the current directory. A user running `corpus init --workspace ~/notes` from inside any
existing project scaffolds into that project. Additionally the "refuses a directory that already
holds a workspace" guard does not fire on a directory that merely looks like an existing project
(a git repo with files).

Fix both: (a) `--workspace` (when no positional is given) must be honored — or explicitly refused
with an error telling the user to pass the positional; silent divergence is the bug; (b) init
refuses a non-empty directory that is not already a corpus workspace unless `--force` is given,
with a message listing what it found (git repo, existing files).

**Second live occurrence (2026-07-29, CLI-014 E2E drill):** the same silent-cwd fallback
escaped into the development repo root itself — overwrote `README.md`/`.gitignore` and staged a
genesis commit's worth of files (orchestrator repaired by index reset + restore from HEAD).
Additional finding for the fix: **`CreatedPaths.unwind()` cannot repair the worst of it** —
`writeFile`/`copyFile` record a path only when `!existed`, so overwritten pre-existing files
survive the rollback. The guard fix should either snapshot-and-restore files it overwrites or
(simpler) refuse before writing anything into a non-empty non-workspace directory.

## Acceptance Criteria

- [x] `corpus init --workspace <path>` targets `<path>` (or errors clearly); never silently
      scaffolds the cwd when a target was named.
- [x] Init into a non-empty non-workspace directory requires `--force`; the refusal names the
      evidence; pre-fix destructive reproduction logged.
- [x] `docs/cli.md` regenerated; existing init tests updated.

## E2E Verification Log

**implemented on: opus** (cli-dev, 2026-07-29/30, sprint-015 stage A).

Scratch prefix: `/Users/theophanerupin/.claude/jobs/4dd0ddef/tmp/s015-cli013-8mdrNp`. **Every**
`corpus init` below shows its cwd, and no invocation ran with the repository or any subdirectory of
it as cwd (TEST-317). `/Users/theophanerupin/code/corpus/.corpus` was checked after every drill and
never existed. `8765` was never bound and never killed; ports used were `9180`–`9184`, all free
afterwards. From-source CLI: `node_modules/.bin/tsx apps/cli/src/bin/corpus.ts` (never `npx`).

### A. Pre-fix reproduction (HEAD before the fix)

**TEST-298 — `--workspace` parsed, bound, discarded. REPRODUCED.**

```
cwd=/…/s015-cli013-8mdrNp/t298-A
$ corpus init --workspace /…/t298-B --port 9180
Initialized Corpus workspace at /…/s015-cli013-8mdrNp/t298-A     ← the cwd, not $B
BEFORE  A: []                       B: []
AFTER   A: [.claude .corpus .git .gitignore data README.md]   (6 entries)
        B: []                       (0 entries)
```

**TEST-299 — the overwrite is unrecoverable. REPRODUCED.** Git repo with a committed
`README.md`/`.gitignore`, cwd = that directory, `corpus init --port 9180`:

| file         | sha256 before  | sha256 after   |
| ------------ | -------------- | -------------- |
| `README.md`  | `24ef9c15…5515` | `67130e54…a74b8` |
| `.gitignore` | `a8db1661…3879` | `60fbad57…dfceb` |
| `notes.txt`  | `b37e50ce…45fb` | `b37e50ce…45fb` (untouched) |

The run **succeeded** ("git: reused the existing repository, added the workspace commit"), so
`unwind()` was never reached. A second drill (`t299b`) forced it to run by installing a
`.git/hooks/pre-commit` that exits 1: init failed with _"the workspace's initial commit failed"_,
`unwind()` correctly removed `data/`, `.corpus/` and `.claude/` — and `README.md`/`.gitignore` kept
the template's hashes (`67130e54…`, `60fbad57…`). **Proof that rollback cannot repair an overwrite**,
which is why the fix refuses first.

**TEST-300 — the enclosing-repository escape. REPRODUCED, with a correction to the stated
mechanism.** Two shapes were drilled and they behave differently:

- _Empty subdirectory inside a repo_ (`t300`): `isRepositoryRoot` is false, `git init -b main` runs
  and creates a **nested** repository (`sub/.git` is a directory). The parent's gitdir was **not**
  reinitialized and `core.bare` stayed `false`; the observed damage is the parent reporting
  `?? sub/`. So the contract's "reinitializes the enclosing repository's gitdir" did not reproduce in
  this shape — recorded rather than asserted.
- _Linked worktree_ (`t300b`, the PLUGINS-002 shape): `.git` is a **file**, `isRepositoryRoot` is
  **true**, so init takes the `reused` branch — it overwrote `README.md`
  (`64cccb6e…` → `67130e54…`) and wrote a commit onto branch `feature` **inside the parent
  repository's object store** (worktree log 1 → 2 commits, author `user <user@corpus.local>`). This
  is the real enclosing-repository contamination, and it is the mechanism behind the incidents.

Both shapes are covered by the fix (TEST-315 and TEST-307 below).

### B/C/D. Post-fix

**TEST-313 — `--workspace` honored, cwd untouched. PASS.**

```
cwd=/…/t313-A
$ corpus init --workspace /…/t313-B --port 9181
Initialized Corpus workspace at /…/s015-cli013-8mdrNp/t313-B
AFTER A: []  (0 entries)
AFTER B: [.claude .corpus .git .gitignore data README.md]; config port 9181; data/{docs,threads}; 1 commit
```

**TEST-303 — `CORPUS_WORKSPACE` honored. PASS.** `CORPUS_WORKSPACE=$B corpus init --port 9184` from
`$A`: `$B` initialized, `$A` empty.

**TEST-302 — positional wins, loudly. PASS.**
`corpus init $B --workspace $C --port 9183` →
`warning: two targets were named; the positional /…/t302-B wins over /…/t302-C, which was ignored.`
`$C` empty; `$B` holds the workspace. Precedence is stated in the command description and therefore
in `docs/cli.md`.

**TEST-304 — no flag, no positional still targets cwd. PASS.** `index.test.ts`'s
`creates the §4 tree, the config, the template and one commit` passes unchanged.

**TEST-314 — the TEST-299 repo now refuses, harmlessly. PASS.**

```
cwd=/…/t314-project
$ corpus init --port 9181
corpus: refusing to initialize /…/t314-project — it is a git repository (.git/); it already holds
4 entries (.git, .gitignore, README.md, notes.txt).
  Initialize an empty or not-yet-existing directory, or pass --force to write into this one anyway.
  --force cannot undo an overwrite: the template's README.md and .gitignore replace any of the same name.
EXIT CODE: 2
```

sha256 after = sha256 before for **all three** files (`24ef9c15…`, `a8db1661…`, `b37e50ce…`); HEAD
unchanged; `git status --porcelain` empty; no `.corpus`. `--json` emits
`{"error":{"code":"usage_error","message":"refusing to initialize …"}}`, exit 2 (Adjudication 6 — no
new exit code).

**TEST-305/306 — evidence named, and the two kinds are distinguishable. PASS.** The message above
carries `it is a git repository (.git/)` **and** `it already holds 4 entries (…)` as separate
clauses; a plain directory of files yields only the second.

**TEST-307 — linked worktree caught. PASS.**
`refusing to initialize /…/t315-wt — it is a linked git worktree of another repository (.git file);
it already holds 2 entries (.git, parent.txt).` Worktree HEAD unchanged, still 1 commit,
`parent.txt` sha unchanged. This is the TEST-300b damage, now prevented.

**TEST-315/308 — empty subdirectory inside a repo refused. PASS.**
`refusing to initialize /…/t315-parent/sub — it sits inside the git repository at /…/t315-parent.`
Parent before/after identical: `core.bare=false`, `HEAD=21ac1f47…`, `status --porcelain` empty.
`sub/` listing empty. The nested-repo escape cannot happen.

**TEST-309 — refusal precedes the first write. PASS, two ways.** (a) Every refusal drill above shows
an identical `readdirSync` listing and identical content hashes before and after. (b) Unit test
`refuses before the first write — git is never even probed` injects a `GitRunner` that records every
call and rejects; the assertion is `expect(invocations).toEqual([])`. Since `requireGit` runs before
`created.mkdir(target)` (`index.ts`), git never being invoked pins the guard strictly ahead of the
first write.

**TEST-310 — the `unwind()` gap is pinned, not assumed. PASS.** New `scaffold.test.ts` case
`does NOT restore a file it overwrote — it only records the damage` writes over a pre-existing
`README.md` through both `writeFile` and `copyFile`, calls `unwind()`, and asserts the original
content is **gone**. Implemented as recording, not snapshot-and-restore, so the test is not inverted:
`CreatedPaths.overwritten` exists solely so `--force` can report what it destroyed.

**TEST-311 — `--force` proceeds and says what it did. PASS.**

```
cwd=/…/t311-force
$ corpus init --port 9181 --force
warning: --force: initializing /…/t311-force anyway — it is a git repository (.git/); it already
holds 3 entries (.git, README.md, notes.txt).
warning: overwrote 1 pre-existing file, which cannot be restored: README.md.
Initialized Corpus workspace at /…/t311-force
  git: reused the existing repository, added the workspace commit
EXIT 0 — notes.txt preserved ("keep me"), branch trunk, 2 commits
```

**TEST-312 — `--force` does not override the existing-workspace guard. PASS.** Re-running with
`--force` on that workspace: `is already a Corpus workspace: .corpus/config.json already exists.` /
`--force does not override this: a live workspace is never replaced.` Exit 2. Unit siblings cover
both the config and the non-empty-`data/` shapes.

**TEST-316 — the `--workspace`-created workspace really works. PASS.**

```
$ corpus --workspace /…/t313-B server start   → listening on http://127.0.0.1:9181 (pid 95013)
$ corpus --workspace /…/t313-B server status  → running — pid 95013 on :9181, up 2s
$ corpus --workspace /…/t313-B health         → ok — corpus 0.0.0, workspace /…/t313-B
$ corpus --workspace /…/t313-B doc create --title "Guard proof" --type note
                                              → created doc_d7uggq5d — data/docs/inbox/guard-proof.md
$ git -C /…/t313-B log --format='%an <%ae>|%s'
  user <user@corpus.local>|doc create: Guard proof (doc_d7uggq5d) by user
  user <user@corpus.local>|workspace: initialize corpus workspace by user
$ corpus --workspace /…/t313-B server stop    → stopped (pid 95013);  9181 free afterwards
```

### E. Regression, docs, prose

**TEST-318 — all three "there is no `--force`" sites updated.** Module comment
(`index.ts`), the existing-workspace hint, and the published command description all read truthfully;
the third is visible in `docs/cli.md`.

**TEST-319 — `docs/cli.md` regenerated.** `npm run docs:cli -w apps/cli` run; the entry documents
`--force`, the four-way precedence, and the refusal. `prettier --check docs/cli.md` clean;
`apps/cli/src/docs/generate.test.ts` (16 tests, incl. _matches the committed docs/cli.md_) green; a
second regeneration is a byte-for-byte no-op against a snapshot.
`scripts/check-generated-artifacts.ts` is **red, as expected** (Adjudication 12 — the agent cannot
commit), verbatim:

```
✗ API contract is stale: packages/contract/openapi.json, packages/contract/src/client/schema.generated.ts
  Fix: npm run generate -w packages/contract && git add packages/contract/openapi.json packages/contract/src/client/schema.generated.ts
✗ CLI reference is stale: docs/cli.md
  Fix: npm run docs:cli -w apps/cli && git add docs/cli.md
 docs/cli.md | 27 ++++++++++++++++++++-------
 1 file changed, 20 insertions(+), 7 deletions(-)
```

The **contract** half is not this issue's: `packages/contract` carries uncommitted work from another
concurrent session. `git diff packages/contract` from cli-dev is empty of cli-dev edits (TEST-367),
and `git diff SPEC.md` / `git diff assets/workspace/` are empty (TEST-366). The orchestrator's
post-commit run is authoritative.

**TEST-320 — registry still valid.** `collectRegistryProblems` empty; init declares `port` and
`force` and **no** flag named `workspace` (it reads `context.flags.string("workspace")`, which
`mergedFlags` populates); `requiresWorkspace === false` unchanged.
`apps/cli/src/registry/validate.test.ts` 25/25 green.

**TEST-321 — the blessed test resolved, not deleted.** `index.test.ts`'s
`reuses an existing repository instead of re-initializing it` → renamed `…, under --force`, still
asserting `repository === "reused"`, two commits, branch `trunk`. A **new** sibling,
`refuses that same repository without --force, touching nothing`, pins the refusal (listing,
`notes.txt` content and HEAD all unchanged, no `.corpus`).

**TEST-322 — pinned tests survive.** `fails before creating anything when git is missing`,
`fails loudly on an occupied --port, leaving the target empty` and
`unwinds everything it created when the commit fails` pass **unchanged** (their targets are empty
temp dirs outside any repository). `warns when the new workspace nests inside an existing one` passes
unchanged and gained an explicit sibling asserting Adjudication 8 — an enclosing **Corpus workspace**
is deliberately excluded from the repository evidence, so nesting stays a warning.
`server/lifecycle.test.ts` and `workspace/upgrade.test.ts` confirmed unaffected (91/91 green).
`existingWorkspaceReason`'s empty-directory cases gained companions in the new
`unrelatedContentReasons` block. **No test was deleted and none was inverted.**

**TEST-365 — no collision with SERVER-030.** `tracks the queue skeleton and the install manifest, and
nothing else under .corpus` is untouched by this issue; whoever lands second reconciles.

**Test results.** `apps/cli/src/commands/init` 88/88 green (5 files).
`npm test -w apps/cli` — **718/718 green, 62 files** (the one workspace-scoped run of the session).
`scripts/workspace-template.test.ts` 91/91 green with `CLI_COMMANDS_PENDING_CLI_006` still `[]`.
`npm run typecheck -w apps/cli` clean; `eslint apps/cli/src/commands/init apps/cli/src/docs` — no
issues; `prettier --check` clean. No lint rule was disabled and no suppression added.

**TEST-370 — machine left clean.** `9180`–`9184` free (`lsof -nP -iTCP:<port> -sTCP:LISTEN`); no
orphaned vitest workers; the only process started (server pid 95013) was stopped by
`corpus server stop`. `8765`: nothing listening before or after; never bound, never killed.

### Rider: CONTRACT-021 consumption (bundled for this commit)

Not part of CLI-013's scope — folded in at the coordinator's request because CONTRACT-021's
`deferred` queue status was already in the working tree and had two silent `apps/cli` consumers with
no compile signal. Both are fixed by **deriving from the contract** rather than re-listing:

- `scaffold.ts` carried its own `QUEUE_STATUSES` literal, so a fresh workspace would have been
  scaffolded without `.corpus/queue/deferred/`. The local constant is deleted; the module now reads
  `QUEUE_EVENT_STATUSES` from `@corpus/contract`. `WORKSPACE_DIRECTORIES` and the `.gitkeep` loop
  follow it, so the next status is created the day it is declared.
- `queue/control.ts`'s `reportStatus` enumerated the counts by hand and omitted `deferred`. It now
  prints it in the contract's lifecycle order — between the live and the terminal states, never
  beside `failed` — and the published description and `--json` example say what a non-zero
  `deferred` means (waiting, not broken). `docs/cli.md` regenerated.

Tests: `index.test.ts`'s two queue-skeleton assertions now derive from `QUEUE_EVENT_STATUSES`
instead of listing five strings (this is **TEST-365**, reconciled here rather than by SERVER-030);
new `scaffold.test.ts` case `creates one queue directory per status the contract declares, deferred
included`; `control.test.ts`'s fixture gains `deferred: 4`, its exact-output assertion is updated,
and a new case asserts every contract status appears in the line. `npm test -w apps/cli`:
**720/720 green, 62 files.** Typecheck, eslint and prettier clean.

E2E on a fresh workspace (`corpus init … --port 9182`, cwd outside the repo): `.corpus/queue/` holds
`abandoned deferred failed in-progress pending processed`, and all six `.gitkeep`s are tracked by the
initial commit.

**🔴 ESCALATION — CONTRACT-021 broke `apps/server`'s queue counts (P0, not this domain).**
`corpus queue status` against a real server printed `deferred undefined`, which led to
`apps/server/src/queue/service.ts:362-371`. `status()` maps over `QUEUE_EVENT_STATUSES` and then
destructures the result **positionally**:

```ts
const [pending = 0, inProgress = 0, processed = 0, failed = 0, abandoned = 0] = counts;
return { halted, pending, inProgress, processed, failed, abandoned };
```

`deferred` was inserted at index 2, so every count after `in-progress` is now shifted by one and
`abandoned` is dropped. Demonstrated on a scratch workspace seeded with 1/2/3/4/5/6 event files in
`pending`/`in-progress`/`deferred`/`processed`/`failed`/`abandoned`:

```
$ corpus --workspace … queue status --json
{"halted":false,"pending":1,"inProgress":0,"processed":3,"failed":4,"abandoned":5}
   expected: pending 1, inProgress 2, deferred 3, processed 4, failed 5, abandoned 6
```

`processed` reports `deferred`'s count, `failed` reports `processed`'s, `abandoned` reports
`failed`'s, the real `abandoned` count is lost, and `deferred` is absent from the response entirely —
which is why the CLI renders `undefined`. (The `inProgress: 0` reading is a separate detail of how
`listIds("in-progress")` treats unclaimed files and does not change the conclusion.)

This is `apps/server`, owned by server-dev, so **it was not fixed here**. The CLI was deliberately
left faithful to the contract rather than defended with `?? 0`: a fallback would have hidden exactly
this bug, which is the failure mode the derive-don't-re-list change exists to prevent. Sequence a
server fix (destructure by name, or build the object from the enum) before this lands, or the
`deferred undefined` line ships.

**TEST-368/369 — no state-changing git in the dev repo.** Only `git status`, `git diff`, `git log`
and `git rev-parse` were run there. All `git init` / `git commit` / `git worktree add` calls were
inside scratch fixtures. Repo `git status --porcelain` for this issue's surface:
`apps/cli/src/commands/init/{git,git.test,index,index.test,scaffold,scaffold.test}.ts`,
`docs/cli.md`, `issues/cli/013-init-workspace-flag.md` — nothing else, no `.corpus/`, no scaffolded
`data/`, no clobbered `README.md`/`.gitignore`.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
