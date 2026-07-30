# [UI-015] Remaining per-call mutation callbacks vulnerable to observer teardown

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus — apply UI-012's shipped pattern to two named call sites.

## Dependencies

- Depends on: UI-012
- Blocks: —

## Spec References

- issues/ui/012-docmenu-toast-teardown.md — the mechanism (TanStack v5 drops per-call
  onSuccess/onError on observer teardown) and the shipped fix (`SettledCallbacks` hook-level
  callbacks in @corpus/kit)
- UI-012 implementing agent's report (2026-07-29)

## Summary

Found while fixing UI-012, out of its scope: two more call sites report outcomes through per-call
callbacks that die with the observer — `useAnchorLayer.post` (thread-creation warnings) and
`ThreadCard`'s own resolve button. Both are safe today only because their surfaces happen to stay
mounted; both go silent if the reader closes mid-flight. Apply the `SettledCallbacks` pattern to
each; a teardown-path test per site (settle after unmount ⇒ feedback still surfaces).

## Acceptance Criteria

- [ ] Both sites surface success/error after their component unmounts mid-flight; tests pin the
      teardown path.
- [ ] No behavior change while mounted.

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
