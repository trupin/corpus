# [CONTRACT-007] Forms surface: formAnswer schema + form.respond producer routes

## Domain

contract

## Status

todo

## Priority

P1

## Model

opus — SPEC §8's form fence grammar and §7's form.respond event are specified; the work is schema enumeration.

## Dependencies

- Depends on: CONTRACT-002
- Blocks: SERVER-016, UI-008

## Spec References

- SPEC.md §8 — form fences in agent turns, the answer flow; §7 — `form.respond` event type
- `issues/sprints/sprint-006.md` — Open Conflict 3 (discovery: zero form surface shipped)

## Summary

Discovered by sprint-006: no `formAnswer` schema and no producer of `form.respond` exist anywhere in the contract, so SERVER-006's form AC was struck. This issue designs the form-answer wire surface (the answer submission route/shape, its validation against the form fence's fields, and the `form.respond` event payload) before UI-008 renders forms.

## Acceptance Criteria

- [ ] Form-answer request/response schemas per §8; the submission route declared; `form.respond` payload pinned in the QueueEvent core types.
- [ ] All standing invariants; artifacts regenerated; round-trips.

## Technical Design

To be refined when scheduled (Phase 3, before UI-008).

## E2E Verification Log

_Filled in by the implementing agent as proof-of-work. State which model the implementing agent ran on ("implemented on: opus | fable")._

### Reproduction (bugs only)

_[Agent fills if applicable]_

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
