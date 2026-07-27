# [SERVER-019] Mount validation + skill-rollback handlers

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — the validator exists; rollback is a targeted git revert through the existing git module.

## Dependencies

- Depends on: CONTRACT-008
- Blocks: CLI-006

## Spec References

- SPEC.md §14 — validation; §7 — skill rollback loop safety
- `issues/contract/008-check-rollback-routes.md`

## Summary

Server half of the CLI-003 deferral (2026-07-27 adjudication): attach handlers to CONTRACT-008's routes. Validation reuses `apps/server/src/core/check.ts` — the same implementation the write path runs, per §14. Rollback restores a skill document's last-known-good version via the git module (revert of the file to a prior commit, authored per the acting party, through the standard mutation pipeline so projection and SSE stay consistent).

## Acceptance Criteria

- [ ] Validation handler: ids resolve through the projection; `(path, content)` pairs validate without touching disk; findings shape per contract; one validator implementation shared with the write path.
- [ ] Rollback handler: restores the skill file at its last-known-good (or `--to` ref), commits through the auto-committer with correct author, re-projects, invalidates; 404 unknown skill.
- [ ] Colocated tests + E2E evidence (real workspace, real curl).

## Technical Design

To be refined when scheduled (Phase 4, before AGENT-003).

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
- [ ] Committed with `[SERVER-019]` prefix
