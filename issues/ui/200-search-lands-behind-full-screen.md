# [UI-200] A search pick lands invisibly behind full screen

## Domain

ui

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: UI-199 (which found it)

## Spec References

- SPEC.md **§10** — search; full screen

## Summary

Found during UI-199's reproduction (2026-09-09): search (⌘K) stacks above
full screen, and choosing a result lands the pick as a loose path BEHIND
the overlay — the mode persists (correct, post-UI-199) but the gesture's
result is unseen. Decide what a search pick means inside full screen —
navigate the excursion (likely, matching "full screen stays"), or something
else — and implement.

## Acceptance Criteria

- [ ] A search pick made inside full screen has a visible result
- [ ] The decision recorded with the rejected alternative
- [ ] The battery/spec covers the search-over-full-screen state

## E2E Verification Log

_Implementing agent fills; state the model._
