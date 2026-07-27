# [CONTRACT-008] Validation + skill-rollback routes (doc check / skill rollback surface)

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — the validator's shape already exists server-side; this pins it to the wire.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: SERVER-019, CLI-006

## Spec References

- SPEC.md §14 — validation ("hooks and API share one implementation"), `doc check --staged`
- SPEC.md §7 — skills as documents, `corpus skill rollback` loop safety
- `issues/sprints/sprint-007.md` — Open Conflicts (discovery: no validation or targeted-revert endpoint exists)

## Summary

Deferred out of CLI-003 (2026-07-27 adjudication): `corpus doc check` and `corpus skill rollback` have no server endpoints. The validator itself already exists (`apps/server/src/core/check.ts`; its `CheckDocument` type is already the `(path, content)` pair shape `--staged` needs) — this issue declares the wire surface: a validation route accepting either document ids or `(path, content)` pairs and returning structured findings (errors vs warnings), and a targeted-revert route restoring a skill's last-known-good version, returning the restored commit and path.

## Acceptance Criteria

- [ ] Validation route: request accepts ids XOR `(path, content)` pairs; response distinguishes errors (exit-6 class) from warnings (orphaned anchors, unresolved `[[refs]]`); shapes reuse/align with `CheckDocument`.
- [ ] Skill-rollback route: request `{name, to?}`; 404 for unknown skill; response carries restored commit + file path.
- [ ] All standing contract invariants hold; artifacts regenerated; client round-trips.

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
- [ ] Committed with the issue-ID prefix
