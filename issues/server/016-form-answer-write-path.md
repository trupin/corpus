# [SERVER-016] Form answer write path (form.respond producer)

## Domain

server

## Status

todo

## Priority

P1

## Model

opus — consumes CONTRACT-007's pinned shapes through the shipped write pipeline.

## Dependencies

- Depends on: CONTRACT-007, SERVER-006
- Blocks: UI-008

## Spec References

- SPEC.md §8 — the answer flow; §7 — form.respond enqueue

## Summary

Implements CONTRACT-007's form-answer route through the shipped mutation pipeline: validate the answer against the form fence, append the answer turn, enqueue `form.respond`, clear the needs=form attention reason.

## Acceptance Criteria

- [ ] To be refined with CONTRACT-007; must include: answer validation against the fence's fields, the enqueue, and the attention-reason clearing SERVER-011 already keys on.

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
