# [CLI-014] `stop` unowned-pidfile deletion + `upgrade --adopt` manifest honesty

## Domain
cli

## Status
todo

## Priority
P1

## Model
opus

## Dependencies
- Depends on: CLI-009 (foreign-branch precedent), CLI-005 (upgrade)
- Blocks: —

## Spec References
- SPEC.md §13 — server lifecycle (stop semantics)
- SPEC.md §13 — workspace upgrade

## Summary
Two PR #11 review findings on apps/cli, both adjudicated **fix** by the orchestrator:

1. **Finding 13 (stop.ts)**: the `unowned` branch
   (`apps/cli/src/commands/server/stop.ts:46-59`) still deletes a live pid's pidfile —
   the exact "may be this workspace's server on a previously configured port" argument
   CLI-009 used to make the `foreign` branch conservative; CLI-009's log escalated this
   branch rather than deciding it. Adjudication: apply the same treatment — never
   delete a pidfile whose pid is alive; report instead.
2. **Finding 12 (upgrade --adopt)**: on a pre-manifest workspace, the adopt path
   (`apps/cli/src/commands/workspace/upgrade.ts:175-181` with
   `template/plan.ts:170-189`) skips `applyPlan` but `nextManifestFiles` still records
   the incoming sha for files that were never installed. The plan prints
   `install <path>` that never happens, the baseline manifest claims a file not on
   disk, and later runs misreport it as user-deleted. Untested cell.

## Acceptance Criteria
- [ ] `stop` `unowned` branch: pidfile of a live pid is never deleted; the command reports the situation (mirroring the `foreign` branch's wording/behavior from CLI-009); dead-pid cleanup unchanged
- [ ] `upgrade --adopt` on a pre-manifest workspace: the recorded manifest matches reality — a template file absent from disk is not recorded as installed, and the printed plan lists only actions actually taken (decide: either genuinely install missing files under --adopt, or exclude them from `nextManifestFiles` and report them as pending — pick the semantics most consistent with what `--adopt` promises in its help text/docs, and justify in the log)
- [ ] A later `upgrade` run after an adopt no longer misreports never-installed files as user-deleted
- [ ] Tests cover both: live-pid unowned pidfile preserved; adopt-on-pre-manifest cell (manifest content, plan output, subsequent-run classification)

## Technical Design

### Files to Create/Modify
- `apps/cli/src/commands/server/stop.ts`
- `apps/cli/src/commands/workspace/upgrade.ts`, `apps/cli/src/template/plan.ts`
- colocated tests

### Key Implementation Details
Read CLI-009's issue file and log first — the `foreign` branch is the behavioral
template for the `unowned` fix. For --adopt, keep `--dry-run` writing nothing.

### Edge Cases
- Unowned pidfile whose pid died → still cleaned up (current behavior for dead pids stands).
- Adopt where *some* template files exist on disk and some don't — mixed recording must be per-file.

## Testing Strategy
apps/cli scoped tests (VITEST_MAX_THREADS=4).

## E2E Verification Plan

### Reproduction Steps (bugs only)
1. Scratch workspace (explicit --workspace path). For stop: craft an unowned pidfile pointing at a live pid; run `corpus server stop`; observe the pidfile deleted. For upgrade: strip the manifest, delete one template file, run `upgrade --adopt`; observe the manifest recording the missing file and a later run calling it user-deleted.

### Verification Steps
1. Rebuild the CLI; repeat both drills — pidfile preserved with a report; manifest matches disk and the follow-up run classifies correctly.

## E2E Verification Log
_Filled in by the implementing agent as proof-of-work._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
