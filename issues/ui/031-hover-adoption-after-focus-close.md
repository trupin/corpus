# [UI-031] Closing full screen must not adopt the column under the resting pointer

## Domain
ui

## Status
todo

## Priority
P2

## Model
opus

## Dependencies
- Depends on: UI-005
- Blocks: —

## Spec References
- SPEC.md §11 — active column follows focus/hover; esc/⌫ close-back precedence

## Summary
User decision (2026-07-31, sign-off round): after closing full screen, the column
under the *resting* mouse becomes active (§11's hover-follows-active fires on the
overlay unmount), which strands `esc` for keyboard-only flow until the mouse
physically moves (UI-022 eval finding: 7 dead presses, survives reload; hovering
restores). Signed rule: **on programmatic close, keep the origin column active and
ignore the pointer's position until it actually moves** — hover re-adopts only on
real mouse movement. Implementation shape: suppress hover-adoption until the next
`mousemove` after a focus-mode close (a one-shot latch), not a permanent behavior
change to hover-follows-active.

## Acceptance Criteria
- [ ] Enter focus from column A with the pointer parked over column B's area → esc → column A is still active; esc keeps working
- [ ] Moving the mouse afterwards resumes normal hover-follows-active immediately
- [ ] No change to click/keyboard column activation

## Technical Design
### Files to Create/Modify
- The active-column hover tracking (apps/ui/src/board/ or shell/) + tests; e2e case in the focus spec

## Testing Strategy
apps/ui scoped (VITEST_MAX_THREADS=4).

## E2E Verification Plan
Real app: reproduce the eval's exact drill (ref-follow in focus, esc with parked pointer) → esc still closes/backs.

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
