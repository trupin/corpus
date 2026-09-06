# [INFRA-041] Four script findings the gates cannot see

## Domain

infra

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Blocks: —

## Origin

Batched 2026-09-06 from **SHARED-003** (the PR #11 / PR #12 review ledger) by the
audit that closed it. Four infra findings survived the ledger's earlier sweeps.
Three are in `scripts/` and share a shape: a guard or an assertion whose failure
mode the suite cannot see. The fourth is the CI workflow's fork-PR behaviour.

The ledger's other infra items are already struck: the pack-audit todos entry and
the ESLint core→plugin ban lost their subjects with the plugin surface
(SHARED-065/INFRA-031), the `release.yml` publish job was closed by INFRA-014, and
the manual-`npm run e2e`-against-live-8765 item was resolved by INFRA-028.

## Spec References

- SPEC.md §2.1 — packaging and what the installed tool resolves
- CLAUDE.md — "Verification Is On Demand": a check that can run on the diff runs
  locally, a check that needs the whole codebase is CI's

## Summary

Four findings, one pass. Items 1-3 are all the same defect in different scripts:
something the script asserts is not itself asserted, so the assertion could be
deleted or could misreport and every gate would stay green. Item 4 is a known CI
behaviour on fork PRs, deferred with a stated trigger condition.

**Line numbers below are the ledger's, recorded 2026-07-29 to 2026-07-31. Verify
each location before editing and record any drift in the log.** An item that no
longer applies is struck with evidence, not silently ticked.

## Acceptance Criteria

- [ ] **1. `scripts/merge-coverage.ts:149-156` — the INFRA-009 guard is
      untested.** Deleting the call site keeps the whole suite green, which means
      nothing proves the guard runs. Add a test that fails when the guard is
      removed. The test must exercise the wiring, not re-test the guard's own
      logic in isolation — the defect is that the call site is unpinned.

- [ ] **2. `scripts/package-staging.ts:153` — `externalizeThirdParty` would
      externalize Node `#subpath` imports.** The result is a `PackagingError`
      that is loud but confusing: it names an externalization problem when the
      cause is a subpath import that should never have been treated as a package.
      Either handle `#`-prefixed specifiers explicitly, or make the error name the
      real cause. Whichever is chosen, add the case to the script's tests so the
      behaviour is pinned rather than incidental.

- [ ] **3. `scripts/check-pack.ts:70-80` — the staged-name assertion sits inside
      the zero-violations branch.** Two consequences, both recorded and both
      real: combined failures under-report (a name mismatch is invisible while
      any violation exists), and a name-only mismatch prints a success line
      before the failure. **The exit codes are correct** — this is about what a
      human reading the output concludes. Hoist the assertion out of the branch
      so every failure is reported in one pass, and make the output order match
      the verdict. Add a test with both failures at once.

- [ ] **4. Fork PRs' read-only `GITHUB_TOKEN` makes the sticky comment job fail
      red.** (PR #16 review, finding 4.) The job is not required, so a fork PR
      can still merge — but it shows a red check on every outside contribution.
      The ledger deferred this with an explicit trigger: "revisit if/when outside
      contributions start". **The decision for this issue is whether that trigger
      has fired.** If the repository still takes no outside PRs, strike this item
      with that as the evidence and leave the workflow alone. If it does, make the
      job skip cleanly on a fork rather than fail — a skipped check reads as "not
      applicable", a red one reads as "broken".

- [ ] Every fixed item is covered by a test that fails without the fix. Items 1-3
      exist **because** their subjects are untested; a fix with no test repeats
      the defect.
- [ ] No new work is added to the git hooks. Per INFRA-025 the hooks are
      diff-scoped and stay that way: anything whole-repo belongs to CI.

## Technical Design

### Files to Create/Modify

- `scripts/merge-coverage.ts` and its test — item 1
- `scripts/package-staging.ts` and its test — item 2
- `scripts/check-pack.ts` and its test — item 3
- `.github/workflows/package.yml` — item 4, only if its trigger has fired

### Key Implementation Details

Items 1-3 are the same lesson and should be fixed the same way: the thing that
was missing is a test that dies when the code is removed. For item 1 that is
literal — the ledger's own test for the defect is "delete the call site and see
whether anything goes red". Write the test that would have gone red.

For item 3, read the script's current structure before hoisting: the assertion
may have been placed inside the branch because it depends on state the violation
path does not compute. If so, the fix is to compute it unconditionally, not to
move the assertion and hope.

For item 4, do not change the workflow on speculation. The ledger's deferral is a
decision with a named trigger, and re-opening it without the trigger is churn.
Check the repository's PR history for an outside contribution, record what was
found, and act on that.

### Edge Cases

- `pack:check` is deliberately **not** in pre-push (it builds and packs, too slow
  for a push). Item 3's fix must not change that.
- `npm run coverage` is the CI gate at ≥ 90% on four metrics. Item 1's new test
  contributes to that number — make sure it tests something rather than merely
  executing lines.
- A `PackagingError` message change (item 2) may be asserted on by an existing
  test. Update it deliberately rather than loosening the assertion.

## Testing Strategy

Per item, a test that fails against the current code. Run the affected scripts'
tests directly (`npx vitest run scripts/`) before reporting done — per CLAUDE.md
the commit hook runs no tests and proves nothing about correctness.

## E2E Verification Plan

### Verification Steps

1. Item 1: comment out the guard's call site, run the suite, confirm it now goes
   red. Restore, confirm green. Quote both runs.
2. Item 2: stage a package with a `#subpath` import and show the error message
   before and after.
3. Item 3: produce a run with both a violation and a name mismatch; quote the
   full output before and after, and the exit code in both.
4. Item 4: quote the evidence for the trigger decision.
5. `npm run pack:check` and `npm run coverage` both still pass.

## E2E Verification Log

_[Agent fills, item by item, with the actual command output. A struck item needs
its evidence here too. State which model the implementing agent ran on.]_

## Completion Checklist (domain agent)

- [ ] All four items ticked or struck with evidence
- [ ] Tests written and passing; each fails without its fix
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: no new whole-repo work added to the hooks
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed with `[INFRA-041]` prefix
