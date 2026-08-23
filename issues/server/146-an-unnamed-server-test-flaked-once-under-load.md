# [SERVER-146] One server test failed once under load and has not been named

## Domain
server

## Status
todo

## Priority
P2 (nice-to-have)

## Model
opus

## Dependencies
- Depends on: —
- Blocks: —

## Spec References
- None. This is test-suite reliability, not product behaviour.

## Summary

**Recorded because the evidence was lost, and that is the finding.**

During v0.20.0's harvest, `vitest run apps/server` reported `1 failed | 4563
passed (4564)` on the run that verified SERVER-145. Two immediate re-runs of the
identical tree reported `201 files, 4564 tests passed`, exit 0.

**The failing test's name was not captured.** The orchestrator read the summary
line and not the failure body, so the only durable facts are the count, the
timestamp, and that the tree was unchanged between the three runs. The machine
was carrying two other agents at the time.

This is filed rather than dismissed. A test that fails once and passes twice is
either a flake or a real race that lost a coin toss, and "it passed on retry" is
not evidence of which. SERVER-140 in this same release was exactly that shape —
3 of 4 runs green — and turned out to be a real ordering bug in a test, fixed to
10 of 10.

## What to do

- [ ] Run `apps/server` under deliberate load — the conditions that produced it
      — with `--reporter=verbose` and the output captured to a file, repeatedly,
      until a failure is caught **with its name**.
- [ ] If it names a test that SERVER-140's family already covers (the watcher's
      out-of-band commit file, whose 15-second `WAIT` budget still governs its
      other tests — SERVER-140 flagged that explicitly), fold it there and close
      this.
- [ ] If it is a real race, fix it and falsify the fix.
- [ ] If a bounded search cannot reproduce it, close this with the search
      recorded, so the next person does not start from nothing.

## Technical Design

### Files to Create/Modify
- Whichever test the search names. None until then.

### Key Implementation Details

**Capture to a file, always.** The reason this issue is thin is that a summary
line was read where a log should have been kept. Every orchestrator-run gate in
this repo should redirect to a file — the cost is nothing and the alternative is
this issue.

INFRA-020 already tracks "tests that fail under gate load and pass in isolation"
as a pattern. Check it before starting: this may be one more instance rather
than a new thing.

### Edge Cases
- The failure being in a file whose whole-file budget is the problem rather than
  one assertion's.

## Testing Strategy

The search **is** the work. Repeated runs under load, verbose, captured.

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. `VITEST_MAX_THREADS=4 ./node_modules/.bin/vitest run apps/server --reporter=verbose > log 2>&1`
2. Run concurrent work to reproduce the load
3. Repeat until a failure is captured with its name

### Verification Steps
1. Ten consecutive green runs under the same load, as SERVER-140 required of
   itself

## E2E Verification Log

### Reproduction (bugs only)
2026-08-23, v0.20.0 harvest: `1 failed | 4563 passed (4564)`, name not captured.
Two re-runs of the same tree: `4564 passed`, exit 0, both times.

### Post-Implementation Verification
_[Agent fills]_

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] `/audit` run (if qualifying — P0, cross-domain, large, or security-sensitive)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[ISSUE-ID]` prefix
