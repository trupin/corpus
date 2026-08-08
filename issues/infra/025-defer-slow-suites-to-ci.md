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

- **pre-commit** runs `vitest run --changed` instead of the whole suite: the
  tests *related to what changed*, resolved through vitest's own module graph.
- **pre-push** no longer runs the full unit suite or Playwright. It keeps
  version singularity, the generated-artifact drift check, build, eslint,
  prettier and typecheck.
- Both print what they deferred and how to run it by hand.

## Why the module graph, not a hand-picked subset

A curated "fast suites" list would be a second inventory that drifts from the
first — the failure this project has fixed three times elsewhere (INFRA-022's
manifest set, `version-sources`' globs, the four copies of one sentence in
PR #28). A derived set cannot drift.

## What this gives up, stated plainly

`--changed` sees imports. It does **not** see a dependency that is not an
import: a fixture read at runtime, a generated artifact, a rule two workspaces
restate independently. Those now fail in CI rather than locally.

That is an accepted trade, and it is bounded by an existing rule: **a PR merges
only when `CI / validate` is green on its head commit**, and CI runs everything.
So the cost is a red PR and a second push, never a bad merge.

## Acceptance Criteria

- [x] The local gate no longer runs the full unit suite or Playwright
- [x] Related tests still run on commit, derived rather than listed
- [x] Both hooks say what they deferred and how to run it
- [x] CI is untouched and still runs everything
- [x] `--passWithNoTests` so a prose-only commit is not a failure

## E2E Verification Log

Applied by the orchestrator on **Opus 5 (1M context)**, 2026-08-07, at the
user's instruction to apply immediately. Timings recorded on the commit that
carries this file.

## Completion Checklist (orchestrator)

- [ ] Committed with `[INFRA-025]` prefix
