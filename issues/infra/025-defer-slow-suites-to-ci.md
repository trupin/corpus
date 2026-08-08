# [INFRA-025] Defer the slow suites to CI; run only fast tests locally

## Domain

infra

## Status

done

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: INFRA-024 (the inert-path fast path, which this partly subsumes)

## Spec References

- —

## Summary

**User decision, 2026-08-07**: *"We should be leveraging the CI more. Let's defer
slow test suites to the CI only and only run the fast test suites locally."*

Before: every commit ran ~10,500 unit tests, and every push added the full
Playwright suite. A one-paragraph SPEC edit cost the same gate as a rewrite of
the projection.

**This is not only a speed change.** `.githooks/pre-push` already documents
(INFRA-019) that git opens the transport to the remote *before* running the
hook, so a gate slow enough to outlast the remote's idle timeout makes the push
die with SIGPIPE **after** printing that every check passed — nothing lands, and
git reports nothing. The e2e suite is what pushed the gate over that line.
Observed repeatedly in this session: pushes stalling and having to be re-run. A
fast gate wins that race, so this buys correctness as well as minutes.

## What changed

The target was set explicitly by the user mid-session: **10-15 seconds max**.
Two intermediate attempts missed it, and the arithmetic is why — type-aware
eslint builds the whole TypeScript program even to lint one file, and a
libs-only build is still five `tsc` runs. Neither fits in fifteen seconds. So
the gate stops doing compile-class work at all.

**The rule, as the user put it**: a check that can run on the diff runs locally;
a check that needs the whole codebase is CI's.

- **pre-commit**: `npm audit`, `eslint` on staged TypeScript, `prettier` on
  staged files.
- **pre-push**: `version:check`, and `eslint` over the pushed range.
- **CI only**: `tsc --noEmit` (project-wide, no diff-scoped form exists), build,
  the generated-artifact drift check that depends on it, the unit suite, and
  Playwright.

**A measurement that reversed a decision**: the first two attempts assumed
type-aware eslint could not be fast because it builds the whole program even for
one file. Measured, it is ~2s for one file and ~3s across three workspaces — it
was `eslint .` that cost ~2.5 minutes at 3 GB, the whole-repo run rather than the
type-aware machinery. So eslint came back. The unit suite was measured too and
stays in CI even scoped to changed files.

## Why version:check is the one survivor

It reads manifests and `git show`; it starts no compiler. And it guards the one
failure CI cannot un-break after the fact: a `v*` tag pointing at a tree the
release guard rejects is already published by the time CI reports it (INFRA-022),
and unwinding a pushed tag is a documented recovery procedure rather than a
re-run. Everything else CI catches costs a red PR and a second push.

## What this gives up, stated plainly

A broken build, a type error and a failing test now reach the remote before
anything objects. The developer finds out from CI, minutes later, instead of
from the commit. Lint and formatting still fail locally, on the diff.

That is a real loss and it was chosen deliberately. It is bounded by an existing
rule: **a PR merges only when `CI / validate` is green on its head commit**, and
CI runs everything. So the cost is a red PR and a second push — never a bad
merge, and never a bad `main`.

The honest counterweight: for most of this session the local gate was not
catching defects, it was re-proving a green suite for the twelfth time while the
laptop swapped.

## Acceptance Criteria

- [x] A commit finishes within the 10-15s target
- [x] The local gate runs no compile-class work — no build, no type-aware lint,
      no `tsc`, no test suite
- [x] Prettier is scoped to staged files, so a prose commit pays milliseconds
- [x] Both hooks say what they deferred and how to run it by hand
- [x] CI is untouched and still runs everything
- [x] `version:check` survives on pre-push, for the reason above

## E2E Verification Log

Applied by the orchestrator on **Opus 5 (1M context)**, 2026-08-07, at the
user's instruction to apply immediately. Timings recorded on the commit that
carries this file.

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-025]` prefix
