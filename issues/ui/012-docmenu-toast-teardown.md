# [UI-012] DocMenu's Still current / Archive / Resolve never toast — callbacks dropped on unmount

## Domain

ui

## Status

todo

## Priority

P2

## Model

opus — a menu-close timing change with a known mechanism; care, not judgment.

## Dependencies

- Depends on: UI-005
- Blocks: —

## Spec References

- SPEC.md §11 (reader/menu affordances)
- `apps/ui/src/shell/Toasts.tsx` docblock (no silent committed writes)

## Summary

Found by the sprint-010 fix pass (2026-07-28), verified in a real browser: the ⋯ menu's
**Still current**, **Archive** and **Resolve** call `onClose()` synchronously after `mutate()`,
unmounting `DocMenu` before the request settles. TanStack Query v5 drops per-call
`onSuccess`/`onError` callbacks on observer teardown, so none of the three ever toasts — the
write commits (observed: `PUT /api/docs/... {"reviewed":"…"}` fired, `.toast` count stayed 0
across ~3 s) with zero user feedback. **Delete is unaffected** (it closes inside `onSuccess` —
which is also the shape of the fix).

## Acceptance Criteria

- [ ] All three actions toast on success and on error, with the menu closing at a timing that
      doesn't regress keyboard focus return.
- [ ] A test pins the teardown path: mutation settling after unmount must still surface feedback.
- [ ] Delete's behavior unchanged.

## Technical Design

Either close inside `onSuccess`/`onError` (Delete's pattern), or move the toast to the mutation
hook's own callbacks (which survive observer teardown), or fire the toast before close from the
mutation promise. Pick one, apply to all three actions consistently.

## E2E Verification Log

_(to be filled by the implementing agent)_

## Completion Checklist (domain agent)

- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled in with concrete evidence
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)

- [ ] `/evaluate` passes
- [ ] Committed
