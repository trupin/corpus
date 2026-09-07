# [UI-196] Capture has no weight control while the Ask designates

## Domain

ui

## Status

todo

## Priority

P1

## Model

fable

## Dependencies

- Depends on: UI-192 (whose ownership decision created this)

## Spec References

- SPEC.md **§10** — the weight sentence names "its Capture"

## Summary

UI-192's escalation, accepted 2026-09-07: resolving the duplicated weight
editors gave the composer row's Select sole ownership while the Ask
designates — and Capture, which shares the surface, lost its weight control
in that default state. The duplicate was judged worse than the narrowing,
and §10's "its Capture" wording says the narrowing is a real gap, not a
simplification. Decide a capture-scoped affordance (or a rider narrowing
§10) and implement.

## Acceptance Criteria

- [ ] Capture can state a weight in every state the spec grants it one, or
      a signed rider says it cannot
- [ ] No duplicated editor returns — UI-192's one-editor rule holds

## E2E Verification Log

_Implementing agent fills; state the model._
