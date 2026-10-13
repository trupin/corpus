# [UI-205] Space does not open the image viewer

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-202 (the v0.37.1 evaluation found it, `issues/evals/v0.37.1-eval.md` O2)

## Spec References

- SPEC.md **§5** and **§10**

## Summary

Found 2026-10-13 by the v0.37.1 evaluator. A viewable image carries `role="button"` and Enter opens the viewer, but Space does not. A button answers both keys by convention. The spec names neither key. Not compared with v0.37.0.

## Acceptance Criteria

- [ ] Reproduced against the real app before any change
- [ ] Space on a focused viewable image opens the viewer, as Enter does, without inserting a space in the body
- [ ] A test pins the behaviour and fails on the current code

## E2E Verification Log

_Implementing agent fills; state the model._
