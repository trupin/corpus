# [UI-204] Backspace on a focused image closes the reader

## Domain

ui

## Status

todo

## Priority

P1

## Model

opus

## Dependencies

- Depends on: —
- Related: UI-202 (the v0.37.1 evaluation found it, `issues/evals/v0.37.1-eval.md` O3)

## Spec References

- SPEC.md **§5** and **§10**

## Summary

Found 2026-10-13 by the v0.37.1 evaluator. When keyboard focus is on an image in a document body — which is exactly where Escape from the image viewer leaves it (SPEC §10) — Backspace closes the reader. It also happens without the viewer. Nothing is lost on disk, but a person who closes the viewer and presses Backspace to edit is thrown out of the document.

## Acceptance Criteria

- [ ] Reproduced against the real app before any change
- [ ] Backspace with focus on an image in a body does not close the reader; it does what the editor does beside the image, or nothing
- [ ] A test pins the behaviour and fails on the current code

## E2E Verification Log

_Implementing agent fills; state the model._
