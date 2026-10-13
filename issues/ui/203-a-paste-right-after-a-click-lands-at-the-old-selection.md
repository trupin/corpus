# [UI-203] A paste right after a click lands at the old selection

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
- Related: UI-202 (the v0.37.1 evaluation found it, `issues/evals/v0.37.1-eval.md` O1)

## Spec References

- SPEC.md **§5** and **§10**

## Summary

Found 2026-10-13 by the v0.37.1 evaluator. In a document body, click to place the caret and paste at once: the text lands at the editor's previous selection (the start of the document), not at the caret. It happens on a note that never opened the image viewer, so it is older than UI-202. Nothing is lost, but the text goes somewhere the person did not put it. UI-202 found that ProseMirror learns of a click only from the async `selectionchange` (~15 ms in Chromium); a keystroke forces a flush, a paste evidently does not.

## Acceptance Criteria

- [ ] Reproduced against the real app before any change
- [ ] A paste made at once after a click lands at the caret the click placed
- [ ] A test pins the behaviour and fails on the current code

## E2E Verification Log

_Implementing agent fills; state the model._
