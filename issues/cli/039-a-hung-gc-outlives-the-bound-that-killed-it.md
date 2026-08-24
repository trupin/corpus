# [CLI-039] A hung `git gc` leaves children the timeout does not kill

## Domain

cli

## Status

done

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: CLI-037 (added the bound), SERVER-089 (measured the corruption)

## Spec References

- SPEC.md **§4** — "Corpus maintains the repository; git does not maintain it in
  the background", and "Maintenance never prevents a server from starting"

## Summary

Found by PR #42's review, disclosed in a code comment, and filed so the gap is
not discoverable only by reading that comment.

`runGit` bounds every git child at 120 s (CLI-037), which turns a hung `git gc`
into the failure §4 already promises to handle. But Node's `execFile` timeout
calls `child.kill()` on the **direct pid**, not the process group — and `git gc`
forks `git repack` and `git pack-objects` as its own children. So on expiry the
`gc` process dies while a repack may still be running, and `corpus server start`
then spawns the server beside it: **the concurrent-writer condition CLI-037
exists to remove**, reached through the pathological door rather than the
ordinary one.

Reaching it needs `gc` to hang past 120 s, so this is a genuine pathology-only
window, and the bound is still strictly better than hanging forever. But the
whole point of CLI-037 was that a second unsupervised writer must not exist.

## Acceptance Criteria

- [x] Reproduce: make a `gc` outlive the bound and show a `repack` child
      surviving the kill
- [x] The whole process group is signalled — chosen, and why is below
- [x] `corpus server start` still never blocks on maintenance (§4)
- [x] `apps/cli/src/commands/init/git.ts`'s disclosure comment is updated to
      describe what is true afterwards
- [x] `git-timeout.test.ts` covers the new behaviour, and keeps pinning that the
      bound itself exists

## Technical Design

### Files to Create/Modify

- `apps/cli/src/commands/init/git.ts`

### Notes

- `detached: true` plus `process.kill(-pid)` is the usual shape for signalling a
  group, but it changes how the child is reaped and how its output is collected.
  Check both rather than assuming.

## Testing Strategy

A fake `git` on `PATH` that forks a long-lived child, so the group behaviour is
observable without waiting 120 s for a real repack.

## E2E Verification Log

_Filled by the implementing agent (cli-dev, **Opus 5 (1M context)**), 2026-08-24._

### Pre-fix reproduction

A `gc` stand-in that forks a long-lived child and hangs, run under `execFile`
with the old `timeout: 1500` option:

```
$ node probe.mjs
gc pid 92563
rejected: Command failed: /tmp/cli039/fakegit killed= true signal= SIGTERM
--- after the bound expired ---
repack pid 92564
  PID STAT ARGS
92564 S    sh -c while true; do sleep 1; done
```

The direct child died on `SIGTERM`. The fork it made was **still running**, which
is the unsupervised writer CLI-037 exists to remove.

### Which of the two answers, and why

**The whole process group is signalled.** The alternative — refuse to start while
a repack is alive — was rejected on §4: "Maintenance never prevents a server from
starting". A start that waits on, or refuses because of, a wedged repack trades
the concurrent-writer failure for a worse one, and the acceptance criteria say so
outright. Signalling the group removes the second writer and leaves the start
unconditional, which is the only combination §4 allows.

### The fix, and the thing the issue asked me to check rather than assume

`detached: true` gives the child a process group of its own, so `-pid` at expiry
names git's subtree and not this process and its shell.

**`execFile` cannot detach.** It forwards a fixed subset of its options to
`spawn` — `cwd`, `env`, `gid`, `uid`, `shell`, `signal`, `windowsHide`,
`windowsVerbatimArguments` — and drops the rest. `detached` is not on the list,
and TypeScript refuses the option for exactly that reason:

```
error TS2769: Object literal may only specify known properties, and 'detached'
does not exist in type 'ExecFileOptionsWithStringEncoding'.
```

