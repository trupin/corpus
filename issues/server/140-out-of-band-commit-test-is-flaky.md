# [SERVER-140] `commit-out-of-band` races chokidar against `selfWrites.record`

## Domain
server

## Priority
P2

## Status
done

## Model
opus

## Dependencies
- Depends on: — (found by SERVER-137, 2026-08-22)

## Spec References
- SPEC.md §4 — the workspace, and what a write records

## Summary

Measured by SERVER-137's implementer while running the full server suite four
times: `apps/server/src/watcher/commit-out-of-band.test.ts > never lets a later
mutation carry the person's bytes` **failed on two of four full runs and passes
in isolation**.

Nothing in SERVER-137 touches the out-of-band committer. The test races a real
chokidar delivery against `selfWrites.record`, and under the load of a full
parallel suite the two land in either order.

## Why it matters

This is the test that protects a real rule: a person's edit made outside the
server must not be swallowed into the next mutation's commit as though the
server wrote it. A test for that rule which fails half the time under load is
worse than one that fails always — the failure reads as noise, and someone will
eventually re-run it until it passes.

`npm run coverage` and `CI / validate` both run the full suite, so this is a
50% chance of a red CI run on any push, attributable to nothing in the diff.

## Acceptance Criteria
- [x] The test decides the interleaving rather than timing it. (Not through
      `mutex` — this suite builds a watcher directly and has no `CorpusServer`,
      so the lever is `WatcherHandle.close()`, which stops the only other writer
      outright. See the log.)
- [x] It fails when the out-of-band guard is removed, and passes 10 consecutive
      full-suite runs with it
- [x] If the race is in the product rather than the test, that is the finding
      and the fix goes there instead — **it is partly in the product, and that
      is escalated rather than fixed here.** See "The finding" below.

## Testing Strategy
Run the full server suite ten times and count. A pass rate is the evidence here,
not a single green run.

## E2E Verification Plan
### Verification Steps
1. Ten full `npm test -w apps/server` runs, before and after.

## The finding

**Both halves of the race are real, and only one of them is the test's.**

### The half that is the test's

`waitForLog` polls `git log` against `WAIT`'s 15-second budget. What that budget
actually bounds is fsevents delivery to chokidar under load, which no test can
predict — the helper's own docstring already records it being outrun "for one
change in five runs", which is why the file's longer tests were handed
`PATIENT` (60 s). More patience is a bigger guess, not a decision.

Measured directly: with another agent's suite running concurrently on this
machine, this file reported **9 of 15 failed and took 230 s**, with the
watcher's invalidation keys empty — every wait starved at once. The same file in
isolation is **8 s** and green.

### The half that is the product's, and is **not** fixed here

`collectDocument` records an out-of-band commit for **every** event it processes,
including a duplicate delivery of a save it has already committed. `flush()` is
synchronous and hands that commit to a promise chain, so the commit's `git add`
stages the working tree **as it stands when the commit runs**, not as it stood
when the flush observed it. If the server writes the same path while such a
commit is waiting on the git lock, the person's commit carries the *server's*
bytes under `user` — the mirror image of the rule this very test protects.

`selfWrites.record` cannot prevent it: the observation that produced the queued
commit happened before the record, so `claim` never gets a say. That is exactly
the shape the issue's title names.

**Not fixed here, deliberately.** Closing it means either staging a snapshot of
the observed bytes rather than the working tree, or sharing a lock between the
watcher's commit chain and `applyOperations` — both are changes to the
watcher/committer boundary, and the obvious cheap patch (re-check the bytes
before committing and skip when they moved) is wrong in the case that matters:
when the *first* flush's commit is the stale one, skipping loses the person's
commit and the server's mutation carries `+Mine.` after all. **Escalated to the
orchestrator as a separate finding.** The window is narrow — it needs a
duplicate or late delivery and a server write to the same path within the same
few milliseconds — but it is a misattributed commit in §4's audit trail, which is
not a thing to leave undocumented.

## E2E Verification Log

