# [SERVER-089] `rollback.test.ts` fails in CI at a git object the fixture should have

> **Resolved.** Cause: git ≥ 2.29 spawns `git maintenance run --auto --detach`
> after **every** commit, and on the runner's git 2.54 that detached process
> starts repacking a fresh repository at the **tenth** commit — concurrently
> with the commits after it and the `git log` beside it — which permanently
> corrupts the object store in ~40% of runs. Fix: fixture repositories are
> created with `maintenance.auto=false`. Not auto-gc; `gc.auto=0` was measured
> **not** to fix it.

## Domain

server

## Status

done

## Priority

P0 — blocks PR #41

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —
- Related: UI-105, `todos.spec.ts` (the other load-sensitive failures)

## Spec References

- Not a spec behaviour — a test-harness defect that makes CI unreliable.

## Summary

`CI / validate` failed on PR #41's head `e277895a` in
`apps/server/src/skills/rollback.test.ts` — "refuses when the walk found
nothing" — with git refusing to walk its own history:

```
Error: Command failed: git log --format=%H -- .claude/skills/orchestrate/SKILL.md
error: Could not read 61b15cb4bf25144b8fb17037f9ffdf947e7f1d63
fatal: cannot simplify commit 9c1da6db995baa89f550c4f46b29fdefcc1855de
       (because of 61b15cb4bf25144b8fb17037f9ffdf947e7f1d63)
```

`git log -- <path>` needs a commit's parents to decide whether the path changed,
so a parent missing from the object store fails the walk. The same suite passed
on the commit before and after; it is not a defect in the branch.

## Second failure: the auto-gc hypothesis is wrong

It recurred on the next head (`0ab5a223`), and the recurrence falsifies the
guess below.

**`git log` printed exactly 31 shas before failing in both runs** — different
commit shas each time, the same count. A concurrent prune would not stop at the
same depth twice. The failure is **deterministic**, not a race, so it is not
auto-gc and it is not load.

What that points at instead: the walk really does have ~31 readable commits and
then a parent that is not in the object store. Either the fixture's repository is
not the fifty-two-commit repository the test believes it built, or the `git log`
is running somewhere other than where the commits went. Worth checking first:
whether `ws.git` and the loop's commits share a working directory on CI, whether
anything in the CI checkout (`actions/checkout` defaults to `fetch-depth: 1`)
reaches the fixture, and whether `sanitizeGitEnv()` covers every git variable the
runner sets — a leaked `GIT_DIR`, `GIT_OBJECT_DIRECTORY` or
`GIT_ALTERNATE_OBJECT_DIRECTORIES` would produce exactly this shape.

The count is the strongest clue in the failure and should be the first thing
explained: **why 31?**

## The first diagnosis, kept for the record — and disproved

`apps/server/src/docs/write-fixture.ts:124` runs `git init` and sets `user.name`
and `user.email`. **It does not disable auto-gc.** This test then makes
**fifty-two commits in a tight loop** (`REVISION_SEARCH_LIMIT + 1`), each its own
process, and immediately runs `git log` over the result.

`git gc --auto` fires from an ordinary git command once enough loose objects
accumulate, and it prunes in the background. Fifty-two rapid commits on a loaded
shared runner is exactly the shape that trips it, and a `git log` racing a
concurrent prune is exactly this error.

**Not proven**, and the issue should prove it before fixing: the run's log does
not show a `gc` invocation, and the shas in the message have not been traced to
the fixture's own history rather than to something inherited. Reproduce it before
changing anything — a fix that merely makes the symptom rarer is worse than the
symptom, because the next occurrence will be read as "the known flake".

## Acceptance Criteria

- [x] **Explain the 31.** — explained by falsifying it: the depth is **not**
      deterministic. Measured under git 2.54 it lands anywhere in 1–35
      (observed 1, 3, 4, 6, 9, 9, 9, 14, 15, 15, 18, 21, 28, 29, 30, 30, 31,
      31, 32, 32, 32, 33, 33, 33, 33, 35), clustering in the high twenties and
      low thirties — 10 of 26 observed failures fell in 28–35. Two CI runs
      landing on 31 is the mode of a broad distribution, not a fingerprint
- [x] The failure is **reproduced** — 26 corrupt repositories in 65 runs of the
      fixture's exact git command sequence under git 2.54 on Linux, error text
      identical to CI's — and the cause identified before any fix
