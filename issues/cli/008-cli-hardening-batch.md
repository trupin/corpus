# [CLI-008] CLI hardening batch: PR #9 MINOR findings

## Domain

cli

## Status

todo

## Priority

P2

## Model

opus — small, precisely located fixes from the PR #9 review.

## Dependencies

- Depends on: CLI-003, CLI-004
- Blocks: —

## Spec References

- PR #9 review, MINOR findings 7–9 (CLI subset)

## Summary

CLI-side MINOR findings from the Phase 2 PR review, deferred out of the merge:

1. **`probeHealth` ignores `health.workspace`** (`commands/server/state.ts`): a foreign corpus server on the same port passes as this workspace's; in `start` the child can die EADDRINUSE while the ready-probe hits the foreigner, writing a pidfile for a dead pid and reporting success. Compare the workspace identity.
2. **`lock break --from agent` silently rewrites to `user`** (`commands/lock/break.ts`): refuse like `doc delete` does (exit 2, no request) — one guard pattern for the two user-only verbs; refresh the stale module-header prose.
3. **Tag edit read-modify-write** (`commands/doc/edit.ts`): `--add-tag`/`--remove-tag` is an unguarded GET-then-PUT; document the hazard and mitigate if the server offers a conditional write; otherwise note the accepted race in the module header.
4. **`readAll` duplication** (`commands/job/log.ts` vs `input.ts`): fold onto the `input.ts` implementation (CLI-007 likely already did this — verify and close).

## Acceptance Criteria

- [ ] Each item fixed with a regression test, or explicitly waived with a written rationale here.
- [ ] Full gate green.

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Post-Implementation Verification

_[Agent fills]_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review: spec compliance, code quality
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/audit` run (if qualifying)
- [ ] `/evaluate` passes (if evaluator active)
- [ ] Committed with `[CLI-008]` prefix
