# [INFRA-019] A slow pre-push gate outlives the SSH session git already opened

## Domain
infra

## Status
done — cause identified and fixed 2026-08-03. Two earlier diagnoses in this file
were wrong and are kept below, because the wrong turns are the useful part.

## Priority
P0

## Model
opus

## Dependencies
- Depends on: —
- Blocks: — (blocked the v0.2.0 release and the Phase 12 branch push)

## Spec References
- —

## Summary
A push runs the full pre-push gate, prints `pre-push ✓ all checks passed`, and
then **exits 141 with nothing on the remote and no error from git at all**.
First hit while releasing v0.2.0; hit again pushing `phase-12-dogfood-wave2`.

**The cause.** `GIT_TRACE=1` on a failing push shows the ordering that explains
everything:

```
11:29:23  run_command: ssh git@github.com 'git-receive-pack '\''trupin/corpus.git'\'''
11:29:25  run_command: /Users/…/.githooks/pre-push origin git@github.com:trupin/corpus.git
          … the gate runs for three to five minutes (e2e included) …
          pre-push ✓ all checks passed
          <no further trace line — git is gone, exit 141>
```

git opens the transport to the remote **before** it runs the hook, then waits for
the hook. By the time this gate finishes, GitHub has closed the idle
`git-receive-pack` session, and git's first write to that dead connection raises
SIGPIPE (141 = 128 + 13). Nothing reaches the remote, the gate output says
everything passed, and git prints no error because it dies before reaching its
reporting path.

Compare a **successful** push's trace at the same point:

```
          pre-push ✓ all checks passed
11:14:xx  run_command: git pack-objects --all-progress-implied --revs --stdout …
          remote: … / To github.com:trupin/corpus.git / 6cef2d3..9ef0079  main -> main
```

`pack-objects` is the first thing git does after the hook. Its absence is the
signature of this failure.

**The fix.** SSH keepalives, so the session survives a slow hook:

```
ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=30
```

It **cannot** be set from inside the hook — git opened the connection before the
hook existed, so an `export GIT_SSH_COMMAND` there reaches only the hook's own
children (this was tried, and was wrong). It has to be in git's configuration
before the push starts, so `npm run setup-hooks` now sets `core.sshCommand`
alongside `core.hooksPath`.

## Two wrong diagnoses, kept on purpose

1. **"The hook never reads its stdin."** git hands a pre-push hook the ref list
   on stdin; this hook ignored it, and every step spawns children that inherit
   that descriptor. Plausible mechanism for a SIGPIPE, and wrong. The drain
   shipped and pushes kept failing identically. It is kept as hygiene — a hook
   that leaves its stdin unread can strand a writer — but it fixed nothing here.
2. **"Tag refs fail, branch refs work."** Drawn from a sample where the tag push
   failed and a branch push then succeeded. It also predicted "new ref creation
   fails", which the Phase 12 **branch** push disproved by failing the same way.
   The real variable was never the ref type; it was how long the gate ran before
   git tried to use the connection, which reads as intermittent because it is a
   race against the remote's idle timeout.

The lesson worth keeping: *a clean gate followed by a silent 141 is a transport
problem, not a hook problem.* Reach for `GIT_TRACE=1` first — it distinguishes
the two in one run, and both wrong turns above would have been skipped by
looking at whether `pack-objects` ever started.

## Acceptance Criteria
- [x] Cause identified from evidence, not inferred from symptoms
- [x] `git push` of a new branch lands without a detour (`phase-12-dogfood-wave2`
      pushed clean, exit 0, `* [new branch]`, remote sha matches local)
- [x] The fix is in git config, not the hook, since the hook runs too late
- [x] `npm run setup-hooks` applies it, so a fresh clone is not silently exposed
- [x] The hook documents the failure signature, so the next person reads the
      trace instead of re-deriving it
- [x] Releasing no longer depends on a human remembering a manual API call

## Technical Design
### Files to Create/Modify
- `package.json` — `setup-hooks` sets `core.sshCommand`
- `.githooks/pre-push` — the diagnosis, and why the fix cannot live there

### Notes
- A standing alternative if this recurs: make the gate fast enough that the
  session never idles out (e2e is the expensive step and CI runs it anyway).
  Keepalives are the cheaper fix and do not weaken the gate, so they came first.
- v0.2.0's tag ref was created through the GitHub API while this was unknown.
  That worked only because its commit was already on the remote; the API returns
  `422 Object does not exist` when the objects have not been uploaded, which is
  exactly what happened when the same trick was tried for the Phase 12 branch.

## Testing Strategy
The fix is verified by the thing it unblocks.

## E2E Verification Log

**Model: Fable 5, orchestrator, 2026-08-03.**

Failing, three times on v0.2.0's tag and twice on the Phase 12 branch:

```
$ /usr/bin/git push origin phase-12-dogfood-wave2 > log 2>&1; echo "EXIT=$?"
EXIT=141
$ tail -1 log
pre-push ✓ all checks passed
$ /usr/bin/git ls-remote origin refs/heads/phase-12-dogfood-wave2
(nothing)
```

With `GIT_TRACE=1`, ten trace lines total, the last being `git rev-parse
--show-toplevel` from inside the hook — and nothing after the gate. The
connection had been opened two seconds before the hook started.

With keepalives, same commit, same gate:

```
$ GIT_SSH_COMMAND="ssh -o ServerAliveInterval=20 -o ServerAliveCountMax=30" \
    /usr/bin/git push origin phase-12-dogfood-wave2
EXIT=0
To github.com:trupin/corpus.git
 * [new branch]      phase-12-dogfood-wave2 -> phase-12-dogfood-wave2
$ /usr/bin/git ls-remote origin refs/heads/phase-12-dogfood-wave2
96459eec570987ed258addd20e7ab3d6a8a7b503
$ /usr/bin/git rev-parse HEAD
96459eec570987ed258addd20e7ab3d6a8a7b503
```

`npm run setup-hooks` re-run on this clone; `git config core.sshCommand` now
reports the keepalive command.

## Completion Checklist (domain agent)
- [x] `/lint` passes
- [x] E2E verification log filled
- [x] Self-review
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