So `runGit` is `spawn`-based now, and does the collection `execFile` was doing:
buffer both streams, resolve on exit 0, and reject with an error carrying `code`,
`stdout` and `stderr` in the **shape existing callers already read** —
`gitExitCode` wants a numeric `code` (`hasStagedChanges` and two
`workspace upgrade` probes branch on `code === 1`), `gitFailure` wants `stderr`.
A child ended by a signal carries `killed`/`signal` and **no** numeric code, so a
group killed at the bound can never be mistaken for `git diff --quiet` reporting
staged changes.

The bound is `SIGTERM` to the group at `GIT_TIMEOUT_MS` (unchanged, 120 s), then
`SIGKILL` to the group after `GIT_KILL_GRACE_MS` (5 s) for a member that ignores
the polite signal. Both timers are cleared when the child settles, and the
escalation timer is `unref`ed so a pending grace period cannot hold the CLI open.

### The two consequences the issue told me to check, checked

- **Output is still collected** — `runGit(["--version"])` returns
  `git version …` on `stdout`; `corpus workspace maintain` prints its real
  object counts (below).
- **The child is still reaped here** — it stays this process's child whatever
  group it is in; `close` fires and the promise settles in every test and every
  real run.
- **What does change**, disclosed rather than discovered: a terminal's Ctrl-C no
  longer reaches git directly, since signals go to the foreground group the child
  has left. An interrupted `corpus init` ends its git child through the bound
  instead of instantly — a second or two of a `git commit` on the way out,
  against the unsupervised repack this issue was filed for.
- **stdin is now `/dev/null`** rather than an open pipe nobody writes to. A
  detached child cannot read the terminal without being stopped by `SIGTTIN`,
  which would turn a prompt into a 120-second hang; closed stdin makes it an
  immediate EOF and an ordinary git error, which is the failure §4 reports.

### Tests

`git-timeout.test.ts` rewritten onto the new mechanism and **keeps pinning that
the bound exists**: `detached: true` present, `stdio` closed, the expiry
signalling `-4711` and not `4711`, the `SIGKILL` escalation, nothing signalled
when git finishes normally, and the 60 s floor on `GIT_TIMEOUT_MS`. A second
describe pins the rejection shape every caller reads.

`git-process-group.test.ts` (new) is the measurement, with **real processes and
real signals and no mock**: a fake `git` on `PATH` forks a long-lived child and
hangs, `runGit` really spawns it, and `ps -o pgid=` is read.

```
✓ leads a process group of its own, so the bound can signal the fork with it
✓ ends with its fork when the group is signalled, which is what expiry does
```

It asserts `groupOf(gc) === gc`, `groupOf(gc) !== groupOf(process.pid)` and
`groupOf(forked) === gc` — the property the whole fix rests on — then sends the
signal the bound sends and asserts **both** processes are gone. The 120 s bound
is never waited out.

### E2E against a real workspace

```
$ corpus init ws2 --port 8892
Initialized Corpus workspace at …/ws2
  git: initialized on main, one commit authored as user
  git: background maintenance is off here — corpus packs the repository at server start
  installed 26 template files, recorded in .corpus/template-manifest.json

$ git -C ws2 log --format="%an <%ae> %s"
user <user@corpus.local> workspace: initialize corpus workspace by user

$ corpus workspace maintain
loose objects   48
packed objects  0
packs           0
packs at        6700 loose objects
  nothing to pack yet; corpus packs at server start once the count is above the threshold.
```

Every git path — `init`, `add`, `commit`, `config`, `count-objects`,
`rev-parse` — runs through the new `spawn`, with the right author and the right
numbers. `corpus server start` / `corpus server stop` on port 8891 both worked
through the same code in this session.

### Checks

`npm run typecheck -w apps/cli` clean, eslint clean, prettier clean,
`vitest run apps/cli scripts/…` — 109 files, 2148 tests, exit 0. No orphaned
processes: `ps -Ao pid,args | grep -E 'cli039|fake-gc'` empty afterwards.

## Completion Checklist (domain agent)

- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] Committed with `[ISSUE-ID]` prefix
