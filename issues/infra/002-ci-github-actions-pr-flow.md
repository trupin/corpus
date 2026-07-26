# [INFRA-002] CI GitHub Action + PR-based landing flow

## Domain

infra

## Status

done

## Priority

P0

## Dependencies

- Depends on: INFRA-001
- Blocks: —

## Spec References

- CLAUDE.md — Git Workflow (rules updated by this issue)

## Summary

Add a `CI` GitHub Actions workflow mirroring the local pre-push gate (lint, format check, typecheck, unit tests, e2e-when-specs-exist) running on every PR and on pushes to `main`. Update the Git Workflow rules: every significant change lands via a PR, and a PR merges only when all validation actions are green on its head commit. Enforce the check requirement server-side with a branch ruleset on `main`.

## Acceptance Criteria

- [x] `.github/workflows/ci.yml` runs lint, format:check, typecheck, unit tests on `pull_request` and `push` to `main`; Playwright step self-skips while no e2e specs exist (same guard as pre-push).
- [x] CLAUDE.md Git Workflow requires branch + PR for significant changes and green `CI / validate` before merging; trivial bookkeeping may still commit directly.
- [x] This change itself lands through a PR that shows the new workflow passing (proof the action works).
- [x] Branch protection/ruleset on `main` requires the `validate` status check for PRs.

## Technical Design

### Files to Create/Modify

- `.github/workflows/ci.yml` — the validate job (Node 22, npm cache, npm ci, the four gates + guarded e2e)
- `CLAUDE.md` — Git Workflow rules 1–2 (PR flow, green-checks requirement)
- `issues/PLAN.md` — this row

### Key Implementation Details

Single `validate` job so the required-status-check context is one stable name. `concurrency` cancels superseded runs per ref. CI intentionally duplicates the pre-push gate: hooks give fast local feedback, CI gives the authoritative, unskippable verdict.

### Edge Cases

- No e2e specs yet: the Playwright step prints an explicit skip line instead of failing on "no tests found"; browser install only happens once specs exist.

## Testing Strategy

The PR for this issue is the test: the workflow must appear, run, and pass on the PR's head commit before merge.

## E2E Verification Plan

### Verification Steps

1. Push the branch, open a PR.
2. Observe the `CI / validate` check run and pass on GitHub (not locally).
3. Merge only after green; confirm the check also runs on the resulting `main` push.

## E2E Verification Log

### Post-Implementation Verification

2026-07-26, real GitHub runs (no local simulation):

- PR #1 (https://github.com/trupin/corpus/pull/1) opened from `infra-002-ci`; `validate` check ran on GitHub and passed: https://github.com/trupin/corpus/actions/runs/30206142928/job/89804434411 (`gh pr checks 1` → `validate SUCCESS`).
- Ruleset `main-protection` (id 19767610) created on the default branch via API: PRs required, `validate` status check required, deletion + force-push blocked, repo-admin bypass for trivial direct commits.
- Merged via `gh pr merge 1 --rebase --delete-branch` only after the check was green; landed on `main` as `c20eb09`.

## Completion Checklist (domain agent)

- [x] Tests written and passing (CI run is the test)
- [x] `/lint` passes
- [x] E2E verification log filled in with concrete evidence
- [x] Self-review: spec compliance, code quality
- [x] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [x] Committed with `[INFRA-002]` prefix