- [x] Auto-gc is **not** the cause and `gc.auto=0` is **not** the fix: measured
      9 of 25 runs still corrupt with it set. The setting that fixes it is
      `maintenance.auto=false`, and the reason is written at the point of the
      config (`git/maintenance.ts`), including why `gc.auto=0` is there and why
      it must not be mistaken for the fix
- [x] Every repository-creating fixture in `apps/server` now carries it, not
      just the one that failed — the trigger is **ten commits**, not fifty-two
- [x] Re-scoped plainly: the cause is git ≥ 2.29's post-commit
      `git maintenance run --auto --detach`, which on git 2.54 begins repacking
      a fresh repository at the tenth commit
- [x] The bound is examined and **deliberately kept at fifty-one commits** —
      see "The bound" below

## Technical Design

### Files to Create/Modify

- `apps/server/src/git/maintenance.ts` (new) — the settings and why, exported
  from `git/index.ts` beside `sanitizeGitEnv`.
- `apps/server/src/git/maintenance.test.ts` (new) — the regression guard.
- Every repository-creating fixture in `apps/server`: `docs/write-fixture.ts`,
  `git/commit.test.ts`, `git/show.test.ts`, `projection/unindexable.test.ts`,
  `watcher/watcher.test.ts`, `watcher/git-head.test.ts`,
  `watcher/reconcile-out-of-band.test.ts`.
- `skills/rollback.test.ts` is **unchanged**.

### The bound

Kept at `REVISION_SEARCH_LIMIT + 1`. Lowering it was the wrong lever twice
over: the trigger is ten commits, so a smaller loop would still have crossed it
— it would only have made the symptom rarer, which this issue forbids — and the
bound is `REVISION_SEARCH_LIMIT`, a shipped constant, so a test that proved a
smaller one would stop proving the behaviour operators actually meet. It is
also not expensive: fifty-two processes, ~1 s, and the comment at the loop
already explains why only the first iteration needs an `add`.

### Notes

- `sanitizeGitEnv()` is the environment half; `disableAutoMaintenance()` is the
  repository half. Both are exported from `apps/server/src/git/index.ts`.
- The other known load-sensitive failures — `soft-wrap.spec.ts:193` (UI-105) and
  `todos.spec.ts` — are caret/selection races and are **not** this. Do not fold
  them in. (But see "Escalated" below: the e2e suite drives a real `corpus init`
  workspace whose repository has no such setting.)

## Testing Strategy

The corruption itself is a race — 8 of 25 runs under git 2.54, 0 of 25 under
git 2.37 — so an assertion about a broken repository would be a coin flip on
one machine and vacuously green on the other. The guard is written against the
mechanism instead, which is deterministic on every git since 2.29 and visible
from a single commit: under `GIT_TRACE`, a commit in a fixture repository must
spawn no `git maintenance run --auto` child. A companion test asserts the same
of a control repository built without the settings **in the positive** — so if
a future git stops spawning the dispatcher, or renames it, the control fails
first and says the guard has gone blind, rather than the guard passing for the
wrong reason. A third test takes a fixture repository fifteen commits past the
trigger and asserts the object store still holds only loose objects, `git fsck`
is silent, and the history is whole.

## E2E Verification Log

**Model: Opus 5 (1M context).** Bug — pre-fix reproduction first, no code
touched until the cause was measured.

### 1. What the CI logs actually say

`gh api .../jobs/{93352940843,93351070077}/logs`. Both failures carry the full
`execFileSync` payload, so the stdout is recoverable rather than inferred:

- Both printed **exactly 31 shas** — confirmed by counting the serialized
  `stdout`, not by reading the console.
- The runner's git is **2.54.0** (`git version` in the post-job cleanup).
  Local git here is **2.37.3** — the whole gap.
- Same error text both times, different shas.

### 2. Pre-fix reproduction (this is where the "31" dies)

Local git never reproduces it, so the reproduction was built by matching the
runner's git rather than its checkout: `alpine/git:latest` is git **2.54.0**,
the runner's exact version, on Linux. The script is the fixture's and the
test's git command sequence verbatim — `git init --initial-branch=main`,
identity, `.gitignore` seed commit, then 51 × (`write` + `git commit -q -m … --
<path>`), then `git log --format=%H -- <path>`.

