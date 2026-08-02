# [UI-033] First pointer move after focus-close never activates the column under the cursor

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
- Blocks: —

## Spec References
- SPEC.md §10 board keyboard/pointer model (hover-follows-active)

## Summary
Found diagnosing the anchor-layer e2e flake during the v0.1.0 release push
(2026-08-02). The UI-031 latch (`keyboardOwns` in
`apps/ui/src/keyboard/useActiveColumn.ts`) is released by a `document`-level
`mousemove` listener, but column activation comes only from `onMouseOver` on the
column section. Chromium dispatches a movement's boundary events **before** its
`mousemove`, so the first real pointer movement after `hold()` always has its
`mouseover` evaluated while the latch is still armed — dropped — and the
`mousemove` that disarms the latch carries no activation of its own. The column
adopts the board only on the **next element-boundary crossing**, contradicting
the rule documented at `useActiveColumn.ts:42` ("released by the same real
`mousemove`").

Benign for users in busy layouts (real motion crosses boundaries within pixels),
but a pointer travelling inside one uniform region (empty `.col-list`, a large
`.row-excerpt`, board background) can move a long way with the column still
inactive — same family as the UI-022 "wiggle the mouse" complaint. The origin
column keeps the board and `esc` keeps working, so nothing is stranded. The
e2e spec (`apps/ui/e2e/anchor-layer.spec.ts`, "keeps the origin column active")
was stabilized with an honest two-move gesture and stays green if this is fixed.

## Proposed fix (from the diagnosing agent — verify, don't assume)
1. `useActiveColumn.ts`: register the `mousemove` release listener with
   `capture: true` (React dispatches at the root container, inside `document`'s
   bubble path, so a bubble-phase release still runs after the column's handler).
2. `Column.tsx`: add `onMouseMove={onActivate}` beside `onMouseOver={onActivate}`
   — `activate` is a `setWanted` no-op after the first call, so no extra renders
   in steady state.
Note: the same swallowing applies to `pin()` (`⇧←`/`⇧→`), where it is arguably
desirable — decide explicitly whether `pin()` keeps the current behavior.

## Acceptance Criteria
- [ ] A single post-close pointer move activates the column under the cursor
- [ ] `pin()` behavior decided explicitly and tested either way
- [ ] Unit test in `useActiveColumn.test.ts` for the event-order race
- [ ] E2E: single-move activation asserted; the existing two-move spec still green

## Technical Design
### Files to Create/Modify
- `apps/ui/src/keyboard/useActiveColumn.ts`
- `apps/ui/src/board/Column.tsx`
- `apps/ui/src/keyboard/useActiveColumn.test.ts`
- `apps/ui/e2e/anchor-layer.spec.ts` (additive assertion only)

## Testing Strategy
Unit test simulating mouseover-before-mousemove ordering; e2e single-move case.

## E2E Verification Plan
Real app: close full screen with pointer parked over another column; one small
mouse move activates that column (keyboard nav follows it).

## E2E Verification Log
_Filled by the implementing agent; state the model._

## Completion Checklist (domain agent)
- [ ] Tests written and passing
- [ ] `/lint` passes
- [ ] E2E verification log filled
- [ ] Self-review
- [ ] Acceptance criteria verified

## Completion Checklist (orchestrator)
- [ ] Committed with `[ISSUE-ID]` prefix
