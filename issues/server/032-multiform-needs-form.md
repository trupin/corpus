# [SERVER-032] `needs=form` drops a thread while a second form is still answerable

## Domain

server

## Status

todo

## Priority

P2

## Model

opus — a detector refinement with a SPEC-reading to confirm.

## Dependencies

- Depends on: SERVER-029
- Blocks: —

## Spec References

- SPEC.md §6/§11 — forms and the needs reasons
- issues/evals/HARDENING-P4-eval.md — F-1 (2026-07-29)

## Summary

Found by the Phase 4 evaluator (reproducible): a thread carrying **two** unanswered forms leaves
`needs=form` once *either* form is answered — the first answer moves `last_author` to `user`,
which is the detector's engagement heuristic — while the second form remains answerable (`201`)
and UI-013's finding-12 fix deliberately keeps every unanswered form live in the renderer. SPEC §6
reads as form-scoped, so detector and renderer disagree on multi-form threads.

Refine the detector so a thread stays in `needs=form` while ANY unanswered agent form exists
(per-form answered-state, buildable from `has_form` turns vs. answer turns), or — if the product
answer is "one form at a time" — propose the SPEC clarification instead. Decide with a SPEC
reading; don't guess.

## Acceptance Criteria

- [ ] Multi-form thread behavior is consistent across detector, renderer, and SPEC — either the
      detector counts unanswered forms, or the SPEC says one-at-a-time and the renderer follows.
- [ ] The evaluator's reproduction is the regression test.

## E2E Verification Log

_Filled in by the implementing agent. State the model._

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