**Model: Opus 5 (1M context).**

### Reproduction

Four consecutive `npm test -w apps/server` runs, before any change, nothing else
of mine on the machine:

```
run 1  Tests  4538 passed (4538)          137.04s
run 2  Tests  4541 passed (4541)          136.26s
run 3  Tests  4541 passed (4541)          179.73s
run 4  Tests  1 failed | 4540 passed      146.01s
       × commit-out-of-band.test.ts > an out-of-band edit is committed for itself
         (SPEC.md §4, SERVER-090) > never lets a later mutation carry the
         person's bytes under its own author                            806ms
```

**One in four, and the named test.** The 806 ms is the point: the test failed on
an assertion, not on `waitForLog`'s 15-second budget running out — which is what
identifies the second half above as the mechanism rather than plain starvation.
(The test counts differ across runs because another agent landed tests between
them.)

Separately, under a second agent's concurrent suite, the same file reported
**9 failed of 15** in 230 s with the watcher's invalidation keys empty — the
starvation half, at full strength.

### The change

`apps/server/src/watcher/commit-out-of-band.test.ts` only. Nothing in
`apps/server/src` changed.

1. **`watchedOutOfBandCommitter`** wraps the committer the watcher is given and
   exposes `committed(docId)`. The test now proceeds at the instant the person's
   commit landed, from inside the committer the watcher itself calls — no poll
   interval, no budget of the test's own. The remaining bound is vitest's own
   `testTimeout`, which is the right bound for a hang and the wrong one for a
   slow disk.
2. **The watcher is closed before the mutation.** `close()` clears the pending
   batch, awaits the commit chain and stops chokidar, so there is no second
   writer left to interleave with — the product window above cannot reach this
   assertion. It deliberately does **not** close the commit window, so the last
   assertion (the person's window is closed and relabelled by the agent's
   commit) is still the real one.
3. **`selfWrites.record` moved before the write**, which is what the registry's
   own docstring requires ("Call it **before** the bytes hit the filesystem") and
   what `applyOperations` does. The old order was the test disagreeing with the
   product about when a self-write becomes claimable.

Coverage is not lost by closing the watcher: `watcher.test.ts`'s "self-write
suppression" block already asserts, with the record-then-write order, that the
server's own bytes are not announced and not projected as a person's.

### Falsification, twice, restoring each file byte-for-byte afterwards

```
1. OUT_OF_BAND_ACTOR flipped "user" → "agent" in commit-out-of-band.ts
   × never lets a later mutation carry the person's bytes under its own author  561ms
     → expected 'agent|doc edit: Mortgage (doc_mortgag…' to contain 'user|'

2. `commitOutOfBand:` dropped from startWatcher — the guard removed entirely
   × never lets a later mutation carry the person's bytes under its own author  40064ms
     → Test timed out in 40000ms.
```

The second fails as a timeout by construction: with nothing committing the
person's change, the watcher's own signal never arrives. A hang is the honest
failure for a feature that has been deleted, and it is the price of not polling.

### Ten consecutive full-suite runs

```
npm test -w apps/server, ten times in a row, after the change:
  run  1 … run 10   Tests  4548 passed (4548)      10 / 10 green
```

Against **3 of 4** before it, on the same machine, in the same session, with the
same other agents on it. (The suite grew from 4538 to 4548 tests across the two
sets — other agents landed work between them; nothing was skipped or removed.)

The named test also passes in isolation, and the whole file passes:
`./node_modules/.bin/vitest run apps/server/src/watcher/commit-out-of-band.test.ts`
→ **15 passed** in 8.0 s.

### Not done, and said out loud

The 15-second `WAIT` budget still governs the file's **other** tests, and the
230 s / 9-failure measurement above is about all of them, not only this one.
That is a wider job than this issue's scope and is left unfixed. If CI goes red
on another test in this file, that is why.

## Completion Checklist (domain agent)
- [x] Tests written and passing
- [x] `/lint` passes
- [x] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[SERVER-140]` prefix