First run of 40 iterations: **18 failed**, identical error shape —

```
error: Could not read 87babb5247e5c1e875316f751697c45272e6715b
fatal: cannot simplify commit 98394088bcfce075e54f009e3aa111f88e92a13d (because of 87babb…)
```

— at depths 3, 9, 9, 9, 15, 28, 30, 30, **31**, 32, 33 … One iteration failed
differently and more alarmingly, inside a `git commit`:
`error: .claude/…/SKILL.md: failed to insert into database` /
`fatal: updating files failed`.

**The 31 is not deterministic.** Across 65 baseline iterations the depth ranged
1–35; 31 is simply near the mode. Two CI samples agreeing was chance, and the
hypothesis they were used to build ("the fixture's repository is not the
repository the test believes it built") is false — the repository *is* the
right one, it is being destroyed while the test runs.

### 3. The damage is real, and permanent

Re-running `git log` three seconds later on a failed repository still fails
(24 of 25 times). `git fsck` on one:

```
error: HEAD: invalid reflog entry 457266fe…
broken link from  commit d61a032c…
              to  commit 457266fe…
missing commit 457266fe…
```

`.git/objects/pack` held a multi-pack-index, two cruft packs (`.mtimes`) and
150 surviving loose objects. Nothing in the test writes packs.

### 4. Cause

`GIT_TRACE=1` over the loop: **every one of the 51 commits ends with**

```
trace: run_command: git maintenance run --auto --quiet --detach
```

A detached background process, spawned by `git commit` itself since git 2.29.
Instrumenting the loop, the first pack file appears at **commit #10 — three
runs out of three, same commit, ~70 loose objects** — and packs keep arriving
after that (15–25 by the end of a run). That repack runs concurrently with the
commits that follow it and with the `git log` beside them, and the object store
does not survive it. The auto-gc guess in this issue is wrong in two ways: the
loose-object count never comes near `gc.auto`'s 6700, and the tasks that
repack read `maintenance.<task>.auto`, not `gc.auto`.

### 5. Which setting actually fixes it — measured, not assumed

25 iterations per arm, git 2.54.0, same script:

| repository config             | corrupt runs |
| ----------------------------- | ------------ |
| none (baseline)               | **8 / 25**   |
| `gc.auto=0` only              | **9 / 25**   |
| `maintenance.auto=false` only | **0 / 25**   |
| both                          | **0 / 25**   |

`gc.auto=0` — the issue's own hypothesis — is measurably not a fix. Confirmed
independently on both gits: with only `gc.auto=0`, `GIT_TRACE` still shows
`run_command: git maintenance run --auto`; with `maintenance.auto=false`, zero
children are spawned.

### 6. Post-fix evidence

- **50 iterations under git 2.54.0 with the fixture's exact command sequence
  including the new settings: 0 failures.** Every run: 51 shas from `git log`,
  **0** pack files, `git fsck` silent. Baseline for the same script was 26
  failures in 65 runs (~40%).
- The regression guard fails without the fix **on this laptop's git 2.37**, so
  this class of bug stops being CI-only: with `disableAutoMaintenance(git)`
  removed from `write-fixture.ts`, `maintenance.test.ts` reports
  `× is never asked for by a fixture workspace's repository`; restored, all
  three tests pass in 439 ms.
- `npm run build` clean · `npm run lint` clean · `npm run typecheck` clean ·
  `prettier --check` clean on all ten touched files.
- `vitest run apps/server` — **179 files, 3702 tests, all passing**, 67.8 s.
  `skills/rollback.test.ts` included (33 tests).

### 7. Escalated to the orchestrator, not fixed here

The same git behaviour reaches **real user workspaces**. The server commits on
every mutation and reads git back immediately; `corpus init`
(`apps/cli/src/commands/init/git.ts`) sets no such config, and the e2e suite
drives exactly that — a real `corpus init` workspace on the runner's git 2.54.
Ten commits is a short session. Whether Corpus should turn off automatic
maintenance in a workspace it commits into dozens of times an hour (and, if so,
what maintains it instead) is a product decision spanning `apps/cli`, not a
fixture fix. Non-server fixtures (`apps/cli`, `scripts/`) make at most six
commits each and are below the trigger.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
