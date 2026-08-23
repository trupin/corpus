# [SERVER-140] `commit-out-of-band` races chokidar against `selfWrites.record`

## Domain
server

## Priority
P2

## Status
todo

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
- [ ] The test decides the interleaving rather than timing it. SERVER-136
      exposed `mutex` on `CorpusServer` for exactly this reason — holding a lane
      is how an ordering is decided
- [ ] It fails when the out-of-band guard is removed, and passes 10 consecutive
      full-suite runs with it
- [ ] If the race is in the product rather than the test, that is the finding
      and the fix goes there instead

## Testing Strategy
Run the full server suite ten times and count. A pass rate is the evidence here,
not a single green run.

## E2E Verification Plan
### Verification Steps
1. Ten full `npm test -w apps/server` runs, before and after.

## E2E Verification Log
_Filled in by the implementing agent._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in

## Completion Checklist (orchestrator)
- [ ] Committed with `[SERVER-140]` prefix
